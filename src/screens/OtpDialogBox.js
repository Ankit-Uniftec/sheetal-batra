import React, { useState, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import "./Screen2.css";
import Logo from "../images/logo.png";
import config from "../config/config";
import formatPhoneNumber from "../utils/formatPhoneNumber";
import { usePopup } from "../components/Popup";

export default function OtpDialogBox() {
  const { showPopup, PopupComponent } = usePopup();
  const location = useLocation();
  const navigate = useNavigate();

  const mobile = location.state?.mobile;
  const phoneNumber = location.state?.phoneNumber;

  const [time, setTime] = useState(30);
  const [loading, setLoading] = useState(false);
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const inputRefs = useRef([]);

  /* ---------- TIMER ---------- */
  useEffect(() => {
    const timer = setInterval(() => {
      setTime((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  /* ---------- OTP HANDLERS ---------- */
  const handleChange = (value, index) => {
    if (!/^\d*$/.test(value)) return;

    const updated = [...otp];
    updated[index] = value;
    setOtp(updated);

    if (value && index < 5) {
      inputRefs.current[index + 1].focus();
    }
  };

  const handleKeyDown = (e, index) => {
    if (e.key === "Backspace" && otp[index] === "" && index > 0) {
      inputRefs.current[index - 1].focus();
    }
  };

  /* ---------- VERIFY OTP VIA SPUR EDGE FUNCTION ---------- */
  const verifyOTP = async () => {
    const code = otp.join("");

    if (code.length !== 6) {
      showPopup({
        title: "Invalid OTP",
        message: "Enter a valid 6-digit OTP",
        type: "warning",
        confirmText: "Ok",
      });
      return;
    }

    setLoading(true);

    try {
      // Call verify-otp edge function
      const response = await fetch(
        `${config.SUPABASE_URL}/functions/v1/verify-otp`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "apikey": config.SUPABASE_KEY,
            "Authorization": `Bearer ${config.SUPABASE_KEY}`,
          },
          body: JSON.stringify({ phone: phoneNumber, code }),
        }
      );

      const result = await response.json();

      if (!response.ok || !result.success) {
        setLoading(false);
        showPopup({
          title: "Error",
          message: result.error || "Invalid or expired OTP",
          type: "error",
          confirmText: "Ok",
        });
        return;
      }

      // OTP verified! Now create a session using the magic link token
      if (result.token) {
        const { data: sessionData, error: sessionError } = await supabase.auth.verifyOtp({
          token_hash: result.token,
          type: "magiclink",
        });

        if (sessionError) {
          console.error("Session creation error:", sessionError);
          // Even if session creation fails, OTP was verified
          // Try to navigate based on profile status
        }
      }

      setLoading(false);

      // Navigate based on profile status
      if (result.hasProfile) {
        navigate("/product");
      } else {
        navigate("/userinfo", { state: { phoneNumber } });
      }

    } catch (err) {
      console.error("Verify error:", err);
      setLoading(false);
      showPopup({
        title: "Error",
        message: "Something went wrong. Please try again.",
        type: "error",
        confirmText: "Ok",
      });
    }
  };

  /* ---------- RESEND OTP VIA SPUR WHATSAPP ---------- */
  const resendOTP = async () => {
    if (time !== 0) return;

    setLoading(true);

    try {
      const response = await fetch(
        `${config.SUPABASE_URL}/functions/v1/send-otp`,
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
      setLoading(false);

      if (!response.ok || !result.success) {
        showPopup({
          title: "Error",
          message: result.error || "Failed to resend OTP",
          type: "error",
          confirmText: "Ok",
        });
        return;
      }

      setTime(30);
      setOtp(["", "", "", "", "", ""]);
      inputRefs.current[0]?.focus();

      showPopup({
        title: "OTP Sent",
        message: "A new OTP has been sent to your WhatsApp.",
        type: "success",
        confirmText: "Ok",
      });

    } catch (err) {
      console.error("Resend error:", err);
      setLoading(false);
      showPopup({
        title: "Error",
        message: "Failed to resend OTP. Please try again.",
        type: "error",
        confirmText: "Ok",
      });
    }
  };

  const handleBack = () => {
    if (location.state?.fromAssociate) {
      navigate("/AssociateDashboard", {
        state: { fromBuyerVerification: true },
      });
    } else {
      navigate(-1);
    }
  };

  return (
    <div className="screen2-bg">
      {/* Popup Component */}
      {PopupComponent}
      <img src={Logo} alt="logo" className="logo2" onClick={handleBack} />
      <button className="back-btn" onClick={() => { navigate(-1) }} >
        ←
      </button>

      <div className="card2">
        <h2 className="title">Welcome to Sheetal Batra</h2>
        <p className="subtitle">Your personalised experience awaits.</p>


        <div className="otpBox">
          <p className="otp-text">OTP has been sent to your WhatsApp on {phoneNumber}</p>

          {otp.map((v, i) => (
            <input
              key={i}
              maxLength={1}
              ref={(el) => (inputRefs.current[i] = el)}
              value={v}
              onChange={(e) => handleChange(e.target.value, i)}
              onKeyDown={(e) => handleKeyDown(e, i)}
              className="otp-input"
            />
          ))}
        </div>

        <button className="btn2" onClick={verifyOTP} disabled={loading}>
          {loading ? "Verifying..." : "Continue"}
        </button>

        {time > 0 ? (
          <p className="timer-text">
            You can resend the code in {time} seconds
          </p>
        ) : (
          <button className="resend-btn" onClick={resendOTP}>
            Resend OTP
          </button>
        )}
      </div>
    </div>
  );
}