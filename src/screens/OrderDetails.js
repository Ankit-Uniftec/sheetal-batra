import React, { useEffect, useMemo, useState } from "react";
import "./Screen6.css";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";
import Logo from "../images/logo.png";
import formatIndianNumber from "../utils/formatIndianNumber";
import formatPhoneNumber from "../utils/formatPhoneNumber"; // Import the new utility
import formatDate from "../utils/formatDate"; // Import formatDate
import { SearchableSelect } from "../components/SearchableSelect";

const countryOptions = [
  { label: "India", value: "India" },
  { label: "United States", value: "United States" },
  { label: "Canada", value: "Canada" },
  { label: "United Kingdom", value: "United Kingdom" },
  { label: "Australia", value: "Australia" },
  { label: "Germany", value: "Germany" },
  { label: "France", value: "France" },
  { label: "Japan", value: "Japan" },
  { label: "China", value: "China" },
  { label: "Brazil", value: "Brazil" },
];


const fetchIndiaAddressByPincode = async (pincode) => {
  try {
    const res = await fetch(
      `https://api.postalpincode.in/pincode/${pincode}`
    );
    const data = await res.json();

    if (
      data?.[0]?.Status === "Success" &&
      data[0].PostOffice?.length
    ) {
      return {
        state: data[0].PostOffice[0].State,
        city: data[0].PostOffice[0].District,
      };
    }
    return null;
  } catch (err) {
    console.error("Pincode lookup failed", err);
    return null;
  }
};


