import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import "./CommsOrderForm.css";
import Logo from "../../images/logo.png";
import { usePopup } from "../../components/Popup";

/**
 * CommsOrderForm — first screen of the comms order flow.
 *
 * Flow: CommsDashboard → CommsOrderForm → ProductForm (with isCommsOrder) → CommsReviewOrder → OrderPlaced
 *
 * Captures all comms-specific fields:
 *   - Request Source (Individual / Agency)
 *   - Profile Type (when Individual) / Agency Name (when Agency)
 *   - Engagement Type (Barter / Gifting / Sourcing / Personal order)
 *   - Purpose of Request
 *   - Name + POC + Contact + Email
 *   - Delivery Date, Outfit Return Date (sourcing only)
 *   - Order Assign (production owner)
 *   - Existing Product Location (sourcing / barter only)
 *
 * On submit, saves the form data to sessionStorage and navigates to /product
 * with isCommsOrder flag, so ProductForm reuses its existing logic.
 */

const AGENCY_OPTIONS = [
  "Vanda",
  "Stanley",
  "Contemporary Connect (UAE PR)",
  "Stilt Communication",
  "Others",
];

const PURPOSE_OPTIONS = [
  "Ganesh Chaturthi",
  "Mother's day",
  "Holi",
  "Diwali",
  "Ganpati",
  "Raksha Bandhan",
  "Karwa chauth",
  "Republic day",
  "Eid",
  "Summer gifting",
  "Others",
];

const ORDER_ASSIGN_OPTIONS = [
  { name: "Manish Batra", email: "manish@alliedengineering.net.in" },
  { name: "Khushnuma Khan", email: "productionoffline1@gmail.com" },
];

const LOCATION_OPTIONS = [
  "N/A",
  "Delhi store",
  "Ludhiana store",
  "Delhi WH (1)",
  "Delhi WH (2)",
  "Consignment",
  "Others",
];

const SESSION_KEY = "commsOrderFormData";

