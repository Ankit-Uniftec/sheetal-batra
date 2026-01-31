import React, { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import "./Screen1.css";
import Logo from "../images/logo.png";
import config from "../config/config";
import { usePopup } from "../components/Popup";

/* ----------------------------------
   COUNTRY CODE CONFIG
----------------------------------- */
const COUNTRY_CODES = [
  { code: "+91", label: "India", flag: "🇮🇳" },
  { code: "+1", label: "USA", flag: "🇺🇸" },
  { code: "+44", label: "UK", flag: "🇬🇧" },
  { code: "+61", label: "Australia", flag: "🇦🇺" },
  { code: "+971", label: "UAE", flag: "🇦🇪" },
  { code: "+49", label: "Germany", flag: "🇩🇪" },
  { code: "+33", label: "France", flag: "🇫🇷" },
  { code: "+39", label: "Italy", flag: "🇮🇹" },
  { code: "+34", label: "Spain", flag: "🇪🇸" },
  { code: "+31", label: "Netherlands", flag: "🇳🇱" },
  { code: "+86", label: "China", flag: "🇨🇳" },
  { code: "+81", label: "Japan", flag: "🇯🇵" },
  { code: "+82", label: "South Korea", flag: "🇰🇷" },
  { code: "+65", label: "Singapore", flag: "🇸🇬" },
  { code: "+60", label: "Malaysia", flag: "🇲🇾" },
  { code: "+66", label: "Thailand", flag: "🇹🇭" },
  { code: "+62", label: "Indonesia", flag: "🇮🇩" },
  { code: "+966", label: "Saudi Arabia", flag: "🇸🇦" },
  { code: "+974", label: "Qatar", flag: "🇶🇦" },
  { code: "+965", label: "Kuwait", flag: "🇰🇼" },
  { code: "+968", label: "Oman", flag: "🇴🇲" },
  { code: "+52", label: "Mexico", flag: "🇲🇽" },
  { code: "+55", label: "Brazil", flag: "🇧🇷" },
  { code: "+27", label: "South Africa", flag: "🇿🇦" },
  { code: "+234", label: "Nigeria", flag: "🇳🇬" },
  { code: "+20", label: "Egypt", flag: "🇪🇬" },
];


export default function OtpVerification() {
  const { showPopup, PopupComponent } = usePopup();
  const navigate = useNavigate();
  const location = useLocation();

  const [countryCode, setCountryCode] = useState("+91");
  const [mobile, setMobile] = useState("");
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");

  const handleBack = () => {
    if (location.state?.fromAssociate) {
      navigate("/AssociateDashboard", {
        state: { fromBuyerVerification: true },
      });
    } else {
      navigate(-1);
    }
  };

  const handleContinue = async () => {
    const normalized = mobile.replace(/\D/g, "");

    if (normalized.length < 6) {
      showPopup({
        title: "Invalid mobile number",
        message: "Please enter a valid mobile number.",
        type: "warning",
        confirmText: "Ok",
      })
      // alert("Please enter a valid mobile number");
      return;
    }

    const phoneNumber = `${countryCode}${normalized}`;
    setLoading(true);
    setStatusMessage("Checking...");

    try {
      // Step 1: Check if customer exists in profiles table
      const { data: existingProfile, error: profileError } = await supabase
        .from("profiles")
        .select("*")
        .eq("phone", phoneNumber)
        .single();

      if (profileError && profileError.code !== "PGRST116") {
        console.error("Profile lookup error:", profileError);
      }

      if (existingProfile) {
        // ✅ EXISTING CUSTOMER - Try to auto sign-in
        // console.log("✅ Existing customer found:", existingProfile.full_name || existingProfile.name);
        setStatusMessage("Welcome back! Signing you in...");

        // Call edge function to get magic link token
        const response = await fetch(
          `${config.SUPABASE_URL}/functions/v1/auto-signin`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "apikey": config.SUPABASE_KEY,
              "Authorization": `Bearer ${config.SUPABASE_KEY}`,
            },
            body: JSON.stringify({ phone: phoneNumber }),
          }
        );

        const result = await response.json();
        console.log("Auto-signin response:", result);

        if (result.success && result.token) {
          // Verify the magic link token to create session
          const { data: sessionData, error: verifyError } = await supabase.auth.verifyOtp({
            token_hash: result.token,
            type: "magiclink",
          });

          if (verifyError) {
            console.error("Token verification error:", verifyError);
            // Fallback to OTP
            setStatusMessage("Sending OTP...");
          } else {
            // console.log("✅ Session created, user:", sessionData.user?.id);
            setLoading(false);

            // Check if profile is complete (has full_name)
            if (existingProfile.full_name) {
              navigate("/product");
            } else {
              navigate("/userinfo", { state: { phoneNumber } });
            }
            return;
          }
        } else {
          console.log("Auto-signin failed:", result.error);
          // Fallback to OTP if auto-signin fails
          setStatusMessage("Sending OTP...");
        }
      }

      // console.log("Sending OTP to:", phoneNumber);
      setStatusMessage("Sending OTP...");

      const { error } = await supabase.auth.signInWithOtp({
        phone: phoneNumber,
      });

      if (error) {
        setLoading(false);
        setStatusMessage("");
        alert(error.message);
        return;
      }

      setLoading(false);
      navigate("/otp", {
        state: {
          mobile: normalized,
          phoneNumber,
          countryCode,
          fromAssociate: location.state?.fromAssociate || false,
        },
      });

    } catch (err) {
      console.error("Error:", err);
      setLoading(false);
      setStatusMessage("");
      showPopup({
        title: "Please try again",
        message: "Something went wrong.",
        type: "error",
        confirmText: "Ok",
      })
      // alert("Something went wrong. Please try again.");
    }
  };

  return (
    <div className="screen1">
      {/* Popup Component */}
      {PopupComponent}
      <button className="back-btn" onClick={handleBack}>
        ←
      </button>

      <img src={Logo} alt="logo" className="logo" onClick={handleBack} />

      <div className="card">
        <div
          style={{
            textAlign: "center",
            alignItems: "center",
            justifyContent: "center",
            width: "372px",
          }}
        >
          <h2>Welcome to Sheetal Batra</h2>
          <p className="cardp">Your personalised experience awaits.</p>
        </div>

        <div className="phone-wrapper">
          <select
            className="country-code"
            value={countryCode}
            onChange={(e) => setCountryCode(e.target.value)}
          >
            {COUNTRY_CODES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.flag} {c.code}
              </option>
            ))}
          </select>

          <input
            className="phone-input"
            placeholder="Enter mobile number"
            type="tel"
            value={mobile}
            onChange={(e) => setMobile(e.target.value)}
          />
        </div>

        <button className="btn" onClick={handleContinue} disabled={loading}>
          {loading ? statusMessage || "Please wait..." : "Continue"}
        </button>

        <small>
          By continuing, you agree to our{" "}
          <a
            href="https://sheetalbatra.com/pages/privacy-policy"
            target="new"
          >
            Terms & Privacy Policy
          </a>
        </small>
      </div>
    </div>
  );
}