export default function OrderDetails() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();

  const order = location.state?.orderPayload;

  const [profile, setProfile] = useState(null);
  const [selectedSP, setSelectedSP] = useState(null);

  // Payment
  const [advancePayment, setAdvancePayment] = useState(0); // Changed to amount
  const [discountPercent, setDiscountPercent] = useState(0);
  const [birthdayDiscount, setBirthdayDiscount] = useState(0);
  const [discountApplied, setDiscountApplied] = useState(false);
  const [birthdayApplied, setBirthdayApplied] = useState(false);
  const [appliedCode, setAppliedCode] = useState("");

  // Billing
  const [billingSame, setBillingSame] = useState(true);
  const [billingAddress, setBillingAddress] = useState("");
  const [billingCountry, setBillingCountry] = useState("");
  const [billingCity, setBillingCity] = useState("");
  const [billingState, setBillingState] = useState("");
  const [billingPincode, setBillingPincode] = useState("");
  const [billingCompany, setBillingCompany] = useState("");
  const [billingGST, setBillingGST] = useState("");

  // Delivery
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [deliveryCountry, setDeliveryCountry] = useState("India");
  const [deliveryCity, setDeliveryCity] = useState("");
  const [deliveryState, setDeliveryState] = useState("");
  const [deliveryPincode, setDeliveryPincode] = useState("");
  const [deliveryNotes, setDeliveryNotes] = useState("");
  const [paymentMode, setPaymentMode] = useState("UPI");
  const COD_CHARGE = 250;
  const SHIPPING_CHARGE_AMOUNT = 2500; // Define shipping charge amount
  const SHIPPING_THRESHOLD = 30000; // Define the threshold for shipping charge

  const [shippingCharge, setShippingCharge] = useState(0); // State to hold shipping charge


  const norm = (v) => (v || "").trim();

  const totalAmount = useMemo(
    () => Number(order?.grand_total) || 0,
    [order?.grand_total]
  );

  const sanitizedAdvance = useMemo(() => {
    const amount = parseFloat(advancePayment);
    const minAdvance = totalAmount * 0.25; // 25% of total amount
    if (isNaN(amount) || amount <= 0) return minAdvance; // If no advance or invalid, default to 25%
    return Math.max(minAdvance, Math.min(amount, totalAmount)); // Ensure it's at least 25% and not more than total
  }, [advancePayment, totalAmount]);

  const remainingAmount = useMemo(
    () => Math.max(0, totalAmount - sanitizedAdvance),
    [totalAmount, sanitizedAdvance]
  );
    // ✅ Calculate totalDiscount BEFORE pricing useMemo
  const totalDiscount = useMemo(() => {
    return (Number(discountPercent) || 0) + (Number(birthdayDiscount) || 0);
  }, [discountPercent, birthdayDiscount]);

  const pricing = useMemo(() => {
    const pct = Math.min(100, Math.max(0, Number(totalDiscount) || 0));
    const discountAmount = (totalAmount * pct) / 100;

    let netPayable = Math.max(0, totalAmount - discountAmount);
    let currentShippingCharge = 0;

    // Apply shipping charge if country is not India and total is under 30000
    if (order.mode_of_delivery === "Home Delivery" && deliveryCountry !== "India" && totalAmount < SHIPPING_THRESHOLD) {
      netPayable += SHIPPING_CHARGE_AMOUNT;
      currentShippingCharge = SHIPPING_CHARGE_AMOUNT;
    }
    setShippingCharge(currentShippingCharge); // Update shipping charge state

    // ✅ Add COD charge
    if (paymentMode === "COD" && order.mode_of_delivery === "Home Delivery") {
      netPayable += COD_CHARGE;
    }

    const remaining = Math.max(0, netPayable - sanitizedAdvance);

    return {
      discountPercent: pct,
      discountAmount,
      netPayable,
      remaining,
      shippingCharge: currentShippingCharge, // Include shipping charge in pricing object
      // ✅ Added for payload
      regularDiscount: Number(discountPercent) || 0,
      birthdayDiscount: Number(birthdayDiscount) || 0,
    };
  }, [totalDiscount, discountPercent, birthdayDiscount, totalAmount, sanitizedAdvance, paymentMode, deliveryCountry, order.mode_of_delivery]);

  //auto fill delivery state and city:
  useEffect(() => {
    if (deliveryCountry !== "India") return;
    if (deliveryPincode.length !== 6) return;

    (async () => {
      const result = await fetchIndiaAddressByPincode(deliveryPincode);
      if (result) {
        setDeliveryState(result.state);
        setDeliveryCity(result.city);
      }
    })();
  }, [deliveryPincode, deliveryCountry]);
  //auto fill billing state and city:
  useEffect(() => {
    if (billingCountry !== "India") return;
    if (billingPincode.length !== 6) return;

    (async () => {
      const result = await fetchIndiaAddressByPincode(billingPincode);
      if (result) {
        setBillingState(result.state);
        setBillingCity(result.city);
      }
    })();
  }, [billingPincode, billingCountry]);

  //-------------------------------------------
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
  // CONTINUE TO NEXT SCREEN
  // -------------------------------
  const confirmOrder = () => {
    if (!billingSame) {
      if (!billingAddress || !billingCity || !billingState || !billingPincode) {
        alert("Please fill full billing address.");
        return;
      }
    }

    // Build payload without signature (signature will be added in Screen7)
    const finalBillingAddress = billingSame
      ? `${deliveryAddress}, ${deliveryCountry}, ${deliveryCity}, ${deliveryState} - ${deliveryPincode}`
      : `${billingAddress}, ${billingCountry}, ${billingCity}, ${billingState} - ${billingPincode}`;

    const payload = {
      ...order,
      user_id: user.id,
      advance_payment: sanitizedAdvance,
      remaining_payment: pricing.remaining,
      discount_percent: pricing.discountPercent,
      discount_amount: pricing.discountAmount,
      grand_total_after_discount: pricing.netPayable,
      net_total: pricing.netPayable,

      // DELIVERY
      delivery_name: profile.full_name,
      delivery_email: profile.email,
      delivery_phone: profile.phone,
      delivery_address: deliveryAddress,
      delivery_country: deliveryCountry,
      delivery_city: deliveryCity,
      delivery_state: deliveryState,
      delivery_pincode: deliveryPincode,
      delivery_notes: deliveryNotes,

      // BILLING
      billing_same: billingSame,
      billing_address: finalBillingAddress,
      billing_country: billingCountry,
      billing_company: billingCompany || null,
      billing_gstin: billingGST || null,
      payment_mode: paymentMode,
      cod_charge: paymentMode === "COD" ? COD_CHARGE : 0,
      shipping_charge: pricing.shippingCharge, // Include shipping charge in payload


      // SALESPERSON
      salesperson: selectedSP?.saleperson || null,
      salesperson_phone: selectedSP?.phone ? formatPhoneNumber(selectedSP.phone) : null,
      salesperson_email:
        selectedSP?.email || localStorage.getItem("sp_email") || null,
    };

    // Navigate directly to Screen7
    navigate("/orderDetail", { state: { orderPayload: payload } });
  };

  const handleDiscount = async () => {
    const codeInput = window.prompt("Enter Collector code:");
    if (codeInput === null) return; // cancelled

    const code = codeInput.trim().toUpperCase();
    if (!code) {
      alert("Please enter a valid collector code.");
      return;
    }

    try {
      // ✅ Fixed: Select both code and percent
      const { data, error } = await supabase
        .from("discount")
        .select("code, percent")
        .ilike("code", code)
        .limit(1)
        .maybeSingle();

      if (error || !data) {
        alert("Invalid or expired discount code.");
        return;
      }

      const pct = Number(data.percent) || 0;
      const actualCode = data.code.toUpperCase();

      // ✅ SBBIRTHDAY can combine with other codes
      if (actualCode === "SBBIRTHDAY") {
        if (birthdayApplied) {
          alert("Birthday discount already applied!");
          return;
        }
        setBirthdayDiscount(pct);
        setBirthdayApplied(true);
        alert(
          `🎂 Birthday discount (${pct}%) applied!${
            discountApplied ? ` Combined with ${appliedCode}: Total ${discountPercent + pct}% off!` : ""
          }`
        );
      } else {
        // Regular codes - only one at a time
        if (discountApplied) {
          const confirmReplace = window.confirm(
            `You already have "${appliedCode}" (${discountPercent}%) applied. Replace with "${actualCode}" (${pct}%)?`
          );
          if (!confirmReplace) return;
        }
        setDiscountPercent(pct);
        setDiscountApplied(true);
        setAppliedCode(actualCode);
        alert(
          `✅ Discount code "${actualCode}" (${pct}%) applied!${
            birthdayApplied ? ` Combined with Birthday: Total ${pct + birthdayDiscount}% off!` : ""
          }`
        );
      }

    } catch (e) {
      console.error("Discount lookup failed", e);
      alert("Could not validate discount code. Please try again.");
    }
  };

  // ✅ Remove discount handlers
  const removeRegularDiscount = () => {
    setDiscountPercent(0);
    setDiscountApplied(false);
    setAppliedCode("");
  };

  const removeBirthdayDiscount = () => {
    setBirthdayDiscount(0);
    setBirthdayApplied(false);
  };

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

  return (
    <div className="screen6">
      {/* HEADER */}
      <div className="screen6-header">

        <img src={Logo} className="sheetal-logo" alt="logo" onClick={handleLogout} />
        <h2 className="title">Order Detail</h2>
      </div>



      <div className="screen6-container">

        {/* Your existing form UI remains unchanged */}
        {/* DELIVERY DETAILS */}
        {order.mode_of_delivery === "Home Delivery" && (
          <div className="section-box">
            <h3>Delivery Details</h3>

            <div className="row3">
              <div className="field">
                <label>Name:</label>
                <span>{profile.full_name}</span>
              </div>

              <div className="field">
                <label>Email:</label>
                <span>{profile.email}</span>
              </div>

              <div className="field">
                <label>Phone:</label>
                <span>{formatPhoneNumber(profile.phone)}</span>
              </div>
            </div>

            <div className="row3">

              <div className="field">
                <label>Country:</label>
                <SearchableSelect
                  options={countryOptions}
                  value={deliveryCountry}
                  onChange={setDeliveryCountry}
                  placeholder="Select Country"
                />
              </div>

              <div className="field">
                <label>Pincode:</label>
                <input
                  className="input-line"
                  maxLength={6}
                  value={deliveryPincode}
                  onChange={(e) =>
                    setDeliveryPincode(e.target.value.replace(/\D/g, ""))
                  }
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
                <label>City:</label>
                <input
                  className="input-line"
                  value={deliveryCity}
                  onChange={(e) => setDeliveryCity(e.target.value)}
                />
              </div>
              <div className="field">
                <label>Delivery Address:</label>
                <input
                  className="input-line"
                  value={deliveryAddress}
                  onChange={(e) => setDeliveryAddress(e.target.value)}
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
                <input
                  className="input-line"
                  value={deliveryNotes}
                  onChange={(e) => setDeliveryNotes(e.target.value)}
                />
              </div>
            </div>

            {order.comments && (
              <div className="field field-wide" style={{ marginTop: "12px" }}>
                <label>Notes:</label>
                <span>{order.comments}</span>
              </div>
            )}
          </div>
        )}

        {order.mode_of_delivery === "Delhi Store" && (
          <div className="section-box">
            <h3>Delivery Details</h3>
            <div className="row3">
              <div className="field full-width-field">
                <label>Store Address:</label>
                <span>S-208, Greater Kailash II, Basement, New Delhi, Delhi 110048</span>
              </div>
            </div>
            <div className="row3">
              <div className="field">
                <label>Delivery Date:</label>
                <span>{order.delivery_date}</span>
              </div>

              <div className="field">
                <label>Delivery Notes:</label>
                <input
                  className="input-line"
                  value={deliveryNotes}
                  onChange={(e) => setDeliveryNotes(e.target.value)}
                />
              </div>
            </div>

            {order.comments && (
              <div className="field field-wide" style={{ marginTop: "12px" }}>
                <label>Notes:</label>
                <span>{order.comments}</span>
              </div>
            )}
          </div>
        )}

        {order.mode_of_delivery === "Ludhiana Store" && (
          <div className="section-box">
            <h3>Delivery Details</h3>
            <div className="row3">
              <div className="field full-width-field">
                <label>Store Address:</label>
                <span>S.C.O no. 22, Sun View Plaza Ludhiana, Punjab 142027</span>
              </div>
            </div>
            <div className="row3">
              <div className="field">
                <label>Delivery Date:</label>
                <span>{order.delivery_date}</span>
              </div>

              <div className="field">
                <label>Delivery Notes:</label>
                <input
                  className="input-line"
                  value={deliveryNotes}
                  onChange={(e) => setDeliveryNotes(e.target.value)}
                />
              </div>
            </div>

            {order.comments && (
              <div className="field field-wide" style={{ marginTop: "12px" }}>
                <label>Notes:</label>
                <span>{order.comments}</span>
              </div>
            )}
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
                <label>Country:</label>
                <SearchableSelect
                  options={countryOptions}
                  value={billingCountry}
                  onChange={setBillingCountry}
                  placeholder="Select Country"
                />
              </div>
              <div className="field">
                <label>Pincode:</label>
                <input
                  className="input-line"
                  maxLength={6}
                  value={billingPincode}
                  onChange={(e) =>
                    setBillingPincode(e.target.value.replace(/\D/g, ""))
                  }
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
                <label>City:</label>
                <input
                  className="input-line"
                  value={billingCity}
                  onChange={(e) => setBillingCity(e.target.value)}
                />
              </div>

            </div>
          )}
        </div>

        {/* PAYMENT DETAILS */}
        {/* <div className="section-box"> */}
        <div className="section-box payment-section">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3>Payment Details</h3>
            <button onClick={handleDiscount} className="apply-discount-btn" style={{ background: '#d5b85a', border: "none", height: "30px", color: 'white !important' }}>Collector Code</button>
          </div>

          {/* ✅ Applied Discounts Display */}
          {(discountApplied || birthdayApplied) && (
            <div
              className="applied-discounts"
              style={{
                display: "flex",
                gap: "10px",
                flexWrap: "wrap",
                marginBottom: "16px",
                paddingBottom: "16px",
                borderBottom: "1px solid #eee",
              }}
            >
              {discountApplied && (
                <div
                  className="discount-tag"
                  style={{
                    background: "#e8f5e9",
                    color: "#2e7d32",
                    padding: "6px 12px",
                    borderRadius: "20px",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    fontSize: "14px",
                  }}
                >
                  <span>🏷️ {appliedCode} ({discountPercent}%)</span>
                  <button
                    onClick={removeRegularDiscount}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      fontSize: "16px",
                      color: "#666",
                    }}
                  >×</button>
                </div>
              )}
              {birthdayApplied && (
                <div
                  className="discount-tag birthday"
                  style={{
                    background: "#fff3e0",
                    color: "#e65100",
                    padding: "6px 12px",
                    borderRadius: "20px",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    fontSize: "14px",
                  }}
                >
                  <span>🎂 SBBIRTHDAY ({birthdayDiscount}%)</span>
                  <button
                    onClick={removeBirthdayDiscount}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      fontSize: "16px",
                      color: "#666",
                    }}
                  >×</button>
                </div>
              )}
              {discountApplied && birthdayApplied && (
                <div
                  style={{
                    background: "#d5b85a",
                    color: "white",
                    padding: "6px 12px",
                    borderRadius: "20px",
                    fontSize: "14px",
                    fontWeight: "600",
                  }}
                >
                  Total: {totalDiscount}% OFF
                </div>
              )}
            </div>
          )}

          <div className="row3">
            <div className="field">
              <label>Mode of Payment:</label>
              <select
                className="input-select"
                value={paymentMode}
                onChange={(e) => setPaymentMode(e.target.value)}
              >
                <option value="UPI">UPI</option>
                <option value="COD">COD</option>
                <option value="Credit Card">Credit Card</option>
                <option value="Debit Card">Debit Card</option>
                <option value="Net Banking">Net Banking</option>
              </select>



            </div>

            <div className="field">
              <label>Total Amount:</label>
              <span>₹{formatIndianNumber(totalAmount)}</span>
            </div>
            <div className="field">
              <label> Min. Advance:</label>
              <span>
                ₹{formatIndianNumber(sanitizedAdvance)}
                {totalAmount > 0 && ` (${((sanitizedAdvance / totalAmount) * 100).toFixed(2)}%)`}
              </span>
            </div>
            <div className="field">
              <label>Advance Payment (Amount):</label>
              <input
                className="input-line"
                type="number"
                value={advancePayment}
                onChange={(e) => setAdvancePayment(e.target.value)}
              />
            </div>


          </div>
          {/* ✅ Fixed: Show when either discount is applied */}
          {(discountApplied || birthdayApplied) && (
            <div className="row3">
              <div className="field">
                <label>Discount %:</label>
                <span>{pricing.discountPercent}%</span>
              </div>
              <div className="field">
                <label>Discount Amount:</label>
                <span>₹{formatIndianNumber(pricing.discountAmount)}</span>
              </div>
              <div className="field">
                <label>Net Payable:</label>
                <span>₹{formatIndianNumber(pricing.netPayable)}</span>
              </div>
            </div>
          )}


          <div className="row3">
            <div className="field">
              <label>Balance:</label>
              <span>₹{formatIndianNumber(pricing.remaining)}</span>
            </div>
          </div>

          {((paymentMode === "COD" && order.mode_of_delivery === "Home Delivery") || pricing.shippingCharge > 0) && (
            <div className="row3">
              {paymentMode === "COD" && (
                <div className="field">
                  <label>COD Charge:</label>
                  <span>₹{formatIndianNumber(COD_CHARGE)}</span>
                </div>
              )}
              {pricing.shippingCharge > 0 && (
                <div className="field">
                  <label>Shipping Charge:</label>
                  <span>₹{formatIndianNumber(pricing.shippingCharge)}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* CONFIRM BUTTON */}
        <button className="confirm-btn" onClick={confirmOrder}>
          Continue
        </button>
        <button className="back-btn" onClick={() => navigate(-1)}>←</button>
      </div>
    </div>
  );
}