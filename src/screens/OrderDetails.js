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
import SplitPaymentModal from "../components/SplitPaymentModal";

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
  const draftId = location.state?.draftId;

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
  const [advancePayment, setAdvancePayment] = useState();
  const [discountPercent, setDiscountPercent] = useState(0);
  const [birthdayDiscount, setBirthdayDiscount] = useState(0);
  const [discountApplied, setDiscountApplied] = useState(false);
  const [birthdayApplied, setBirthdayApplied] = useState(false);
  const [appliedCode, setAppliedCode] = useState("");
  const [codWaiverApplied, setCodWaiverApplied] = useState(false);

  // Store Credit
  const [storeCreditApplied, setStoreCreditApplied] = useState(false);
  const [availableStoreCredit, setAvailableStoreCredit] = useState(0);
  const [storeCreditExpiry, setStoreCreditExpiry] = useState(null);

  // Split Payment
  const [isSplitPayment, setIsSplitPayment] = useState(false);
  const [splitPayments, setSplitPayments] = useState([]);
  const [showSplitModal, setShowSplitModal] = useState(false);

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

  // Calculate extras total from all items (discount should NOT apply on extras)
  const extrasTotal = useMemo(() => {
    const items = order?.items || [];
    return items.reduce((total, item) => {
      const itemExtras = item.extras || [];
      const itemExtrasTotal = itemExtras.reduce((sum, extra) => sum + (Number(extra.price) || 0), 0);
      return total + itemExtrasTotal;
    }, 0);
  }, [order?.items]);

  // Check if order is Custom (50% advance) or Standard (25% advance)
  const isCustomOrder = order?.payment_order_type === "Custom";
  const minAdvancePercent = isCustomOrder ? 0.5 : 0.25;

  // Allow any advance amount (don't force minimum)
  const sanitizedAdvance = useMemo(() => {
    const amount = parseFloat(advancePayment);
    if (isNaN(amount) || amount < 0) return 0;
    return Math.min(amount, totalAmount);
  }, [advancePayment, totalAmount]);

  const remainingAmount = useMemo(
    () => Math.max(0, totalAmount - sanitizedAdvance),
    [totalAmount, sanitizedAdvance]
  );

  // Calculate totalDiscount BEFORE pricing useMemo
  const totalDiscount = useMemo(() => {
    return (Number(discountPercent) || 0) + (Number(birthdayDiscount) || 0);
  }, [discountPercent, birthdayDiscount]);

  // Check if store credit is valid (not expired)
  const isStoreCreditValid = useMemo(() => {
    if (!storeCreditExpiry) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const expiryDate = new Date(storeCreditExpiry);
    return expiryDate >= today && availableStoreCredit > 0;
  }, [storeCreditExpiry, availableStoreCredit]);

  const pricing = useMemo(() => {
    const pct = Math.min(100, Math.max(0, Number(totalDiscount) || 0));

    // Calculate base amount for discount (excluding extras)
    const baseAmountForDiscount = totalAmount - extrasTotal;
    const discountAmount = (baseAmountForDiscount * pct) / 100;

    const hasDiscount = discountApplied || birthdayApplied;

    let netPayable = Math.max(0, totalAmount - discountAmount);
    let currentShippingCharge = 0;

    if (order.mode_of_delivery === "Home Delivery" && deliveryCountry !== "India" && totalAmount < SHIPPING_THRESHOLD) {
      netPayable += SHIPPING_CHARGE_AMOUNT;
      currentShippingCharge = SHIPPING_CHARGE_AMOUNT;
    }
    setShippingCharge(currentShippingCharge);

    // Check if Cash is used in advance payment (normal or split)
    const hasCashPayment = isSplitPayment
      ? splitPayments.some(p => p.mode === "Cash")
      : paymentMode === "COD";

    // COD charge - waived if codWaiverApplied is true
    const appliedCodCharge = (hasCashPayment && order.mode_of_delivery === "Home Delivery" && !codWaiverApplied)
      ? COD_CHARGE
      : 0;

    if (appliedCodCharge > 0) {
      netPayable += appliedCodCharge;
    }

    // Calculate store credit to be used
    // Store credit is applied AFTER discounts, COD charge, and shipping
    let storeCreditUsed = 0;
    let netAfterStoreCredit = netPayable;

    if (storeCreditApplied && isStoreCreditValid) {
      // Use full store credit or order value, whichever is less
      storeCreditUsed = Math.min(availableStoreCredit, netPayable);
      netAfterStoreCredit = Math.max(0, netPayable - storeCreditUsed);
    }

    // Calculate min advance: on netAfterStoreCredit if store credit applied, 
    // on netPayable if discount applied, otherwise on totalAmount
    const minAdvanceBase = storeCreditApplied ? netAfterStoreCredit : (hasDiscount ? netPayable : totalAmount);
    const minAdvanceAmount = minAdvanceBase * minAdvancePercent;

    const remaining = Math.max(0, netAfterStoreCredit - sanitizedAdvance);

    return {
      discountPercent: pct,
      discountAmount,
      netPayable,
      netAfterStoreCredit,
      remaining,
      shippingCharge: currentShippingCharge,
      regularDiscount: Number(discountPercent) || 0,
      birthdayDiscount: Number(birthdayDiscount) || 0,
      minAdvanceAmount,
      hasDiscount,
      codCharge: appliedCodCharge,
      storeCreditUsed,
      remainingStoreCredit: availableStoreCredit - storeCreditUsed,
    };
  }, [
    totalDiscount,
    discountPercent,
    birthdayDiscount,
    totalAmount,
    extrasTotal,
    sanitizedAdvance,
    paymentMode,
    deliveryCountry,
    order.mode_of_delivery,
    discountApplied,
    birthdayApplied,
    minAdvancePercent,
    codWaiverApplied,
    isSplitPayment,
    splitPayments,
    storeCreditApplied,
    availableStoreCredit,
    isStoreCreditValid
  ]);


  // Check if advance is below minimum
  const isAdvanceBelowMinimum = sanitizedAdvance < pricing.minAdvanceAmount;

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

        if (!cancelled) {
          setProfile(prof || null);
          
          // Set store credit info from profile
          if (prof) {
            setAvailableStoreCredit(Number(prof.store_credit) || 0);
            setStoreCreditExpiry(prof.store_credit_expiry || null);
          }
        }
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
        if (data.codWaiverApplied !== undefined) setCodWaiverApplied(data.codWaiverApplied);
        if (data.storeCreditApplied !== undefined) setStoreCreditApplied(data.storeCreditApplied);

        if (data.isSplitPayment !== undefined) setIsSplitPayment(data.isSplitPayment);
        if (data.splitPayments) setSplitPayments(data.splitPayments);

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
      codWaiverApplied,
      storeCreditApplied,
      isSplitPayment,
      splitPayments,
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
    codWaiverApplied,
    storeCreditApplied,
    isSplitPayment,
    splitPayments,
  ]);

  if (!profile || !order) return <p>Loading...</p>;

  // Proceed with order (called after confirmation)
  const proceedWithOrder = () => {
    const finalBillingAddress = billingSame
      ? `${deliveryAddress}, ${deliveryCountry}, ${deliveryCity}, ${deliveryState} - ${deliveryPincode}`
      : `${billingAddress}, ${billingCountry}, ${billingCity}, ${billingState} - ${billingPincode}`;

    // Payment mode storage
    let paymentModeValue;
    if (isSplitPayment) {
      paymentModeValue = JSON.stringify(splitPayments); // Store as JSON string
    } else {
      paymentModeValue = paymentMode === "COD" ? "Cash" : paymentMode;
    }

    const payload = {
      ...order,
      user_id: user.id,
      advance_payment: sanitizedAdvance,
      remaining_payment: pricing.remaining,
      discount_percent: pricing.discountPercent,
      discount_amount: pricing.discountAmount,
      grand_total_after_discount: pricing.netAfterStoreCredit,
      net_total: pricing.netAfterStoreCredit,

      // Store credit info
      store_credit_used: pricing.storeCreditUsed,
      store_credit_remaining: pricing.remainingStoreCredit,

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
      payment_mode: paymentModeValue,
      is_split_payment: isSplitPayment,
      cod_charge: pricing.codCharge,
      shipping_charge: pricing.shippingCharge,

      salesperson: selectedSP?.saleperson || null,
      salesperson_phone: selectedSP?.phone ? formatPhoneNumber(selectedSP.phone) : null,
      salesperson_email: selectedSP?.email || localStorage.getItem("sp_email") || null,
      salesperson_store: selectedSP?.store_name || "Delhi Store",
    };

    navigate("/orderDetail", { state: { orderPayload: payload, draftId } });
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
        message: `The entered amount is below the minimum advance of ₹${formatIndianNumber(pricing.minAdvanceAmount)} (${minPercentLabel})`,
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

    // Check for SB250 code
    if (code === "SB250") {
      if (codWaiverApplied) {
        showPopup({
          title: "Already Applied",
          message: "Free COD code already applied!",
          type: "warning",
        });
        return;
      }

      // Check if Cash is used in advance payment (normal or split)
      const hasCashPayment = isSplitPayment
        ? splitPayments.some(p => p.mode === "Cash")
        : paymentMode === "COD";

      if (! hasCashPayment || order.mode_of_delivery !== "Home Delivery") {
        showPopup({
          title: "Not Applicable",
          message: "SB250 is only applicable for Cash on Delivery with Home Delivery.",
          type: "warning",
        });
        return;
      }
      setCodWaiverApplied(true);
      showPopup({
        title: "Free COD Applied!",
        message: "COD charge of ₹250 has been waived!",
        type: "success",
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

  const handleApplyStoreCredit = () => {
    if (!isStoreCreditValid) {
      showPopup({
        title: "Store Credit Unavailable",
        message: availableStoreCredit > 0 
          ? "Your store credit has expired." 
          : "You don't have any store credits available.",
        type: "warning",
        confirmText: "OK",
      });
      return;
    }

    if (storeCreditApplied) {
      showPopup({
        title: "Already Applied",
        message: "Store credit is already applied to this order.",
        type: "warning",
        confirmText: "OK",
      });
      return;
    }

    const creditToUse = Math.min(availableStoreCredit, pricing.netPayable);
    const remainingCredit = availableStoreCredit - creditToUse;

    showPopup({
      title: "Apply Store Credit?",
      message: `Available: ₹${formatIndianNumber(availableStoreCredit)} • Will use: ₹${formatIndianNumber(creditToUse)}${remainingCredit > 0 ? ` • Remaining: ₹${formatIndianNumber(remainingCredit)}` : ""}`,
      type: "confirm",
      confirmText: "Apply",
      cancelText: "Cancel",
      onConfirm: () => {
        setStoreCreditApplied(true);
        showPopup({
          title: "Store Credit Applied! 💳",
          message: `₹${formatIndianNumber(creditToUse)} store credit applied to your order!`,
          type: "success",
          confirmText: "OK",
        });
      },
    });
  };

  const removeStoreCredit = () => {
    setStoreCreditApplied(false);
  };

  const handleSplitPaymentSave = (payments, totalAmount) => {
    setSplitPayments(payments);
    setIsSplitPayment(true);
    setAdvancePayment(totalAmount);

    // Check if any payment is Cash for COD charge logic
    const hasCash = payments.some(p => p.mode === "Cash");
    if (!hasCash && codWaiverApplied) {
      setCodWaiverApplied(false);
    }
  };

  const removeSplitPayment = () => {
    setIsSplitPayment(false);
    setSplitPayments([]);
    setAdvancePayment("");
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

  const removeCodWaiver = () => {
    setCodWaiverApplied(false);
  };

  const handleLogout = async () => {
    try {
      // Clear form data
      sessionStorage.removeItem("screen4FormData");
      sessionStorage.removeItem("screen6FormData");

      // ✅ Check if we have a saved associate session
      const savedSession = sessionStorage.getItem("associateSession");

      if (savedSession) {
        // Restore the salesperson's session
        const session = JSON.parse(savedSession);

        // Set the session back in Supabase
        const { error } = await supabase.auth.setSession({
          access_token: session.access_token,
          refresh_token: session.refresh_token
        });

        if (error) {
          console.error("Failed to restore session:", error);
          navigate("/login", { replace: true });
          return;
        }


        // Clean up and navigate
        sessionStorage.removeItem("associateSession");
        sessionStorage.removeItem("returnToAssociate");
        sessionStorage.setItem("requirePasswordVerificationOnReturn", "true");
        navigate("/AssociateDashboard", { replace: true });
      } else {
        // No saved session - just navigate back
        console.log("⚠️ No saved session found");
        sessionStorage.setItem("requirePasswordVerificationOnReturn", "true");
        navigate("/AssociateDashboard", { replace: true });
      }
    } catch (e) {
      console.error("Logout error", e);
      navigate("/login", { replace: true });
    }
  };

  return (
    <div className="screen6">
      {/* HEADER */}
      <header className="pf-header">
        <img src={Logo} alt="logo" className="pf-header-logo" onClick={handleLogout} />
        <h1 className="pf-header-title">Order Detail</h1>
      </header>

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
              <button onClick={handleDiscount} className="apply-discount-btn" style={{ background: '#d5b85a', border: "none", color: 'white', borderRadius: 5, }}>
                Collector Code
              </button>
              <button
                onClick={() => setShowSplitModal(true)}
                className="apply-discount-btn"
                style={{ background: '#1565c0', border: "none", color: 'white', borderRadius: 5, }}
              >
                Split Payment
              </button>
              {/* Store Credit Button - Only show if user has store credits */}
              {availableStoreCredit > 0 && (
                <button
                  onClick={handleApplyStoreCredit}
                  className="apply-discount-btn"
                  style={{ 
                    background: storeCreditApplied ? '#4caf50' : '#9c27b0', 
                    border: "none", 
                    height: "30px", 
                    color: 'white', 
                    borderRadius: 5,
                    opacity: !isStoreCreditValid ? 0.6 : 1,
                  }}
                  disabled={!isStoreCreditValid}
                >
                  💳 Store Credit
                </button>
              )}
            </div>
          </div>

          {/* Store Credit Info Banner */}
          {availableStoreCredit > 0 && (
            <div
              style={{
                background: isStoreCreditValid ? "#f3e5f5" : "#ffebee",
                border: `1px solid ${isStoreCreditValid ? "#ce93d8" : "#ef9a9a"}`,
                borderRadius: "8px",
                padding: "12px 16px",
                marginBottom: "16px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div>
                <span style={{ fontWeight: "600", color: isStoreCreditValid ? "#7b1fa2" : "#c62828" }}>
                  💳 Store Credit Available: ₹{formatIndianNumber(availableStoreCredit)}
                </span>
                <span style={{ 
                  fontSize: "12px", 
                  color: isStoreCreditValid ? "#666" : "#c62828", 
                  marginLeft: "12px" 
                }}>
                  {isStoreCreditValid 
                    ? `Valid till: ${formatDate(storeCreditExpiry)}` 
                    : `Expired on: ${formatDate(storeCreditExpiry)}`}
                </span>
              </div>
              {!storeCreditApplied && isStoreCreditValid && (
                <button
                  onClick={handleApplyStoreCredit}
                  style={{
                    background: "#9c27b0",
                    color: "white",
                    border: "none",
                    padding: "6px 16px",
                    borderRadius: "4px",
                    cursor: "pointer",
                    fontWeight: "500",
                  }}
                >
                  Apply
                </button>
              )}
            </div>
          )}

          {/* Applied Discounts Display */}
          {(discountApplied || birthdayApplied || codWaiverApplied || storeCreditApplied) && (
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
              {codWaiverApplied && (
                <div
                  className="discount-tag cod-waiver"
                  style={{
                    background: "#e3f2fd",
                    color: "#1565c0",
                    padding: "6px 12px",
                    borderRadius: "20px",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    fontSize: "14px",
                  }}
                >
                  <span>SB250 (₹250 waived)</span>
                  <button
                    onClick={removeCodWaiver}
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
              {storeCreditApplied && (
                <div
                  className="discount-tag store-credit"
                  style={{
                    background: "#f3e5f5",
                    color: "#7b1fa2",
                    padding: "6px 12px",
                    borderRadius: "20px",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    fontSize: "14px",
                  }}
                >
                  <span>💳 Store Credit (₹{formatIndianNumber(pricing.storeCreditUsed)})</span>
                  <button
                    onClick={removeStoreCredit}
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
            </div>
          )}

          <div className="row3">
            <div className="field">
              <label>Mode of Payment:</label>
              {isSplitPayment ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" }}>
                  {splitPayments.map((sp, idx) => (
                    <span key={idx} style={{
                      background: "#e3f2fd",
                      padding: "4px 10px",
                      borderRadius: "12px",
                      fontSize: "13px",
                    }}>
                      {sp.mode} (₹{formatIndianNumber(sp.amount)})
                    </span>
                  ))}
                  <button
                    onClick={removeSplitPayment}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      fontSize: "16px",
                      color: "#c62828",
                    }}
                  >×</button>
                </div>
              ) : (
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
              )}
            </div>

            <div className="field">
              <label>Total Amount:</label>
              <span>₹{formatIndianNumber(totalAmount)}</span>
            </div>
            <div className="field flex-wrap">
              <label>
                Min. Advance
                {isCustomOrder && <span style={{ color: "#e65100", marginLeft: 4 }}>(Custom - 50%)</span>}
                {!isCustomOrder && <span style={{ color: "#2e7d32", marginLeft: 4 }}>(Standard - 25%)</span>}
              </label>
              <span>₹{formatIndianNumber(pricing.minAdvanceAmount)}</span>
            </div>
          </div>

          {(discountApplied || birthdayApplied) && (
            <div className="row3">
              <div className="field">
                <label>Collector Code:</label>
                <span>- ₹{formatIndianNumber(pricing.discountAmount)}</span>
              </div>
              <div className="field">
                <label>Subtotal:</label>
                <span>₹{formatIndianNumber(pricing.netPayable)}</span>
              </div>
            </div>
          )}

          {/* Store Credit Applied Row */}
          {storeCreditApplied && pricing.storeCreditUsed > 0 && (
            <div className="row3">
              <div className="field">
                <label>Store Credit Applied:</label>
                <span style={{ color: "#7b1fa2", fontWeight: "600" }}>- ₹{formatIndianNumber(pricing.storeCreditUsed)}</span>
              </div>
              <div className="field">
                <label>Net Payable:</label>
                <span style={{ fontWeight: "700", color: "#2e7d32" }}>₹{formatIndianNumber(pricing.netAfterStoreCredit)}</span>
              </div>
              {pricing.remainingStoreCredit > 0 && (
                <div className="field">
                  <label>Remaining Store Credit:</label>
                  <span style={{ color: "#666" }}>₹{formatIndianNumber(pricing.remainingStoreCredit)}</span>
                </div>
              )}
            </div>
          )}

          <div className="row3">
            <div className="field">
              <label>Advance Payment (Amount):</label>
              <input
                className="input-line"
                type="number"
                value={advancePayment}
                onChange={(e) => {
                  const val = parseFloat(e.target.value) || '';
                  const maxAmount = storeCreditApplied ? pricing.netAfterStoreCredit : totalAmount;
                  if (val > maxAmount) {
                    setAdvancePayment(maxAmount);
                  } else {
                    setAdvancePayment(e.target.value);
                  }
                }}
                max={storeCreditApplied ? pricing.netAfterStoreCredit : totalAmount}
                disabled={isSplitPayment}
                style={isSplitPayment ? { background: "#f5f5f5" } : {}}
              />
            </div>
            <div className="field">
              <label>Balance:</label>
              <span style={{ fontWeight: "600", color: pricing.remaining > 0 ? "#333" : "#2e7d32" }}>
                ₹{formatIndianNumber(pricing.remaining)}
              </span>
            </div>
          </div>

          {(pricing.codCharge > 0 || pricing.shippingCharge > 0) && (
            <div className="row3">
              {pricing.codCharge > 0 && (
                <div className="field">
                  <label>Cash Charge:</label>
                  <span>₹{formatIndianNumber(pricing.codCharge)}</span>
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
        confirmText={popup.confirmText}
        cancelText={popup.cancelText}
        showCancel={popup.type === "confirm"}
      />
      {/* Split Payment Modal */}
      <SplitPaymentModal
        isOpen={showSplitModal}
        onClose={() => setShowSplitModal(false)}
        onSave={handleSplitPaymentSave}
        maxAmount={storeCreditApplied ? pricing.netAfterStoreCredit : pricing.netPayable}
      />
    </div>
  );
}