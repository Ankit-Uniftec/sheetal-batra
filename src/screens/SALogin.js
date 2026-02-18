import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import "./SALogin.css";
import Logo from "../images/logo.png";
import eye from "../images/eye.svg"
import eyeOff from "../images/eyeOff.svg"
import { usePopup } from "../components/Popup";

export default function SALogin() {
  const { showPopup, PopupComponent } = usePopup();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!email || !password) {
      showPopup({
        title: "Email and Password Required!",
        message: "Please enter email and password.",
        type: "warning",
        confirmText: "Ok",
      })
      // alert("Please enter email and password.");
      return;
    }

    setLoading(true);

    const { data: authData, error: authError } =
      await supabase.auth.signInWithPassword({
        email,
        password,
      });

    setLoading(false);

    if (authError) {
      showPopup({
        title: "Invalid Credentials",
        message: "Please enter valid credentials.",
        type: "warning",
        confirmText: "Ok",
      })
      // alert("Invalid email or password");
      return;
    }

    const { data: userRecord } = await supabase
      .from("salesperson")
      .select("role")
      .eq("email", email)
      .single();

    if (!userRecord) {
      showPopup({
        title: "Role not found ",
        message: "",
        type: "error",
        confirmText: "Ok",
      })
      // alert("Role not found!");
      return;
    }

    if (userRecord.role === "salesperson") {
      localStorage.setItem("sp_email", email.trim());
      navigate("/AssociateDashboard");
    } else if (userRecord.role === "warehouse") {
      navigate("/warehouseDashboard");
    } else if (userRecord.role === "inventory") {
      navigate("/inventoryDashboard");
    } else if (userRecord.role === "accounts") {
      navigate("/accounts")
    } else if (userRecord.role === "admin") {
      navigate("/admin")
    }else if (userRecord.role === "executive"){
      navigate("/b2b-executive-dashboard")
    }else if (userRecord.role === "merchandiser"){
      navigate("/b2b-merchandiser-dashboard")
    }else{
      showPopup({
        title: "Unknown role",
        message: "Access is Denied.",
        type: "warning",
        confirmText: "Ok",
      })
      // alert("Unknown role. Access denied.");
    }
  };

  return (
    <div className="screen1">
      {/* Popup Component */}
      {PopupComponent}
      <img src={Logo} alt="logo" className="logo" />

      <div className="card">
        <p className="login-title">SA Login</p>

        <div style={{ width: "372px", margin: "0 auto" }}>
          <input
            className="input"
            placeholder="Enter your email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          {/* ******** PASSWORD INPUT WITH EYE ******** */}
          <div className="password-wrapper">
            <input
              className="input"
              type={showPassword ? "text" : "password"}
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{ marginTop: "24px" }}
            />

            {/* <span
              className="eye-icon"
              onClick={() => setShowPassword(!showPassword)}
            >
              {showPassword ? {eye} : ""}
            </span> */}


            <span className="eye-icon" onClick={() => setShowPassword(!showPassword)}>
              <img src={showPassword ? eyeOff : eye} alt="toggle visibility" width={20} />
            </span>

          </div>
          {/* *************************************** */}

          <button className="btn" onClick={handleLogin} disabled={loading}>
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </div>


      </div>
    </div>
  );
}

