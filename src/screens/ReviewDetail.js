import React, { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";
import SignatureCanvas from "react-signature-canvas";
import Logo from "../images/logo.png";
import formatIndianNumber from "../utils/formatIndianNumber";
import "./Screen7.css";
import formatPhoneNumber from "../utils/formatPhoneNumber";
import config from "../config/config";
import { generateAllPdfs } from "../utils/pdfUtils";
import { usePopup } from "../components/Popup";
import { NOTIFICATION_TYPES, sendNotification } from "../utils/notificationService";

// Auto Signature Logo URL
const AUTO_SIGNATURE_URL = "https://qlqvchcvuwjnfranqcmx.supabase.co/storage/v1/object/public/signature/logo.png";

function ColorDotDisplay({ colorObject }) {
  if (!colorObject) return null;

  let displayColorName = "";
  let displayColorHex = "#000000";

  if (typeof colorObject === "string") {
    displayColorName = colorObject;
    displayColorHex = colorObject.startsWith("#") ? colorObject : "gray";
  } else if (typeof colorObject === "object" && colorObject !== null) {
    displayColorName = colorObject.name || "";
    displayColorHex = colorObject.hex || "";
  } else {
    return <span>Invalid Color</span>;
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
      <div
        style={{
          background: displayColorHex,
          height: "14px",
          width: "28px",
          borderRadius: "8px",
          border: "1px solid #ccc",
        }}
      />
      <span>{displayColorName}</span>
    </div>
  );
}

const getISTTimestamp = () => {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(now.getTime() + istOffset);
  return istDate.toISOString().slice(0, 19).replace('T', ' ');
};

const toISODate = (value) => {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  if (/^\d{2}-\d{2}-\d{4}$/.test(value)) {
    const [dd, mm, yyyy] = value.split("-");
    return `${yyyy}-${mm}-${dd}`;
  }
  try {
    return new Date(value).toISOString().slice(0, 10);
  } catch {
    return null;
  }
};

const compressSignature = (signaturePad) => {
  return new Promise((resolve) => {
    const canvas = signaturePad.getCanvas();
    const newCanvas = document.createElement("canvas");
    newCanvas.width = canvas.width;
    newCanvas.height = canvas.height;
    const ctx = newCanvas.getContext("2d");
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, newCanvas.width, newCanvas.height);
    ctx.drawImage(canvas, 0, 0);
    newCanvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.8);
  });
};

const checkEmptyFields = (obj, prefix = "") => {
  const emptyFields = [];
  for (const [key, value] of Object.entries(obj)) {
    const fieldPath = prefix ? `${prefix}.${key}` : key;
    if (value === "" || value === null || value === undefined) {
      emptyFields.push({ field: fieldPath, value, type: typeof value });
    } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      emptyFields.push(...checkEmptyFields(value, fieldPath));
    }
  }
  return emptyFields;
};
// ========== END DEBUG HELPERS ==========

