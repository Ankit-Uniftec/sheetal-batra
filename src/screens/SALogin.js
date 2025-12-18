import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import "./SALogin.css";
import Logo from "../images/logo.png";
import eye from "../images/eye.svg"
import eyeOff from "../images/eyeOff.svg"

export default function SALogin() {
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!email || !password) {
      alert("Please enter email and password.");
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
      alert("Invalid email or password");
      return;
    }

    const { data: userRecord } = await supabase
      .from("salesperson")
      .select("role")
      .eq("email", email)
      .single();

    if (!userRecord) {
      alert("Role not found!");
      return;
    }

    if (userRecord.role === "salesperson") {
      localStorage.setItem("sp_email", email.trim());
      navigate("/associateDashboard");
    } else if (userRecord.role === "warehouse") {
      navigate("/warehouseDashboard");
    } else {
      alert("Unknown role. Access denied.");
    }
  };

  return (
    <div className="screen1">
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

