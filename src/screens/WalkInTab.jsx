import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { COUNTRY_CODES, SOURCE_OPTIONS } from "../utils/countryCodes";
import "./WalkInTab.css";

const formatDateTime = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d)) return "—";
  return d.toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
};

// saEmail = the logged-in SA's email; walk-ins are scoped to this value.
export default function WalkInTab({ saEmail, showPopup }) {
  const [walkins, setWalkins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showForm, setShowForm] = useState(false);

  // Form state
  const [name, setName] = useState("");
  const [countryCode, setCountryCode] = useState("+91");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [source, setSource] = useState("");

  // Custom country dropdown open state (native select renders flag emoji
  // unreliably across OSes, so we use our own dropdown).
  const [ccOpen, setCcOpen] = useState(false);
  const selectedCountry = COUNTRY_CODES.find((c) => c.code === countryCode) || COUNTRY_CODES[0];

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!saEmail) { setLoading(false); return; }
      const { data } = await supabase
        .from("walkins")
        .select("*")
        .eq("sa_email", saEmail.toLowerCase())
        .order("created_at", { ascending: false });
      if (cancelled) return;
      setWalkins(data || []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [saEmail]);

  const phoneDigits = useMemo(() => phone.replace(/\D/g, ""), [phone]);

  const resetForm = () => {
    setName(""); setCountryCode("+91"); setPhone(""); setEmail(""); setSource("");
  };

  const openForm = () => { resetForm(); setShowForm(true); };
  const closeForm = () => { if (!submitting) setShowForm(false); };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) {
      showPopup?.({ title: "Name required", message: "Please enter the visitor's name.", type: "warning", confirmText: "OK" });
      return;
    }
    if (phoneDigits.length < 6) {
      showPopup?.({ title: "Phone required", message: "Please enter a valid phone number.", type: "warning", confirmText: "OK" });
      return;
    }
    if (!source) {
      showPopup?.({ title: "Source required", message: "Please select how they heard about us.", type: "warning", confirmText: "OK" });
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        sa_email: saEmail.toLowerCase(),
        name: name.trim(),
        country_code: countryCode,
        phone: phoneDigits,
        email: email.trim() || null,
        source: source,
      };
      const { data, error } = await supabase
        .from("walkins")
        .insert(payload)
        .select()
        .single();
      if (error) throw error;
      setWalkins((prev) => [data, ...prev]);
      setShowForm(false);
      resetForm();
      showPopup?.({ title: "Visit Registered", message: "Walk-in recorded successfully.", type: "success", confirmText: "OK" });
    } catch (err) {
      console.error("Walk-in save failed:", err);
      showPopup?.({ title: "Failed", message: err.message || "Could not save the walk-in.", type: "error", confirmText: "OK" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="ad-order-details-wrapper">
      <div className="wi-header">
        <h2 className="ad-order-title" style={{ margin: 0 }}>Walk-In ({walkins.length})</h2>
        <button className="wi-add-btn" onClick={openForm}>+ Add Walk-In</button>
      </div>

      {/* ─── This SA's walk-ins ─── */}
      {loading ? (
        <p className="ad-loading-text">Loading walk-ins…</p>
      ) : walkins.length === 0 ? (
        <p className="wi-empty">No walk-ins recorded yet. Click "+ Add Walk-In" to register a visit.</p>
      ) : (
        <div className="wi-table-wrapper">
          <table className="wi-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Name</th>
                <th>Phone</th>
                <th>Email</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {walkins.map((w) => (
                <tr key={w.id}>
                  <td>{formatDateTime(w.created_at)}</td>
                  <td>{w.name || "—"}</td>
                  <td>{w.country_code} {w.phone}</td>
                  <td>{w.email || "—"}</td>
                  <td>{w.source || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ─── Add Walk-In modal ─── */}
      {showForm && (
        <div className="wi-overlay" onClick={closeForm}>
          <div className="wi-modal" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="wi-modal-close" onClick={closeForm} aria-label="Close">×</button>
            <h3 className="wi-modal-title">Register Walk-In Visit</h3>

            <form className="wi-form" onSubmit={handleSubmit}>
              <div className="wi-field">
                <label>Your Name <span className="wi-req">*</span></label>
                <input
                  type="text"
                  placeholder="Full name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                />
              </div>

              <div className="wi-field">
                <label>Phone Number <span className="wi-req">*</span></label>
                <div className="wi-phone-row">
                  <div className="wi-cc">
                    <button
                      type="button"
                      className="wi-cc-trigger"
                      onClick={() => setCcOpen((v) => !v)}
                    >
                      <span className="wi-cc-flag">{selectedCountry.flag}</span>
                      <span className="wi-cc-code">{selectedCountry.code}</span>
                      <span className="wi-cc-chevron">▾</span>
                    </button>
                    {ccOpen && (
                      <>
                        <div className="wi-cc-backdrop" onClick={() => setCcOpen(false)} />
                        <ul className="wi-cc-menu">
                          {COUNTRY_CODES.map((c) => (
                            <li
                              key={c.code}
                              className={`wi-cc-option ${c.code === countryCode ? "selected" : ""}`}
                              onClick={() => { setCountryCode(c.code); setCcOpen(false); }}
                            >
                              <span className="wi-cc-flag">{c.flag}</span>
                              <span className="wi-cc-label">{c.label}</span>
                              <span className="wi-cc-code">{c.code}</span>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </div>
                  <input
                    type="tel"
                    placeholder="Enter phone number"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </div>
              </div>

              <div className="wi-field">
                <label>Email Address <span className="wi-optional">optional</span></label>
                <input
                  type="email"
                  placeholder="your@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              <div className="wi-field">
                <label>How did you hear about us? <span className="wi-req">*</span></label>
                <select value={source} onChange={(e) => setSource(e.target.value)}>
                  <option value="">Please select…</option>
                  {SOURCE_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>

              <button type="submit" className="wi-submit" disabled={submitting}>
                {submitting ? "Saving…" : "Register Visit"}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
