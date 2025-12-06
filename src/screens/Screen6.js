// import React, { useEffect, useState } from "react";
// import "./Screen6.css";
// import { useNavigate, useLocation } from "react-router-dom";
// import { supabase } from "../lib/supabaseClient";
// import { useAuth } from "../context/AuthContext";
// import Logo from "../images/logo.png";
// export default function Screen6() {
//   const navigate = useNavigate();
//   const location = useLocation();
//   const { user } = useAuth();

//   const order = location.state?.orderPayload;

//   const [profile, setProfile] = useState(null);
//   const [salespersons, setSalespersons] = useState([]);
//   const [selectedSP, setSelectedSP] = useState(null);

//   // Billing
//   const [billingSame, setBillingSame] = useState(true);
//   const [billingAddress, setBillingAddress] = useState("");
//   const [billingCompany, setBillingCompany] = useState("");
//   const [billingGST, setBillingGST] = useState("");

//   // Delivery fields (user enters manually)
//   const [deliveryAddress, setDeliveryAddress] = useState("");
//   const [deliveryCity, setDeliveryCity] = useState("");
//   const [deliveryState, setDeliveryState] = useState("");
//   const [deliveryPincode, setDeliveryPincode] = useState("");


//   // Auto-pick salesperson using the logged-in user's email
//   // 1) Kill stale state when user changes, then fetch salesperson for THIS login
//   // helper to normalize emails
//   // helper to normalize
//   const norm = (v) => (v || "").trim();

//   useEffect(() => {
//     // IMPORTANT: do NOT rely on auth user (now it's the customer after OTP)
//     const cachedEmail = norm(localStorage.getItem("sp_email"));

//     let cancelled = false;
//     setSelectedSP(null);

//     (async () => {
//       // still load profile for delivery section (this may be customer's profile)
//       if (user?.id) {
//         const { data: prof } = await supabase
//           .from("profiles")
//           .select("*")
//           .eq("id", user.id)
//           .single();
//         if (!cancelled) setProfile(prof || null);
//       }

//       if (!cachedEmail) {
//         console.warn("No salesperson email in localStorage (sp_email).");
//         if (!cancelled) setSelectedSP(null);
//         return;
//       }

//       // 1) exact match by email
//       const { data: eqRows, error: eqErr } = await supabase
//         .from("salesperson")
//         .select("*")
//         .eq("email", cachedEmail)
//         .limit(1);

//       if (eqErr) console.warn("salesperson eq(email) error:", eqErr);

//       let sp = eqRows?.[0];

//       // 2) fallback: case-insensitive exact (ilike w/o %)
//       if (!sp) {
//         const { data: ilikeRows, error: ilikeErr } = await supabase
//           .from("salesperson")
//           .select("*")
//           .ilike("email", cachedEmail)
//           .limit(1);

//         if (ilikeErr) console.warn("salesperson ilike(email) error:", ilikeErr);
//         sp = ilikeRows?.[0] || null;
//       }

//       if (!cancelled) {
//         setSelectedSP(sp);
//         if (!sp) console.warn("No salesperson found for sp_email:", cachedEmail);
//       }
//     })();

//     return () => { cancelled = true; };
//   }, [user?.id]); // run when screen mounts / profile user changes




//   useEffect(() => {
//     if (!user) return;
//     loadProfile();
//     loadSalespersons();
//   }, [user]);

//   const loadProfile = async () => {
//     const { data } = await supabase
//       .from("profiles")
//       .select("*")
//       .eq("id", user.id)
//       .single();

//     setProfile(data);
//   };

//   const loadSalespersons = async () => {
//     const { data } = await supabase.from("salesperson").select("*");
//     setSalespersons(data);
//   };

//   const handleSPChange = (id) => {
//     const found = salespersons.find((s) => s.id.toString() === id);
//     setSelectedSP(found);
//   };

//   const confirmOrder = async () => {
//     if (!billingSame) {
//       if (!billingAddress || !billingCompany || !billingGST) {
//         alert("Please fill billing details");
//         return;
//       }
//     }

//     const payload = {
//       ...order,
//       user_id: user.id,

//       // Always save delivery info (even if UI is hidden)
//       delivery_name: profile.full_name,
//       delivery_email: profile.email,
//       delivery_phone: profile.phone,
//       delivery_address: deliveryAddress,
//       delivery_city: deliveryCity,
//       delivery_state: deliveryState,
//       delivery_pincode: deliveryPincode,