export default function CommsOrderForm() {
  const navigate = useNavigate();
  const { showPopup, PopupComponent } = usePopup();

  // Auth state — must be a comms user
  const [profile, setProfile] = useState(null);
  const [loadingAuth, setLoadingAuth] = useState(true);

  // Form fields
  const [requestSource, setRequestSource] = useState(""); // 'Individual' | 'Agency'
  const [profileType, setProfileType] = useState("");    // when Individual
  const [agencyName, setAgencyName] = useState("");      // when Agency, from AGENCY_OPTIONS
  const [agencyOther, setAgencyOther] = useState("");    // when agencyName === 'Others'
  const [engagementType, setEngagementType] = useState(""); // 'Barter' | 'Gifting' | 'Sourcing' | 'Personal order'
  const [purpose, setPurpose] = useState("");
  const [purposeOther, setPurposeOther] = useState("");
  const [clientName, setClientName] = useState("");
  const [pocName, setPocName] = useState("");
  const [contact, setContact] = useState("");
  const [email, setEmail] = useState("");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [outfitReturnDate, setOutfitReturnDate] = useState(""); // sourcing only
  const [orderAssign, setOrderAssign] = useState(""); // production email
  const [existingProductLocation, setExistingProductLocation] = useState(""); // sourcing/barter
  const [existingProductLocationOther, setExistingProductLocationOther] = useState("");

  // Today's date for the Order Date field (read-only)
  const todayISO = new Date().toISOString().slice(0, 10);

  // ─── Auth guard ───
  useEffect(() => {
    let cancelled = false;
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { navigate("/login", { replace: true }); return; }

      const { data: sp } = await supabase
        .from("salesperson")
        .select("email, role, saleperson, phone, designation")
        .eq("email", session.user.email?.toLowerCase())
        .maybeSingle();

      if (cancelled) return;
      if (!sp || sp.role !== "comms") {
        await supabase.auth.signOut();
        navigate("/login", { replace: true });
        return;
      }
      setProfile(sp);
      setLoadingAuth(false);
    };
    checkAuth();
    return () => { cancelled = true; };
  }, [navigate]);

  // ─── Restore session-saved form data (for back-navigation) ───
  useEffect(() => {
    const saved = sessionStorage.getItem(SESSION_KEY);
    if (!saved) return;
    try {
      const d = JSON.parse(saved);
      if (d.requestSource) setRequestSource(d.requestSource);
      if (d.profileType) setProfileType(d.profileType);
      if (d.agencyName) setAgencyName(d.agencyName);
      if (d.agencyOther) setAgencyOther(d.agencyOther);
      if (d.engagementType) setEngagementType(d.engagementType);
      if (d.purpose) setPurpose(d.purpose);
      if (d.purposeOther) setPurposeOther(d.purposeOther);
      if (d.clientName) setClientName(d.clientName);
      if (d.pocName) setPocName(d.pocName);
      if (d.contact) setContact(d.contact);
      if (d.email) setEmail(d.email);
      if (d.deliveryDate) setDeliveryDate(d.deliveryDate);
      if (d.outfitReturnDate) setOutfitReturnDate(d.outfitReturnDate);
      if (d.orderAssign) setOrderAssign(d.orderAssign);
      if (d.existingProductLocation) setExistingProductLocation(d.existingProductLocation);
      if (d.existingProductLocationOther) setExistingProductLocationOther(d.existingProductLocationOther);
    } catch (e) { /* ignore parse errors */ }
  }, []);

  // ─── Save form data to sessionStorage on every change ───
  useEffect(() => {
    const data = {
      requestSource, profileType, agencyName, agencyOther,
      engagementType, purpose, purposeOther,
      clientName, pocName, contact, email,
      deliveryDate, outfitReturnDate, orderAssign,
      existingProductLocation, existingProductLocationOther,
    };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(data));
  }, [
    requestSource, profileType, agencyName, agencyOther,
    engagementType, purpose, purposeOther,
    clientName, pocName, contact, email,
    deliveryDate, outfitReturnDate, orderAssign,
    existingProductLocation, existingProductLocationOther,
  ]);

  // Conditional visibility helpers
  const isIndividual = requestSource === "Individual";
  const isAgency = requestSource === "Agency";
  const isSourcing = engagementType === "Sourcing";
  const isBarterOrSourcing = engagementType === "Barter" || engagementType === "Sourcing";
  const showAgencyOther = isAgency && agencyName === "Others";
  const showPurposeOther = purpose === "Others";
  const showLocationOther = isBarterOrSourcing && existingProductLocation === "Others";

  // ─── Submit / Next ───
  const handleNext = () => {
    // Required-field validation
    const missing = [];
    if (!requestSource) missing.push("Request Source");
    if (isIndividual && !profileType) missing.push("Profile Type");
    if (isAgency && !agencyName) missing.push("Agency Name");
    if (showAgencyOther && !agencyOther.trim()) missing.push("Agency Name (custom)");
    if (!engagementType) missing.push("Engagement Type");
    if (!purpose) missing.push("Purpose of Request");
    if (showPurposeOther && !purposeOther.trim()) missing.push("Purpose (custom)");
    if (!clientName.trim()) missing.push("Name");
    if (!contact.trim()) missing.push("Contact");
    if (!deliveryDate) missing.push("Delivery Date");
    if (isSourcing && !outfitReturnDate) missing.push("Outfit Return Date");
    if (isBarterOrSourcing && !existingProductLocation) missing.push("Existing Product Location");
    if (showLocationOther && !existingProductLocationOther.trim()) missing.push("Existing Product Location (custom)");

    if (missing.length > 0) {
      showPopup({
        title: "Required fields missing",
        message: `Please fill: ${missing.join(", ")}.`,
        type: "warning",
        confirmText: "Ok",
      });
      return;
    }

    // Final outfit-return-date sanity check (must be on or after delivery date)
    if (isSourcing && outfitReturnDate < deliveryDate) {
      showPopup({
        title: "Invalid return date",
        message: "Outfit Return Date must be on or after Delivery Date.",
        type: "warning",
        confirmText: "Ok",
      });
      return;
    }

    // Resolve the final agency / purpose / location strings (use 'Others' free text where applicable)
    const finalAgencyName = isAgency
      ? (agencyName === "Others" ? agencyOther.trim() : agencyName)
      : null;
    const finalPurpose = purpose === "Others" ? purposeOther.trim() : purpose;
    const finalLocation = isBarterOrSourcing
      ? (existingProductLocation === "Others" ? existingProductLocationOther.trim() : existingProductLocation)
      : null;

    // Save comms-specific payload alongside the standard order session.
    // ProductForm → CommsReviewOrder will consume this on placement.
    const commsPayload = {
      is_comms: true,
      comms_request_source: requestSource,
      comms_profile_type: isIndividual ? profileType : null,
      comms_agency_name: finalAgencyName,
      comms_engagement_type: engagementType,
      comms_purpose: finalPurpose,
      comms_poc_name: pocName.trim() || null,
      comms_outfit_return_date: isSourcing ? outfitReturnDate : null,
      comms_order_assign: orderAssign || null,
      comms_existing_product_location: finalLocation,
      // Client identity fields (mirror the existing order/profile shape so
      // CommsReviewOrder can write them into the orders row directly).
      delivery_name: clientName.trim(),
      delivery_phone: contact.trim(),
      delivery_email: email.trim() || null,
      delivery_date: deliveryDate,
    };
    sessionStorage.setItem("commsOrderPayload", JSON.stringify(commsPayload));

    // Mirror the SA flow's currentSalesperson — comms placer is Nazreen herself.
    // Also seed associateSession so OrderPlaced's session-restore logic doesn't bail.
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        sessionStorage.setItem("associateSession", JSON.stringify({
          access_token: session.access_token,
          refresh_token: session.refresh_token,
          user: { email: session.user?.email },
        }));
      }
      sessionStorage.setItem("currentSalesperson", JSON.stringify({
        name: profile.saleperson,
        email: profile.email,
        phone: profile.phone,
        store: "COMMS", // marker, not a real store — comms orders carry this
        designation: profile.designation,
      }));
      sessionStorage.setItem("returnDashboard", "/comms-dashboard");
      sessionStorage.setItem("isCommsOrder", "true");
      // Make sure no leftover stock-order flag misroutes ProductForm.
      sessionStorage.removeItem("isStockOrder");

      navigate("/product", { state: { fromAssociate: true, isCommsOrder: true } });
    })();
  };

  const handleCancel = () => {
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem("commsOrderPayload");
    sessionStorage.removeItem("isCommsOrder");
    navigate("/comms-dashboard", { replace: true });
  };

  if (loadingAuth) return <div className="cof-loading">Loading…</div>;

  return (
    <div className="cof-page">
      {PopupComponent}

      <header className="cof-header">
        <img src={Logo} alt="Sheetal Batra" className="cof-logo" />
        <h1 className="cof-title">New Comms Order</h1>
        <button className="cof-cancel-link" onClick={handleCancel}>← Back to Dashboard</button>
      </header>

      <main className="cof-main">
        <h2 className="cof-section-title">Order Details</h2>
        <p className="cof-muted">Step 1 of 3 — Capture the request context before selecting products.</p>

        <div className="cof-grid">
          {/* Row 1: Request Source + (Profile Type | Agency Name) */}
          <div className="cof-field">
            <label className="cof-label">Request Source <span className="cof-req">*</span></label>
            <select className="cof-input" value={requestSource} onChange={(e) => {
              setRequestSource(e.target.value);
              // Reset cross-field state when source flips
              setProfileType("");
              setAgencyName("");
              setAgencyOther("");
            }}>
              <option value="">Select…</option>
              <option value="Individual">Individual</option>
              <option value="Agency">Agency</option>
            </select>
          </div>

          {isIndividual && (
            <div className="cof-field">
              <label className="cof-label">Profile Type <span className="cof-req">*</span></label>
              <select className="cof-input" value={profileType} onChange={(e) => setProfileType(e.target.value)}>
                <option value="">Select…</option>
                <option value="Celebrity">Celebrity</option>
                <option value="Influencer">Influencer</option>
                <option value="Stylist">Stylist</option>
              </select>
            </div>
          )}

          {isAgency && (
            <div className="cof-field">
              <label className="cof-label">Agency Name <span className="cof-req">*</span></label>
              <select className="cof-input" value={agencyName} onChange={(e) => setAgencyName(e.target.value)}>
                <option value="">Select…</option>
                {AGENCY_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
              {showAgencyOther && (
                <input
                  type="text"
                  className="cof-input"
                  style={{ marginTop: 8 }}
                  placeholder="Specify agency name"
                  value={agencyOther}
                  onChange={(e) => setAgencyOther(e.target.value)}
                />
              )}
            </div>
          )}

          {/* Row 2: Engagement + Purpose */}
          <div className="cof-field">
            <label className="cof-label">Engagement Type <span className="cof-req">*</span></label>
            <select className="cof-input" value={engagementType} onChange={(e) => {
              setEngagementType(e.target.value);
              // Sourcing-only / barter-only fields reset when engagement flips
              if (e.target.value !== "Sourcing") setOutfitReturnDate("");
              if (e.target.value !== "Barter" && e.target.value !== "Sourcing") {
                setExistingProductLocation("");
                setExistingProductLocationOther("");
              }
            }}>
              <option value="">Select…</option>
              <option value="Barter">Barter</option>
              <option value="Gifting">Gifting</option>
              <option value="Sourcing">Sourcing</option>
              <option value="Personal order">Personal order</option>
            </select>
          </div>

          <div className="cof-field">
            <label className="cof-label">Purpose of Request <span className="cof-req">*</span></label>
            <select className="cof-input" value={purpose} onChange={(e) => setPurpose(e.target.value)}>
              <option value="">Select…</option>
              {PURPOSE_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            {showPurposeOther && (
              <input
                type="text"
                className="cof-input"
                style={{ marginTop: 8 }}
                placeholder="Specify purpose"
                value={purposeOther}
                onChange={(e) => setPurposeOther(e.target.value)}
              />
            )}
          </div>

          {/* Row 3: Name + POC */}
          <div className="cof-field">
            <label className="cof-label">Name <span className="cof-req">*</span></label>
            <input type="text" className="cof-input" placeholder="Client / celebrity name"
              value={clientName} onChange={(e) => setClientName(e.target.value)} />
          </div>

          <div className="cof-field">
            <label className="cof-label">POC Name</label>
            <input type="text" className="cof-input" placeholder="Point of contact"
              value={pocName} onChange={(e) => setPocName(e.target.value)} />
          </div>

          {/* Row 4: Contact + Email */}
          <div className="cof-field">
            <label className="cof-label">Contact <span className="cof-req">*</span></label>
            <input type="tel" className="cof-input" placeholder="Phone number"
              value={contact} onChange={(e) => setContact(e.target.value)} />
          </div>

          <div className="cof-field">
            <label className="cof-label">E-mail ID</label>
            <input type="email" className="cof-input" placeholder="email@example.com"
              value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>

          {/* Row 5: Order Date (read-only) + Delivery Date */}
          <div className="cof-field">
            <label className="cof-label">Order Date</label>
            <input type="date" className="cof-input" value={todayISO} readOnly disabled />
          </div>

          <div className="cof-field">
            <label className="cof-label">Delivery Date <span className="cof-req">*</span></label>
            <input type="date" className="cof-input" min={todayISO}
              value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} />
          </div>

          {/* Row 6: Outfit Return Date (sourcing only) */}
          {isSourcing && (
            <div className="cof-field">
              <label className="cof-label">Outfit Return Date <span className="cof-req">*</span></label>
              <input type="date" className="cof-input" min={deliveryDate || todayISO}
                value={outfitReturnDate} onChange={(e) => setOutfitReturnDate(e.target.value)} />
            </div>
          )}

          {/* Row 7: Order Assign */}
          <div className="cof-field">
            <label className="cof-label">Order Assign</label>
            <select className="cof-input" value={orderAssign} onChange={(e) => setOrderAssign(e.target.value)}>
              <option value="">Select production owner…</option>
              {ORDER_ASSIGN_OPTIONS.map((p) => (
                <option key={p.email} value={p.email}>{p.name}</option>
              ))}
            </select>
          </div>

          {/* Row 8: Existing Product Location (sourcing/barter only) */}
          {isBarterOrSourcing && (
            <div className="cof-field">
              <label className="cof-label">Existing Product Location <span className="cof-req">*</span></label>
              <select className="cof-input" value={existingProductLocation}
                onChange={(e) => setExistingProductLocation(e.target.value)}>
                <option value="">Select location…</option>
                {LOCATION_OPTIONS.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
              {showLocationOther && (
                <input
                  type="text"
                  className="cof-input"
                  style={{ marginTop: 8 }}
                  placeholder="Specify location"
                  value={existingProductLocationOther}
                  onChange={(e) => setExistingProductLocationOther(e.target.value)}
                />
              )}
            </div>
          )}
        </div>

        <div className="cof-actions">
          <button className="cof-btn-secondary" onClick={handleCancel}>Cancel</button>
          <button className="cof-btn-primary" onClick={handleNext}>Next: Select Products →</button>
        </div>
      </main>
    </div>
  );
}
