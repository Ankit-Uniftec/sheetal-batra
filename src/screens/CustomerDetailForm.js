

import React, { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import "../screens/Screen3.css";
import Logo from "../images/logo.png";
import formatDate from "../utils/formatDate"; // Import formatDate
import { usePopup } from "../components/Popup";

export default function CustomerDetailForm() {
  const { showPopup, PopupComponent } = usePopup();
  const navigate = useNavigate();
  const location = useLocation();

  const phoneNumber = location.state?.phoneNumber || "";

  // Exhibition orders collect quick walk-up details, so email + DOB are
  // OPTIONAL for them (they're not required by anything downstream — profile
  // lookups key off auth id, the customer PDF needs only name+phone, and the
  // birthday discount is entered manually). The regular flow is unchanged:
  // email + DOB stay mandatory there. One flag drives both the validation and
  // the field labels so the two can't drift.
  const isExhibition = !!sessionStorage.getItem("exhibitionOrder");
  const emailRequired = !isExhibition;
  const dobRequired = !isExhibition;

  // ---------------- STATE ----------------
  const [fullName, setFullName] = useState("");
  const [gender, setGender] = useState("Female");
  const [email, setEmail] = useState("");
  const [dob, setDob] = useState("");
  const [loading, setLoading] = useState(false);

  // ---------------- VALIDATION ----------------
  const isValidEmail = (email) =>
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  const saveUserInfo = async () => {
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      showPopup({
        title: "User login",
        message: "User not logged in.",
        type: "error",
        confirmText: "Ok",
      })
      // alert("User not logged in.");
      return;
    }

    // 🔴 MANDATORY FIELD CHECK
    if (!fullName.trim()) {
      showPopup({
        title: "Name Required!",
        message: "Please enter your full name.",
        type: "warning",
        confirmText: "Ok",
      })
      // alert("Please enter your full name.");
      return;
    }

    if (!gender) {
      showPopup({
        title: "Gender Required!",
        message: "Please select your gender.",
        type: "warning",
        confirmText: "Ok",
      })
      // alert("Please select your gender.");
      return;
    }

    if (emailRequired && !email.trim()) {
      showPopup({
        title: "Email Required!",
        message: "Please enter your email.",
        type: "warning",
        confirmText: "Ok",
      })
      return;
    }

    // Validate the format only when an email was actually entered (so an
    // optional, left-blank email passes, but a malformed one is still caught).
    if (email.trim() && !isValidEmail(email)) {
      showPopup({
        title: "Invalid Email",
        message: "Please enter a valid email address",
        type: "warning",
        confirmText: "Ok",
      })
      return;
    }

    if (dobRequired && !dob) {
      showPopup({
        title: "Date of birth Required!",
        message: "Please select your date of birth.",
        type: "warning",
        confirmText: "Ok",
      })
      return;
    }

    setLoading(true);

    // Normalize: keep country code intact. Only fall back to +91 when the input
    // looks like a bare 10-digit Indian number (legacy data). Never silently
    // drop digits from international numbers.
    let normalizedPhone;
    if (phoneNumber.startsWith("+")) {
      normalizedPhone = "+" + phoneNumber.replace(/\D/g, "");
    } else {
      const digits = phoneNumber.replace(/\D/g, "");
      if (digits.length === 10) {
        normalizedPhone = "+91" + digits;
      } else {
        // Already includes country code without "+" — preserve all digits
        normalizedPhone = "+" + digits;
      }
    }

    const { error } = await supabase.from("profiles").upsert({
      id: user.id,
      full_name: fullName.trim(),
      gender,
      phone: normalizedPhone,
      // Optional in the exhibition flow — store null rather than an empty string.
      email: email.trim() ? email.trim().toLowerCase() : null,
      dob: dob || null,
      created_at: new Date(),
    });

    setLoading(false);

    if (error) {
      showPopup({
        title: "Error",
        message: error.message,
        type: "error",
        confirmText: "Ok",
      })
      // alert(error.message);
      return;
    }

    showPopup({
      title: "Welcome",
      message: "Welcome to the world of Sheetal Batra",
      type: "success",
      confirmText: "Ok",
    })
    // alert("Welcome to the world of Sheetal Batra");
    navigate("/product");
  };

  const handleBack = () => {
    if (location.state?.fromAssociate) {
      navigate("/buyerVerification");
    } else {
      navigate(-1);
    }
  };

  return (
    <div className="screen3-root">
      {/* Popup Component */}
      {PopupComponent}
      <button className="back-btn" onClick={handleBack}>←</button>

      <div className="card3">
        <img src={Logo} className="logo3" alt="logo" />
        <h2>Personal Details</h2>

        {/* ROW 1 */}
        <div className="row">
          <div className="input-box">
            <label>Full Name *</label>
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
            />
          </div>

          <div className="input-box">
            <label>Gender *</label>
            <select
              value={gender}
              onChange={(e) => setGender(e.target.value)}
              required
            >
              <option value="">Select</option>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
              <option value="Others">Others</option>
            </select>
          </div>
        </div>

        {/* ROW 2 */}
        <div className="row">
          <div className="input-box">
            <label>Phone *</label>
            <input type="text" value={phoneNumber} readOnly />
          </div>

          <div className="input-box">
            <label>Email {emailRequired ? "*" : "(optional)"}</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="input-box">
            <label>Date of Birth {dobRequired ? "*" : "(optional)"}</label>
            <input
              type="date"
              value={dob}
              onChange={(e) => setDob(e.target.value)}
              required
            />
          </div>
        </div>

        <button className="btn3" onClick={saveUserInfo} disabled={loading}>
          {loading ? "Saving..." : "Continue"}
        </button>
      </div>
    </div>
  );
}