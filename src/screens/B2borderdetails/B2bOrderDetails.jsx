import React, { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import "./B2bOrderDetails.css";
import Logo from "../../images/logo.png";
import formatIndianNumber from "../../utils/formatIndianNumber";
import { usePopup } from "../../components/Popup";

/**
 * Searchable Select Component
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
                if (current) setQuery(current.label);
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
            if (current) setQuery("");
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
            if (current) setQuery(current.label);
        }
    };

    const clear = (e) => {
        e.stopPropagation();
        onChange("");
        setQuery("");
        inputRef.current?.focus();
    };

    return (
        <div ref={rootRef} className={`ss-root ${disabled ? "ss-disabled" : ""} ${className}`}>
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
                        if (current && query === current.label) setQuery("");
                        setOpen(true);
                    }}
                    onKeyDown={handleKeyDown}
                    disabled={disabled}
                />
                {current && (
                    <button className="ss-clear" title="Clear" onClick={clear}>×</button>
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

// Merchandiser options (from PDF)
const MERCHANDISER_OPTIONS = [
    { label: "Prastuti", value: "Prastuti" },
    { label: "Sharia", value: "Sharia" },
];

// Order type options
const ORDER_TYPE_OPTIONS = [
    { label: "Buyout", value: "Buyout" },
    { label: "Consignment", value: "Consignment" },
];

// Markdown type options
const MARKDOWN_TYPE_OPTIONS = [
    { label: "Percentage (%)", value: "percent" },
    { label: "Fixed Amount (₹)", value: "amount" },
];

export default function B2bOrderDetails() {
    const navigate = useNavigate();
    const location = useLocation();
    const { showPopup, PopupComponent } = usePopup();

    // Get data from previous step
    const [vendor, setVendor] = useState(null);
    const [items, setItems] = useState([]);
    const [subtotal, setSubtotal] = useState(0);
    const [taxes, setTaxes] = useState(0);
    const [grandTotal, setGrandTotal] = useState(0);
    const [totalQuantity, setTotalQuantity] = useState(0);

    // B2B specific fields
    const [poNumber, setPoNumber] = useState("");
    const [b2bOrderType, setB2bOrderType] = useState("Buyout");
    const [merchandiserName, setMerchandiserName] = useState("");
    const [markdownType, setMarkdownType] = useState("percent");
    const [markdownValue, setMarkdownValue] = useState("");
    const [deliveryDate, setDeliveryDate] = useState("");
    const [deliveryAddress, setDeliveryAddress] = useState("");
    const [orderNotes, setOrderNotes] = useState("");

    // Calculated values
    const [markdownAmount, setMarkdownAmount] = useState(0);
    const [finalTotal, setFinalTotal] = useState(0);

    // Credit limit check
    const [creditLimit, setCreditLimit] = useState(0);
    const [currentBalance, setCurrentBalance] = useState(0);
    const [creditWarning, setCreditWarning] = useState("");

    // ==================== LOAD DATA FROM LOCATION STATE ====================
    useEffect(() => {
        if (location.state) {
            const { vendor, items, subtotal, taxes, grandTotal, totalQuantity } = location.state;
            
            if (!vendor || !items || items.length === 0) {
                showPopup({
                    title: "Missing Data",
                    message: "Please select products first.",
                    type: "warning",
                });
                setTimeout(() => navigate("/b2b-vendor-selection"), 1500);
                return;
            }

            setVendor(vendor);
            setItems(items);
            setSubtotal(subtotal || 0);
            setTaxes(taxes || 0);
            setGrandTotal(grandTotal || 0);
            setTotalQuantity(totalQuantity || 0);

            // Set vendor's delivery address as default
            if (vendor.delivery_address) {
                setDeliveryAddress(vendor.delivery_address);
            } else if (vendor.address) {
                setDeliveryAddress(vendor.address);
            }

            // Set credit limit from vendor
            setCreditLimit(vendor.credit_limit || 0);
            setCurrentBalance(vendor.current_balance || 0);
        } else {
            showPopup({
                title: "No Data",
                message: "Please start from vendor selection.",
                type: "warning",
            });
            setTimeout(() => navigate("/b2b-vendor-selection"), 1500);
        }
    }, [location.state, navigate]);

    // ==================== CALCULATE MARKDOWN & FINAL TOTAL ====================
    useEffect(() => {
        let discount = 0;
        
        if (markdownValue && Number(markdownValue) > 0) {
            if (markdownType === "percent") {
                discount = (grandTotal * Number(markdownValue)) / 100;
            } else {
                discount = Number(markdownValue);
            }
        }

        setMarkdownAmount(discount);
        setFinalTotal(grandTotal - discount);
    }, [markdownType, markdownValue, grandTotal]);

    // ==================== CHECK CREDIT LIMIT ====================
    useEffect(() => {
        if (b2bOrderType === "Buyout" && creditLimit > 0) {
            const projectedBalance = currentBalance + finalTotal;
            if (projectedBalance > creditLimit) {
                setCreditWarning(`Warning: This order exceeds credit limit. Available: ₹${formatIndianNumber(creditLimit - currentBalance)}`);
            } else {
                setCreditWarning("");
            }
        } else {
            setCreditWarning("");
        }
    }, [b2bOrderType, finalTotal, creditLimit, currentBalance]);

    // ==================== HANDLERS ====================
    const handleBack = () => {
        navigate("/b2b-product-form", {
            state: { vendor },
        });
    };

    const handleContinue = () => {
        // Validation
        if (!poNumber.trim()) {
            showPopup({
                title: "PO Number Required",
                message: "Please enter a PO number.",
                type: "warning",
            });
            return;
        }

        if (!merchandiserName) {
            showPopup({
                title: "Merchandiser Required",
                message: "Please select a merchandiser.",
                type: "warning",
            });
            return;
        }

        if (!deliveryDate) {
            showPopup({
                title: "Delivery Date Required",
                message: "Please select a delivery date.",
                type: "warning",
            });
            return;
        }

        // For Consignment orders, markdown is required
        if (b2bOrderType === "Consignment" && !markdownValue) {
            showPopup({
                title: "Markdown Required",
                message: "Please enter markdown percentage or amount for consignment orders.",
                type: "warning",
            });
            return;
        }

        // Prepare order payload
        const orderPayload = {
            // Vendor info
            vendor_id: vendor.id,
            vendor_name: vendor.store_brand_name,
            vendor_code: vendor.vendor_code,

            // Products
            items: items,

            // B2B specific fields
            po_number: poNumber.trim(),
            b2b_order_type: b2bOrderType,
            merchandiser_name: merchandiserName,
            markdown_type: markdownType,
            markdown_value: Number(markdownValue) || 0,
            markdown_amount: markdownAmount,

            // Delivery
            delivery_date: deliveryDate,
            delivery_address: deliveryAddress,

            // Notes
            order_notes: orderNotes,

            // Totals
            subtotal: subtotal,
            taxes: taxes,
            grand_total: grandTotal,
            final_total: finalTotal,
            total_quantity: totalQuantity,

            // Metadata
            is_b2b: true,
            approval_status: "pending",
            created_at: new Date().toISOString(),
        };

        // Navigate to review page
        navigate("/b2b-review-order", {
            state: {
                orderPayload,
                vendor,
            },
        });
    };

    // Get min date (today)
    const getMinDate = () => {
        const today = new Date();
        return today.toISOString().split("T")[0];
    };

    return (
        <div className="b2b-od-bg">
            {PopupComponent}

            {/* HEADER */}
            <header className="b2b-od-header">
                <img src={Logo} alt="logo" className="b2b-od-logo" onClick={() => navigate("/b2b-vendor-selection")} />
                <h1 className="b2b-od-title">B2B Order - Order Details</h1>
                {vendor && (
                    <div className="b2b-od-vendor-info">
                        <span className="vendor-name">{vendor.store_brand_name}</span>
                        <span className="vendor-code">{vendor.vendor_code}</span>
                    </div>
                )}
            </header>

            <div className="b2b-od-card">
                <div className="b2b-od-layout">
                    {/* LEFT - FORM */}
                    <div className="b2b-od-form">
                        <h4 className="b2b-od-section-title">Order Information</h4>

                        {/* Order Summary */}
                        <div className="b2b-od-products-summary">
                            <h5>Products ({items.length})</h5>
                            <div className="products-list">
                                {items.map((item, i) => (
                                    <div key={item._id || i} className="product-item">
                                        <span className="product-name">{item.product_name}</span>
                                        <span className="product-details">
                                            Size: {item.size} | Qty: {item.quantity} | ₹{formatIndianNumber(item.price * item.quantity)}
                                        </span>
                                    </div>
                                ))}
                            </div>
                            <div className="products-total">
                                <span>Total Items: {totalQuantity}</span>
                                <span>Amount: ₹{formatIndianNumber(grandTotal)}</span>
                            </div>
                        </div>

                        {/* PO Number & Order Type */}
                        <div className="b2b-od-row">
                            <div className="b2b-od-field">
                                <label>PO Number *</label>
                                <input
                                    type="text"
                                    className="b2b-od-input"
                                    placeholder="Enter PO Number"
                                    value={poNumber}
                                    onChange={(e) => setPoNumber(e.target.value)}
                                />
                            </div>

                            <div className="b2b-od-field">
                                <label>Order Type *</label>
                                <div className="order-type-buttons">
                                    {ORDER_TYPE_OPTIONS.map((opt) => (
                                        <button
                                            key={opt.value}
                                            className={`order-type-btn ${b2bOrderType === opt.value ? "active" : ""}`}
                                            onClick={() => setB2bOrderType(opt.value)}
                                        >
                                            {opt.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* Merchandiser & Delivery Date */}
                        <div className="b2b-od-row">
                            <div className="b2b-od-field">
                                <label>Merchandiser *</label>
                                <SearchableSelect
                                    options={MERCHANDISER_OPTIONS}
                                    value={merchandiserName}
                                    onChange={setMerchandiserName}
                                    placeholder="Select Merchandiser"
                                />
                            </div>

                            <div className="b2b-od-field">
                                <label>Delivery Date *</label>
                                <input
                                    type="date"
                                    className="b2b-od-input"
                                    value={deliveryDate}
                                    min={getMinDate()}
                                    onChange={(e) => setDeliveryDate(e.target.value)}
                                />
                            </div>
                        </div>

                        {/* Markdown Section */}
                        <div className="b2b-od-section">
                            <h5 className="section-subtitle">
                                Markdown / Discount
                                {b2bOrderType === "Consignment" && <span className="required-badge">Required for Consignment</span>}
                            </h5>
                            <div className="b2b-od-row">
                                <div className="b2b-od-field">
                                    <label>Markdown Type</label>
                                    <div className="markdown-type-buttons">
                                        {MARKDOWN_TYPE_OPTIONS.map((opt) => (
                                            <button
                                                key={opt.value}
                                                className={`markdown-type-btn ${markdownType === opt.value ? "active" : ""}`}
                                                onClick={() => setMarkdownType(opt.value)}
                                            >
                                                {opt.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <div className="b2b-od-field">
                                    <label>
                                        {markdownType === "percent" ? "Markdown %" : "Markdown Amount (₹)"}
                                    </label>
                                    <input
                                        type="number"
                                        className="b2b-od-input"
                                        placeholder={markdownType === "percent" ? "e.g., 10" : "e.g., 5000"}
                                        value={markdownValue}
                                        min={0}
                                        max={markdownType === "percent" ? 100 : grandTotal}
                                        onChange={(e) => setMarkdownValue(e.target.value)}
                                    />
                                </div>
                            </div>

                            {markdownAmount > 0 && (
                                <div className="markdown-preview">
                                    <span>Discount: -₹{formatIndianNumber(markdownAmount.toFixed(2))}</span>
                                </div>
                            )}
                        </div>

                        {/* Delivery Address */}
                        <div className="b2b-od-row">
                            <div className="b2b-od-field full-width">
                                <label>Delivery Address</label>
                                <textarea
                                    className="b2b-od-textarea"
                                    placeholder="Enter delivery address..."
                                    value={deliveryAddress}
                                    onChange={(e) => setDeliveryAddress(e.target.value)}
                                    rows={3}
                                />
                            </div>
                        </div>

                        {/* Order Notes */}
                        <div className="b2b-od-row">
                            <div className="b2b-od-field full-width">
                                <label>Order Notes</label>
                                <textarea
                                    className="b2b-od-textarea"
                                    placeholder="Any special instructions or notes..."
                                    value={orderNotes}
                                    onChange={(e) => setOrderNotes(e.target.value)}
                                    rows={3}
                                />
                            </div>
                        </div>

                        {/* Credit Warning */}
                        {creditWarning && (
                            <div className="credit-warning">
                                <span className="warning-icon">⚠️</span>
                                <span>{creditWarning}</span>
                            </div>
                        )}

                        {/* Buttons */}
                        <div className="b2b-od-buttons">
                            <button className="b2b-od-back-btn" onClick={handleBack}>
                                ← Back to Products
                            </button>
                            <button className="b2b-od-continue-btn" onClick={handleContinue}>
                                Review Order →
                            </button>
                        </div>
                    </div>

                    {/* RIGHT - SUMMARY */}
                    <div className="b2b-od-summary">
                        <h3>Order Summary</h3>

                        <div className="summary-row">
                            <span>Vendor:</span>
                            <span>{vendor?.store_brand_name}</span>
                        </div>

                        <div className="summary-row">
                            <span>Order Type:</span>
                            <span className={`type-badge ${b2bOrderType.toLowerCase()}`}>{b2bOrderType}</span>
                        </div>

                        <div className="summary-divider"></div>

                        <div className="summary-row">
                            <span>Items:</span>
                            <span>{totalQuantity}</span>
                        </div>

                        <div className="summary-row">
                            <span>Subtotal:</span>
                            <span>₹{formatIndianNumber(subtotal.toFixed(2))}</span>
                        </div>

                        <div className="summary-row">
                            <span>GST (18%):</span>
                            <span>₹{formatIndianNumber(taxes.toFixed(2))}</span>
                        </div>

                        <div className="summary-row">
                            <span>Gross Total:</span>
                            <span>₹{formatIndianNumber(grandTotal.toFixed(2))}</span>
                        </div>

                        {markdownAmount > 0 && (
                            <div className="summary-row discount">
                                <span>Markdown:</span>
                                <span>-₹{formatIndianNumber(markdownAmount.toFixed(2))}</span>
                            </div>
                        )}

                        <div className="summary-divider"></div>

                        <div className="summary-row total">
                            <span>Final Total:</span>
                            <span>₹{formatIndianNumber(finalTotal.toFixed(2))}</span>
                        </div>

                        {b2bOrderType === "Buyout" && creditLimit > 0 && (
                            <div className="credit-info">
                                <div className="credit-row">
                                    <span>Credit Limit:</span>
                                    <span>₹{formatIndianNumber(creditLimit)}</span>
                                </div>
                                <div className="credit-row">
                                    <span>Current Balance:</span>
                                    <span>₹{formatIndianNumber(currentBalance)}</span>
                                </div>
                                <div className="credit-row">
                                    <span>Available:</span>
                                    <span>₹{formatIndianNumber(Math.max(0, creditLimit - currentBalance))}</span>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* BACK BUTTON */}
            <button className="b2b-floating-back" onClick={handleBack}>←</button>
        </div>
    );
}