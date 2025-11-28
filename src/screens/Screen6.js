import React, { useEffect, useState } from "react";
import "./Screen6.css";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";

export default function Screen6() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();

  const order = location.state?.orderPayload;

  const [profile, setProfile] = useState(null);
  const [salespersons, setSalespersons] = useState([]);
  const [selectedSP, setSelectedSP] = useState(null);

  // Billing
  const [billingSame, setBillingSame] = useState(true);
  const [billingAddress, setBillingAddress] = useState("");
  const [billingCompany, setBillingCompany] = useState("");
  const [billingGST, setBillingGST] = useState("");

  useEffect(() => {
    if (!user) return;
    loadProfile();
    loadSalespersons();
  }, [user]);

  const loadProfile = async () => {
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();

    setProfile(data);
  };

  const loadSalespersons = async () => {
    const { data } = await supabase.from("salesperson").select("*");
    setSalespersons(data);
  };

  const handleSPChange = (id) => {
    const found = salespersons.find((s) => s.id.toString() === id);
    setSelectedSP(found);
  };

  const confirmOrder = async () => {
    if (!billingSame) {
      if (!billingAddress || !billingCompany || !billingGST) {
        alert("Please fill billing details");
        return;
      }
    }

    const payload = {
      ...order,
      user_id: user.id,

      billing_same: billingSame,
      billing_address: billingSame ? profile.address : billingAddress,
      billing_company: billingSame ? null : billingCompany,
      billing_gstin: billingSame ? null : billingGST,

      salesperson: selectedSP?.salesperson || null,
      salesperson_phone: selectedSP?.phone || null,
      salesperson_email: selectedSP?.email || null,

      created_at: new Date(),
    };

    const { error } = await supabase.from("orders").insert(payload);

    if (error) return alert(error.message);

    alert("Order placed successfully!");
    navigate("/payment");
  };

  if (!profile || !order) return <p>Loading...</p>;

  return (
    <div className="screen6">

      {/* HEADER */}
      <div className="screen6-header">
        <button className="back-btn" onClick={() => navigate(-1)}>←</button>
        <img src="/logo.png" className="sheetal-logo" alt="logo" />
        <button className="share-btn">Share</button>
      </div>

      <h2 className="title">Confirm Your Details</h2>

      <div className="screen6-container">

        {/* CONTACT DETAILS */}
        <div className="section-box">
          <h3>Contact Details</h3>

          <div className="row3">
            <div className="field">
              <label>Full name:</label>
              <span>{profile.full_name}</span>
            </div>

            <div className="field">
              <label>Email:</label>
              <span>{profile.email}</span>
            </div>

            <div className="field">
              <label>Phone:</label>
              <span>{profile.phone}</span>
            </div>
          </div>
        </div>

        {/* DELIVERY DETAILS */}
        <div className="section-box">
          <h3>Delivery Details</h3>

          <div className="row3">
            <div className="field">
              <label>Full Name:</label>
              <span>{profile.full_name}</span>
            </div>

            <div className="field">
              <label>Email:</label>
              <span>{profile.email}</span>
            </div>

            <div className="field">
              <label>Phone:</label>
              <span>{profile.phone}</span>
            </div>
          </div>

          <div className="row3">
            <div className="field">
              <label>Delivery Address:</label>
              <span>{profile.address}</span>
            </div>

            <div className="field">
              <label>City:</label>
              <span>{profile.city}</span>
            </div>

            <div className="field">
              <label>State:</label>
              <span>{profile.state}</span>
            </div>

            <div className="field">
              <label>Pincode:</label>
              <span>{profile.pincode}</span>
            </div>
          </div>

          <div className="row3">
            <div className="field">
              <label>Delivery Date:</label>
              <span>{order.delivery_date}</span>
            </div>

            <div className="field">
              <label>Delivery Notes:</label>
              <span>{order.comments || "—"}</span>
            </div>
          </div>
        </div>

        {/* BILLING DETAILS */}
        {/* BILLING DETAILS */}
        <div className="section-box">
          <h3>Billing Details</h3>

          <div className="row3">
            <div className="field">
              <label>Billing address same as delivery address:</label>
              <select
                className="input-select"
                value={billingSame ? "yes" : "no"}
                onChange={(e) => setBillingSame(e.target.value === "yes")}
              >
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </div>

            <div className="field">
              <label>Company name:</label>
              <input
                className="input-line"
                value={billingCompany}
                onChange={(e) => setBillingCompany(e.target.value)}
              />
            </div>

            <div className="field">
              <label>GSTIN:</label>
              <input
                className="input-line"
                value={billingGST}
                onChange={(e) => setBillingGST(e.target.value)}
              />
            </div>
          </div>

          {!billingSame && (
            <div className="row3">
              <div className="field full-width">
                <label>Billing Address:</label>
                <input
                  className="input-line"
                  value={billingAddress}
                  onChange={(e) => setBillingAddress(e.target.value)}
                />
              </div>
            </div>
          )}
        </div>


        {/* SALESPERSON DETAILS */}
        <div className="section-box">
          <h3>Salesperson Details</h3>

          <div className="row3">
            <div className="field">
              <label>Salesperson:</label>
              <select
                className="input-select"
                onChange={(e) => handleSPChange(e.target.value)}
              >
                <option value="">Select</option>
                {salespersons.map((sp) => (
                  <option key={sp.id} value={sp.id}>
                    {sp.salesperson}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label>Salesperson Phone:</label>
              <span>{selectedSP?.phone || "—"}</span>
            </div>

            <div className="field">
              <label>Salesperson Email:</label>
              <span>{selectedSP?.email || "—"}</span>
            </div>
          </div>
        </div>

        {/* PRODUCT DETAILS */}
        {/* PRODUCT DETAILS */}
<div className="section-box">
  <h3>Product Details</h3>

  {order.items.map((item, i) => (
    <div key={i} className="product-box">

      {/* Product Image */}
      <img
        src={item.image_url || "/images/sample-product.jpg"}
        alt="product"
        className="prod-img"
      />

      {/* Product Info */}
      <div className="prod-details">
        <div className="prod-row2">
          <div className="prod-field">
            <label>Product Name:</label>
            <span>{item.product_name}</span>
          </div>

          <div className="prod-field">
            <label>Color:</label>
            <span>{item.color}</span>
          </div>
        </div>

        <div className="prod-row2">
          <div className="prod-field">
            <label>Top:</label>
            <span>{item.top}</span>
          </div>

          <div className="prod-field">
            <label>Bottom:</label>
            <span>{item.bottom}</span>
          </div>
        </div>

        <div className="prod-row2">
          <div className="prod-field">
            <label>Extras:</label>
            <span>{item.extra}</span>
          </div>
        </div>
      </div>

    </div>
  ))}
</div>


        {/* CONFIRM BUTTON */}
        <button className="confirm-btn" onClick={confirmOrder}>
          Confirm & Submit Order
        </button>

      </div>
    </div>
  );
}
