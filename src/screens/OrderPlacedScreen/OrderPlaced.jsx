import React, { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import Logo from "../../images/logo.png";
import "./OrderPlaced.css";

export default function OrderPlaced() {
  const navigate = useNavigate();
  const location = useLocation();
  const order = location.state?.order;

  const [showConfetti, setShowConfetti] = useState(true);

  useEffect(() => {
    // Hide confetti after 3 seconds
    const timer = setTimeout(() => setShowConfetti(false), 3000);
    return () => clearTimeout(timer);
  }, []);

  const handleBackToDashboard = async () => {
    try {
      await supabase.auth.signOut();

      const raw = sessionStorage.getItem("associateSession");
      const saved = raw ? JSON.parse(raw) : null;

      if (saved?.access_token && saved?.refresh_token) {
        const { error } = await supabase.auth.setSession({
          access_token: saved.access_token,
          refresh_token: saved.refresh_token,
        });

        if (!error) {
          sessionStorage.setItem("requireVerification", "true");
          sessionStorage.removeItem("associateSession");
          sessionStorage.removeItem("returnToAssociate");
          navigate("/AssociateDashboard", { replace: true });
          return;
        }
      }
      navigate("/associateDashboard", { replace: true });
    } catch (e) {
      console.error("Logout restore error", e);
      navigate("/associateDashboard", { replace: true });
    }
  };

  if (!order) {
    return (
      <div className="order-placed-bg">
        <div className="order-placed-card">
          <h2>No order data found</h2>
          <button className="op-btn op-btn-primary" onClick={handleBackToDashboard}>
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="order-placed-bg">
      {/* Confetti Animation */}
      {showConfetti && (
        <div className="confetti-container">
          {[...Array(50)].map((_, i) => (
            <div
              key={i}
              className="confetti"
              style={{
                left: `${Math.random() * 100}%`,
                animationDelay: `${Math.random() * 2}s`,
                backgroundColor: ["#d5b85a", "#4CAF50", "#2196F3", "#FF9800", "#E91E63"][
                  Math.floor(Math.random() * 5)
                ],
              }}
            />
          ))}
        </div>
      )}

      {/* Header */}
      <div className="op-header">
        <img
          src={Logo}
          className="op-logo"
          alt="logo"
          onClick={handleBackToDashboard}
        />
      </div>

      {/* Main Card */}
      <div className="order-placed-card">
        {/* Success Icon */}
        <div className="success-icon-container">
          <div className="success-icon">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
        </div>

        {/* Success Message */}
        <h1 className="success-title">Order Placed Successfully!</h1>
        <p className="success-subtitle">
          Thank you for your order. Your order has been received and is being processed.
        </p>

        {/* Order ID Box */}
        <div className="order-id-box">
          <span className="order-id-label">Order ID</span>
          <span className="order-id-value">#{order.order_no}</span>
        </div>

        {/* Back to Dashboard Button */}
        <button className="op-btn op-btn-primary" onClick={handleBackToDashboard}>
          Back to Dashboard
        </button>
      </div>
    </div>
  );
}