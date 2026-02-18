import React, { useEffect, useState, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import "./B2bVendorSelection.css";
import Logo from "../../images/logo.png";
import formatIndianNumber from "../../utils/formatIndianNumber";
import { usePopup } from "../../components/Popup";

const SESSION_KEY = "b2bVendorData";

/**
 * Searchable Select Component
 */
function SearchableSelect({ options, value, onChange, placeholder = "Select…", disabled = false, className = "" }) {
    const normalized = useMemo(() => (options || []).map((o) => typeof o === "object" && o !== null && "label" in o && "value" in o ? o : { label: String(o), value: o }), [options]);
    const current = useMemo(() => normalized.find((o) => String(o.value) === String(value)) || null, [normalized, value]);
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [focusIdx, setFocusIdx] = useState(-1);
    const rootRef = useRef(null);
    const inputRef = useRef(null);
    const listRef = useRef(null);
    const filtered = useMemo(() => { const q = query.trim().toLowerCase(); if (!q) return normalized; return normalized.filter((o) => o.label.toLowerCase().includes(q)); }, [normalized, query]);

    useEffect(() => { if (!open) { if (!value) setQuery(""); else if (current) setQuery(current.label); } }, [value, current, open]);
    useEffect(() => { const onDoc = (e) => { if (!rootRef.current?.contains(e.target)) { setOpen(false); setFocusIdx(-1); if (current) setQuery(current.label); } }; document.addEventListener("mousedown", onDoc); return () => document.removeEventListener("mousedown", onDoc); }, [current]);
    useEffect(() => { if (!open || !listRef.current || focusIdx < 0) return; const el = listRef.current.querySelector(`[data-idx="${focusIdx}"]`); if (el?.scrollIntoView) el.scrollIntoView({ block: "nearest" }); }, [focusIdx, open]);

    const handleSelect = (opt) => { onChange(opt?.value ?? ""); setOpen(false); setQuery(opt?.label ?? ""); setFocusIdx(-1); requestAnimationFrame(() => inputRef.current?.focus()); };
    const handleKeyDown = (e) => { if (!open && (e.key === "ArrowDown" || e.key === "Enter")) { setOpen(true); setFocusIdx(0); if (current) setQuery(""); return; } if (!open) return; if (e.key === "ArrowDown") { e.preventDefault(); setFocusIdx((i) => Math.min((filtered.length || 1) - 1, i + 1)); } else if (e.key === "ArrowUp") { e.preventDefault(); setFocusIdx((i) => Math.max(0, i - 1)); } else if (e.key === "Enter") { e.preventDefault(); const opt = filtered[focusIdx]; if (opt) handleSelect(opt); } else if (e.key === "Escape") { e.preventDefault(); setOpen(false); setFocusIdx(-1); if (current) setQuery(current.label); } };
    const clear = (e) => { e.stopPropagation(); onChange(""); setQuery(""); inputRef.current?.focus(); };

    return (
        <div ref={rootRef} className={`ss-root ${disabled ? "ss-disabled" : ""} ${className}`}>
            <div className={`ss-control ${open ? "ss-open" : ""}`} onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); if (disabled) return; setOpen(true); setFocusIdx(-1); requestAnimationFrame(() => inputRef.current?.focus()); }}>
                <input ref={inputRef} className="ss-input" placeholder={placeholder} value={query} onChange={(e) => { setQuery(e.target.value); if (!open) setOpen(true); setFocusIdx(0); }} onFocus={() => { if (current && query === current.label) setQuery(""); setOpen(true); }} onKeyDown={handleKeyDown} disabled={disabled} />
                {current && <button className="ss-clear" title="Clear" onClick={clear}>×</button>}
            </div>
            {open && (
                <div className="ss-menu" role="listbox">
                    {filtered.length === 0 ? <div className="ss-empty">No matches</div> : (
                        <ul ref={listRef} className="ss-list">
                            {filtered.map((opt, idx) => (
                                <li key={String(opt.value)} data-idx={idx} className={`ss-option ${String(opt.value) === String(value) ? "is-selected" : ""} ${idx === focusIdx ? "is-focused" : ""}`} onMouseEnter={() => setFocusIdx(idx)} onMouseDown={(e) => e.preventDefault()} onClick={() => handleSelect(opt)} role="option" aria-selected={String(opt.value) === String(value)}>
                                    {opt.label}
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}
        </div>
    );
}

export default function B2bVendorSelection() {
    const navigate = useNavigate();
    const { showPopup, PopupComponent } = usePopup();

    const [vendors, setVendors] = useState([]);
    const [vendorsLoading, setVendorsLoading] = useState(true);
    const [selectedVendorId, setSelectedVendorId] = useState("");
    const [selectedVendor, setSelectedVendor] = useState(null);
    const [vendorContacts, setVendorContacts] = useState([]);

    const [poNumber, setPoNumber] = useState("");
    const [merchandiser, setMerchandiser] = useState("");
    const [orderType, setOrderType] = useState("");
    const [discountPercent, setDiscountPercent] = useState(0);
    const [remarks, setRemarks] = useState("");

    const merchandisers = [
        { label: "Prastuti", value: "Prastuti" },
        { label: "Sharia", value: "Sharia" },
    ];

    // Restore from session
    useEffect(() => {
        const saved = sessionStorage.getItem(SESSION_KEY);
        if (saved) {
            try {
                const data = JSON.parse(saved);
                if (data.selectedVendorId) setSelectedVendorId(data.selectedVendorId);
                if (data.poNumber) setPoNumber(data.poNumber);
                if (data.merchandiser) setMerchandiser(data.merchandiser);
                if (data.orderType) setOrderType(data.orderType);
                if (data.discountPercent !== undefined) setDiscountPercent(data.discountPercent);
                if (data.remarks) setRemarks(data.remarks);
            } catch (e) {
                console.error("Error restoring vendor data:", e);
            }
        }
    }, []);

    // Save to session
    useEffect(() => {
        const data = { selectedVendorId, selectedVendor, vendorContacts, poNumber, merchandiser, orderType, discountPercent, remarks };
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(data));
    }, [selectedVendorId, selectedVendor, vendorContacts, poNumber, merchandiser, orderType, discountPercent, remarks]);

    // Fetch vendors
    useEffect(() => {
        const fetchVendors = async () => {
            setVendorsLoading(true);
            try {
                const { data, error } = await supabase
                    .from("vendors")
                    .select(`*, vendor_contacts (*)`)
                    .eq("is_active", true)
                    .order("store_brand_name", { ascending: true });
                if (error) throw error;
                setVendors(data || []);
            } catch (err) {
                console.error("Error fetching vendors:", err);
                showPopup({ title: "Error", message: "Failed to load vendors: " + err.message, type: "error" });
            } finally {
                setVendorsLoading(false);
            }
        };
        fetchVendors();
    }, []);

    // Vendor change
    useEffect(() => {
        if (!selectedVendorId) { setSelectedVendor(null); setVendorContacts([]); return; }
        const vendor = vendors.find((v) => v.id === selectedVendorId);
        if (vendor) {
            setSelectedVendor(vendor);
            setVendorContacts(vendor.vendor_contacts || []);
            if (!orderType) setOrderType(vendor.default_order_type || "Buyout");
            if (discountPercent === 0) setDiscountPercent(vendor.default_markdown_percent || 0);
        }
    }, [selectedVendorId, vendors]);

    const vendorOptions = useMemo(() => vendors.map((v) => ({ label: `${v.store_brand_name}${v.location ? ` - ${v.location}` : ""} (${v.vendor_code})`, value: v.id })), [vendors]);
    const availableCredit = useMemo(() => selectedVendor ? (selectedVendor.credit_limit || 0) - (selectedVendor.current_credit_used || 0) : 0, [selectedVendor]);
    const primaryContact = useMemo(() => vendorContacts.find((c) => c.is_primary) || vendorContacts[0] || null, [vendorContacts]);

    const handleContinue = () => {
        if (!selectedVendor) { showPopup({ title: "Vendor Required", message: "Please select a vendor to continue.", type: "warning" }); return; }
        if (!poNumber.trim()) { showPopup({ title: "PO Number Required", message: "Please enter the Purchase Order (PO) number.", type: "warning" }); return; }
        if (!merchandiser) { showPopup({ title: "Merchandiser Required", message: "Please select a merchandiser for this order.", type: "warning" }); return; }
        if (!orderType) { showPopup({ title: "Order Type Required", message: "Please select an order type (Buyout/Consignment).", type: "warning" }); return; }

        const b2bData = { selectedVendorId, vendor: selectedVendor, vendorContacts, primaryContact, poNumber: poNumber.trim(), merchandiser, orderType, discountPercent, remarks, availableCredit };
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(b2bData));
        navigate("/b2b-product-form");
    };

    const handleBack = () => navigate("/b2b-executive-dashboard");

    return (
        <div className="b2b-vs-container">
            {PopupComponent}

            {/* Header */}
            <header className="b2b-vs-header">
                <div className="header-left">
                    <button className="back-btn" onClick={handleBack}>←</button>
                    <img src={Logo} alt="logo" className="header-logo" />
                    <h1>New B2B Order</h1>
                </div>
                <div className="header-steps">
                    <div className="step active">
                        <span className="step-num">1</span>
                        <span className="step-label">Vendor</span>
                    </div>
                    <div className="step-line"></div>
                    <div className="step">
                        <span className="step-num">2</span>
                        <span className="step-label">Products</span>
                    </div>
                    <div className="step-line"></div>
                    <div className="step">
                        <span className="step-num">3</span>
                        <span className="step-label">Details</span>
                    </div>
                    <div className="step-line"></div>
                    <div className="step">
                        <span className="step-num">4</span>
                        <span className="step-label">Review</span>
                    </div>
                </div>
            </header>

            <div className="b2b-vs-content">
                <div className="b2b-vs-main">
                    {/* Vendor Selection Card */}
                    <div className="form-card">
                        <h2>Select Vendor</h2>
                        <p className="form-subtitle">Search and select a vendor for this B2B order</p>
                        
                        <div className="form-field vendor-search">
                            <label>Vendor *</label>
                            <SearchableSelect
                                options={vendorOptions}
                                value={selectedVendorId}
                                onChange={setSelectedVendorId}
                                placeholder={vendorsLoading ? "Loading vendors..." : "Search vendor by name, location or code..."}
                                disabled={vendorsLoading}
                            />
                        </div>
                    </div>

                    {/* Vendor Details Card */}
                    {selectedVendor && (
                        <div className="form-card vendor-details-card">
                            <div className="vendor-header">
                                <div className="vendor-avatar">
                                    {selectedVendor.store_brand_name?.charAt(0) || "V"}
                                </div>
                                <div className="vendor-info">
                                    <h3>{selectedVendor.store_brand_name}</h3>
                                    <span className="vendor-code">{selectedVendor.vendor_code}</span>
                                    {selectedVendor.location && <span className="vendor-location">📍 {selectedVendor.location}</span>}
                                </div>
                            </div>

                            <div className="vendor-details-grid">
                                <div className="detail-group">
                                    <h4>Legal Information</h4>
                                    <div className="detail-row"><span>Legal Name</span><span>{selectedVendor.legal_name || "N/A"}</span></div>
                                    <div className="detail-row"><span>GST Number</span><span>{selectedVendor.gst_number || "N/A"}</span></div>
                                    <div className="detail-row"><span>Payment Terms</span><span>{selectedVendor.payment_terms || "N/A"}</span></div>
                                </div>
                                <div className="detail-group">
                                    <h4>Primary Contact</h4>
                                    {primaryContact ? (
                                        <>
                                            <div className="detail-row"><span>Name</span><span>{primaryContact.contact_name || "N/A"}</span></div>
                                            <div className="detail-row"><span>Email</span><span>{primaryContact.contact_email || "N/A"}</span></div>
                                            <div className="detail-row"><span>Phone</span><span>{primaryContact.contact_phone || "N/A"}</span></div>
                                        </>
                                    ) : (
                                        <p className="no-data">No contact information</p>
                                    )}
                                </div>
                                <div className="detail-group credit-group">
                                    <h4>Credit Information</h4>
                                    <div className="credit-stats">
                                        <div className="credit-stat">
                                            <span className="credit-value">₹{formatIndianNumber(selectedVendor.credit_limit || 0)}</span>
                                            <span className="credit-label">Credit Limit</span>
                                        </div>
                                        <div className="credit-stat">
                                            <span className="credit-value">₹{formatIndianNumber(selectedVendor.current_credit_used || 0)}</span>
                                            <span className="credit-label">Used</span>
                                        </div>
                                        <div className="credit-stat">
                                            <span className={`credit-value ${availableCredit <= 0 ? "negative" : "positive"}`}>₹{formatIndianNumber(availableCredit)}</span>
                                            <span className="credit-label">Available</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Order Details Card */}
                    {selectedVendor && (
                        <div className="form-card">
                            <h2>Order Details</h2>
                            <p className="form-subtitle">Enter the order information</p>

                            <div className="form-grid">
                                <div className="form-field">
                                    <label>PO Number *</label>
                                    <input type="text" className="form-input" placeholder="Enter Purchase Order Number" value={poNumber} onChange={(e) => setPoNumber(e.target.value)} />
                                </div>
                                <div className="form-field">
                                    <label>Merchandiser *</label>
                                    <SearchableSelect options={merchandisers} value={merchandiser} onChange={setMerchandiser} placeholder="Select Merchandiser" />
                                </div>
                                <div className="form-field">
                                    <label>Order Type *</label>
                                    <div className="toggle-btns">
                                        <button className={`toggle-btn ${orderType === "Buyout" ? "active" : ""}`} onClick={() => setOrderType("Buyout")}>Buyout</button>
                                        <button className={`toggle-btn ${orderType === "Consignment" ? "active" : ""}`} onClick={() => setOrderType("Consignment")}>Consignment</button>
                                    </div>
                                </div>
                                <div className="form-field">
                                    <label>Markdown %</label>
                                    <input type="number" className="form-input" placeholder="0" min={0} max={100} value={discountPercent} onChange={(e) => setDiscountPercent(Number(e.target.value) || 0)} />
                                </div>
                            </div>

                            <div className="form-field full-width">
                                <label>Remarks (Optional)</label>
                                <textarea className="form-textarea" placeholder="Any special instructions or notes for this order..." value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={3} />
                            </div>
                        </div>
                    )}

                    {/* Credit Warning */}
                    {selectedVendor && availableCredit <= 0 && (
                        <div className="warning-card">
                            <span className="warning-icon">⚠️</span>
                            <div>
                                <strong>Credit Limit Exceeded</strong>
                                <p>This vendor has no available credit. Order will require approval.</p>
                            </div>
                        </div>
                    )}
                </div>

                {/* Action Footer */}
                <div className="b2b-vs-footer">
                    <button className="btn btn-secondary" onClick={handleBack}>← Cancel</button>
                    <button className="btn btn-primary" onClick={handleContinue} disabled={!selectedVendor}>
                        Continue to Products →
                    </button>
                </div>
            </div>
        </div>
    );
}