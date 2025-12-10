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

  if (!order) {
    return <div style={{ padding: 20 }}>No order data found.</div>;
  }

  const saveOrderToDB = async () => {
    setLoading(true);
    const { error } = await supabase.from("orders").insert(order);
    setLoading(false);

    if (error) {
      alert(error.message);
      return;
    }

    alert("Order Saved!");
    navigate("/orderHistory");
  };

  return (
    <div className="screen7">

      {/* HEADER */}
      <div className="screen7-header">
        <button className="back-btn" onClick={() => navigate(-1)}>←</button>
        <img src={Logo} className="sheetal-logo" alt="logo" />
      </div>

      <h2 className="title">Review Your Order</h2>

      <div className="screen7-container">


        {/* PRODUCT DETAILS (MATCHES SCREEN6 CARD STYLE) */}
        {/* PRODUCT DETAILS */}
        <div className="section-box">
          <h3>Product Details</h3>

          {order.items?.map((item, i) => (
            <div key={i} className="product-box">

              {/* IMAGE */}
              <img src={item.image_url} className="prod-img" alt="" />

              {/* DETAILS USING SCREEN6 STYLE */}
              <div className="product-fields">

                {/* ROW 1 — Product Name (2 columns) + Color */}
                {/* ROW 1 — Product Name + Color in same horizontal row */}
                <div className="row-flex">

                  <div className="field field-wide">
                    <label>Product Name:</label>
                    <span>{item.product_name}</span>
                  </div>

                  <div className="field field-small">
                    <label>Color:</label>
                    <div style={{background:item.color,height:"15px",width:'30px',borderRadius:'14px',marginBottom:'5px'}}></div>
                    <span>{item.color}</span>
                    
                  </div>

                </div>


                {/* ROW 2 — Top + Bottom + Extras */}
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



        {/* SALESPERSON DETAILS — SCREEN6 STYLE */}
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


        {/* PAYMENT DETAILS — SCREEN6 STYLE */}
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
          {loading ? "Saving..." : "Confirm & Save Order"}
        </button>
      </div>
    </div>
  );
}
