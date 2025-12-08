import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import "./SALogin.css";
import Logo from "../images/logo.png";

export default function SALogin() {
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!email || !password) {
      alert("Please enter email and password.");
      return;
    }

    setLoading(true);

    // 1️⃣ LOGIN WITH SUPABASE AUTH
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

    // Logged-in user ID
    const userId = authData.user.id;

    // 2️⃣ FETCH THE USER'S ROLE FROM salesperson TABLE
    const { data: userRecord, error: userError } = await supabase
      .from("salesperson")
      .select("role")
      .eq("email", email) 
      .single();

    if (userError || !userRecord) {
      console.error(userError);
      alert("Role not found for this user!");
      return;
    }

    const userRole = userRecord.role;

    // 3️⃣ ROLE-BASED NAVIGATION
    if (userRole === "salesperson") {
      // after signInWithPassword()
const { data: { user } } = await supabase.auth.signInWithPassword({ email, password });


  localStorage.setItem("sp_email", user.email.trim());

// optionally store id too if you have it
// localStorage.setItem("sp_id", user.id);

      navigate("/associateDashboard");
    } else if (userRole === "warehouse") {
      navigate("/warehouseDashboard");
    } else {
      alert("Unknown role. Access denied.");
    }
  };

  return (
    <div className="screen1">
      <img src={Logo} alt="logo" className="logo" />

      <div className="card">
        <h2>Welcome to Sheetal Batra</h2>
        <p>SA Login</p>

        <div style={{ width: "372px", margin: "0 auto" }}>
          <input
            className="input"
            placeholder="Enter your email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <input
            className="input"
            type="password"
            placeholder="Enter your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ marginTop: "24px" }}
          />

          <button className="btn" onClick={handleLogin} disabled={loading}>
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </div>

        <div className="back-btn" onClick={() => navigate(-1)}>
          <span>&#8592;</span>
        </div>
      </div>
    </div>
  );
}
