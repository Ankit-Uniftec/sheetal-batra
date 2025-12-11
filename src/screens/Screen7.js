import React, { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";
import Logo from "../images/logo.png";
import SignatureCanvas from "react-signature-canvas";
import "./Screen7.css";

export default function Screen7() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const order = location.state?.orderPayload;

  const [loading, setLoading] = useState(false);
  const [sendTo, setSendTo] = useState(
    order?.delivery_phone || order?.phone || ""
  );

  // Signature Modal
  const [showSignature, setShowSignature] = useState(false);
  const [sigPad, setSigPad] = useState(null);

  if (!order) {
    return <div style={{ padding: 20 }}>No order data found.</div>;
  }

  const profileFromOrder = (src) => ({
    full_name: src?.delivery_name || src?.customer_name || src?.name || "",
    email: src?.delivery_email || src?.email || "",
    phone: src?.delivery_phone || src?.phone || "",
  });

  // -------------------------------
  // STEP 1 → OPEN SIGNATURE MODAL
  // -------------------------------
  const handlePlaceOrder = () => {
    setShowSignature(true); // Open signature modal
  };

  // -------------------------------
  // STEP 2 → SAVE SIGNATURE + SAVE ORDER
  // -------------------------------
  const saveSignatureAndContinue = async () => {
    if (!sigPad || sigPad.isEmpty()) {
      alert("Please provide signature before continuing.");
      return;
    }

    try {
      // Convert signature to PNG data URL
      const dataUrl = sigPad.toDataURL("image/png");

      // Convert data URL -> Blob
      const blob = await (await fetch(dataUrl)).blob();

      // ---- IMPORTANT: clean, unique path ----
      const timestamp = Date.now();
      const filePath = `${user.id}/signature_${timestamp}.png`;

      // ---- Upload to Supabase Storage ----
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from("signature") // 👈 bucket name (must match dashboard)
        .upload(filePath, blob, {
          contentType: "image/png",
          upsert: true,
        });

      if (uploadError) {
        console.error("Signature upload error:", uploadError);
        alert("Signature upload failed: " + uploadError.message);
        return;
      }

      // ---- Get public URL of uploaded file ----
      const { data: publicData } = supabase.storage
        .from("signature")
        .getPublicUrl(filePath);

      const signatureUrl = publicData.publicUrl;

      // ---- Update order with signature URL ----
      const orderWithSignature = {
        ...order,
        signature_url: signatureUrl,
      };

      // Close modal
      setShowSignature(false);

      // Now save order to DB and send PDF
      await saveOrderToDB(orderWithSignature);
    } catch (err) {
      console.error("Unexpected error while saving signature:", err);
      alert("Unexpected error while saving signature.");
    }
  };

  const saveOrderToDB = async (orderToSave = order) => {
    setLoading(true);
    try {
      const { data: inserted, error } = await supabase
        .from("orders")
        .insert(orderToSave)
        .select()
        .single();

      if (error) {
        alert(error.message);
        return;
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();

      const SUPABASE_URL =
        supabase?.supabaseUrl || "https://qlqvchcvuwjnfranqcmx.supabase.co";

      const res = await fetch(`${SUPABASE_URL}/functions/v1/send-order-pdf`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token ?? ""}`,
        },
        body: JSON.stringify({
          order: inserted,
          profile: profileFromOrder(inserted),
          sendTo,
        }),
      });

      const raw = await res.text();
      let json = null;

      try {
        json = JSON.parse(raw);
      } catch (_) { }

      if (!res.ok) {
        console.error("Edge Function HTTP error:", raw);
        alert("Order saved but invoice step failed.");
        return;
      }

      if (json?.ok === false) {
        alert("Order saved but invoice failed. Check console.");
        return;
      }

      alert("Order saved & invoice sent on WhatsApp!");
      navigate("/orderHistory");
    } catch (e) {
      console.error("Save+PDF error:", e);
      alert("Unexpected error during save.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="screen7">
      {/* HEADER */}
      <div className="screen7-header">
        <button className="back-btn" onClick={() => navigate(-1)}>
          ←
        </button>
        <img src={Logo} className="sheetal-logo" alt="logo" />
      </div>

      <h2 className="title">Review Your Order</h2>

      <div className="screen7-container">
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
                    <div
                      style={{
                        background: item.color,
                        height: "15px",
                        width: "30px",
                        borderRadius: "14px",
                        marginBottom: "5px",
                      }}
                    />
                    <span className="color-value">
                      {item.color}

                    </span>
                  </div>
                </div>

                <div className="row3">
                  <div className="field">
                    <label>Top:</label>
                    <span>{item.top}</span>
                  </div>
                  <div className="field">
                    <label>Bottom:</label>
                    <span>{item.bottom}</span>
                  </div>
                  <div className="field">
                    <label>Extras:</label>
                    <span>{item.extra}</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* BILLING DETAILS — only if GST Invoice = Yes */}
        {order.billing_same === false && (
          <div className="section-box">
            <h3>Billing Details</h3>

            <div className="row3">
              <div className="field">
                <label>Company Name:</label>
                <span>{order.billing_company || "—"}</span>
              </div>

              <div className="field">
                <label>GSTIN:</label>
                <span>{order.billing_gstin || "—"}</span>
              </div>

              <div className="field">
                <label>Billing Address:</label>
                <span>{order.billing_address || "—"}</span>
              </div>
            </div>
          </div>
        )}

        {/* DELIVERY DETAILS — only for Home Delivery */}
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

            <div className="row3">
              <div className="field">
                <label>Address:</label>
                <span>{order.delivery_address}</span>
              </div>

              <div className="field">
                <label>City:</label>
                <span>{order.delivery_city}</span>
              </div>

              <div className="field">
                <label>State:</label>
                <span>{order.delivery_state}</span>
              </div>
            </div>

            <div className="row3">
              <div className="field">
                <label>Pincode:</label>
                <span>{order.delivery_pincode}</span>
              </div>

              <div className="field">
                <label>Delivery Date:</label>
                <span>{order.delivery_date}</span>
              </div>

              <div className="field">
                <label>Notes:</label>
                <span>{order.comments || "—"}</span>
              </div>
            </div>
          </div>
        )}

        {/* SALESPERSON DETAILS */}
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

        {/* PAYMENT DETAILS */}
        <div className="section-box">
          <h3>Payment Details</h3>
          <div className="row3">
            <div className="field">
              <label>Total Amount:</label>
              <span>₹{order.grand_total}</span>
            </div>
            <div className="field">
              <label>Advance Paid:</label>
              <span>—</span>
            </div>
            <div className="field">
              <label>Balance:</label>
              <span>—</span>
            </div>
          </div>
        </div>

        <button
          className="confirm-btn"
          disabled={loading}
          onClick={handlePlaceOrder}
        >
          {loading ? "Saving..." : "Place Order"}
        </button>
      </div>

      {/* SIGNATURE MODAL */}
      {showSignature && (
        <div className="signature-modal">
          <div className="signature-box">
            <h3>Please Sign Below</h3>

            <SignatureCanvas
              penColor="black"
              ref={setSigPad}
              canvasProps={{
                width: 500,
                height: 200,
                className: "sig-canvas",
              }}
            />

            <div className="sig-buttons">
              <button
                onClick={() => sigPad.clear()}
                style={{
                  height: "40px",
                  width: "70px",
                  textAlign: "center",
                }}
              >
                Clear
              </button>

              <button
                className="confirm-btn"
                onClick={saveSignatureAndContinue}
                disabled={loading}
              >
                {loading ? "Saving..." : "Save & Continue"}
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
