import React, { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import "./Screen1.css";
import Logo from "../images/logo.png";
import LogoVideo from "../images/logo.mp4"
import LogoVideoWebm from "../images/logo.webm";
import config from "../config/config";
import { usePopup } from "../components/Popup";
import { COUNTRY_CODES } from "../utils/countryCodes";

/* COUNTRY_CODES now lives in src/utils/countryCodes.js (shared with Walk-In form). */

export default function OtpVerification() {
  const { showPopup, PopupComponent } = usePopup();
  const navigate = useNavigate();
  const location = useLocation();

  const [countryCode, setCountryCode] = useState("+91");
  const [mobile, setMobile] = useState("");
  // Custom searchable country dropdown (native select can't search and
  // renders flag emoji unreliably across OSes).
  const [ccOpen, setCcOpen] = useState(false);
  const [ccQuery, setCcQuery] = useState("");
  const selectedCountry = COUNTRY_CODES.find((c) => c.code === countryCode) || COUNTRY_CODES[0];
  // Filter by country name or dial code (with or without the leading "+").
  const ccQ = ccQuery.trim().toLowerCase().replace(/^\+/, "");
  const ccFiltered = ccQ
    ? COUNTRY_CODES.filter(
        (c) => c.label.toLowerCase().includes(ccQ) || c.code.replace("+", "").startsWith(ccQ)
      )
    : COUNTRY_CODES;
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [showVideo, setShowVideo] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState(null);

  const handleBack = () => {
    if (location.state?.fromAssociate) {
      navigate("/AssociateDashboard", {
        state: { fromBuyerVerification: true },
      });
    } else {
      navigate(-1);
    }
  };

  /* ---------- SEND OTP VIA SPUR WHATSAPP ---------- */
  const sendOtpViaSpur = async (phoneNumber) => {
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

    if (!response.ok || !result.success) {
      throw new Error(result.error || "Failed to send OTP");
    }

    return result;
  };

  // Play video then navigate
  const navigateWithVideo = (path, state) => {
    setPendingNavigation({ path, state });
    setShowVideo(true);
  };

  const handleVideoEnd = () => {
    setShowVideo(false);
    if (pendingNavigation) {
      navigate(pendingNavigation.path, { state: pendingNavigation.state });
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
      });
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
        // console.log("Auto-signin response:", result);

        if (result.success && result.token) {
          // Verify the magic link token to create session
          const { data: sessionData, error: verifyError } = await supabase.auth.verifyOtp({
            token_hash: result.token,
            type: "magiclink",
          });

          if (verifyError) {
            console.error("Token verification error:", verifyError);
            // Fallback to Spur WhatsApp OTP
            setStatusMessage("Sending OTP via WhatsApp...");
          } else {
            setLoading(false);

            // Check if profile is complete (has full_name)
            if (existingProfile.full_name) {
              navigateWithVideo("/product");
            } else {
              navigateWithVideo("/userinfo", { phoneNumber });
            }
            return;
          }
        } else {
          // Fallback to Spur WhatsApp OTP
          setStatusMessage("Sending OTP via WhatsApp...");
        }
      }

      // ======= SPUR WHATSAPP OTP (replaces Twilio SMS) =======
      setStatusMessage("Sending OTP via WhatsApp...");

      try {
        await sendOtpViaSpur(phoneNumber);
      } catch (otpError) {
        setLoading(false);
        setStatusMessage("");

        // Handle rate limit (30 second cooldown)
        if (otpError.message.includes("30 seconds")) {
          showPopup({
            title: "Please wait",
            message: "Please wait 30 seconds before requesting another OTP.",
            type: "warning",
            confirmText: "Ok",
          });
        } else {
          showPopup({
            title: "Failed to send OTP",
            message: otpError.message || "Could not send OTP. Please try again.",
            type: "error",
            confirmText: "Ok",
          });
        }
        return;
      }

      setLoading(false);
      navigateWithVideo("/otp", {
        mobile: normalized,
        phoneNumber,
        countryCode,
        fromAssociate: location.state?.fromAssociate || false,
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
      });
    }
  };

  return (
    <div className="screen1">
      {/* Popup Component */}
      {PopupComponent}
      {/* Full-screen video overlay */}
      {showVideo && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: "#ffffff",
          zIndex: 99999,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}>
          <video
            ref={(el) => {
              if (el) {
                el.playbackRate = 2.5;
                el.play().catch(() => handleVideoEnd());
              }
            }}
            muted
            playsInline
            onEnded={handleVideoEnd}
            style={{
              width: "680px",
              height: "680px",
              objectFit: "contain",
            }}
          >
            <source src={LogoVideoWebm} type="video/webm" />
            <source src={LogoVideo} type="video/mp4" />
          </video>
        </div>
      )}
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
          <div className="cc-select">
            <button
              type="button"
              className="country-code cc-trigger"
              onClick={() => { setCcOpen((v) => !v); setCcQuery(""); }}
            >
              <span>{selectedCountry.flag} {selectedCountry.code}</span>
              <span className="cc-chevron">▾</span>
            </button>
            {ccOpen && (
              <>
                <div className="cc-backdrop" onClick={() => { setCcOpen(false); setCcQuery(""); }} />
                <div className="cc-menu">
                  <input
                    className="cc-search"
                    placeholder="Search country…"
                    value={ccQuery}
                    autoFocus
                    onChange={(e) => setCcQuery(e.target.value)}
                  />
                  <ul className="cc-list">
                    {ccFiltered.length === 0 && (
                      <li className="cc-empty">No matches</li>
                    )}
                    {ccFiltered.map((c) => (
                      <li
                        key={c.code}
                        className={`cc-option ${c.code === countryCode ? "selected" : ""}`}
                        onClick={() => { setCountryCode(c.code); setCcOpen(false); setCcQuery(""); }}
                      >
                        <span className="cc-flag">{c.flag}</span>
                        <span className="cc-label">{c.label}</span>
                        <span className="cc-code">{c.code}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}
          </div>

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