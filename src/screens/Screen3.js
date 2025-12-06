import React, { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import "../screens/Screen3.css";
import Logo from "../images/logo.png";

function Screen3() {
  const navigate = useNavigate();
  const location = useLocation();

  const phoneNumber = location.state?.phoneNumber || "";

  // State
  const [fullName, setFullName] = useState("");
  const [gender, setGender] = useState("");
  const [email, setEmail] = useState("");
  const [dob, setDob] = useState("");
  const [loading, setLoading] = useState(false);

  const saveUserInfo = async () => {
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      alert("User not logged in.");
      return;
    }

    if (!fullName || !email) {
      alert("Full Name and Email are required.");
      return;
    }

    setLoading(true);

    const normalized = "+91" + phoneNumber.replace(/\D/g, "").slice(-10);

    const { error } = await supabase.from("profiles").upsert({
      id: user.id,
      full_name: fullName,
      gender,
      phone: normalized,
      email,
      dob,
      created_at: new Date(),
    });

    setLoading(false);

    if (error) {
      alert(error.message);
      return;
    }

    alert("Profile saved successfully!");
    navigate("/product");
  };

  const handleBack = () => {
    if (location.state?.fromAssociate) {
      // Send flag so dashboard will require password again
      navigate("/buyerVerification", {

      });
    } else {
      navigate(-1);
    }
  };

  return (
    <div className="screen3-root">
      <button className="back-btn" onClick={handleBack}>←</button>
      <div className="card3">
        <img src={Logo} className="logo3" alt="logo" />

        <h2>Personal Details</h2>

        {/* Row 1 */}
        <div className="row">
          <div className="input-box">
            <label>Full name*</label>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>

          <div className="input-box">
            <label>Gender</label>
            <select value={gender} onChange={(e) => setGender(e.target.value)}>
              <option value="">⏷</option>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
            </select>
          </div>

        </div>

        {/* Row 2 */}
        <div className="row">
          <div className="input-box">
            <label>Phone number*</label>
            <input type="text" value={phoneNumber} readOnly />
          </div>

          <div className="input-box">
            <label>Email*</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>

          <div className="input-box">
            <label>Date of Birth</label>
            <input type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
          </div>
        </div>

        <button className="btn3" onClick={saveUserInfo} disabled={loading}>
          {loading ? "Saving..." : "Continue"}
        </button>
      </div>
    </div>
  );
}

export default Screen3;
