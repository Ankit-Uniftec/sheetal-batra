import React, { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";
import SignatureCanvas from "react-signature-canvas";
import Logo from "../images/logo.png";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import formatIndianNumber from "../utils/formatIndianNumber";
import formatDate from "../utils/formatDate"; // Import formatDate
import "./Screen7.css";
import { buildCustomerOrderPdf } from "../pdf/customerPdf";
import { buildWarehousePdf } from "../pdf/warehousePdf";



function ColorDotDisplay({ colorObject }) {
  if (!colorObject) return null;

  let displayColorName = "";
  let displayColorHex = "#000000";

  if (typeof colorObject === "string") {
    displayColorName = colorObject;
    // Attempt to convert common color names to hex if needed, or use a default
    displayColorHex = colorObject.startsWith("#") ? colorObject : "gray"; // Fallback to gray for unknown named colors
  } else if (typeof colorObject === "object" && colorObject !== null) {
    displayColorName = colorObject.name || "";
    displayColorHex = colorObject.hex || "#000000";
  } else {
    // Fallback for any other unexpected type, prevent rendering the object
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


// ===============================
// DATE HELPERS (POSTGRES SAFE)
// ===============================
const toISODate = (value) => {
  if (!value) return null;

  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);

  // Convert DD-MM-YYYY → YYYY-MM-DD
  if (/^\d{2}-\d{2}-\d{4}$/.test(value)) {
    const [dd, mm, yyyy] = value.split("-");
    return `${yyyy}-${mm}-${dd}`;
  }

  // Fallback (Date object / timestamp)
  try {
    return new Date(value).toISOString().slice(0, 10);
  } catch {
    return null;
  }
};


export default function ReviewDetail() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const order = location.state?.orderPayload;

  const [loading, setLoading] = useState(false);
  const [showSignature, setShowSignature] = useState(false);
  const [sigPad, setSigPad] = useState(null);

  const totalAmount = Number(order.grand_total) || 0;
  const advancePayment = Number(order.advance_payment) || 0;
  const discountPercent = Number(order.discount_percent) || 0;
  const discountAmount = Number(order.discount_amount) || 0;
  const netPayable = Number(order.net_total) || 0;
  const remaining = Number(order.remaining_payment) || 0;

  const pricing = {
    discountPercent,
    discountAmount,
    netPayable,
    remaining,
  };

  // ===============================
  // PROFILE
  // ===============================
  const profileFromOrder = (o) => ({
    full_name: o?.delivery_name || "",
    email: o?.delivery_email || "",
    phone: o?.delivery_phone || "",
  });

  // ===============================
  // SIGNATURE FLOW
  // ===============================
  const handlePlaceOrder = () => {
    setShowSignature(true);
  };

  const saveSignatureAndContinue = async () => {
    if (!sigPad || sigPad.isEmpty()) {
      alert("Please sign before continuing.");
      return;
    }

    try {
      setLoading(true);

      const blob = await (await fetch(sigPad.toDataURL("image/png"))).blob();
      const path = `${user.id}/signature_${Date.now()}.png`;

      const { error } = await supabase.storage
        .from("signature")
        .upload(path, blob, { upsert: true });

      if (error) throw error;

      const { data } = supabase.storage
        .from("signature")
        .getPublicUrl(path);

      const orderWithPricing = {
        ...order,
        discount_percent: pricing.discountPercent,
        discount_amount: pricing.discountAmount,
        grand_total_after_discount: pricing.netPayable,
        net_total: pricing.netPayable,
        remaining_payment: pricing.remaining,
        signature_url: data.publicUrl,
      };

      await saveOrderToDB(orderWithPricing);
    } catch (e) {
      alert("Signature upload failed");
      console.error(e);
    } finally {
      setLoading(false);
      setShowSignature(false);
    }
  };

  // ===============================
  // PDF BUILDER (SAFE)
  // ===============================


  // ===============================
  // SAVE ORDER
  // ===============================
  // ===============================
  // SAVE ORDER (DATE SAFE)
  // ===============================
  const saveOrderToDB = async (orderToSave) => {
    try {
      // ===============================
      // NORMALIZE DATE FIELDS (SAFE)
      // ===============================
      const normalizedOrder = {
        ...orderToSave,

        created_at: orderToSave.created_at
          ? new Date(orderToSave.created_at).toISOString()
          : new Date().toISOString(),

        delivery_date: toISODate(orderToSave.delivery_date),
        join_date: toISODate(orderToSave.join_date),

        // Optional dates (safe even if undefined)
        billing_date: toISODate(orderToSave.billing_date),
        expected_delivery: toISODate(orderToSave.expected_delivery),
      };

      // ===============================
      // SAVE ORDER TO DB
      // ===============================
      const { data, error } = await supabase
        .from("orders")
        .insert(normalizedOrder)
        .select()
        .single();

      if (error) throw error;

      // ===============================
      // GENERATE BOTH PDFs
      // ===============================
      const logoUrl = new URL(Logo, window.location.origin).href;

      // 🔹 Customer Order Copy
      const customerPdfBytes = await buildCustomerOrderPdf(data, logoUrl);

      // 🔹 Warehouse Order Copy
      const warehousePdfBytes = await buildWarehousePdf(data, logoUrl);

      // ===============================
      // UPLOAD PDFs TO STORAGE
      // ===============================
      const uploads = [
        supabase.storage
          .from("invoices")
          .upload(
            `orders/${data.id}_customer.pdf`,
            new Blob([customerPdfBytes]),
            {
              upsert: true,
              contentType: "application/pdf",
            }
          ),

        supabase.storage
          .from("invoices")
          .upload(
            `orders/${data.id}_warehouse.pdf`,
            new Blob([warehousePdfBytes]),
            {
              upsert: true,
              contentType: "application/pdf",
            }
          ),
      ];

      await Promise.all(uploads);

      // ===============================
      // DONE
      // ===============================
      alert("✅ Order saved & both PDFs generated successfully!");
      // navigate("/orderHistory");
      handleLogout();
    } catch (e) {
      console.error("❌ Order save failed:", e);
      alert(e.message || "Failed to save order");
    }
  };


  //logo click logout
  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();

      const raw = sessionStorage.getItem("associateSession");
      const saved = raw ? JSON.parse(raw) : null;

      if (saved?.access_token && saved?.refresh_token) {
        const { error } = await supabase.auth.setSession({
          access_token: saved.access_token,
          refresh_token: saved.refresh_token,
        });

        if (!error) {
          sessionStorage.removeItem("associateSession");
          sessionStorage.removeItem("returnToAssociate");
          navigate("/AssociateDashboard", { replace: true });
          return;
        }
      }
      navigate("/login", { replace: true });
    } catch (e) {
      console.error("Logout restore error", e);
      navigate("/login", { replace: true });
    }
  };
  // ==========================
  // JSX UI BELOW
  // ==========================

  if (!order) {
    return <div>No order found</div>;
  }

  return (
    <div className="screen7">
      {/* HEADER */}
      <div className="screen6-header">

        <img src={Logo} className="sheetal-logo" alt="logo" onClick={handleLogout} />
        <h2 className="title">Review Detail</h2>
      </div>



      <div className="screen6-container">
        {/* PRODUCT DETAILS */}
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
                  <div className="field field-small">
                    <label>Color:</label>
                    <ColorDotDisplay colorObject={item.color} />
                  </div>
                </div>

                {item.notes && (
                  <div className="field field-wide" style={{ marginTop: "12px" }}>
                    <label>Product Notes:</label>
                    <span>{item.notes}</span>
                  </div>
                )}

                <div className="row3">
                  <div className="field">
                    <label>Top:</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <span>{item.top}</span>
                      {item.top_color && <ColorDotDisplay colorObject={item.top_color} />}
                    </div>
                  </div>
                  <div className="field">
                    <label>Bottom:</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
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

        {/* Delivery */}
        {order.mode_of_delivery === "Home Delivery" && (
          <div className="section-box">
            <h3>Delivery Details</h3>

            <div className="row3">
              <div className="field">
                <label>Name:</label>
                <span>{order.delivery_name}</span>
              </div>
              <div className="field">
                <label>Email:</label>
                <span>{order.delivery_email}</span>
              </div>
              <div className="field">
                <label>Phone:</label>
                <span>{order.delivery_phone}</span>
              </div>
            </div>

            {/* ✅ DELIVERY ADDRESS */}
            <div className="field field-wide" style={{ marginTop: "12px" }}>
              <label>Delivery Address:</label>
              <span>
                {[
                  order.delivery_address,
                  order.delivery_city,
                  order.delivery_state,
                  order.delivery_pincode,
                ]
                  .filter(Boolean)
                  .join(", ")}
              </span>
            </div>

            {order.delivery_notes && (
              <div className="field field-wide" style={{ marginTop: "12px" }}>
                <label>Delivery Notes:</label>
                <span>{order.delivery_notes}</span>
              </div>
            )}

            {order.comments && (
              <div className="field field-wide" style={{ marginTop: "12px" }}>
                <label>General Order Comments:</label>
                <span>{order.comments}</span>
              </div>
            )}
          </div>
        )}

        {/* Billing Details */}
        <div className="section-box">
          <h3>Billing Details</h3>

          {order.billing_same ? (
            <div className="field field-wide">
              <label>Billing Address:</label>
              <span>Same as delivery address</span>
            </div>
          ) : (
            <>
              {/* Company + GSTIN (same row like other sections) */}
              {(order.billing_company || order.billing_gstin) && (
                <div className="row3">
                  <div className="field">
                    <label>Company Name:</label>
                    <span>{order.billing_company || "—"}</span>
                  </div>

                  <div className="field">
                    <label>GSTIN:</label>
                    <span>{order.billing_gstin || "—"}</span>
                  </div>
                </div>
              )}

              {/* Billing Address */}
              <div className="field field-wide" style={{ marginTop: "12px" }}>
                <label>Billing Address:</label>
                <span>
                  {[
                    order.billing_address,
                    order.billing_city,
                    order.billing_state,
                    order.billing_pincode,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                </span>
              </div>
            </>
          )}
        </div>



        {/* Salesperson */}
        <div className="section-box">
          <h3>Salesperson Details</h3>
          <div className="row3">
            <div className="field">
              <label>Name:</label>
              <span>{order.salesperson || "—"}</span>
            </div>
            <div className="field">
              <label>Email:</label>
              <span>{order.salesperson_email || "—"}</span>
            </div>
            <div className="field">
              <label>Phone:</label>
              <span>{order.salesperson_phone || "—"}</span>
            </div>
          </div>
        </div>

        {/* Payment */}
        <div className="section-box">
          <h3>Payment Details</h3>
          <div className="row3">
            <div className="field">
              <label>Total Amount:</label>
              <span>₹{formatIndianNumber(totalAmount)}</span>
            </div>
            <div className="field">
              <label>Advance Payment:</label>
              <span>₹{formatIndianNumber(advancePayment)}</span>
            </div>
            <div className="field">
              <label>Balance:</label>
              <span>₹{formatIndianNumber(pricing.remaining)}</span>
            </div>

          </div>
          {pricing.discountPercent>0 && (
            <div className="row3">


              <div className="field">
                <label>Discount %:</label>
                <span>{pricing.discountPercent}%</span>
              </div>
              <div className="field">
                <label>Discount Amount:</label>
                <span>₹{formatIndianNumber(pricing.discountAmount)}</span>
              </div>



            </div>
          )

          }
        </div>

        <button
          className="confirm-btn"
          disabled={loading}
          onClick={handlePlaceOrder}
        >
          {loading ? "Saving..." : "Place Order"}
        </button>
        <button className="back-btn" onClick={() => navigate(-1)}>
          ←
        </button>
      </div>

      {/* SIGNATURE MODAL */}
      {showSignature && (
        <div className="signature-modal">
          <div className="signature-box">
            <h3>Sign Below</h3>
            <SignatureCanvas
              penColor="black"
              ref={setSigPad}
              canvasProps={{
                width: 500,
                height: 200,
                className: "sig-canvas",
              }}
            />
            <div className="sig-buttons" >
              <button style={{ color: "white" }} onClick={() => sigPad.clear()}>Clear </button>
              <button style={{ color: "white !important" }} onClick={saveSignatureAndContinue}>
                Save & Continue
              </button>
            </div>
            <button
              className="close-modal"
              onClick={() => setShowSignature(false)}
            >
              ✖
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
