import React, { useEffect, useMemo, useState } from "react";
import "./Screen6.css";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";
import Logo from "../images/logo.png";
import formatIndianNumber from "../utils/formatIndianNumber";
import formatPhoneNumber from "../utils/formatPhoneNumber";
import formatDate from "../utils/formatDate";
import { SearchableSelect } from "../components/SearchableSelect";
import Popup from "../components/Popup";

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

  // Popup state
  const [popup, setPopup] = useState({
    show: false,
    title: "",
    message: "",
    type: "info",
    confirmText: "OK",
    cancelText: "Cancel",
  });
  
  // Separate ref for pending confirm action (to avoid stale closure issues)
  const pendingActionRef = React.useRef(null);

  // Payment
  const [advancePayment, setAdvancePayment] = useState(0);
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
  const SHIPPING_CHARGE_AMOUNT = 2500;
  const SHIPPING_THRESHOLD = 30000;

  const [shippingCharge, setShippingCharge] = useState(0);

  // Helper to show popup
  const showPopup = (options) => {
    // Store the callback in ref to avoid stale closure
    pendingActionRef.current = options.onConfirm || null;
    setPopup({
      show: true,
      title: options.title || "",
      message: options.message || "",
      type: options.type || "info",
      confirmText: options.confirmText || "OK",
      cancelText: options.cancelText || "Cancel",
    });
  };

  // Helper to close popup
  const closePopup = () => {
    setPopup((prev) => ({ ...prev, show: false }));
    pendingActionRef.current = null;
  };

  // Handle confirm button click in popup
  const handlePopupConfirm = () => {
    if (pendingActionRef.current) {
      pendingActionRef.current();
    }
    closePopup();
  };

  const norm = (v) => (v || "").trim();

  const totalAmount = useMemo(
    () => Number(order?.grand_total) || 0,
    [order?.grand_total]
  );

  // Check if order is Custom (50% advance) or Standard (25% advance)
  const isCustomOrder = order?.order_type === "Custom";
  const minAdvancePercent = isCustomOrder ? 0.5 : 0.25;
  const minAdvanceAmount = totalAmount * minAdvancePercent;

  // Allow any advance amount (don't force minimum)
  const sanitizedAdvance = useMemo(() => {
    const amount = parseFloat(advancePayment);
    if (isNaN(amount) || amount < 0) return 0;
    return Math.min(amount, totalAmount);
  }, [advancePayment, totalAmount]);

  // Check if advance is below minimum
  const isAdvanceBelowMinimum = sanitizedAdvance < minAdvanceAmount;

  const remainingAmount = useMemo(
    () => Math.max(0, totalAmount - sanitizedAdvance),
    [totalAmount, sanitizedAdvance]
  );

  // Calculate totalDiscount BEFORE pricing useMemo
  const totalDiscount = useMemo(() => {
    return (Number(discountPercent) || 0) + (Number(birthdayDiscount) || 0);
  }, [discountPercent, birthdayDiscount]);

  const pricing = useMemo(() => {
    const pct = Math.min(100, Math.max(0, Number(totalDiscount) || 0));
    const discountAmount = (totalAmount * pct) / 100;

    let netPayable = Math.max(0, totalAmount - discountAmount);
    let currentShippingCharge = 0;

    if (order.mode_of_delivery === "Home Delivery" && deliveryCountry !== "India" && totalAmount < SHIPPING_THRESHOLD) {
      netPayable += SHIPPING_CHARGE_AMOUNT;
      currentShippingCharge = SHIPPING_CHARGE_AMOUNT;
    }
    setShippingCharge(currentShippingCharge);

    if (paymentMode === "COD" && order.mode_of_delivery === "Home Delivery") {
      netPayable += COD_CHARGE;
    }

    const remaining = Math.max(0, netPayable - sanitizedAdvance);

    return {
      discountPercent: pct,
      discountAmount,
      netPayable,
      remaining,
      shippingCharge: currentShippingCharge,
      regularDiscount: Number(discountPercent) || 0,
      birthdayDiscount: Number(birthdayDiscount) || 0,
    };
  }, [totalDiscount, discountPercent, birthdayDiscount, totalAmount, sanitizedAdvance, paymentMode, deliveryCountry, order.mode_of_delivery]);

  // Auto fill delivery state and city
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

  // Auto fill billing state and city
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

  // SESSION STORAGE RESTORE
  useEffect(() => {
    const saved = sessionStorage.getItem("screen6FormData");
    if (saved) {
      try {
        const data = JSON.parse(saved);

        if (data.advancePayment !== undefined) setAdvancePayment(data.advancePayment);
        if (data.discountPercent !== undefined) setDiscountPercent(data.discountPercent);
        if (data.birthdayDiscount !== undefined) setBirthdayDiscount(data.birthdayDiscount);
        if (data.discountApplied !== undefined) setDiscountApplied(data.discountApplied);
        if (data.birthdayApplied !== undefined) setBirthdayApplied(data.birthdayApplied);
        if (data.appliedCode) setAppliedCode(data.appliedCode);
        if (data.paymentMode) setPaymentMode(data.paymentMode);

        if (data.billingSame !== undefined) setBillingSame(data.billingSame);
        if (data.billingAddress) setBillingAddress(data.billingAddress);
        if (data.billingCountry) setBillingCountry(data.billingCountry);
        if (data.billingCity) setBillingCity(data.billingCity);
        if (data.billingState) setBillingState(data.billingState);
        if (data.billingPincode) setBillingPincode(data.billingPincode);
        if (data.billingCompany) setBillingCompany(data.billingCompany);
        if (data.billingGST) setBillingGST(data.billingGST);

        if (data.deliveryAddress) setDeliveryAddress(data.deliveryAddress);
        if (data.deliveryCountry) setDeliveryCountry(data.deliveryCountry);
        if (data.deliveryCity) setDeliveryCity(data.deliveryCity);
        if (data.deliveryState) setDeliveryState(data.deliveryState);
        if (data.deliveryPincode) setDeliveryPincode(data.deliveryPincode);
        if (data.deliveryNotes) setDeliveryNotes(data.deliveryNotes);

      } catch (e) {
        console.error("Error restoring Screen6 form data:", e);
      }
    }
  }, []);

  // SESSION STORAGE SAVE
  useEffect(() => {
    const formData = {
      advancePayment,
      discountPercent,
      birthdayDiscount,
      discountApplied,
      birthdayApplied,
      appliedCode,
      paymentMode,
      billingSame,
      billingAddress,
      billingCountry,
      billingCity,
      billingState,
      billingPincode,
      billingCompany,
      billingGST,
      deliveryAddress,
      deliveryCountry,
      deliveryCity,
      deliveryState,
      deliveryPincode,
      deliveryNotes,
    };
    sessionStorage.setItem("screen6FormData", JSON.stringify(formData));
  }, [
    advancePayment,
    discountPercent,
    birthdayDiscount,
    discountApplied,
    birthdayApplied,
    appliedCode,
    paymentMode,
    billingSame,
    billingAddress,
    billingCountry,
    billingCity,
    billingState,
    billingPincode,
    billingCompany,
    billingGST,
    deliveryAddress,
    deliveryCountry,
    deliveryCity,
    deliveryState,
    deliveryPincode,
    deliveryNotes,
  ]);

  if (!profile || !order) return <p>Loading...</p>;

  // Proceed with order (called after confirmation)
  const proceedWithOrder = () => {
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

      delivery_name: profile.full_name,
      delivery_email: profile.email,
      delivery_phone: profile.phone,
      delivery_address: deliveryAddress,
      delivery_country: deliveryCountry,
      delivery_city: deliveryCity,
      delivery_state: deliveryState,
      delivery_pincode: deliveryPincode,
      delivery_notes: deliveryNotes,

      billing_same: billingSame,
      billing_address: finalBillingAddress,
      billing_country: billingCountry,
      billing_company: billingCompany || null,
      billing_gstin: billingGST || null,
      payment_mode: paymentMode,
      cod_charge: paymentMode === "COD" ? COD_CHARGE : 0,
      shipping_charge: pricing.shippingCharge,

      salesperson: selectedSP?.saleperson || null,
      salesperson_phone: selectedSP?.phone ? formatPhoneNumber(selectedSP.phone) : null,
      salesperson_email: selectedSP?.email || localStorage.getItem("sp_email") || null,
    };

    navigate("/orderDetail", { state: { orderPayload: payload } });
  };

  // CONTINUE TO NEXT SCREEN
  const confirmOrder = () => {
    if (!billingSame) {
      if (!billingAddress || !billingCity || !billingState || !billingPincode) {
        showPopup({
          title: "Billing Address Required",
          message: "Please fill full billing address.",
          type: "warning",
        });
        return;
      }
    }

    // Check if advance payment is below minimum and show warning
    if (isAdvanceBelowMinimum) {
      const minPercentLabel = isCustomOrder ? "50%" : "25%";
      showPopup({
        title: "Minimum Advance Requirement",
        // message: `Order Type: ${isCustomOrder ? "Custom" : "Standard"}\nMinimum Required: ₹${formatIndianNumber(minAdvanceAmount)} (${minPercentLabel})\nEntered Amount: ₹${formatIndianNumber(sanitizedAdvance)}\n\nDo you want to continue anyway?`,
        // message: `Advance entered by you is less than ${minPercentLabel} \n\nMinimum advance required for this order is: ₹${formatIndianNumber(minAdvanceAmount)}`,
        message: `The entered amount is below the minimum advance of ₹${formatIndianNumber(minAdvanceAmount)} (${minPercentLabel})`,
        type: "confirm",
        confirmText: "Continue",
        cancelText: "Cancel",
        onConfirm: proceedWithOrder,
      });
      return;
    }

    proceedWithOrder();
  };

  const handleDiscount = async () => {
    const codeInput = window.prompt("Enter Collector code:");
    if (codeInput === null) return;

    const code = codeInput.trim().toUpperCase();
    if (!code) {
      showPopup({
        title: "Invalid Code",
        message: "Please enter a valid collector code.",
        type: "warning",
      });
      return;
    }

    try {
      const { data, error } = await supabase
        .from("discount")
        .select("code, percent")
        .ilike("code", code)
        .limit(1)
        .maybeSingle();

      if (error || !data) {
        showPopup({
          title: "Invalid Code",
          message: "Invalid or expired discount code.",
          type: "error",
        });
        return;
      }

      const pct = Number(data.percent) || 0;
      const actualCode = data.code.toUpperCase();

      if (actualCode === "SBBIRTHDAY") {
        if (birthdayApplied) {
          showPopup({
            title: "Already Applied",
            message: "Birthday discount already applied!",
            type: "warning",
          });
          return;
        }
        setBirthdayDiscount(pct);
        setBirthdayApplied(true);
        showPopup({
          title: "Birthday Discount Applied! 🎂",
          message: `${pct}% birthday discount applied!${discountApplied ? ` Combined with ${appliedCode}: Total ${discountPercent + pct}% off!` : ""}`,
          type: "success",
        });
      } else {
        if (discountApplied) {
          showPopup({
            title: "Replace Discount?",
            message: `You already have "${appliedCode}" (${discountPercent}%) applied.\n\nReplace with "${actualCode}" (${pct}%)?`,
            type: "confirm",
            confirmText: "Replace",
            cancelText: "Keep Current",
            onConfirm: () => {
              setDiscountPercent(pct);
              setDiscountApplied(true);
              setAppliedCode(actualCode);
              setTimeout(() => {
                showPopup({
                  title: "Discount Applied! ✅",
                  message: `Discount code "${actualCode}" (${pct}%) applied!${birthdayApplied ? ` Combined with Birthday: Total ${pct + birthdayDiscount}% off!` : ""}`,
                  type: "success",
                });
              }, 300);
            },
          });
          return;
        }
        setDiscountPercent(pct);
        setDiscountApplied(true);
        setAppliedCode(actualCode);
        showPopup({
          title: "Discount Applied! ✅",
          message: `Discount code "${actualCode}" (${pct}%) applied!${birthdayApplied ? ` Combined with Birthday: Total ${pct + birthdayDiscount}% off!` : ""}`,
          type: "success",
        });
      }

    } catch (e) {
      console.error("Discount lookup failed", e);
      showPopup({
        title: "Error",
        message: "Could not validate discount code. Please try again.",
        type: "error",
      });
    }
  };

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
      sessionStorage.removeItem("screen4FormData");
      sessionStorage.removeItem("screen6FormData");

      const { data: { session } } = await supabase.auth.getSession();

      if (session) {
        sessionStorage.setItem("requirePasswordVerificationOnReturn", "true");
        sessionStorage.removeItem("associateSession");
        sessionStorage.removeItem("returnToAssociate");
        navigate("/AssociateDashboard", { replace: true });
      } else {
        await supabase.auth.signOut();
        sessionStorage.removeItem("associateSession");
        sessionStorage.removeItem("returnToAssociate");
        navigate("/login", { replace: true });
      }
    } catch (e) {
      console.error("Logout error", e);
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
        <div className="section-box payment-section">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3>Payment Details</h3>
            <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
              <span
                style={{
                  background: isCustomOrder ? "#fff3e0" : "#e8f5e9",
                  color: isCustomOrder ? "#e65100" : "#2e7d32",
                  padding: "6px 12px",
                  borderRadius: "20px",
                  fontSize: "13px",
                  fontWeight: "600",
                }}
              >
                {isCustomOrder ? "Custom Order" : "Standard Order"}
              </span>
              <button onClick={handleDiscount} className="apply-discount-btn" style={{ background: '#d5b85a', border: "none", height: "30px", color: 'white !important' }}>
                Collector Code
              </button>
            </div>
          </div>

          {/* Applied Discounts Display */}
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
                <option value="COD">Cash</option>
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
              <label>
                Min. Advance
                {isCustomOrder && <span style={{ color: "#e65100", marginLeft: 4 }}>(Custom - 50%)</span>}
                {!isCustomOrder && <span style={{ color: "#2e7d32", marginLeft: 4 }}>(Standard - 25%)</span>}
              </label>
              <span>₹{formatIndianNumber(minAdvanceAmount)}</span>
            </div>
            <div className="field">
              <label>Advance Payment (Amount):</label>
              <input
                className="input-line"
                type="number"
                value={advancePayment}
                onChange={(e) => {
                  const val = parseFloat(e.target.value) || 0;
                  // Cap at total amount
                  if (val > totalAmount) {
                    setAdvancePayment(totalAmount);
                  } else {
                    setAdvancePayment(e.target.value);
                  }
                }}
                max={totalAmount}
              />
            </div>
          </div>

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
              <span style={{ fontWeight: "600", color: pricing.remaining > 0 ? "#333" : "#2e7d32" }}>
                ₹{formatIndianNumber(pricing.remaining)}
              </span>
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

      {/* Popup Component */}
      <Popup
        isOpen={popup.show}
        onClose={closePopup}
        title={popup.title}
        message={popup.message}
        type={popup.type}
        onConfirm={handlePopupConfirm}
        // confirmText={popup.confirmText}
        cancelText={popup.cancelText}
        showCancel={popup.type === "confirm"}
      />
    </div>
  );
}