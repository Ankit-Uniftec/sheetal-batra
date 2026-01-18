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
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const order = location.state?.orderPayload;

  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("Placing order...");
  const [showSignature, setShowSignature] = useState(false);
  const [sigPad, setSigPad] = useState(null);

  const totalAmount = Number(order?.grand_total) || 0;
  const advancePayment = Number(order?.advance_payment) || 0;
  const discountPercent = Number(order?.discount_percent) || 0;
  const discountAmount = Number(order?.discount_amount) || 0;
  const netPayable = Number(order?.net_total) || 0;
  const remaining = Number(order?.remaining_payment) || 0;
  const storeCreditUsed = Number(order?.store_credit_used) || 0;

  const pricing = { discountPercent, discountAmount, netPayable, remaining, storeCreditUsed };

  const handlePlaceOrder = () => setShowSignature(true);

  const saveSignatureAndContinue = async () => {
    if (!sigPad || sigPad.isEmpty()) {
      alert("Please sign before continuing.");
      return;
    }

    try {
      setLoading(true);
      setLoadingMessage("Uploading signature...");

      const emptyFields = checkEmptyFields(order);
      if (emptyFields.length > 0) {
        console.log("⚠️ Found empty fields that might cause PDF issues:");
      }

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

      setLoadingMessage("Saving order...");
      // 2️⃣ PREPARE ORDER DATA
      const normalizedOrder = {
        ...order,
        discount_percent: pricing.discountPercent,
        discount_amount: pricing.discountAmount,
        grand_total_after_discount: pricing.netPayable,
        net_total: pricing.netPayable,
        remaining_payment: pricing.remaining,
        signature_url: sigData.publicUrl,
        created_at: order.created_at ? new Date(order.created_at).toISOString() : new Date().toISOString(),
        delivery_date: toISODate(order.delivery_date),
        join_date: toISODate(order.join_date),
        billing_date: toISODate(order.billing_date),
        expected_delivery: toISODate(order.expected_delivery),
      };

      // Remove measurement saving flags from order data
      const { save_measurements, measurements_to_save, store_credit_remaining, ...orderDataToInsert } = normalizedOrder;

      setLoadingMessage("Generating invoice PDFs...");
      // 3️⃣ GENERATE ORDER NUMBER
      const { data: orderNo, error: orderNoError } = await supabase.rpc(
        "generate_order_no",
        { p_store: normalizedOrder.mode_of_delivery }
      );

      if (orderNoError) {
        console.error("❌ Order number generation error:", orderNoError);
        throw orderNoError;
      }

      // 4️⃣ INSERT ORDER

      const { data: insertedOrder, error: insertError } = await supabase
        .from("orders")
        .insert({ ...orderDataToInsert, order_no: orderNo })
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

      setLoadingMessage("Sending confirmation...");
      // 5️⃣.0 GENERATE PDFs & SEND WHATSAPP
      const orderWithItems = {
        ...insertedOrder,
        items: normalizedOrder.items || order.items || [],
      };
      try {
        const pdfUrls = await generateAllPdfs(orderWithItems);

        // Send WhatsApp with Customer PDF
        if (pdfUrls?.customer_url) {
          try {

            const response = await fetch(
              `${config.SUPABASE_URL}/functions/v1/spur-whatsapp`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "apikey": config.SUPABASE_KEY,
                  "Authorization": `Bearer ${config.SUPABASE_KEY}`,
                },
                body: JSON.stringify({
                  customerName: orderWithItems.delivery_name,
                  customerPhone: orderWithItems.delivery_phone,
                  customerCountry: orderWithItems.delivery_country || "India",
                  pdfUrl: pdfUrls.customer_url,
                }),
              }
            );

          } catch (err) {
            console.error("❌ WhatsApp error:", err);
          }
        }
      } catch (pdfError) {
        console.error("❌ PDF generation failed:", pdfError);
        // Continue anyway - order is already placed
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
        console.log("ℹ️ No measurements to save");
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
        console.log("ℹ️ No store credit used in this order");
      }

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
              console.warn(`   ⚠️ No variant found for size ${item.size}`);
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
              if (reduceResult.success) {
              } else {
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

      navigate("/order-placed", {
        state: { order: { ...insertedOrder, items: insertedOrder.items || [] } },
        replace: true,
      });

    } catch (e) {
      console.error("❌ Error message:", e.message);
      console.error("❌ Error stack:", e.stack);
      console.error("❌ Full error:", e);
      alert(e.message || "Failed to place order");
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
      {loading && (
        <div className="global-loader">
          <img src={Logo} alt="Loading" className="loader-logo" />
          <p>{loadingMessage}</p>
        </div>
      )}

      <div className="screen6-header">
        <img src={Logo} className="sheetal-logo" alt="logo" onClick={handleLogout} />
        <h2 className="title">Review Details</h2>
      </div>

      <div className="screen6-container">
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
                <div className="row3">
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

          <div className="row3">
            <div className="field"><label>Net Payable:</label><span style={{ fontWeight: "600" }}>₹{formatIndianNumber(pricing.netPayable)}</span></div>
            <div className="field"><label>Advance Payment:</label><span>₹{formatIndianNumber(advancePayment)}</span></div>
            <div className="field"><label>Balance:</label><span>₹{formatIndianNumber(pricing.remaining)}</span></div>
          </div>
        </div>

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
              <button style={{ color: "white" }} onClick={() => sigPad.clear()}>Clear</button>
              <button style={{ color: "white" }} onClick={saveSignatureAndContinue}>Save & Continue</button>
            </div>
            <button className="close-modal" onClick={() => setShowSignature(false)}>✖</button>
          </div>
        </div>
      )}
    </div>
  );
}