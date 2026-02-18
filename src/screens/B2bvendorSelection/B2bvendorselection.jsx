import React, { useEffect, useState, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import "./B2bvendorselection.css";
import Logo from "../../images/logo.png";
import formatIndianNumber from "../../utils/formatIndianNumber";
import { usePopup } from "../../components/Popup";

/**
 * Searchable Select Component (reused from ProductForm)
 */
function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = "Select…",
  disabled = false,
  className = "",
}) {
  const normalized = useMemo(() => {
    return (options || []).map((o) =>
      typeof o === "object" && o !== null && "label" in o && "value" in o
        ? o
        : { label: String(o), value: o }
    );
  }, [options]);

  const current = useMemo(
    () => normalized.find((o) => String(o.value) === String(value)) || null,
    [normalized, value]
  );

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [focusIdx, setFocusIdx] = useState(-1);
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return normalized;
    return normalized.filter((o) => o.label.toLowerCase().includes(q));
  }, [normalized, query]);

  useEffect(() => {
    if (!open) {
      if (!value) {
        setQuery("");
      } else if (current) {
        setQuery(current.label);
      }
    }
  }, [value, current, open]);

  useEffect(() => {
    const onDoc = (e) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target)) {
        setOpen(false);
        setFocusIdx(-1);
        if (current) {
          setQuery(current.label);
        }
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [current]);

  useEffect(() => {
    if (!open || !listRef.current || focusIdx < 0) return;
    const el = listRef.current.querySelector(`[data-idx="${focusIdx}"]`);
    if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
  }, [focusIdx, open]);

  const handleSelect = (opt) => {
    onChange(opt?.value ?? "");
    setOpen(false);
    setQuery(opt?.label ?? "");
    setFocusIdx(-1);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const handleKeyDown = (e) => {
    if (!open && (e.key === "ArrowDown" || e.key === "Enter")) {
      setOpen(true);
      setFocusIdx(0);
      if (current) {
        setQuery("");
      }
      return;
    }
    if (!open) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusIdx((i) => Math.min((filtered.length || 1) - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const opt = filtered[focusIdx];
      if (opt) handleSelect(opt);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      setFocusIdx(-1);
      if (current) {
        setQuery(current.label);
      }
    }
  };

  const clear = (e) => {
    e.stopPropagation();
    onChange("");
    setQuery("");
    inputRef.current?.focus();
  };

  return (
    <div
      ref={rootRef}
      className={`ss-root ${disabled ? "ss-disabled" : ""} ${className}`}
    >
      <div
        className={`ss-control ${open ? "ss-open" : ""}`}
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (disabled) return;
          setOpen(true);
          setFocusIdx(-1);
          requestAnimationFrame(() => inputRef.current?.focus());
        }}
      >
        <input
          ref={inputRef}
          className="ss-input"
          placeholder={placeholder}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!open) setOpen(true);
            setFocusIdx(0);
          }}
          onFocus={() => {
            if (current && query === current.label) {
              setQuery("");
            }
            setOpen(true);
          }}
          onKeyDown={handleKeyDown}
          disabled={disabled}
        />
        {current && (
          <button className="ss-clear" title="Clear" onClick={clear}>
            ×
          </button>
        )}
      </div>

      {open && (
        <div className="ss-menu" role="listbox">
          {filtered.length === 0 ? (
            <div className="ss-empty">No matches</div>
          ) : (
            <ul ref={listRef} className="ss-list">
              {filtered.map((opt, idx) => {
                const selected = String(opt.value) === String(value);
                const focused = idx === focusIdx;
                return (
                  <li
                    key={String(opt.value)}
                    data-idx={idx}
                    className={`ss-option ${selected ? "is-selected" : ""} ${focused ? "is-focused" : ""}`}
                    onMouseEnter={() => setFocusIdx(idx)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handleSelect(opt)}
                    role="option"
                    aria-selected={selected}
                  >
                    {opt.label}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default function B2BVendorSelection() {
  const navigate = useNavigate();
  const { showPopup, PopupComponent } = usePopup();

  // Vendors data
  const [vendors, setVendors] = useState([]);
  const [vendorsLoading, setVendorsLoading] = useState(true);

  // Selected vendor
  const [selectedVendorId, setSelectedVendorId] = useState("");
  const [selectedVendor, setSelectedVendor] = useState(null);
  const [vendorContacts, setVendorContacts] = useState([]);

  // Form fields
  const [poNumber, setPoNumber] = useState("");
  const [merchandiser, setMerchandiser] = useState("");
  const [orderType, setOrderType] = useState(""); // Buyout / Consignment
  const [discountPercent, setDiscountPercent] = useState(0);
  const [remarks, setRemarks] = useState("");

  // Merchandisers list (will be fetched from salesperson table later)
  const merchandisers = [
    { label: "Prastuti", value: "Prastuti" },
    { label: "Sharia", value: "Sharia" },
  ];

  // Fetch all active vendors
  useEffect(() => {
    const fetchVendors = async () => {
      setVendorsLoading(true);
      try {
        const { data, error } = await supabase
          .from("vendors")
          .select(`
            *,
            vendor_contacts (*)
          `)
          .eq("is_active", true)
          .order("store_brand_name", { ascending: true });

        if (error) throw error;
        setVendors(data || []);
      } catch (err) {
        console.error("Error fetching vendors:", err);
        showPopup({
          title: "Error",
          message: "Failed to load vendors: " + err.message,
          type: "error",
        });
      } finally {
        setVendorsLoading(false);
      }
    };

    fetchVendors();
  }, []);

  // When vendor is selected, populate fields
  useEffect(() => {
    if (!selectedVendorId) {
      setSelectedVendor(null);
      setVendorContacts([]);
      setOrderType("");
      setDiscountPercent(0);
      return;
    }

    const vendor = vendors.find((v) => v.id === selectedVendorId);
    if (vendor) {
      setSelectedVendor(vendor);
      setVendorContacts(vendor.vendor_contacts || []);
      setOrderType(vendor.default_order_type || "Buyout");
      setDiscountPercent(vendor.default_markdown_percent || 0);
    }
  }, [selectedVendorId, vendors]);

  // Create vendor options for dropdown
  const vendorOptions = useMemo(() => {
    return vendors.map((v) => ({
      label: `${v.store_brand_name}${v.location ? ` - ${v.location}` : ""} (${v.vendor_code})`,
      value: v.id,
    }));
  }, [vendors]);

  // Calculate available credit
  const availableCredit = useMemo(() => {
    if (!selectedVendor) return 0;
    return (selectedVendor.credit_limit || 0) - (selectedVendor.current_credit_used || 0);
  }, [selectedVendor]);

  // Get primary contact
  const primaryContact = useMemo(() => {
    return vendorContacts.find((c) => c.is_primary) || vendorContacts[0] || null;
  }, [vendorContacts]);

  // Handle continue to product form
  const handleContinue = () => {
    // Validation
    if (!selectedVendor) {
      showPopup({
        title: "Vendor Required",
        message: "Please select a vendor to continue.",
        type: "warning",
      });
      return;
    }

    if (!poNumber.trim()) {
      showPopup({
        title: "PO Number Required",
        message: "Please enter the Purchase Order (PO) number.",
        type: "warning",
      });
      return;
    }

    if (!merchandiser) {
      showPopup({
        title: "Merchandiser Required",
        message: "Please select a merchandiser for this order.",
        type: "warning",
      });
      return;
    }

    if (!orderType) {
      showPopup({
        title: "Order Type Required",
        message: "Please select an order type (Buyout/Consignment).",
        type: "warning",
      });
      return;
    }

    // Prepare B2B data to pass to ProductForm
    const b2bData = {
      isB2B: true,
      vendor: selectedVendor,
      vendorContacts: vendorContacts,
      primaryContact: primaryContact,
      poNumber: poNumber.trim(),
      merchandiser: merchandiser,
      orderType: orderType,
      discountPercent: discountPercent,
      remarks: remarks,
      availableCredit: availableCredit,
    };

    // Navigate to ProductForm with B2B data
    navigate("/b2b-product-form", {
      state: { b2bData },
    });
  };

  // Handle back navigation
  const handleBack = () => {
    navigate("/b2b-executive-dashboard", { replace: true });
  };

  return (
    <div className="b2b-vendor-bg">
      {PopupComponent}

      {/* Header */}
      <header className="b2b-header">
        <img src={Logo} alt="logo" className="b2b-header-logo" onClick={handleBack} />
        <h1 className="b2b-header-title">B2B Order - Vendor Selection</h1>
      </header>

      <div className="b2b-vendor-card">
        <h2 className="b2b-section-title">Select Vendor</h2>

        {/* Vendor Selection */}
        <div className="b2b-form-section">
          <div className="b2b-row">
            <div className="b2b-field b2b-field-large">
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
        </div>

        {/* Vendor Details Card - Shows when vendor is selected */}
        {selectedVendor && (
          <div className="b2b-vendor-details-card">
            <div className="b2b-vendor-header">
              <div className="b2b-vendor-name">
                <h3>{selectedVendor.store_brand_name}</h3>
                {selectedVendor.location && <span className="b2b-vendor-location">{selectedVendor.location}</span>}
              </div>
              <span className="b2b-vendor-code">{selectedVendor.vendor_code}</span>
            </div>

            <div className="b2b-vendor-grid">
              {/* Legal & GST Info */}
              <div className="b2b-info-group">
                <h4>Legal Information</h4>
                <div className="b2b-info-row">
                  <span className="b2b-label">Legal Name:</span>
                  <span className="b2b-value">{selectedVendor.legal_name}</span>
                </div>
                <div className="b2b-info-row">
                  <span className="b2b-label">GST Number:</span>
                  <span className="b2b-value">{selectedVendor.gst_number || "N/A"}</span>
                </div>
                <div className="b2b-info-row">
                  <span className="b2b-label">Payment Terms:</span>
                  <span className="b2b-value">{selectedVendor.payment_terms || "N/A"}</span>
                </div>
              </div>

              {/* Contact Info */}
              <div className="b2b-info-group">
                <h4>Primary Contact</h4>
                {primaryContact ? (
                  <>
                    <div className="b2b-info-row">
                      <span className="b2b-label">Name:</span>
                      <span className="b2b-value">{primaryContact.contact_name || "N/A"}</span>
                    </div>
                    <div className="b2b-info-row">
                      <span className="b2b-label">Email:</span>
                      <span className="b2b-value">{primaryContact.contact_email || "N/A"}</span>
                    </div>
                    <div className="b2b-info-row">
                      <span className="b2b-label">Phone:</span>
                      <span className="b2b-value">{primaryContact.contact_phone || "N/A"}</span>
                    </div>
                  </>
                ) : (
                  <p className="b2b-no-contact">No contact information available</p>
                )}

                {vendorContacts.length > 1 && (
                  <p className="b2b-more-contacts">+{vendorContacts.length - 1} more contact(s)</p>
                )}
              </div>

              {/* Credit Info */}
              <div className="b2b-info-group">
                <h4>Credit Information</h4>
                <div className="b2b-info-row">
                  <span className="b2b-label">Credit Limit:</span>
                  <span className="b2b-value">₹{formatIndianNumber(selectedVendor.credit_limit || 0)}</span>
                </div>
                <div className="b2b-info-row">
                  <span className="b2b-label">Credit Used:</span>
                  <span className="b2b-value">₹{formatIndianNumber(selectedVendor.current_credit_used || 0)}</span>
                </div>
                <div className="b2b-info-row">
                  <span className="b2b-label">Available Credit:</span>
                  <span className={`b2b-value ${availableCredit <= 0 ? "b2b-credit-warning" : "b2b-credit-ok"}`}>
                    ₹{formatIndianNumber(availableCredit)}
                  </span>
                </div>
                <div className="b2b-info-row">
                  <span className="b2b-label">Default Markdown:</span>
                  <span className="b2b-value">{selectedVendor.default_markdown_percent || 0}%</span>
                </div>
              </div>

              {/* Address Info */}
              <div className="b2b-info-group">
                <h4>Addresses</h4>
                <div className="b2b-info-row">
                  <span className="b2b-label">Billing:</span>
                  <span className="b2b-value b2b-address">{selectedVendor.billing_address || "N/A"}</span>
                </div>
                <div className="b2b-info-row">
                  <span className="b2b-label">Shipping:</span>
                  <span className="b2b-value b2b-address">{selectedVendor.shipping_address || "N/A"}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Order Details Section */}
        {selectedVendor && (
          <div className="b2b-form-section">
            <h2 className="b2b-section-title">Order Details</h2>

            <div className="b2b-row">
              <div className="b2b-field">
                <label>PO Number *</label>
                <input
                  type="text"
                  className="b2b-input"
                  placeholder="Enter Purchase Order Number"
                  value={poNumber}
                  onChange={(e) => setPoNumber(e.target.value)}
                />
              </div>

              <div className="b2b-field">
                <label>Merchandiser *</label>
                <SearchableSelect
                  options={merchandisers}
                  value={merchandiser}
                  onChange={setMerchandiser}
                  placeholder="Select Merchandiser"
                />
              </div>

              <div className="b2b-field">
                <label>Order Type *</label>
                <SearchableSelect
                  options={[
                    { label: "Buyout", value: "Buyout" },
                    { label: "Consignment", value: "Consignment" },
                  ]}
                  value={orderType}
                  onChange={setOrderType}
                  placeholder="Select Order Type"
                />
              </div>

              <div className="b2b-field">
                <label>Discount %</label>
                <input
                  type="number"
                  className="b2b-input"
                  placeholder="Discount %"
                  min={0}
                  max={100}
                  value={discountPercent}
                  onChange={(e) => setDiscountPercent(Number(e.target.value) || 0)}
                />
              </div>
            </div>

            <div className="b2b-row">
              <div className="b2b-field b2b-field-full">
                <label>Remarks (Optional)</label>
                <textarea
                  className="b2b-textarea"
                  placeholder="Any special instructions or notes for this order..."
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  rows={3}
                />
              </div>
            </div>
          </div>
        )}

        {/* Credit Warning */}
        {selectedVendor && availableCredit <= 0 && (
          <div className="b2b-credit-alert">
            <span className="b2b-alert-icon">⚠️</span>
            <div className="b2b-alert-content">
              <strong>Credit Limit Exceeded</strong>
              <p>This vendor has no available credit. Order will require approval from merchandiser.</p>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="b2b-actions">
          <button className="b2b-btn b2b-btn-secondary" onClick={handleBack}>
            ← Back
          </button>
          <button
            className="b2b-btn b2b-btn-primary"
            onClick={handleContinue}
            disabled={!selectedVendor}
          >
            Continue to Products →
          </button>
        </div>
      </div>

      {/* Back Button */}
      <button className="b2b-floating-back" onClick={handleBack}>
        ←
      </button>
    </div>
  );
}