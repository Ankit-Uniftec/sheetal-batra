

import React, { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import "./Screen1.css";
import Logo from "../images/logo.png";

export default function Screen1() {
  const navigate = useNavigate();
  const location = useLocation();

  const [mobile, setMobile] = useState("");
  const [loading, setLoading] = useState(false);

  // -------------------------------------------------------
  // BACK BUTTON: Determine if user came from AssociateDashboard
  // -------------------------------------------------------
  const handleBack = () => {
    if (location.state?.fromAssociate) {
      // Send flag so dashboard will require password again
      navigate("/AssociateDashboard", {
        state: { fromBuyerVerification: true }
      });
    } else {
      navigate(-1);
    }
  };

  // -------------------------------------------------------
  // SEND OTP
  // -------------------------------------------------------
  const handleContinue = async () => {
    const normalized = mobile.replace(/\D/g, "").slice(-10);

    if (normalized.length !== 10) {
      alert("Please enter a valid 10-digit mobile number");
      return;
    }

    const phoneNumber = "+91" + normalized;
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
        fromAssociate: location.state?.fromAssociate || false
      }
    });
  };

  return (
    <div className="screen1">
      
      {/* BACK BUTTON */}
      <button className="back-btn" onClick={handleBack}>←</button>

      <img src={Logo} alt="logo" className="logo" />

      <div className="card">

        <div style={{
          textAlign: 'center',
          alignItems: "center",
          justifyContent: "center",
          width: '372px'
        }}>
          <h2>Welcome to Sheetal Batra</h2>
          <p>Your personalised experience awaits.</p>
        </div>

        <div style={{ width: '372px' }}>
          <input
            className="input"
            placeholder="Enter your mobile number"
            value={mobile}
            onChange={(e) => setMobile(e.target.value)}
          />

          <button className="btn" onClick={handleContinue} disabled={loading}>
            {loading ? "Sending OTP..." : "Continue"}
          </button>
        </div>

        <small>
          By continuing, you agree to our{" "}
          <a href="#" style={{ color: '#D5B85A' }}>Terms & Privacy Policy</a>
        </small>
      </div>
    </div>
  );
}
