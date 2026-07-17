import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { fetchAllRows } from "../utils/fetchAllRows";
import { COUNTRY_CODES, SOURCE_OPTIONS } from "../utils/countryCodes";
import {
  buildOrderPhoneSet,
  isAutoConverted,
  effectiveConverted,
  conversionSource,
  reconcileConversions,
  setManualConversion,
} from "../utils/walkinConversion";
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

  // Conversion tracking. orderPhoneSet = normalized delivery_phones across ALL
  // orders (any SA), used to auto-detect whether a walk-in later ordered.
  const [orderPhoneSet, setOrderPhoneSet] = useState(() => new Set());
  const [convFilter, setConvFilter] = useState("all"); // all | converted | not_converted
  const [togglingId, setTogglingId] = useState(null);

  // Form state
  const [name, setName] = useState("");
  const [countryCode, setCountryCode] = useState("+91");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [source, setSource] = useState("");

  // Custom country dropdown open state (native select renders flag emoji
  // unreliably across OSes, so we use our own dropdown).
  const [ccOpen, setCcOpen] = useState(false);
  const [ccQuery, setCcQuery] = useState("");
  const selectedCountry = COUNTRY_CODES.find((c) => c.code === countryCode) || COUNTRY_CODES[0];
  // Filter by country name or dial code (with or without the leading "+").
  const ccQ = ccQuery.trim().toLowerCase().replace(/^\+/, "");
  const ccFiltered = ccQ
    ? COUNTRY_CODES.filter(
        (c) => c.label.toLowerCase().includes(ccQ) || c.code.replace("+", "").startsWith(ccQ)
      )
    : COUNTRY_CODES;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!saEmail) { setLoading(false); return; }
      // Load this SA's walk-ins and the phone column of ALL orders in parallel.
      // Conversion counts an order from any SA (the client may return on a
      // different SA's shift), so the order query is NOT scoped to saEmail.
      const [walkinsRes, ordersRes] = await Promise.all([
        // Paged past Supabase's 1000-row cap
        fetchAllRows("walkins", (q) => q
          .select("*")
          .eq("sa_email", saEmail.toLowerCase())
          .order("created_at", { ascending: false })),
        // Paged past Supabase's 1000-row cap — conversion matching saw only the newest 1000 phones.
        fetchAllRows("orders", (q) => q.select("delivery_phone")),
      ]);
      if (cancelled) return;

      const phoneSet = buildOrderPhoneSet(ordersRes.data || []);
      setOrderPhoneSet(phoneSet);

      // Reconcile auto-matches with the DB, then show the corrected list.
      const reconciled = await reconcileConversions(walkinsRes.data || [], phoneSet);
      if (cancelled) return;
      setWalkins(reconciled);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [saEmail]);

  // Apply the conversion filter to the loaded walk-ins.
  const visibleWalkins = useMemo(() => {
    if (convFilter === "all") return walkins;
    const want = convFilter === "converted";
    return walkins.filter((w) => effectiveConverted(w, orderPhoneSet) === want);
  }, [walkins, convFilter, orderPhoneSet]);

  const convertedCount = useMemo(
    () => walkins.filter((w) => effectiveConverted(w, orderPhoneSet)).length,
    [walkins, orderPhoneSet]
  );

  // Manual override toggle. Cycles the effective status: clicking flips it and
  // pins a manual override so it sticks even against auto-detection.
  const handleToggleConverted = async (w) => {
    const auto = isAutoConverted(w, orderPhoneSet);
    const currentlyConverted = effectiveConverted(w, orderPhoneSet);
    // New manual value = opposite of current effective. If that equals the auto
    // result, clear the override (null) so it tracks auto going forward.
    const desired = !currentlyConverted;
    const nextManual = desired === auto ? null : desired;
    setTogglingId(w.id);
    try {
      const patch = await setManualConversion(w.id, nextManual, auto);
      setWalkins((prev) => prev.map((x) => (x.id === w.id ? { ...x, ...patch } : x)));
    } catch (err) {
      showPopup?.({ title: "Update failed", message: err.message || "Could not update conversion status.", type: "error", confirmText: "OK" });
    } finally {
      setTogglingId(null);
    }
  };

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
        <h2 className="ad-order-title" style={{ margin: 0 }}>
          Walk-In ({walkins.length})
          {walkins.length > 0 && (
            <span className="wi-converted-summary"> · {convertedCount} converted</span>
          )}
        </h2>
        <button className="wi-add-btn" onClick={openForm}>+ Add Walk-In</button>
      </div>

      {/* ─── Conversion filter ─── */}
      {!loading && walkins.length > 0 && (
        <div className="wi-filter-row">
          {[
            { key: "all", label: "All" },
            { key: "converted", label: "Converted" },
            { key: "not_converted", label: "Not Converted" },
          ].map((opt) => (
            <button
              key={opt.key}
              className={`wi-filter-chip ${convFilter === opt.key ? "active" : ""}`}
              onClick={() => setConvFilter(opt.key)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      {/* ─── This SA's walk-ins ─── */}
      {loading ? (
        <p className="ad-loading-text">Loading walk-ins…</p>
      ) : walkins.length === 0 ? (
        <p className="wi-empty">No walk-ins recorded yet. Click "+ Add Walk-In" to register a visit.</p>
      ) : visibleWalkins.length === 0 ? (
        <p className="wi-empty">No walk-ins match this filter.</p>
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
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {visibleWalkins.map((w) => {
                const converted = effectiveConverted(w, orderPhoneSet);
                const src = conversionSource(w);
                return (
                  <tr key={w.id}>
                    <td>{formatDateTime(w.created_at)}</td>
                    <td>{w.name || "—"}</td>
                    <td>{w.country_code} {w.phone}</td>
                    <td>{w.email || "—"}</td>
                    <td>{w.source || "—"}</td>
                    <td>
                      <div className="wi-status-cell">
                        <span className={`wi-status-badge ${converted ? "converted" : "not-converted"}`}>
                          {converted ? "Converted" : "Not Converted"}
                        </span>
                        <span className="wi-status-src">{src === "manual" ? "manual" : "auto"}</span>
                        <button
                          className="wi-status-toggle"
                          onClick={() => handleToggleConverted(w)}
                          disabled={togglingId === w.id}
                          title={converted ? "Mark as not converted" : "Mark as converted"}
                        >
                          {togglingId === w.id ? "…" : converted ? "Unset" : "Mark converted"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
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
                      onClick={() => { setCcOpen((v) => !v); setCcQuery(""); }}
                    >
                      <span className="wi-cc-flag">{selectedCountry.flag}</span>
                      <span className="wi-cc-code">{selectedCountry.code}</span>
                      <span className="wi-cc-chevron">▾</span>
                    </button>
                    {ccOpen && (
                      <>
                        <div className="wi-cc-backdrop" onClick={() => { setCcOpen(false); setCcQuery(""); }} />
                        <div className="wi-cc-menu">
                          <input
                            className="wi-cc-search"
                            placeholder="Search country…"
                            value={ccQuery}
                            autoFocus
                            onChange={(e) => setCcQuery(e.target.value)}
                          />
                          <ul className="wi-cc-list">
                            {ccFiltered.length === 0 && (
                              <li className="wi-cc-empty">No matches</li>
                            )}
                            {ccFiltered.map((c) => (
                              <li
                                key={c.code}
                                className={`wi-cc-option ${c.code === countryCode ? "selected" : ""}`}
                                onClick={() => { setCountryCode(c.code); setCcOpen(false); setCcQuery(""); }}
                              >
                                <span className="wi-cc-flag">{c.flag}</span>
                                <span className="wi-cc-label">{c.label}</span>
                                <span className="wi-cc-code">{c.code}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
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