export default function ReviewDetail() {
  const isSubmitting = React.useRef(false);
  const { showPopup, PopupComponent } = usePopup();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const order = location.state?.orderPayload;
  const draftId = location.state?.draftId;

  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("Placing order...");
  const [showSignature, setShowSignature] = useState(false);
  const [sigPad, setSigPad] = useState(null);

  // Private-SA-only mandatory fields, captured on this screen.
  // Persist to orders.exb_name + orders.sb_representative_name on insert.
  const [exbName, setExbName] = useState("");
  const [sbRepName, setSbRepName] = useState("");
  // Whether to send the order PDF to the client via WhatsApp.
  // Regular SA: always true (asked before signature only for Private SA).
  // Stored as a ref so it doesn't trigger re-renders mid-flow.
  const sendPdfRef = React.useRef(true);

  const isPrivateSA = (() => {
    try {
      const sp = JSON.parse(sessionStorage.getItem("currentSalesperson") || "{}");
      return sp.designation === "Private SA";
    } catch { return false; }
  })();

  // Stock-order detection — set by the SA's "Place Stock Order" button and
  // carried through ProductForm. Stock orders skip the OTP/customer flow,
  // skip Private-SA verification, force the order_no to the STOCK prefix
  // (via p_store: 'Internal' in the RPC), and skip WhatsApp.
  const isStockOrder = order?.is_stock_order === true ||
    sessionStorage.getItem("isStockOrder") === "true";

  const totalAmount = Number(order?.grand_total) || 0;
  const advancePayment = Number(order?.advance_payment) || 0;
  const discountPercent = Number(order?.discount_percent) || 0;
  const discountAmount = Number(order?.discount_amount) || 0;
  const netPayable = Number(order?.net_total) || 0;
  const remaining = Number(order?.remaining_payment) || 0;
  const storeCreditUsed = Number(order?.store_credit_used) || 0;
  // const loyaltyPointsRedeemed = Number(order?.loyalty_points_redeemed) || 0;
  // const loyaltyDiscount = Number(order?.loyalty_discount) || 0;

  const pricing = {
    discountPercent, discountAmount, netPayable, remaining, storeCreditUsed,
    // loyaltyPointsRedeemed, loyaltyDiscount 
  };

  const handlePlaceOrder = () => {
    // Stock orders skip the WhatsApp/PDF prompt — there's no customer to send to.
    if (isStockOrder) {
      sendPdfRef.current = false;
      setShowSignature(true);
      return;
    }
    // Private SA mandatory fields gate
    if (isPrivateSA) {
      if (!exbName.trim() || !sbRepName.trim()) {
        showPopup({
          type: "warning",
          title: "Missing Required Fields",
          message: "EXB Name and SB Representative Name are required to place a private order.",
          confirmText: "OK",
        });
        return;
      }
    }
    if (isPrivateSA) {
      // Ask BEFORE signature whether to send PDF to client. Decide once, then
      // proceed normally — no post-insert popup, no duplicate-insert race.
      showPopup({
        type: "confirm",
        title: "Send PDF to Client?",
        message: "Do you want to send the order PDF to the client via WhatsApp after placing the order?",
        confirmText: "Yes, Send",
        cancelText: "No, Skip",
        onConfirm: () => {
          sendPdfRef.current = true;
          setShowSignature(true);
        },
        onCancel: () => {
          sendPdfRef.current = false;
          setShowSignature(true);
        },
      });
      return;
    }
    // Regular SA: always send PDF
    sendPdfRef.current = true;
    setShowSignature(true);
  };

  // ============================================================
  // SHARED: Process order after signature URL is obtained
  // ============================================================

  const processOrderWithSignature = async (signatureUrl) => {
    // ✅ Prevent double submission — once an insert succeeds, the lock stays held
    // for the rest of this component's lifecycle (orderInsertSucceeded). For
    // pre-insert failures (validation, network), the lock is released in finally
    // so the user can retry.
    if (isSubmitting.current) return;
    isSubmitting.current = true;
    let orderInsertSucceeded = false;

    try {
    // ✅ BLOCK if no salesperson data
    if (!order.salesperson && !order.salesperson_email) {
      const spSession = sessionStorage.getItem("currentSalesperson");
      if (!spSession) {
        showPopup({
          title: "Error",
          message: "Salesperson data is missing. Please login again from Associate Dashboard.",
          type: "error",
          confirmText: "Ok",
        });
        setLoading(false);
        setShowSignature(false);
        return;
      }
    }
    const emptyFields = checkEmptyFields(order);
    if (emptyFields.length > 0) {
    }

    setLoadingMessage("Validating order data...");

    // 2️⃣ PREPARE ORDER DATA
    const normalizedOrder = {
      ...order,
      discount_percent: pricing.discountPercent,
      discount_amount: pricing.discountAmount,
      grand_total_after_discount: pricing.netPayable,
      net_total: pricing.netPayable,
      remaining_payment: pricing.remaining,
      signature_url: signatureUrl,
      created_at: getISTTimestamp(),
      delivery_date: toISODate(order.delivery_date),
      join_date: toISODate(order.join_date),
      billing_date: toISODate(order.billing_date),
      expected_delivery: toISODate(order.expected_delivery),
    };


    // ✅ SALESPERSON VALIDATION & AUTO-FILL
    // Check if salesperson data is missing and try to recover it
    const missingSalesperson = !normalizedOrder.salesperson || !normalizedOrder.salesperson_email;
    const missingStore = !normalizedOrder.salesperson_store;

    if (missingSalesperson || missingStore) {
      setLoadingMessage("Fetching salesperson data...");

      try {
        // Try 1: Get from sessionStorage (currentSalesperson)
        const savedSP = sessionStorage.getItem("currentSalesperson");
        if (savedSP) {
          const spData = JSON.parse(savedSP);
          if (!normalizedOrder.salesperson && spData.name) {
            normalizedOrder.salesperson = spData.name;
          }
          if (!normalizedOrder.salesperson_email && spData.email) {
            normalizedOrder.salesperson_email = spData.email.toLowerCase();
          }
          if (!normalizedOrder.salesperson_phone && spData.phone) {
            normalizedOrder.salesperson_phone = spData.phone;
          }
          if (!normalizedOrder.salesperson_store && spData.store) {
            normalizedOrder.salesperson_store = spData.store;
          }
        }

        // Try 2: Get from associateSession and fetch from database
        if (!normalizedOrder.salesperson_email) {
          const associateSession = sessionStorage.getItem("associateSession");
          if (associateSession) {
            const session = JSON.parse(associateSession);
            const associateEmail = session?.user?.email;
            if (associateEmail) {
              const { data: spData } = await supabase
                .from("salesperson")
                .select("saleperson, email, phone, store_name")
                .eq("email", associateEmail.toLowerCase())
                .single();

              if (spData) {
                normalizedOrder.salesperson = spData.saleperson;
                normalizedOrder.salesperson_email = spData.email.toLowerCase();
                normalizedOrder.salesperson_phone = spData.phone;
                normalizedOrder.salesperson_store = spData.store_name;
              }
            }
          }
        }

        // Try 3: If we have email but missing other data, fetch from salesperson table
        if (normalizedOrder.salesperson_email && (!normalizedOrder.salesperson || !normalizedOrder.salesperson_store)) {
          const { data: spData } = await supabase
            .from("salesperson")
            .select("saleperson, email, phone, store_name")
            .eq("email", normalizedOrder.salesperson_email.toLowerCase())
            .single();

          if (spData) {
            if (!normalizedOrder.salesperson) normalizedOrder.salesperson = spData.saleperson;
            if (!normalizedOrder.salesperson_store) normalizedOrder.salesperson_store = spData.store_name;
            if (!normalizedOrder.salesperson_phone) normalizedOrder.salesperson_phone = spData.phone;
          }
        }

        // Normalize email to lowercase
        if (normalizedOrder.salesperson_email) {
          normalizedOrder.salesperson_email = normalizedOrder.salesperson_email.toLowerCase();
        }

      } catch (e) {
      }
    } else {
      // Even if we have salesperson data, normalize email to lowercase
      if (normalizedOrder.salesperson_email) {
        normalizedOrder.salesperson_email = normalizedOrder.salesperson_email.toLowerCase();
      }
    }

    // Final fallback for store
    if (!normalizedOrder.salesperson_store) {
      normalizedOrder.salesperson_store = "Delhi Store";
    }

    setLoadingMessage("Saving order...");

    // Remove measurement saving flags from order data
    let { save_measurements, measurements_to_save, store_credit_remaining, ...orderDataToInsert } = normalizedOrder;

    // ============================================================
    // PRIVATE ORDER GUARD — defense in depth
    // ============================================================
    // The client may report `isPrivateSA = true` (read from sessionStorage), but
    // sessionStorage is tamper-able. Before trusting that, re-fetch the SA's
    // designation from the database using their email. Only if the DB confirms
    // "Private SA" do we treat this as a private order. This prevents:
    //  - A non-Private SA spoofing a private (₹0) order
    //  - A regular order's monetary fields leaking into a private order
    let isConfirmedPrivateOrder = false;
    // Stock orders are not customer/private orders — skip the entire Private SA
    // verification block. The is_stock_order flag is already set on the payload
    // by ProductForm.
    if (isPrivateSA && !isStockOrder) {
      // Client claims Private SA — verify it against the DB before accepting.
      if (!normalizedOrder.salesperson_email) {
        showPopup({
          title: "Cannot Verify Private Order",
          message: "Salesperson email is missing — cannot confirm this is a private order. Please log in again from the dashboard.",
          type: "error",
          confirmText: "OK",
        });
        setLoading(false);
        setShowSignature(false);
        return;
      }
      try {
        const { data: spRow, error: spErr } = await supabase
          .from("salesperson")
          .select("designation")
          .eq("email", normalizedOrder.salesperson_email.toLowerCase())
          .single();
        if (spErr) throw spErr;
        isConfirmedPrivateOrder = spRow?.designation === "Private SA";
      } catch (err) {
        // Lookup failed (network/RLS) — fail closed: do not place a private order without confirming permission
        console.error("Could not verify SA designation:", err);
        showPopup({
          title: "Verification Failed",
          message: "Could not verify private-order permission. Please retry — if the problem continues, log in again.",
          type: "error",
          confirmText: "OK",
        });
        setLoading(false);
        setShowSignature(false);
        return;
      }

      if (!isConfirmedPrivateOrder) {
        // Client said Private SA but DB disagrees — block the order outright.
        // Accepting it would let a regular SA spoof a private-order flag via tampered sessionStorage.
        console.warn("Private SA flag mismatch: sessionStorage said yes, DB said no. Blocking order.");
        showPopup({
          title: "Order Blocked",
          message: "Your account is not configured for private orders. Please re-login from the dashboard and try again.",
          type: "error",
          confirmText: "OK",
        });
        setLoading(false);
        setShowSignature(false);
        return;
      }
    }

    if (isConfirmedPrivateOrder) {
      // Confirmed Private SA — flag the order so it's auditable later.
      // Note: monetary fields are NOT zeroed here. Private orders zero out only
      // the product's BASE price (handled in ProductForm.js); extras and the
      // SA's "additional customizations" line items still carry their real
      // prices and roll up into grand_total. Forcing all amounts to 0 here
      // would erase the SA's pricing for those add-ons.
      orderDataToInsert.is_private_order = true;
      // Mandatory private-order metadata captured on this screen.
      orderDataToInsert.exb_name = exbName.trim();
      orderDataToInsert.sb_representative_name = sbRepName.trim();
    } else {
      // Explicitly mark non-private orders as such for clear audit trail
      orderDataToInsert.is_private_order = false;
    }

    // STOCK ORDER FLAG — propagate to the row so dashboards can filter on it.
    if (isStockOrder) {
      orderDataToInsert.is_stock_order = true;
    }

    setLoadingMessage("Generating invoice PDFs...");

    // 3️⃣ GENERATE ORDER NUMBER
    // Stock orders use the 'Internal' store key, which the RPC maps to the
    // STOCK prefix (e.g. SB-STOCK-MMYY-000001).
    const rpcStore = isStockOrder
      ? "Internal"
      : (normalizedOrder.salesperson_store || "Delhi Store");
    const { data: orderNo, error: orderNoError } = await supabase.rpc(
      "generate_order_no",
      { p_store: rpcStore }
    );

    if (orderNoError) {
      console.error("❌ Order number generation error:", orderNoError);
      throw orderNoError;
    }

    // ✅ Validate order number was generated
    if (!orderNo) {
      console.error("❌ Order number is null/empty");
      throw new Error("Failed to generate order number. Please try again.");
    }

    // 3.5️⃣ DUPLICATE CHECK — prevent back/reload double submission
    // Stock orders have no customer (user_id is null), so the user_id-keyed
    // duplicate check below doesn't apply. Skip it for stock.
    const istNow = Date.now() + (5.5 * 60 * 60 * 1000);
    const thirtySecondsAgo = new Date(istNow - 30 * 1000).toISOString().slice(0, 19).replace('T', ' ');
    const { data: recentOrders } = isStockOrder
      ? { data: [] }
      : await supabase
        .from("orders")
        .select("id, order_no, grand_total, items")
        .eq("user_id", order.user_id)
        .gte("created_at", thirtySecondsAgo)
        .limit(3);

    if (recentOrders && recentOrders.length > 0) {
      const currentItem = normalizedOrder.items?.[0] || order.items?.[0] || {};
      const isDupe = recentOrders.some(recent => {
        if (Number(recent.grand_total) !== Number(normalizedOrder.grand_total)) return false;
        const recentItem = recent.items?.[0] || {};
        return (
          recentItem.product_name === currentItem.product_name &&
          recentItem.top === currentItem.top &&
          recentItem.bottom === currentItem.bottom &&
          recentItem.top_color?.name === currentItem.top_color?.name &&
          recentItem.bottom_color?.name === currentItem.bottom_color?.name &&
          recentItem.size === currentItem.size
        );
      });

      if (isDupe) {
        const match = recentOrders[0];
        showPopup({
          title: "Order Already Placed",
          message: `Your order (${match.order_no}) was already placed successfully.`,
          type: "warning",
          confirmText: "OK",
        });
        setLoading(false);
        setShowSignature(false);
        return;
      }
    }

    // 4️⃣ INSERT ORDER
    const { data: insertedOrder, error: insertError } = await supabase
      .from("orders")
      .insert({ ...orderDataToInsert, order_no: orderNo, status: "order_received" })
      .select()
      .single();

    if (insertError) {
      console.error("❌ Order insert error:", insertError);
      console.error("❌ Error details:", JSON.stringify(insertError, null, 2));
      throw insertError;
    }

    if (!insertedOrder) {
      console.error("❌ No order returned after insert");
      throw new Error("Order insert failed");
    }

    // ✅ ORDER PERSISTED — from this point on, never allow another insert attempt
    // for this component instance. The lock will not be released by `finally` below.
    orderInsertSucceeded = true;

    // 4.5️⃣ GENERATE ORDER COMPONENTS (for barcode tracking)
    try {
      const { generateOrderComponents } = await import("../utils/barcodeService");
      const orderForComponents = {
        ...insertedOrder,
        items: normalizedOrder.items || order.items || [],
      };
      const components = await generateOrderComponents(orderForComponents);
      console.log(`✅ Generated ${components.length} components for barcode tracking`);
    } catch (compError) {
      console.error("❌ Component generation failed (non-blocking):", compError);
      // Non-blocking — order is already placed, components can be created later
    }

    // Delete draft if this was from a draft order
    if (draftId) {
      try {
        await supabase.from("draft_orders").delete().eq("id", draftId);
      } catch (err) {
      }
    }

    setLoadingMessage("Sending confirmation...");

    // 5️⃣.0 GENERATE PDFs & SEND WHATSAPP
    const orderWithItems = {
      ...insertedOrder,
      items: normalizedOrder.items || order.items || [],
    };

    try {
      const pdfUrls = await generateAllPdfs(orderWithItems);

      // Send WhatsApp with Customer PDF — sendPdfRef.current is decided BEFORE
      // the signature step (asked for Private SA, defaulted to true for regular SA).
      // No post-insert popup, single straight-line path through the rest of the function.
      if (pdfUrls?.customer_url && sendPdfRef.current) {
        try {
          await fetch(`${config.SUPABASE_URL}/functions/v1/spur-whatsapp`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "apikey": config.SUPABASE_KEY, "Authorization": `Bearer ${config.SUPABASE_KEY}` },
            body: JSON.stringify({
              customerName: orderWithItems.delivery_name,
              customerPhone: orderWithItems.delivery_phone,
              customerCountry: orderWithItems.delivery_country || "India",
              pdfUrl: pdfUrls.customer_url,
            }),
          });
        } catch (err) { console.error("WhatsApp error:", err); }
      }
    } catch (pdfError) {
      console.error("❌ PDF generation failed:", pdfError);
    }

    // 5️⃣.05 SEND NOTIFICATION — Order Placed (#13)
    try {
      const items = normalizedOrder.items || order.items || [];
      const source = items.some(i => i.sync_enabled) ? "Shopify" :
        order.is_b2b ? "B2B" : "Offline";

      // Get PDF attachments from the inserted order (saved by generateAllPdfs)
      const notifAttachments = [];
      if (insertedOrder.customer_url) {
        notifAttachments.push({ type: "order_pdf", url: insertedOrder.customer_url });
      }
      if (insertedOrder.warehouse_urls?.length) {
        insertedOrder.warehouse_urls.forEach(url => {
          notifAttachments.push({ type: "order_pdf", url });
        });
      }

      await sendNotification(NOTIFICATION_TYPES.ORDER_PLACED, {
        orderId: insertedOrder.id,
        orderNo: insertedOrder.order_no,
        metadata: {
          client_name: normalizedOrder.delivery_name,
          is_urgent: normalizedOrder.is_urgent || false,
          source,
          store: normalizedOrder.salesperson_store,
        },
        attachments: notifAttachments,
      });
    } catch (notifErr) {
      console.error("❌ Notification error (non-blocking):", notifErr);
    }

    // 5️⃣.1 SAVE CUSTOMER MEASUREMENTS
    if (order.save_measurements && order.measurements_to_save) {
      try {
        const { error: measurementError } = await supabase
          .from("customer_measurements")
          .insert({
            customer_id: order.user_id,
            measurements: order.measurements_to_save,
            order_id: insertedOrder.id,
            created_at: new Date().toISOString(),
          });

        if (measurementError) {
          console.error("❌ Measurement save error:", measurementError);
        }
      } catch (err) {
        console.error("❌ Measurement save exception:", err);
      }
    } else {
    }

    // 5️⃣.2 DEDUCT STORE CREDIT
    if (order.store_credit_used && order.store_credit_used > 0) {
      try {
        const updateData = {
          store_credit: order.store_credit_remaining || 0,
        };

        if (!order.store_credit_remaining || order.store_credit_remaining <= 0) {
          updateData.store_credit_expiry = null;
        }

        const { error: creditError } = await supabase
          .from("profiles")
          .update(updateData)
          .eq("id", order.user_id);

        if (creditError) {
          console.error("❌ Store credit deduction error:", creditError);
        }
      } catch (err) {
        console.error("❌ Store credit exception:", err);
      }
    } else {
    }

    // 5️⃣.3 LOYALTY POINTS: Award + Deduct
    // try {
    //   // Calculate points earned: 5 pts per ₹10 spent = 0.5 per ₹1
    //   // Base it on net amount actually paid (after all discounts, credits, loyalty discount)
    //   const amountForPoints = Math.max(0, (Number(order.net_total) || 0) - loyaltyDiscount);
    //   const pointsEarned = Math.floor(amountForPoints * 0.5);

    //   // Get current loyalty points
    //   const { data: currentProfile } = await supabase
    //     .from("profiles")
    //     .select("loyalty_points")
    //     .eq("id", order.user_id)
    //     .single();

    //   const currentPoints = Number(currentProfile?.loyalty_points) || 0;
    //   const pointsAfterRedeem = currentPoints - loyaltyPointsRedeemed;
    //   const newPoints = Math.max(0, pointsAfterRedeem) + pointsEarned;

    //   // Update profile with new points
    //   await supabase
    //     .from("profiles")
    //     .update({ loyalty_points: newPoints })
    //     .eq("id", order.user_id);

    //   // Update order with points earned
    //   await supabase
    //     .from("orders")
    //     .update({ loyalty_points_earned: pointsEarned })
    //     .eq("id", insertedOrder.id);

    //   console.log(`✅ Loyalty: Earned ${pointsEarned} pts, Redeemed ${loyaltyPointsRedeemed} pts, New balance: ${newPoints} pts`);
    // } catch (loyaltyErr) {
    //   console.error("❌ Loyalty points error:", loyaltyErr);
    //   // Non-blocking — order is already placed
    // }

    // 6️⃣ REDUCE INVENTORY
    try {
      const items = normalizedOrder.items || order.items || [];

      for (const item of items) {
        if (!item.product_id) {
          continue;
        }

        const quantityOrdered = item.quantity || 1;

        if (item.sync_enabled) {
          // Sync product logic
          const { data: variants, error: fetchError } = await supabase
            .from("product_variants")
            .select("id, inventory, size")
            .eq("product_id", item.product_id)
            .eq("size", item.size)
            .gt("inventory", 0)
            .order("inventory", { ascending: false })
            .limit(1);

          if (fetchError) {
            console.error(`   ❌ Variant fetch error:`, fetchError);
            continue;
          }

          if (variants && variants.length > 0) {
            const variant = variants[0];
            const newInventory = Math.max(0, variant.inventory - quantityOrdered);

            const { error: updateError } = await supabase
              .from("product_variants")
              .update({ inventory: newInventory })
              .eq("id", variant.id);

            if (updateError) {
              console.error(`   ❌ Variant update error:`, updateError);
            }
          } else {
          }

          // Shopify sync
          try {
            const response = await fetch(
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

            const reduceResult = await response.json();
            if (!reduceResult.success) {
              console.error("   ❌ Shopify reduce failed:", reduceResult.error);
            }
          } catch (shopifyErr) {
            console.error("   ❌ Shopify sync error:", shopifyErr);
          }
        } else {
          // Regular product logic
          const { data: productData, error: fetchError } = await supabase
            .from("products")
            .select("inventory, name")
            .eq("id", item.product_id)
            .single();

          if (!fetchError && productData) {
            const currentInventory = productData.inventory || 0;
            const newInventory = Math.max(0, currentInventory - quantityOrdered);

            const { error: updateError } = await supabase
              .from("products")
              .update({ inventory: newInventory })
              .eq("id", item.product_id);

            if (updateError) {
              console.error(`   ❌ Product update error:`, updateError);
            }
          } else {
            console.error("   ❌ Product fetch error:", fetchError);
          }
        }
      }
    } catch (inventoryError) {
      console.error("❌ Inventory update exception:", inventoryError);
    }

    // 7️⃣ CLEAR SESSION & NAVIGATE
    sessionStorage.removeItem("screen4FormData");
    sessionStorage.removeItem("screen6FormData");
    // Clear the stock-order flag so the next time the SA places a normal
    // order it doesn't accidentally inherit stock behaviour.
    sessionStorage.removeItem("isStockOrder");

    navigate("/order-placed", {
      state: { order: { ...insertedOrder, items: insertedOrder.items || [] } },
      replace: true,
    });
    } finally {
      // Release the lock ONLY if the order was not yet inserted. If insert
      // succeeded, keep the lock held forever (for this component instance) so
      // post-insert side-effects (PDFs, popup callbacks) cannot trigger a
      // duplicate insert.
      if (!orderInsertSucceeded) {
        isSubmitting.current = false;
      }
    }
  };

  // ============================================================
  // CANVAS SIGNATURE: Upload signature and process order
  // ============================================================
  const saveSignatureAndContinue = async () => {
    if (!sigPad || sigPad.isEmpty()) {
      showPopup({
        title: "Sign Required!",
        message: "Please sign before continuing.",
        type: "warning",
        confirmText: "Ok",
      });
      return;
    }

    try {
      setLoading(true);
      setLoadingMessage("Uploading signature...");

      const blob = await compressSignature(sigPad);
      const path = `${user.id}/signature_${Date.now()}.jpg`;

      const { error: sigError } = await supabase.storage
        .from("signature")
        .upload(path, blob, { upsert: true, contentType: "image/jpeg" });

      if (sigError) {
        console.error("❌ Signature upload error:", sigError);
        throw sigError;
      }

      const { data: sigData } = supabase.storage.from("signature").getPublicUrl(path);

      // Process order with uploaded signature URL
      await processOrderWithSignature(sigData.publicUrl);

    } catch (e) {
      console.error("❌ Error message:", e.message);
      console.error("❌ Error stack:", e.stack);
      console.error("❌ Full error:", e);
      showPopup({
        title: "Failed",
        message: "Failed to place order.",
        type: "error",
        confirmText: "Ok",
      })
      // alert(e.message || "Failed to place order");
      setLoading(false);
      setShowSignature(false);
    }
  };

  // ============================================================
  // AUTO SIGNATURE: Use logo image instead of canvas signature
  // ============================================================
  const handleAutoSignature = async () => {
    try {
      setLoading(true);
      setLoadingMessage("Processing...");

      // Use the logo URL directly as signature
      await processOrderWithSignature(AUTO_SIGNATURE_URL);

    } catch (e) {
      console.error("❌ Auto signature error:", e.message);
      showPopup({
        title: "Failed",
        message: "Failed to place order.",
        type: "error",
        confirmText: "Ok",
      })
      // alert(e.message || "Failed to place order");
      setLoading(false);
      setShowSignature(false);
    }
  };

  const handleLogout = async () => {
    try {
      sessionStorage.removeItem("screen4FormData");
      sessionStorage.removeItem("screen6FormData");

      const savedSession = sessionStorage.getItem("associateSession");

      if (savedSession) {
        const session = JSON.parse(savedSession);

        const { error } = await supabase.auth.setSession({
          access_token: session.access_token,
          refresh_token: session.refresh_token
        });

        if (error) {
          console.error("Failed to restore session:", error);
          navigate("/login", { replace: true });
          return;
        }

        sessionStorage.removeItem("associateSession");
        sessionStorage.removeItem("returnToAssociate");
        sessionStorage.setItem("requirePasswordVerificationOnReturn", "true");
        navigate("/AssociateDashboard", { replace: true });
      } else {
        sessionStorage.setItem("requirePasswordVerificationOnReturn", "true");
        navigate("/AssociateDashboard", { replace: true });
      }
    } catch (e) {
      console.error("Logout error", e);
      navigate("/login", { replace: true });
    }
  };

  if (!order) return <div>No order found</div>;

  return (
    <div className="rd-screen7">
      {/* Popup Component */}
      {PopupComponent}
      {loading && (
        <div className="global-loader">
          <img src={Logo} alt="Loading" className="loader-logo" />
          <p>{loadingMessage}</p>
        </div>
      )}

      <header className="pf-header">
        <img src={Logo} alt="logo" className="pf-header-logo" onClick={handleLogout} />
        <h1 className="pf-header-title">Review Details</h1>
      </header>

      <div className="screen6-container">
        {/* Gifting Order Badge */}
        {order.is_gifting && (
          <div style={{
            background: '#d5b85a',
            color: '#fff',
            padding: '10px 18px',
            borderRadius: '8px',
            marginBottom: '16px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '14px',
            fontWeight: '600',
          }}>
            Gifting Order For:
            {order.gift_recipient_name && (
              <span style={{ fontWeight: '400', opacity: 0.9 }}>
                {order.gift_recipient_name}
              </span>
            )}
          </div>
        )}

        <div className="section-box">
          <h3>Product Details</h3>
          {order.items?.map((item, i) => (
            <div key={i} className="product-box">
              <img src={item.image_url} className="prod-img" alt="" />
              <div className="product-fields">
                <div className="row-flex">
                  <div className="field field-wide">
                    <label>Product Name:</label>
                    <span>{item.product_name}</span>
                  </div>
                </div>
                {item.notes && (
                  <div className="field field-wide" style={{ marginTop: "12px" }}>
                    <label>Product Notes:</label>
                    <span>{item.notes}</span>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-5 mb-5 max-lg:grid-cols-1">
                  <div className="field">
                    <label>Top:</label>
                    <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                      <span>{item.top}</span>
                      {item.top_color && <ColorDotDisplay colorObject={item.top_color} />}
                    </div>
                  </div>
                  <div className="field">
                    <label>Bottom:</label>
                    <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                      <span>{item.bottom}</span>
                      {item.bottom_color && <ColorDotDisplay colorObject={item.bottom_color} />}
                    </div>
                  </div>
                  <div className="field">
                    <label>Size:</label>
                    <span>{item.size}</span>
                  </div>
                  {item.extras && item.extras.length > 0 && (
                    <div className="field field-wide">
                      <label>Extras:</label>
                      <div className="extras-display">
                        {item.extras.map((extra, idx) => (
                          <div key={idx} className="extra-item-display">
                            <span>{extra.name} (₹{formatIndianNumber(extra.price)})</span>
                            {extra.color && <ColorDotDisplay colorObject={extra.color} />}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {order.mode_of_delivery === "Home Delivery" && (
          <div className="section-box">
            <h3>Delivery Details</h3>
            <div className="row3">
              <div className="field"><label>Name:</label><span>{order.delivery_name}</span></div>
              <div className="field"><label>Email:</label><span>{order.delivery_email}</span></div>
              <div className="field"><label>Phone:</label><span>{formatPhoneNumber(order.delivery_phone)}</span></div>
            </div>
            <div className="field field-wide" style={{ marginTop: "12px" }}>
              <label>Delivery Address:</label>
              <span>{[order.delivery_address, order.delivery_city, order.delivery_state, order.delivery_pincode].filter(Boolean).join(", ")}</span>
            </div>
            {order.delivery_notes && (
              <div className="field field-wide" style={{ marginTop: "12px" }}>
                <label>Delivery Notes:</label><span>{order.delivery_notes}</span>
              </div>
            )}
            {order.is_gifting && (order.gift_recipient_name || order.gift_recipient_contact) && (
              <div className="row3" style={{ marginTop: "12px" }}>
                {order.gift_recipient_name && (
                  <div className="field">
                    <label>Gift Recipient:</label>
                    <span>{order.gift_recipient_name}</span>
                  </div>
                )}
                {order.gift_recipient_contact && (
                  <div className="field">
                    <label>Recipient Contact:</label>
                    <span>{order.gift_recipient_contact}</span>
                  </div>
                )}
              </div>
            )}
            {order.comments && (
              <div className="field field-wide" style={{ marginTop: "12px" }}>
                <label>General Order Comments:</label><span>{order.comments}</span>
              </div>
            )}
          </div>
        )}

        <div className="section-box">
          <h3>Billing Details</h3>
          {order.billing_same ? (
            <div className="field field-wide"><label>Billing Address:</label><span>Same as delivery address</span></div>
          ) : (
            <>
              {(order.billing_company || order.billing_gstin) && (
                <div className="row3">
                  <div className="field"><label>Company Name:</label><span>{order.billing_company || "—"}</span></div>
                  <div className="field"><label>GSTIN:</label><span>{order.billing_gstin || "—"}</span></div>
                </div>
              )}
              <div className="field field-wide" style={{ marginTop: "12px" }}>
                <label>Billing Address:</label>
                <span>{[order.billing_address, order.billing_city, order.billing_state, order.billing_pincode].filter(Boolean).join(", ")}</span>
              </div>
            </>
          )}
        </div>

        <div className="section-box">
          <h3>Payment Details</h3>
          <div className="row3">
            <div className="field">
              <label>Mode of Payment:</label>
              {order.is_split_payment ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                  {JSON.parse(order.payment_mode).map((sp, idx) => (
                    <span key={idx} style={{
                      background: "#e3f2fd",
                      padding: "4px 10px",
                      borderRadius: "12px",
                      fontSize: "13px",
                      color: "#1565c0",
                      fontWeight: "500",
                    }}>
                      {sp.mode}: ₹{formatIndianNumber(sp.amount)}
                    </span>
                  ))}
                </div>
              ) : (
                <span>{order.payment_mode || "—"}</span>
              )}
            </div>
            <div className="field"><label>Total Amount:</label><span>₹{formatIndianNumber(totalAmount)}</span></div>
            <div className="field"><label>Collector Code:</label><span>- ₹{formatIndianNumber(pricing.discountAmount)}</span></div>
          </div>

          {/* Store Credit Row */}
          {pricing.storeCreditUsed > 0 && (
            <div className="row3">
              <div className="field">
                <label>Store Credit Applied:</label>
                <span style={{ color: "#7b1fa2", fontWeight: "600" }}>- ₹{formatIndianNumber(pricing.storeCreditUsed)}</span>
              </div>
            </div>
          )}

          {/* Loyalty Points Row */}
          {/* {pricing.loyaltyDiscount > 0 && (
            <div className="row3">
              <div className="field">
                <label>Loyalty Points Redeemed:</label>
                <span style={{ color: "#e65100", fontWeight: "600" }}>
                  {pricing.loyaltyPointsRedeemed} pts = - ₹{formatIndianNumber(pricing.loyaltyDiscount)}
                </span>
              </div>
            </div>
          )} */}

          <div className="row3">
            <div className="field"><label>Net Payable:</label><span style={{ fontWeight: "600" }}>₹{formatIndianNumber(pricing.netPayable)}</span></div>
            <div className="field"><label>Advance Payment:</label><span>₹{formatIndianNumber(advancePayment)}</span></div>
            <div className="field"><label>Balance:</label><span>₹{formatIndianNumber(pricing.remaining)}</span></div>
          </div>
        </div>

        {/* ─── Other Details (Private SA only) ────────────────────
            EXB Name + SB Representative Name are mandatory when a Private
            SA places an order. Persisted to orders.exb_name and
            orders.sb_representative_name. Hidden for every other flow.
            Uses the same .section-box / .row3 / .field / .input-line
            classes as the rest of this screen (gold underline style). */}
        {isPrivateSA && (
          <div className="section-box">
            <h3>Other Details</h3>
            <div className="row3">
              <div className="field">
                <label htmlFor="exbName">EXB Name *</label>
                <input
                  id="exbName"
                  type="text"
                  className="input-line"
                  value={exbName}
                  onChange={(e) => setExbName(e.target.value)}
                  placeholder="Exhibition name"
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="sbRepName">SB Representative Name *</label>
                <input
                  id="sbRepName"
                  type="text"
                  className="input-line"
                  value={sbRepName}
                  onChange={(e) => setSbRepName(e.target.value)}
                  placeholder="Representative name"
                  required
                />
              </div>
            </div>
          </div>
        )}

        <button className="confirm-btn" disabled={loading} onClick={handlePlaceOrder}>
          {loading ? "Placing..." : "Place Order"}
        </button>
        <button className="back-btn" onClick={() => navigate(-1)}>←</button>
      </div>

      {showSignature && (
        <div className="signature-modal">
          <div className="signature-box">
            <h3>Sign Below</h3>
            <SignatureCanvas penColor="black" ref={setSigPad} canvasProps={{ width: 500, height: 200, className: "sig-canvas" }} />
            <div className="sig-buttons">
              <button style={{ color: "white" }} onClick={() => sigPad.clear()} disabled={loading}>Clear</button>
              <button style={{ color: "white" }} onClick={saveSignatureAndContinue} disabled={loading}>
                {loading ? "Placing..." : "Save & Continue"}
              </button>
              <button
                style={{
                  color: "white",
                  background: loading ? "#ccc" : "#d5b85a",
                  border: "none",
                  padding: "10px 20px",
                  borderRadius: "4px",
                  cursor: loading ? "not-allowed" : "pointer"
                }}
                onClick={handleAutoSignature}
                disabled={loading}
              >
                {loading ? "Placing..." : "Auto"}
              </button>
            </div>
            <button className="close-modal" onClick={() => setShowSignature(false)}>✖</button>
          </div>
        </div>
      )}
    </div>
  );
}