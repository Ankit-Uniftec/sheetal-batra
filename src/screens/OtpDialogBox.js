import React, { useState, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import "./Screen2.css";
import Logo from "../images/logo.png";
import formatPhoneNumber from "../utils/formatPhoneNumber";

export default function OtpDialogBox() {
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

  /* ---------- VERIFY OTP ---------- */
  const verifyOTP = async () => {
    const code = otp.join("");

    if (code.length !== 6) {
      alert("Enter a valid 6-digit OTP");
      return;
    }

    setLoading(true);

    const { data, error } = await supabase.auth.verifyOtp({
      phone: phoneNumber,
      token: code,
      type: "sms",
    });

    setLoading(false);

    if (error) {
      alert(error.message);
      return;
    }

    const formatted = "+91" + phoneNumber.replace(/\D/g, "").slice(-10);

    await supabase.from("profiles").upsert({
      id: data.user.id,
      phone: formatted,
    });

    const { data: profile } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", data.user.id)
      .maybeSingle();

    profile?.full_name
      ? navigate("/product")
      : navigate("/userinfo", { state: { phoneNumber: formatted } });
  };

  /* ---------- RESEND OTP ---------- */
  const resendOTP = async () => {
    if (time !== 0) return;

    setLoading(true);
    const { error } = await supabase.auth.signInWithOtp({
      phone: phoneNumber,
    });
    setLoading(false);

    if (error) {
      alert(error.message);
      return;
    }

    setTime(30);
    setOtp(["", "", "", "", "", ""]);
    inputRefs.current[0]?.focus();
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
      <img src={Logo} alt="logo" className="logo2"  onClick={handleBack}/>
      <button className="back-btn" onClick={()=>{navigate(-1)}} >
        ←
      </button>

      <div className="card2">
        <h2 className="title">Welcome to Sheetal Batra</h2>
         <p className="subtitle">Your personalised experience awaits.</p>
       

        <div className="otpBox">
          <p className="otp-text">OTP has been sent to {formatPhoneNumber(mobile)}</p>

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
