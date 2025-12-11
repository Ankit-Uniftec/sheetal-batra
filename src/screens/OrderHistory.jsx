import React, { useEffect, useState, useMemo } from "react";
import "./OrderHistory.css";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";
import { useNavigate } from "react-router-dom";
import Logo from "../images/logo.png";
export default function OrderHistory() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [orders, setOrders] = useState([]);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState("orders"); // "orders" | "measurements" | "profile"

  // --- helpers ---
  const publicImageUrl = (src) => {
    if (!src) return "/placeholder.png";
    // already a full URL?
    if (/^https?:\/\//i.test(src)) return src;

    // try common buckets; adjust names if your bucket differs
    const buckets = ["product-images", "images", "public"];
    for (const b of buckets) {
      const { data } = supabase.storage.from(b).getPublicUrl(src);
      if (data?.publicUrl) return data.publicUrl;
    }
    return "/placeholder.png";
  };

  // derive a small “recent orders” list for the sidebar
  const recent = useMemo(() => orders.slice(0, 2), [orders]);

  // redirect back to associate if this customer logs out
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session?.user) {
        setLoading(false);
        navigate("/AssociateDashboard", { replace: true });
      }
    });
    return () => sub?.subscription?.unsubscribe?.();
  }, [navigate]);

  useEffect(() => {
    if (!user) {
      setOrders([]);
      setProfile(null);
      setLoading(false);
      return;
    }
    (async () => {
      setLoading(true);

      const [{ data: oData, error: oErr }, { data: pData, error: pErr }] =
        await Promise.all([
          supabase
            .from("orders")
            .select("*")
            .eq("user_id", user.id)
            .order("created_at", { ascending: false }),
          supabase.from("profiles").select("*").eq("id", user.id).single(),
        ]);

      if (oErr) console.error("Order fetch error:", oErr);
      if (pErr) console.error("Profile fetch error:", pErr);

      setOrders(oData || []);
      setProfile(pData || null);
      setLoading(false);
    })();
  }, [user]);

  const goToOrderDetails = (order) => {
    navigate("/orderDetails", { state: { order } });
  };

  const handleLogout = async () => {
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
          sessionStorage.removeItem("associateSession");
          sessionStorage.removeItem("returnToAssociate");
          navigate("/AssociateDashboard", { replace: true });
          return;
        }
      }
      navigate("/login", { replace: true });
    } catch (e) {
      console.error("Logout restore error", e);
      navigate("/login", { replace: true });
    }
  };

  const statusBadge = (status) =>
    status === "complete" ? "complete" : "active"; // default to Active

  if (loading && user) return <p className="loading">Loading...</p>;

  return (
    <div className="order-history-page">
      {/* header */}
      <div className="oh-header">
        <button className="back-btn" onClick={() => navigate(-1)}>←</button>
        <img src={Logo} alt="logo" className="oh-logo" />
        <button className="share-btn" onClick={handleLogout}>Logout</button>
      </div>

      {/* main two-column layout */}
      <div className="oh-layout">
        {/* LEFT SIDEBAR */}
        <aside className="oh-sidebar">
          <div className="sb-card">
            <div className="sb-card-head">
              <span>Recent Orders</span>
              <button className="view-all">View All</button>
            </div>
            {recent.length === 0 && <p className="muted">No orders yet.</p>}
            {recent.map((o) => (
              <div className="recent-row" key={o.id}>
                <div className="progress-ring">40%</div>
                <div className="recent-meta">
                  <div className="small">Order No.</div>
                  <div className="muted">Status: {o.status || "—"}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="sb-card">
            <div className="sb-card-head"><span>Loyalty Points</span></div>
            <div className="muted">Coming soon</div>
          </div>

          <div className="sb-card">
            <div className="sb-card-head">
              <span>Offers & Discounts</span>
              <button className="view-all">View All</button>
            </div>
            <div className="muted">No active offers.</div>
          </div>
        </aside>

        {/* RIGHT CONTENT */}
        <section className="oh-content">
          {/* tabs */}
          <div className="tabs">
            <button
              className={`tab ${tab === "orders" ? "active" : ""}`}
              onClick={() => setTab("orders")}
            >
              Order History
            </button>
            <button
              className={`tab ${tab === "measurements" ? "active" : ""}`}
              onClick={() => setTab("measurements")}
            >
              Measurements
            </button>
            <button
              className={`tab ${tab === "profile" ? "active" : ""}`}
              onClick={() => setTab("profile")}
            >
              Personal Details
            </button>
          </div>

          {/* tab panels */}
          {tab === "orders" && (
            <div className="oh-card-stack">
              {(!user || orders.length === 0) && (
                <p className="no-order">No orders placed yet.</p>
              )}

              {orders.map((order) => {
                const item = order.items?.[0] || {};
                const imgSrc = publicImageUrl(item.image_url);
                const flagClass =
                  order.order_flag?.toLowerCase() === "urgent"
                    ? "flag-urgent"
                    : "flag-medium";

                return (
                  <div key={order.id} className="order-card">
                    {/* ACTIVE / COMPLETE badge */}
                    <div className={`state-badge ${statusBadge(order.status)}`}>
                      {statusBadge(order.status) === "active" ? "Active" : "Complete"}
                    </div>

                    <div className="order-row">
                      <div className="thumb">
                        <img src={imgSrc} alt={item.product_name || "Product"} />
                      </div>

                      <div className="details">
                        <div className="row space">
                          <div className="kv">
                            <div className="small muted">Order No.</div>
                            <div>#{order.id}</div>
                          </div>
                          <div className="kv">
                            <div className="small muted">Order Date</div>
                            <div>{order.created_at?.split("T")[0]}</div>
                          </div>
                          <div className="kv">
                            <div className="small muted">EDD</div>
                            <div>{order.delivery_date || "—"}</div>
                          </div>

                          {/* flag */}
                          {/* <span className={`flag ${flagClass}`}>
                            {order.order_flag || "—"}
                          </span> */}
                        </div>

                        <div className="grid-2">
                          <div className="kv">
                            <div className="label">Product Name</div>
                            <div className="value">{item.product_name || "—"}</div>
                          </div>
                          <div className="kv">
                            <div className="label">Amount</div>
                            <div className="value">₹{order.grand_total ?? "—"}</div>
                          </div>
                          <div className="kv">
                            <div className="label">Qty</div>
                            <div className="value">{order.total_quantity ?? "—"}</div>
                          </div>
                          <div className="kv">
                            <div className="label">Color</div>
                            <div className="value"><div style={{
                                background: item.color,
                                height: "15px",
                                width: "30px",
                                borderRadius: "14px",
                                marginBottom: "5px",}}></div>{item.color || "—"}</div>
                          </div>
                          <div className="kv">
                            <div className="label">Size</div>
                            <div className="value">{item.size || "—"}</div>
                          </div>
                          <div className="kv">
                            <div className="label">SA</div>
                            <div className="value">
                              {order.salesperson || "-"}{" "}
                              {order.salesperson_phone
                                ? `(${order.salesperson_phone})`
                                : ""}
                            </div>
                          </div>
                        </div>

                        {/* <button
                          className="view-btn"
                          onClick={() => goToOrderDetails(order)}
                        >
                          View order details
                        </button> */}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {tab === "measurements" && (
            <div className="placeholder-card">
              <p>Measurements module coming soon.</p>
            </div>
          )}

          {tab === "profile" && (
            <div className="profile-card">
              <h3>Personal Details</h3>
              {!profile && <p className="muted">No profile found.</p>}
              {profile && (
                <div className="profile-grid">
                  <div><strong>Name:</strong> {profile.full_name || "—"}</div>
                  <div><strong>Gender:</strong> {profile.gender || "—"}</div>
                  <div><strong>Phone:</strong> {profile.phone || "—"}</div>
                  <div><strong>Email:</strong> {profile.email || "—"}</div>
                  <div><strong>DOB:</strong> {profile.dob || "—"}</div>
                  <div><strong>Address:</strong> {profile.address || "—"}</div>
                  <div><strong>City:</strong> {profile.city || "—"}</div>
                  <div><strong>State:</strong> {profile.state || "—"}</div>
                  <div><strong>Pincode:</strong> {profile.pincode || "—"}</div>
                  <div><strong>Joined:</strong> {profile.created_at?.split("T")[0] || "—"}</div>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
