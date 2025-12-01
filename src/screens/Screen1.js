import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import "./Screen1.css";

export default function Screen1() {
  const navigate = useNavigate();
  const [mobile, setMobile] = useState("");
  const [loading, setLoading] = useState(false);

  const handleContinue = async () => {
    const normalized = mobile.replace(/\D/g, "").slice(-10); // Always last 10 digits

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
      state: { mobile: normalized, phoneNumber },
    });
  };

  return (
    <div className="screen1">
      <img src="/logo.png" alt="logo" className="logo" />

      <div className="card">
        <div style={{textAlign:'center',alignItems:"center",justifyContent:"center",justifyItems:"center", width:'372px'}}>
          <h2>Welcome to Sheetal Batra</h2>
        <p>Your personalised  experience awaits.</p>
        </div>

        <div style={{width:'372px'}}>
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
          By continuing, you agree to our <a href="#" style={{color:'#D5B85A'}}>Terms & Privacy Policy</a>
        </small>
      </div>
    </div>
  );
}
