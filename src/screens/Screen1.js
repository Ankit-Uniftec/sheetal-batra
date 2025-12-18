import React, { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import "./Screen1.css";
import Logo from "../images/logo.png";
import formatPhoneNumber from "../utils/formatPhoneNumber";

/* ----------------------------------
   COUNTRY CODE CONFIG (OBJECT ARRAY)
----------------------------------- */
const COUNTRY_CODES = [
  { code: "+91", label: "India", flag: "🇮🇳" },
  { code: "+1", label: "USA", flag: "🇺🇸" },
  { code: "+44", label: "UK", flag: "🇬🇧" },
  { code: "+61", label: "Australia", flag: "🇦🇺" },
  { code: "+971", label: "UAE", flag: "🇦🇪" },

  // Europe
  { code: "+49", label: "Germany", flag: "🇩🇪" },
  { code: "+33", label: "France", flag: "🇫🇷" },
  { code: "+39", label: "Italy", flag: "🇮🇹" },
  { code: "+34", label: "Spain", flag: "🇪🇸" },
  { code: "+31", label: "Netherlands", flag: "🇳🇱" },

  // Asia
  { code: "+86", label: "China", flag: "🇨🇳" },
  { code: "+81", label: "Japan", flag: "🇯🇵" },
  { code: "+82", label: "South Korea", flag: "🇰🇷" },
  { code: "+65", label: "Singapore", flag: "🇸🇬" },
  { code: "+60", label: "Malaysia", flag: "🇲🇾" },
  { code: "+66", label: "Thailand", flag: "🇹🇭" },
  { code: "+62", label: "Indonesia", flag: "🇮🇩" },

  // Middle East
  { code: "+966", label: "Saudi Arabia", flag: "🇸🇦" },
  { code: "+974", label: "Qatar", flag: "🇶🇦" },
  { code: "+965", label: "Kuwait", flag: "🇰🇼" },
  { code: "+968", label: "Oman", flag: "🇴🇲" },

  // Americas
  
  { code: "+52", label: "Mexico", flag: "🇲🇽" },
  { code: "+55", label: "Brazil", flag: "🇧🇷" },

  // Africa
  { code: "+27", label: "South Africa", flag: "🇿🇦" },
  { code: "+234", label: "Nigeria", flag: "🇳🇬" },
  { code: "+20", label: "Egypt", flag: "🇪🇬" },
];


export default function Screen1() {
  const navigate = useNavigate();
  const location = useLocation();

  const [countryCode, setCountryCode] = useState("+91");
  const [mobile, setMobile] = useState("");
  const [loading, setLoading] = useState(false);

  // -------------------------------------------------------
  // BACK BUTTON
  // -------------------------------------------------------
  const handleBack = () => {
    if (location.state?.fromAssociate) {
      navigate("/AssociateDashboard", {
        state: { fromBuyerVerification: true },
      });
    } else {
      navigate(-1);
    }
  };

  // -------------------------------------------------------
  // SEND OTP
  // -------------------------------------------------------
  const handleContinue = async () => {
    const normalized = mobile.replace(/\D/g, "");

    if (normalized.length < 6) {
      alert("Please enter a valid mobile number");
      return;
    }

    const phoneNumber = `${countryCode}${normalized}`;
    setLoading(true);

    const { error } = await supabase.auth.signInWithOtp({
      phone: phoneNumber,
    });

    setLoading(false);

    if (error) {
      alert(error.message);
      return;
    }

    navigate("/otp", {
      state: {
        mobile: normalized,
        phoneNumber,
        fromAssociate: location.state?.fromAssociate || false,
      },
    });
  };

  return (
    <div className="screen1">
      {/* BACK BUTTON */}
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

        {/* PHONE INPUT WITH COUNTRY CODE */}
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
            value={formatPhoneNumber(mobile)}
            onChange={(e) => setMobile(e.target.value)}
          />
        </div>

        <button className="btn" onClick={handleContinue} disabled={loading}>
          {loading ? "Sending OTP..." : "Continue"}
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
