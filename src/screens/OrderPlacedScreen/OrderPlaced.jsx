import React, { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import Logo from "../../images/logo.png";
import { usePopup } from "../../components/Popup";
import "./OrderPlaced.css";

export default function OrderPlaced() {
  const navigate = useNavigate();
  const location = useLocation();
  const { showPopup, PopupComponent } = usePopup();
  const order = location.state?.order;
  const [restoring, setRestoring] = useState(false);

  const handleBackToDashboard = async () => {
    if (restoring) return;
    setRestoring(true);

    // Strategy: switch the active Supabase session from the customer back to the SA/SM
    // by calling setSession() with the cached SA tokens (do NOT signOut() first —
    // that would fire SIGNED_OUT, set user=null in AuthContext, and PrivateRoute
    // would redirect us to /login before setSession() can restore).
    try {
      const raw = sessionStorage.getItem("associateSession");
      const saved = raw ? JSON.parse(raw) : null;
      const expectedEmail = saved?.user?.email?.toLowerCase();
      const returnDashboard = sessionStorage.getItem("returnDashboard") || "/AssociateDashboard";

      // Helper: clear all order-flow session keys
      const clearOrderFlowKeys = () => {
        sessionStorage.removeItem("associateSession");
        sessionStorage.removeItem("returnToAssociate");
        sessionStorage.removeItem("returnDashboard");
        sessionStorage.removeItem("currentSalesperson");
        sessionStorage.removeItem("screen4FormData");
        sessionStorage.removeItem("screen6FormData");
      };

      if (saved?.access_token && saved?.refresh_token) {
        const { data, error } = await supabase.auth.setSession({
          access_token: saved.access_token,
          refresh_token: saved.refresh_token,
        });

        // Verify the swap actually happened — data.session should exist and the user
        // should match the saved associate (sanity check against stale tokens)
        const restoredEmail = data?.session?.user?.email?.toLowerCase();
        const swappedOk = !error && data?.session
          && (!expectedEmail || expectedEmail === restoredEmail);

        if (swappedOk) {
          // Success: navigate back to the SA's dashboard with their session restored
          sessionStorage.setItem("requireVerification", "true");
          sessionStorage.removeItem("associateSession");
          sessionStorage.removeItem("returnToAssociate");
          navigate(returnDashboard, { replace: true });
          return;
        }

        // Swap failed — log details so the underlying cause is visible in the console
        console.error("Failed to restore associate session:", {
          error,
          hadSession: !!data?.session,
          expectedEmail,
          restoredEmail,
        });
      } else {
        console.warn("No associateSession found in sessionStorage — cannot restore SA session.");
      }

      // Fallback: clean up everything, sign out, and tell the user clearly
      clearOrderFlowKeys();
      try { await supabase.auth.signOut(); } catch (_) { /* ignore */ }

      showPopup({
        title: "Order Placed",
        message: "Your order was saved successfully. Please log in again to return to the dashboard.",
        type: "info",
        confirmText: "Ok",
        onConfirm: () => navigate("/login", { replace: true }),
      });
    } catch (e) {
      console.error("Logout restore error", e);
      sessionStorage.removeItem("associateSession");
      sessionStorage.removeItem("returnToAssociate");
      sessionStorage.removeItem("returnDashboard");
      try { await supabase.auth.signOut(); } catch (_) { /* ignore */ }
      navigate("/login", { replace: true });
    } finally {
      setRestoring(false);
    }
  };

  if (!order) {
    return (
      <div className="order-placed-bg">
        {PopupComponent}
        <div className="order-placed-card">
          <h2>No order data found</h2>
          <button className="op-btn op-btn-primary" onClick={handleBackToDashboard} disabled={restoring}>
            {restoring ? "Restoring..." : "Back to Dashboard"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="order-placed-bg">
      {PopupComponent}
      {/* Confetti Animation */}
      {/* {showConfetti && (
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
      )} */}

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
        <h1 className="success-title">Your Order is Confirmed</h1>
        <p className="success-subtitle">
          Thank you for choosing Sheetal Batra. Your order has been successfully placed and is being thoughtfully crafted
        </p>

        {/* Order ID Box */}
        <div className="order-id-box">
          <span className="order-id-label">Order ID</span>
          <span className="order-id-value">#{order.order_no}</span>
        </div>

        {/* Back to Dashboard Button */}
        <button className="op-btn op-btn-primary" onClick={handleBackToDashboard} disabled={restoring}>
          {restoring ? "Restoring..." : "Return to Dashboard"}
        </button>
      </div>
    </div>
  );
}