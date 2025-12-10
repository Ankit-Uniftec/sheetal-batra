import React, { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import Logo from "../images/logo.png";
import "./Screen7.css";

export default function Screen7() {
  const navigate = useNavigate();
  const location = useLocation();
  const order = location.state?.orderPayload;

  const [loading, setLoading] = useState(false);
  const [sendTo, setSendTo] = useState(
    order?.delivery_phone || order?.phone || ""
  );

  if (!order) {
    return <div style={{ padding: 20 }}>No order data found.</div>;
  }

  const profileFromOrder = (src) => ({
    full_name: src?.delivery_name || src?.customer_name || src?.name || "",
    email: src?.delivery_email || src?.email || "",
    phone: src?.delivery_phone || src?.phone || "",
  });

  const saveOrderToDB = async () => {
    setLoading(true);
    try {
      const { data: inserted, error } = await supabase
        .from("orders")
        .insert(order)
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
          onClick={saveOrderToDB}
        >
          {loading ? "Saving..." : "Placed Order"}
        </button>
      </div>
    </div>
  );
}