//       // Billing
//       billing_same: billingSame,
//       billing_address: billingSame ? profile.address : billingAddress,
//       billing_company: billingSame ? null : billingCompany,
//       billing_gstin: billingSame ? null : billingGST,

//       // Salesperson
//       salesperson: selectedSP?.saleperson || null,
//       salesperson_phone: selectedSP?.phone || null,
//       salesperson_email: selectedSP?.email || localStorage.getItem("sp_email") || null,

//       created_at: new Date().toISOString(),
//     };

//     const { error } = await supabase.from("orders").insert(payload);

//     if (error) return alert(error.message);

//     alert("Order placed successfully!");
//     navigate("/orderHistory");
//   };

//   if (!profile || !order) return <p>Loading...</p>;

//   return (
//     <div className="screen6">

//       {/* HEADER */}
//       <div className="screen6-header">
//         <button className="back-btn" onClick={() => navigate(-1)}>←</button>
//         <img src={Logo} className="sheetal-logo" alt="logo" />
//         <button className="sharebtn">Share</button>
//       </div>

//       <h2 className="title">Confirm Your Details</h2>

//       <div className="screen6-container">

//         {/* CONTACT DETAILS — HIDDEN PERMANENTLY */}
//         {/* NO CONTACT UI */}

//         {/* DELIVERY DETAILS — SHOW ONLY IF HOME DELIVERY */}
//         {order.mode_of_delivery === "Home Delivery" && (
//           <div className="section-box">
//             <h3>Delivery Details</h3>

//             <div className="row3">
//               <div className="field">
//                 <label>Full Name:</label>
//                 <span>{profile.full_name}</span>
//               </div>

//               <div className="field">
//                 <label>Email:</label>
//                 <span>{profile.email}</span>
//               </div>

//               <div className="field">
//                 <label>Phone:</label>
//                 <span>{profile.phone}</span>
//               </div>
//             </div>

//             <div className="row3">
//               <div className="field">
//                 <label>Delivery Address:</label>
//                 <input
//                   className="input-line"
//                   value={deliveryAddress}
//                   onChange={(e) => setDeliveryAddress(e.target.value)}
//                 />
//               </div>

//               <div className="field">
//                 <label>City:</label>
//                 <input
//                   className="input-line"
//                   value={deliveryCity}
//                   onChange={(e) => setDeliveryCity(e.target.value)}
//                 />
//               </div>

//               <div className="field">
//                 <label>State:</label>
//                 <input
//                   className="input-line"
//                   value={deliveryState}
//                   onChange={(e) => setDeliveryState(e.target.value)}
//                 />
//               </div>

//               <div className="field">
//                 <label>Pincode:</label>
//                 <input
//                   className="input-line"
//                   value={deliveryPincode}
//                   onChange={(e) => setDeliveryPincode(e.target.value)}
//                 />
//               </div>
//             </div>


//             <div className="row3">
//               <div className="field">
//                 <label>Delivery Date:</label>
//                 <span>{order.delivery_date}</span>
//               </div>

//               <div className="field">
//                 <label>Delivery Notes:</label>
//                 <span>{order.comments || "—"}</span>
//               </div>
//             </div>
//           </div>
//         )}

//         {/* BILLING DETAILS */}
//         <div className="section-box">
//           <h3>Billing Details</h3>

//           <div className="row3">
//             <div className="field">
//               <label>Required GST:</label>
//               <select
//                 className="input-select"
//                 value={billingSame ? "no" : "yes"}
//                 onChange={(e) => setBillingSame(e.target.value === "no")}
//               >
//                 <option value="yes">Yes</option>
//                 <option value="no">No</option>
//               </select>
//             </div>

//             <div className="field">
//               <label>Company name:</label>
//               <input
//                 className="input-line"
//                 value={billingCompany}
//                 onChange={(e) => setBillingCompany(e.target.value)}
//               />
//             </div>

//             <div className="field">
//               <label>GSTIN:</label>
//               <input
//                 className="input-line"
//                 value={billingGST}
//                 onChange={(e) => setBillingGST(e.target.value)}
//               />
//             </div>
//           </div>

