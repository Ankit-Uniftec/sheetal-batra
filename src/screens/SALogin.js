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
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !password) {
      showPopup({
        title: "Email and Password Required!",
        message: "Please enter email and password.",
        type: "warning",
        confirmText: "Ok",
      })
      return;
    }

    setLoading(true);

    try {
      const { data: authData, error: authError } =
        await supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password,
        });

      if (authError) {
        showPopup({
          title: "Invalid Credentials",
          message: "Please enter valid credentials.",
          type: "warning",
          confirmText: "Ok",
        })
        return;
      }

      const { data: userRecord, error: roleError } = await supabase
        .from("salesperson")
        .select("role")
        .eq("email", normalizedEmail)
        .single();

      if (roleError || !userRecord) {
        showPopup({
          title: "Role not found",
          message: "Could not determine your role. Please contact admin.",
          type: "error",
          confirmText: "Ok",
        })
        return;
      }

      if (userRecord.role === "salesperson" || userRecord.role === "sa_services") {
        localStorage.setItem("sp_email", normalizedEmail);
        navigate("/AssociateDashboard");
      } else if (userRecord.role === "warehouse") {
        navigate("/warehouseDashboard");
      } else if (userRecord.role === "inventory") {
        navigate("/inventoryDashboard");
      } else if (userRecord.role === "accounts") {
        navigate("/accounts")
      } else if (userRecord.role === "accountant") {
        navigate("/accountant-dashboard")
      } else if (userRecord.role === "head_of_design") {
        navigate("/head-of-design-dashboard")
      } else if (userRecord.role === "gm") {
        navigate("/gm-dashboard")
      } else if (userRecord.role === "retail_manager") {
        navigate("/retail-manager-dashboard");
      } else if (userRecord.role === "admin") {
        navigate("/admin")
      } else if (userRecord.role === "coo") {
        navigate("/coo-dashboard")
      } else if (userRecord.role === "ceo") {
        navigate("/ceo-dashboard")
      } else if (userRecord.role === "ceo_assistant") {
        navigate("/ceo-assistant-dashboard")
      } else if (userRecord.role === "assistant_cmo") {
        navigate("/assistant-cmo-dashboard")
      } else if (userRecord.role === "store_manager") {
        navigate("/store-manager-dashboard");
      } else if (userRecord.role === "executive") {
        const { data: prof } = await supabase.from("profiles").select("full_name, store, store_name").eq("id", authData.user.id).single();
        sessionStorage.setItem("currentSalesperson", JSON.stringify({
          store: prof?.store || prof?.store_name || "B2B",
          name: prof?.full_name || "",
          email: normalizedEmail,
        }));
        navigate("/b2b-executive-dashboard")
      } else if (userRecord.role === "merchandiser") {
        const { data: prof } = await supabase.from("profiles").select("full_name, store, store_name").eq("id", authData.user.id).single();
        sessionStorage.setItem("currentSalesperson", JSON.stringify({
          store: prof?.store || prof?.store_name || "B2B",
          name: prof?.full_name || "",
          email: normalizedEmail,
        }));
        navigate("/b2b-merchandiser-dashboard")
      } else if (userRecord.role === "production") {
        const { data: prof } = await supabase.from("profiles").select("full_name, store, store_name").eq("id", authData.user.id).single();
        sessionStorage.setItem("currentSalesperson", JSON.stringify({
          store: prof?.store || prof?.store_name || "B2B",
          name: prof?.full_name || "",
          email: normalizedEmail,
        }));
        navigate("/b2b-production-dashboard")
      } else if (userRecord.role === "production_manager") {
        const { data: sp } = await supabase
          .from("salesperson")
          .select("name, store")
          .eq("email", normalizedEmail)
          .single();
        sessionStorage.setItem("currentSalesperson", JSON.stringify({
          store: sp?.store || "All",
          name: sp?.name || "",
          email: normalizedEmail,
        }));
        navigate("/production-manager-dashboard");
      } else {
        showPopup({
          title: "Unknown role",
          message: "Access is Denied.",
          type: "warning",
          confirmText: "Ok",
        })
      }
    } catch (err) {
      console.error("Login failed:", err);
      showPopup({
        title: "Something went wrong",
        message: "An unexpected error occurred. Please try again.",
        type: "error",
        confirmText: "Ok",
      })
    } finally {
      setLoading(false);
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
            onChange={(e) => setEmail(e.target.value.toLowerCase())}
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