import React, { useEffect, useState } from "react";
import "./Screen6.css";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";
import Logo from "../images/logo.png";
import SignatureCanvas from "react-signature-canvas";

export default function Screen6() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();

  const order = location.state?.orderPayload;

  const [profile, setProfile] = useState(null);
  const [selectedSP, setSelectedSP] = useState(null);

  // Billing
  const [billingSame, setBillingSame] = useState(true);
  const [billingAddress, setBillingAddress] = useState("");
  const [billingCity, setBillingCity] = useState("");
  const [billingState, setBillingState] = useState("");
  const [billingPincode, setBillingPincode] = useState("");
  const [billingCompany, setBillingCompany] = useState("");
  const [billingGST, setBillingGST] = useState("");

  // Delivery
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [deliveryCity, setDeliveryCity] = useState("");
  const [deliveryState, setDeliveryState] = useState("");
  const [deliveryPincode, setDeliveryPincode] = useState("");

  // Signature Modal
  const [showSignature, setShowSignature] = useState(false);
  const [sigPad, setSigPad] = useState(null);

  const norm = (v) => (v || "").trim();

  // Load user profile + salesperson
  useEffect(() => {
    const cachedEmail = norm(localStorage.getItem("sp_email"));
    let cancelled = false;

    (async () => {
      if (user?.id) {
        const { data: prof } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", user.id)
          .single();

        if (!cancelled) setProfile(prof || null);
      }

      if (!cachedEmail) return;

      const { data: sp1 } = await supabase
        .from("salesperson")
        .select("*")
        .eq("email", cachedEmail)
        .limit(1);

      let sp = sp1?.[0];

      if (!sp) {
        const { data: sp2 } = await supabase
          .from("salesperson")
          .select("*")
          .ilike("email", cachedEmail)
          .limit(1);
        sp = sp2?.[0] || null;
      }

      if (!cancelled) setSelectedSP(sp);
    })();

    return () => (cancelled = true);
  }, [user?.id]);

  if (!profile || !order) return <p>Loading...</p>;

  // -------------------------------
  // STEP 1 → OPEN SIGNATURE MODAL
  // -------------------------------
  const confirmOrder = () => {
    if (!billingSame) {
      if (!billingAddress || !billingCity || !billingState || !billingPincode) {
        alert("Please fill full billing address.");
        return;
      }
    }
    setShowSignature(true); // Open signature modal
  };

  // -------------------------------
  // STEP 2 → SAVE SIGNATURE + CONTINUE
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

      // ---- Build final payload with signature URL ----
      const finalBillingAddress = billingSame
        ? `${deliveryAddress}, ${deliveryCity}, ${deliveryState} - ${deliveryPincode}`
        : `${billingAddress}, ${billingCity}, ${billingState} - ${billingPincode}`;

      const payload = {
        ...order,
        user_id: user.id,

        // DELIVERY
        delivery_name: profile.full_name,
        delivery_email: profile.email,
        delivery_phone: profile.phone,
        delivery_address: deliveryAddress,
        delivery_city: deliveryCity,
        delivery_state: deliveryState,
        delivery_pincode: deliveryPincode,

        // BILLING
        billing_same: billingSame,
        billing_address: finalBillingAddress,
        billing_company: billingCompany || null,
        billing_gstin: billingGST || null,

        // SALESPERSON
        salesperson: selectedSP?.saleperson || null,
        salesperson_phone: selectedSP?.phone || null,
        salesperson_email:
          selectedSP?.email || localStorage.getItem("sp_email") || null,

        // SIGNATURE
        signature_url: signatureUrl,
      };

      // Close modal & navigate
      setShowSignature(false);
      navigate("/orderDetail", { state: { orderPayload: payload } });
    } catch (err) {
      console.error("Unexpected error while saving signature:", err);
      alert("Unexpected error while saving signature.");
    }
  };

  return (
    <div className="screen6">
      {/* HEADER */}
      <div className="screen6-header">
        <button className="back-btn" onClick={() => navigate(-1)}>←</button>
        <img src={Logo} className="sheetal-logo" alt="logo" />
      </div>

      <h2 className="title">Order Form</h2>

      <div className="screen6-container">

        {/* Your existing form UI remains unchanged */}
        {/* DELIVERY DETAILS */}
        {order.mode_of_delivery === "Home Delivery" && (
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
                <input
                  className="input-line"
                  value={deliveryAddress}
                  onChange={(e) => setDeliveryAddress(e.target.value)}
                />
              </div>

              <div className="field">
                <label>City:</label>
                <input
                  className="input-line"
                  value={deliveryCity}
                  onChange={(e) => setDeliveryCity(e.target.value)}
                />
              </div>

              <div className="field">
                <label>State:</label>
                <input
                  className="input-line"
                  value={deliveryState}
                  onChange={(e) => setDeliveryState(e.target.value)}
                />
              </div>

              <div className="field">
                <label>Pincode:</label>
                <input
                  className="input-line"
                  value={deliveryPincode}
                  onChange={(e) => setDeliveryPincode(e.target.value)}
                />
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
        )}

        {/* BILLING DETAILS */}
        <div className="section-box">
          <h3>Billing Details</h3>

          <div className="row3">
            <div className="field">
              <label>Required GST Invoice?</label>
              <select
                className="input-select"
                value={billingSame ? "no" : "yes"}
                onChange={(e) => setBillingSame(e.target.value === "no")}
              >
                <option value="no">No</option>
                <option value="yes">Yes</option>
              </select>
            </div>
          </div>

          {!billingSame && (
            <div className="row3">
              <div className="field">
                <label>Company Name:</label>
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
              <div className="field">
                <label>Billing Address:</label>
                <input
                  className="input-line"
                  value={billingAddress}
                  onChange={(e) => setBillingAddress(e.target.value)}
                />
              </div>

              <div className="field">
                <label>City:</label>
                <input
                  className="input-line"
                  value={billingCity}
                  onChange={(e) => setBillingCity(e.target.value)}
                />
              </div>

              <div className="field">
                <label>State:</label>
                <input
                  className="input-line"
                  value={billingState}
                  onChange={(e) => setBillingState(e.target.value)}
                />
              </div>

              <div className="field">
                <label>Pincode:</label>
                <input
                  className="input-line"
                  value={billingPincode}
                  onChange={(e) => setBillingPincode(e.target.value)}
                />
              </div>
            </div>
          )}
        </div>


        {/* CONFIRM BUTTON */}
        <button className="confirm-btn" onClick={confirmOrder}>
          Continue
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
              <button onClick={() => sigPad.clear() } style={{height:'40px',width:'70px' , textAlign:'center'}}>Clear</button>

              <button className="confirm-btn" onClick={saveSignatureAndContinue}>
                Save & Continue
              </button>
            </div>

            <button className="close-modal" onClick={() => setShowSignature(false)}>
              ✖
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
