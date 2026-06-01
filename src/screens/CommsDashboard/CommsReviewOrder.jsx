import React, { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import "./CommsReviewOrder.css";
import Logo from "../../images/logo.png";
import formatIndianNumber from "../../utils/formatIndianNumber";
import formatDate from "../../utils/formatDate";
import { usePopup } from "../../components/Popup";
import { generateAllPdfs } from "../../utils/pdfUtils";
import { NOTIFICATION_TYPES, sendNotification } from "../../utils/notificationService";
import config from "../../config/config";

/**
 * CommsReviewOrder — final step of the comms order flow.
 *
 * Receives the orderPayload from ProductForm (via location.state). Combines it
 * with comms-specific fields stashed in sessionStorage by CommsOrderForm. Then:
 *   - Renders a read-only summary for review
 *   - Captures mode of delivery + (sourcing-only) delivery address
 *   - For Personal Order engagement: captures advance amount + optional discount %
 *   - For Gifting/Barter > Rs 35,000: gates the order behind Jahnavi approval
 *     (saves with approval_status = 'pending_approval', notifies admin)
 *   - For Barter/Gifting/Sourcing: writes grand_total = 0; items keep their
 *     individual prices for PR reporting
 *   - Calls generate_order_no RPC with p_store = 'COMMS' (gives SB-COM-MMYY-...)
 *   - Inserts the order with salesperson_store = 'COMMS', is_comms = true
 *   - Sends PDF via WhatsApp to the logged-in comms user using their
 *     salesperson.personal_phone — no hardcoded number
 *   - Navigates to /order-placed on success
 */

const COMMS_APPROVAL_CAP = 35000;
const COMMS_STORE_KEY = "COMMS";            // marker value for salesperson_store

const PAYMENT_MODES = [
  { value: "", label: "Select payment mode" },
  { value: "Cash", label: "Cash" },
  { value: "Card", label: "Card" },
  { value: "UPI", label: "UPI" },
  { value: "Bank Transfer", label: "Bank Transfer" },
  { value: "COD", label: "Cash on Delivery" },
];

const DELIVERY_OPTIONS = [
  { value: "Home Delivery", label: "Home Delivery" },
  { value: "Delhi Store", label: "Delhi Store" },
  { value: "Ludhiana Store", label: "Ludhiana Store" },
];

export default function CommsReviewOrder() {
  const navigate = useNavigate();
  const location = useLocation();
  const { showPopup, PopupComponent } = usePopup();

  // ─── Inbound state ───
  const orderPayload = location.state?.orderPayload;
  const draftId = location.state?.draftId;

  // Comms-specific fields stashed by CommsOrderForm
  const commsPayload = useMemo(() => {
    try {
      const raw = sessionStorage.getItem("commsOrderPayload");
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }, []);

  // ─── Auth + Nazreen profile ───
  const [profile, setProfile] = useState(null);
  const [loadingAuth, setLoadingAuth] = useState(true);

  // ─── Form fields captured on this screen ───
  const [modeOfDelivery, setModeOfDelivery] = useState("Delhi Store");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [advancePayment, setAdvancePayment] = useState("");
  const [discountPercent, setDiscountPercent] = useState(0);
  const [paymentMode, setPaymentMode] = useState("");

  // ─── Submission state ───
  const [submitting, setSubmitting] = useState(false);
  const submissionLockRef = useRef(false);

  // ─── Derived flags ───
  const engagementType = commsPayload?.comms_engagement_type;
  const isPersonalOrder = engagementType === "Personal order";
  const isFreeOrder = engagementType && !isPersonalOrder; // Barter/Gifting/Sourcing
  const isSourcing = engagementType === "Sourcing";
  const isHomeDelivery = modeOfDelivery === "Home Delivery";

  // ─── Pricing ───
  // Items array carries the real per-item prices regardless of free vs personal.
  // For PR reporting we keep that intact. Only grand_total gets zeroed for free.
  const items = orderPayload?.items || [];
  const itemsSubtotal = useMemo(() => items.reduce((sum, it) => {
    const base = Number(it.price || 0) * Number(it.quantity || 1);
    const extras = Array.isArray(it.extras)
      ? it.extras.reduce((s, e) => s + Number(e.price || 0), 0)
      : 0;
    return sum + base + extras;
  }, 0), [items]);

  // For Personal: apply discount % off itemsSubtotal. For Free: grand_total = 0.
  const discountAmount = isPersonalOrder
    ? Math.round((itemsSubtotal * Number(discountPercent || 0)) / 100)
    : 0;
  const grandTotalForDB = isFreeOrder ? 0 : Math.max(0, itemsSubtotal - discountAmount);
  const remainingPayment = Math.max(0, grandTotalForDB - Number(advancePayment || 0));

  // ─── Approval gate (Gifting/Barter > Rs 35,000) ───
  // Uses itemsSubtotal (the notional value, not the zeroed grand_total) since
  // a free order with Rs 50,000 of clothing still needs Jahnavis sign-off.
  const requiresApproval = (engagementType === "Gifting" || engagementType === "Barter")
    && itemsSubtotal > COMMS_APPROVAL_CAP;

  // ─── Auth guard ───
  useEffect(() => {
    let cancelled = false;
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { navigate("/login", { replace: true }); return; }
      const { data: sp } = await supabase
        .from("salesperson")
        .select("email, role, saleperson, phone, personal_phone, designation")
        .eq("email", session.user.email?.toLowerCase())
        .maybeSingle();
      if (cancelled) return;
      if (!sp || sp.role !== "comms") {
        await supabase.auth.signOut();
        navigate("/login", { replace: true });
        return;
      }
      setProfile(sp);
      setLoadingAuth(false);
    };
    checkAuth();
    return () => { cancelled = true; };
  }, [navigate]);

  // ─── Guard: must have inbound state ───
  useEffect(() => {
    if (!orderPayload || !commsPayload) {
      // Hit directly without going through the flow — bail to dashboard.
      showPopup({
        title: "Missing order data",
        message: "Please start a new comms order from the dashboard.",
        type: "warning",
        confirmText: "Ok",
        onConfirm: () => navigate("/comms-dashboard", { replace: true }),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Submit ───
  const handlePlaceOrder = async () => {
    if (submissionLockRef.current) return;
    if (submitting) return;

    // Field validation
    if (!modeOfDelivery) {
      showPopup({ title: "Required", message: "Please select Mode of Delivery.", type: "warning" });
      return;
    }
    if (isHomeDelivery && !deliveryAddress.trim()) {
      showPopup({ title: "Required", message: "Please enter a delivery address for Home Delivery.", type: "warning" });
      return;
    }
    if (isPersonalOrder) {
      if (!paymentMode) {
        showPopup({ title: "Required", message: "Please select a payment mode for the personal order.", type: "warning" });
        return;
      }
      const adv = Number(advancePayment || 0);
      if (adv < 0 || adv > grandTotalForDB) {
        showPopup({ title: "Invalid advance", message: `Advance must be between 0 and Rs ${formatIndianNumber(grandTotalForDB)}.`, type: "warning" });
        return;
      }
    }

    submissionLockRef.current = true;
    setSubmitting(true);

    try {
      // Build the order row.
      // Item prices stay intact (per the design: keep real prices for PR reports).
      // Only the order-level totals get zeroed when isFreeOrder.
      const approvalStatus = requiresApproval ? "pending_approval" : null;

      // Strip ProductForm-only keys that aren't columns on `orders` — these
      // would crash the insert with "Could not find the … column" errors.
      // Mirrors the pattern in ReviewDetail.js line 360.
      const {
        save_measurements: _stripSaveMeasurements,
        measurements_to_save: _stripMeasurementsToSave,
        store_credit_remaining: _stripStoreCreditRemaining,
        ...payloadCleaned
      } = orderPayload;

      const orderRow = {
        ...payloadCleaned,
        // Comms metadata from CommsOrderForm
        is_comms: true,
        comms_request_source: commsPayload.comms_request_source,
        comms_profile_type: commsPayload.comms_profile_type,
        comms_agency_name: commsPayload.comms_agency_name,
        comms_engagement_type: commsPayload.comms_engagement_type,
        comms_purpose: commsPayload.comms_purpose,
        comms_poc_name: commsPayload.comms_poc_name,
        comms_outfit_return_date: commsPayload.comms_outfit_return_date,
        comms_order_assign: commsPayload.comms_order_assign,
        comms_existing_product_location: commsPayload.comms_existing_product_location,

        // Client identity (mirrors retail order shape; no real customer profile)
        delivery_name: commsPayload.delivery_name,
        delivery_phone: commsPayload.delivery_phone,
        delivery_email: commsPayload.delivery_email,
        delivery_date: commsPayload.delivery_date,

        // This-screen fields
        mode_of_delivery: modeOfDelivery,
        delivery_address: isHomeDelivery ? deliveryAddress.trim() : null,

        // Pricing
        subtotal: isFreeOrder ? 0 : itemsSubtotal,
        grand_total: grandTotalForDB,
        grand_total_after_discount: grandTotalForDB,
        net_total: grandTotalForDB,
        discount_percent: isPersonalOrder ? Number(discountPercent || 0) : 0,
        discount_amount: discountAmount,
        advance_payment: isPersonalOrder ? Number(advancePayment || 0) : 0,
        remaining_payment: isPersonalOrder ? remainingPayment : 0,
        payment_mode: isPersonalOrder ? paymentMode : null,

        // Placer + store marker
        salesperson: profile?.saleperson,
        salesperson_email: profile?.email?.toLowerCase(),
        salesperson_phone: profile?.phone,
        salesperson_store: COMMS_STORE_KEY,

        // Approval gate (>Rs 35,000 Gifting/Barter)
        approval_status: approvalStatus,

        // Misc
        status: requiresApproval ? "pending_approval" : "order_received",
        is_b2b: false,
        is_stock_order: false,
        created_at: new Date().toISOString(),
      };

      // 1) Order number — COMMS prefix → SB-COM-MMYY-NNNNNN
      const { data: orderNo, error: rpcError } = await supabase.rpc("generate_order_no", { p_store: "COMMS" });
      if (rpcError) throw rpcError;
      if (!orderNo) throw new Error("Failed to generate order number.");
      orderRow.order_no = orderNo;

      // 2) Insert
      const { data: insertedOrder, error: insertError } = await supabase
        .from("orders")
        .insert(orderRow)
        .select()
        .single();
      if (insertError) throw insertError;

      // 2.5) Decrement inventory for each item — mirrors the B2C logic in
      // ReviewDetail.js:719-800. Wrapped in try/catch so inventory failures
      // never block order placement (same convention as B2C).
      //
      // Skip for pending-approval orders so we don't reduce stock for orders
      // that may be rejected. Inventory will decrement at the moment Jahnavi
      // approves (Phase 3+ — for now, approved orders need a manual stock
      // adjustment if you care about pre-approval stock-out prevention).
      //
      // All comms engagement types (Barter/Gifting/Sourcing/Personal) deduct
      // inventory on placement. Only Sourcing increments back on return —
      // handled by the Sourcing Returns tab.
      if (!requiresApproval) {
        try {
          for (const item of (insertedOrder.items || [])) {
            if (!item.product_id) continue;
            const quantityOrdered = item.quantity || 1;
            if (item.sync_enabled) {
              // LXRTS / Shopify-synced product — per-variant inventory by size.
              const { data: variants } = await supabase
                .from("product_variants")
                .select("id, inventory, size")
                .eq("product_id", item.product_id)
                .eq("size", item.size)
                .gt("inventory", 0)
                .order("inventory", { ascending: false })
                .limit(1);
              if (variants && variants.length > 0) {
                const variant = variants[0];
                const newInventory = Math.max(0, variant.inventory - quantityOrdered);
                await supabase
                  .from("product_variants")
                  .update({ inventory: newInventory })
                  .eq("id", variant.id);
                // Shopify sync (same edge function B2C uses)
                try {
                  await fetch(
                    `${config.SUPABASE_URL}/functions/v1/shopify-inventory`,
                    {
                      method: "POST",
                      headers: {
                        "Content-Type": "application/json",
                        "apikey": config.SUPABASE_KEY,
                        "Authorization": `Bearer ${config.SUPABASE_KEY}`,
                      },
                      body: JSON.stringify({
                        action: "reduce",
                        product_id: item.product_id,
                        size: item.size,
                        quantity: quantityOrdered,
                      }),
                    }
                  );
                } catch (shopifyErr) {
                  console.warn("Shopify sync failed (non-blocking):", shopifyErr);
                }
              }
            } else {
              // Regular product — single inventory column on products.
              const { data: productData } = await supabase
                .from("products")
                .select("inventory")
                .eq("id", item.product_id)
                .single();
              if (productData) {
                const currentInventory = productData.inventory || 0;
                const newInventory = Math.max(0, currentInventory - quantityOrdered);
                await supabase
                  .from("products")
                  .update({ inventory: newInventory })
                  .eq("id", item.product_id);
              }
            }
          }
        } catch (inventoryErr) {
          console.warn("Comms inventory decrement failed (non-blocking):", inventoryErr);
        }
      }

      // 3) Notify Jahnavi (admin) if the approval gate fired.
      // Uses the comms-specific notification type so the recipient and
      // template are right (B2B_APPROVAL_AWAITED also notifies merchandisers
      // which doesn't apply to comms).
      if (requiresApproval) {
        try {
          await sendNotification(NOTIFICATION_TYPES.COMMS_APPROVAL_AWAITED, {
            orderId: insertedOrder.id,
            orderNo: insertedOrder.order_no,
            metadata: {
              client_name: commsPayload.delivery_name,
              submitted_by: profile?.email,
              engagement_type: engagementType,
              value: formatIndianNumber(itemsSubtotal),
            },
          });
        } catch (notifErr) {
          console.warn("Approval notification failed (non-blocking):", notifErr);
        }
      }

      // 4) Delete the draft (if any)
      if (draftId) {
        try { await supabase.from("draft_orders").delete().eq("id", draftId); } catch (_) { }
      }

      // 5) Generate PDFs in the background, then send the customer PDF to
      //    Nazreen on WhatsApp. Fire-and-forget — PDF or WhatsApp errors
      //    must not block the "Order Placed" UX.
      //
      // Uses generateAllPdfs (not downloadCustomerPdf/downloadWarehousePdf)
      // because the "download" helpers also call window.open to display the
      // PDFs in new tabs — fine for retail SAs, noisy for comms. generateAllPdfs
      // just builds + uploads + returns the URLs.
      (async () => {
        try {
          const orderForPdf = { ...insertedOrder, items: insertedOrder.items || [] };
          const { customer_url: pdfUrl } = await generateAllPdfs(orderForPdf, null) || {};

          if (pdfUrl) {
            try {
              await fetch(`${config.SUPABASE_URL}/functions/v1/spur-whatsapp`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "apikey": config.SUPABASE_KEY,
                  "Authorization": `Bearer ${config.SUPABASE_KEY}`,
                },
                body: JSON.stringify({
                  customerName: profile?.saleperson || "Comms",
                  customerPhone: profile?.personal_phone || profile?.phone,
                  customerCountry: "India",
                  pdfUrl,
                }),
              });
            } catch (waErr) {
              console.warn("Comms WhatsApp send failed (non-blocking):", waErr);
            }
          }
        } catch (pdfErr) {
          console.warn("PDF generation failed (non-blocking):", pdfErr);
        }
      })();

      // 6) Clear comms-flow session keys so a future order starts fresh.
      sessionStorage.removeItem("commsOrderFormData");
      sessionStorage.removeItem("commsOrderPayload");
      sessionStorage.removeItem("isCommsOrder");
      sessionStorage.removeItem("screen4FormData");
      sessionStorage.removeItem("screen6FormData");

      // 7) Land on OrderPlaced with a comms-specific note for the gated case.
      navigate("/order-placed", {
        state: {
          order: { ...insertedOrder, items: insertedOrder.items || [] },
          commsNote: requiresApproval
            ? `This order exceeds Rs ${formatIndianNumber(COMMS_APPROVAL_CAP)} and is now PENDING Jahnavi's approval. The order is saved but will not progress until approved.`
            : null,
        },
        replace: true,
      });
    } catch (err) {
      console.error("Comms order placement failed:", err);
      submissionLockRef.current = false;
      setSubmitting(false);
      showPopup({
        title: "Order placement failed",
        message: err.message || "An unexpected error occurred. Please try again.",
        type: "error",
        confirmText: "Ok",
      });
    }
  };

  if (loadingAuth) return <div className="cro-loading">Loading…</div>;
  if (!orderPayload || !commsPayload) {
    return <div className="cro-loading">No order in progress. Returning to dashboard…</div>;
  }

  return (
    <div className="cro-page">
      {PopupComponent}

      <header className="cro-header">
        <img src={Logo} alt="Sheetal Batra" className="cro-logo" />
        <h1 className="cro-title">Review Comms Order</h1>
        <button className="cro-back" onClick={() => navigate(-1)}>← Back to Products</button>
      </header>

      <main className="cro-main">
        {requiresApproval && (
          <div className="cro-approval-banner">
            <strong>Approval required:</strong> This order is valued at ₹{formatIndianNumber(itemsSubtotal)} —
            over the ₹{formatIndianNumber(COMMS_APPROVAL_CAP)} cap for {engagementType}. It will be saved as <em>pending</em> and
            sent to Jahnavi for approval. The order will not progress until she signs off.
          </div>
        )}

        {/* ─── Section A: Comms Intake Summary ─── */}
        <section className="cro-card">
          <h2 className="cro-card-title">Order Details</h2>
          <div className="cro-grid-2">
            <Field label="Request Source" value={commsPayload.comms_request_source} />
            {commsPayload.comms_profile_type && (
              <Field label="Profile Type" value={commsPayload.comms_profile_type} />
            )}
            {commsPayload.comms_agency_name && (
              <Field label="Agency Name" value={commsPayload.comms_agency_name} />
            )}
            <Field label="Engagement Type" value={engagementType} />
            <Field label="Purpose" value={commsPayload.comms_purpose} />
            <Field label="Client Name" value={commsPayload.delivery_name} />
            {commsPayload.comms_poc_name && (
              <Field label="POC Name" value={commsPayload.comms_poc_name} />
            )}
            <Field label="Contact" value={commsPayload.delivery_phone} />
            {commsPayload.delivery_email && (
              <Field label="Email" value={commsPayload.delivery_email} />
            )}
            <Field label="Delivery Date" value={formatDate(commsPayload.delivery_date)} />
            {commsPayload.comms_outfit_return_date && (
              <Field label="Outfit Return Date" value={formatDate(commsPayload.comms_outfit_return_date)} />
            )}
            {commsPayload.comms_order_assign && (
              <Field label="Order Assigned To" value={commsPayload.comms_order_assign} />
            )}
            {commsPayload.comms_existing_product_location && (
              <Field label="Existing Product Location" value={commsPayload.comms_existing_product_location} />
            )}
          </div>
        </section>

        {/* ─── Section B: Products summary ─── */}
        <section className="cro-card">
          <h2 className="cro-card-title">Products ({items.length})</h2>
          <table className="cro-products-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Size</th>
                <th>Qty</th>
                <th className="cro-amount">MRP</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, idx) => (
                <tr key={idx}>
                  <td>{it.product_name || "—"}</td>
                  <td>{it.size || "—"}</td>
                  <td>{it.quantity || 1}</td>
                  <td className="cro-amount">₹{formatIndianNumber(Number(it.price || 0))}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan="3" className="cro-amount-label">Notional Value (Subtotal)</td>
                <td className="cro-amount cro-amount-strong">₹{formatIndianNumber(itemsSubtotal)}</td>
              </tr>
              {isFreeOrder && (
                <tr>
                  <td colSpan="3" className="cro-amount-label">{engagementType} Adjustment</td>
                  <td className="cro-amount" style={{ color: "#2e7d32" }}>− ₹{formatIndianNumber(itemsSubtotal)}</td>
                </tr>
              )}
              <tr>
                <td colSpan="3" className="cro-amount-label cro-grand-total-label">Grand Total (Billed)</td>
                <td className="cro-amount cro-grand-total">₹{formatIndianNumber(grandTotalForDB)}</td>
              </tr>
            </tfoot>
          </table>
          {isFreeOrder && (
            <p className="cro-helper">
              Free engagement — order saved with grand_total = ₹0. Item-level prices are preserved for PR reporting.
            </p>
          )}
        </section>

        {/* ─── Section C: Delivery + Payment (this screen captures) ─── */}
        <section className="cro-card">
          <h2 className="cro-card-title">Delivery {isPersonalOrder && "& Payment"}</h2>
          <div className="cro-grid-2">
            <div className="cro-field">
              <label className="cro-label">Mode of Delivery <span className="cro-req">*</span></label>
              <select className="cro-input" value={modeOfDelivery} onChange={(e) => setModeOfDelivery(e.target.value)}>
                {DELIVERY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            {isHomeDelivery && (
              <div className="cro-field" style={{ gridColumn: "1 / -1" }}>
                <label className="cro-label">Delivery Address <span className="cro-req">*</span></label>
                <textarea
                  className="cro-input cro-textarea"
                  rows={3}
                  placeholder="Full address with pincode"
                  value={deliveryAddress}
                  onChange={(e) => setDeliveryAddress(e.target.value)}
                />
              </div>
            )}

            {isPersonalOrder && (
              <>
                <div className="cro-field">
                  <label className="cro-label">Discount %</label>
                  <input
                    type="number"
                    className="cro-input"
                    min="0" max="100"
                    value={discountPercent}
                    onChange={(e) => setDiscountPercent(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
                  />
                </div>
                <div className="cro-field">
                  <label className="cro-label">Advance Payment (₹)</label>
                  <input
                    type="number"
                    className="cro-input"
                    min="0"
                    value={advancePayment}
                    onChange={(e) => setAdvancePayment(e.target.value)}
                    placeholder="0"
                  />
                </div>
                <div className="cro-field">
                  <label className="cro-label">Payment Mode <span className="cro-req">*</span></label>
                  <select className="cro-input" value={paymentMode} onChange={(e) => setPaymentMode(e.target.value)}>
                    {PAYMENT_MODES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                </div>
                <div className="cro-field">
                  <label className="cro-label">Balance Due</label>
                  <input type="text" className="cro-input" value={`₹${formatIndianNumber(remainingPayment)}`} readOnly disabled />
                </div>
              </>
            )}
          </div>
        </section>

        <div className="cro-actions">
          <button className="cro-btn-secondary" onClick={() => navigate(-1)} disabled={submitting}>Back</button>
          <button className="cro-btn-primary" onClick={handlePlaceOrder} disabled={submitting}>
            {submitting ? "Placing order…" : (requiresApproval ? "Submit for Approval" : "Place Order")}
          </button>
        </div>
      </main>
    </div>
  );
}

// Small read-only field display used in the summary cards.
function Field({ label, value }) {
  return (
    <div className="cro-readonly-field">
      <span className="cro-readonly-label">{label}</span>
      <span className="cro-readonly-value">{value || "—"}</span>
    </div>
  );
}