//           {!billingSame && (
//             <div className="row3">
//               <div className="field full-width">
//                 <label>Billing Address:</label>
//                 <input
//                   className="input-line"
//                   value={billingAddress}
//                   onChange={(e) => setBillingAddress(e.target.value)}
//                 />
//               </div>
//             </div>
//           )}
//         </div>

//         {/* SALESPERSON DETAILS */}
//         <div className="section-box" style={{ display: 'none' }}>
//           <h3>Salesperson Details</h3>
//           <div className="row3">
//             <div className="field">
//               <label>Salesperson:</label>
//               <span>
//                 {selectedSP?.saleperson || selectedSP?.salesperson || selectedSP?.name || "—"}
//               </span>
//             </div>
//             <div className="field">
//               <label>Salesperson Phone:</label>
//               <span>{selectedSP?.phone || "—"}</span>
//             </div>
//             <div className="field">
//               <label>Salesperson Email:</label>
//               <span>{selectedSP?.email || localStorage.getItem("sp_email") || "—"}</span>
//             </div>
//           </div>
//         </div>




//         {/* PRODUCT DETAILS — HIDDEN PERMANENTLY */}

//         {/* CONFIRM BUTTON */}
//         <button className="confirm-btn" onClick={confirmOrder}>
//           Place Order
//         </button>

//       </div>
//     </div>
//   );
// }


import React, { useEffect, useState } from "react";
import "./Screen6.css";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";
import Logo from "../images/logo.png";

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

  // Delivery (user manual input)
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [deliveryCity, setDeliveryCity] = useState("");
  const [deliveryState, setDeliveryState] = useState("");
  const [deliveryPincode, setDeliveryPincode] = useState("");

  // Normalize helper
  const norm = (v) => (v || "").trim();

  // Load salesperson & profile
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

  // ------------------------------------------
  // CONFIRM ORDER
  // ------------------------------------------
  const confirmOrder = async () => {
    // If billing is different, validate
    if (!billingSame) {
      if (!billingAddress || !billingCity || !billingState || !billingPincode) {
        alert("Please fill full billing address.");
        return;
      }
    }

    // Create COMBINED billing address string
    let finalBillingAddress = "";
    if (billingSame) {
      finalBillingAddress = `${deliveryAddress}, ${deliveryCity}, ${deliveryState} - ${deliveryPincode}`;
    } else {
      finalBillingAddress = `${billingAddress}, ${billingCity}, ${billingState} - ${billingPincode}`;
    }

    const payload = {
      ...order,
      user_id: user.id,

      // DELIVERY (manual input)
      delivery_name: profile.full_name,
      delivery_email: profile.email,
      delivery_phone: profile.phone,
      delivery_address: deliveryAddress,
      delivery_city: deliveryCity,
      delivery_state: deliveryState,
      delivery_pincode: deliveryPincode,

      // BILLING (COMBINED STRING)
      billing_same: billingSame,
      billing_address: finalBillingAddress,
      billing_company: billingCompany || null,
      billing_gstin: billingGST || null,

      // SALESPERSON
      salesperson: selectedSP?.saleperson || null,
      salesperson_phone: selectedSP?.phone || null,
      salesperson_email:
        selectedSP?.email || localStorage.getItem("sp_email") || null,

      created_at: new Date().toISOString(),
    };

    const { error } = await supabase.from("orders").insert(payload);
    if (error) return alert(error.message);

    alert("Order placed successfully!");
    navigate("/orderHistory");
  };

  return (
    <div className="screen6">
      {/* HEADER */}
      <div className="screen6-header">
        <button className="back-btn" onClick={() => navigate(-1)}>←</button>
        <img src={Logo} className="sheetal-logo" alt="logo" />
        <button className="sharebtn">Share</button>
      </div>

      <h2 className="title">Confirm Your Details</h2>

      <div className="screen6-container">

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
              <label>Required GST?</label>
              <select
                className="input-select"
                value={billingSame ? "no" : "yes"}
                onChange={(e) => setBillingSame(e.target.value === "no")}
              >
                <option value="no">No </option>
                <option value="yes">Yes </option>
              </select>
            </div>
          </div>

          {/* Company & GST Always Visible */}
         

          {/* BILLING ADDRESS — ONLY IF DIFFERENT */}
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

        {/* CONFIRM ORDER */}
        <button className="confirm-btn" onClick={confirmOrder}>
          Place Order
        </button>

      </div>
    </div>
  );
}
