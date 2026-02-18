import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import "./B2bOrderDetails.css";
import Logo from "../../images/logo.png";
import formatIndianNumber from "../../utils/formatIndianNumber";
import formatDate from "../../utils/formatDate";
import { usePopup } from "../../components/Popup";

/**
 * Session Storage Keys
 */
const VENDOR_SESSION_KEY = "b2bVendorData";
const PRODUCT_SESSION_KEY = "b2bProductFormData";
const DETAILS_SESSION_KEY = "b2bOrderDetailsData";

export default function B2bOrderDetails() {
    const navigate = useNavigate();
    const { showPopup, PopupComponent } = usePopup();

    // Data from previous steps
    const [vendorData, setVendorData] = useState(null);
    const [productData, setProductData] = useState(null);

    // Form fields (only delivery-specific)
    const [deliveryAddress, setDeliveryAddress] = useState("");
    const [orderNotes, setOrderNotes] = useState("");

    // ==================== LOAD DATA FROM SESSION ====================
    useEffect(() => {
        // Load vendor data
        const vendorSaved = sessionStorage.getItem(VENDOR_SESSION_KEY);
        if (vendorSaved) {
            try {
                const data = JSON.parse(vendorSaved);
                setVendorData(data);
                // Pre-fill delivery address from vendor
                if (data.vendor?.shipping_address) {
                    setDeliveryAddress(data.vendor.shipping_address);
                }
            } catch (e) {
                console.error("Error loading vendor data:", e);
            }
        }

        // Load product data
        const productSaved = sessionStorage.getItem(PRODUCT_SESSION_KEY);
        if (productSaved) {
            try {
                const data = JSON.parse(productSaved);
                setProductData(data);
            } catch (e) {
                console.error("Error loading product data:", e);
            }
        }

        // Load order details data (if going back and forth)
        const detailsSaved = sessionStorage.getItem(DETAILS_SESSION_KEY);
        if (detailsSaved) {
            try {
                const data = JSON.parse(detailsSaved);
                if (data.deliveryAddress) setDeliveryAddress(data.deliveryAddress);
                if (data.orderNotes) setOrderNotes(data.orderNotes);
            } catch (e) {
                console.error("Error loading details data:", e);
            }
        }

        // Redirect if no data
        if (!vendorSaved || !productSaved) {
            showPopup({ title: "Missing Data", message: "Please complete previous steps first.", type: "warning" });
            setTimeout(() => navigate("/b2b-vendor-selection"), 1500);
        }
    }, [navigate]);

    // ==================== SAVE TO SESSION ====================
    useEffect(() => {
        const data = { deliveryAddress, orderNotes };
        sessionStorage.setItem(DETAILS_SESSION_KEY, JSON.stringify(data));
    }, [deliveryAddress, orderNotes]);

    // ==================== CALCULATIONS ====================
    const vendor = vendorData?.vendor;
    const items = productData?.orderItems || [];
    const subtotal = productData?.subtotal || 0;
    const taxes = productData?.taxes || 0;
    const grandTotal = productData?.grandTotal || 0;
    const totalQuantity = productData?.totalQuantity || 0;

    // Calculate markdown from vendor selection step
    const discountPercent = vendorData?.discountPercent || 0;
    const markdownAmount = grandTotal * (discountPercent / 100);
    const finalTotal = grandTotal - markdownAmount;

    // Credit check
    const availableCredit = vendorData?.availableCredit || 0;
    const orderType = vendorData?.orderType || "Buyout";
    const projectedCredit = (vendor?.current_credit_used || 0) + (orderType === "Buyout" ? finalTotal : 0);
    const creditLimit = vendor?.credit_limit || 0;
    const exceedsCredit = orderType === "Buyout" && projectedCredit > creditLimit;

    // ==================== CONTINUE ====================
    const handleContinue = () => {
        if (!deliveryAddress.trim()) {
            showPopup({ title: "Delivery Address Required", message: "Please enter a delivery address.", type: "warning" });
            return;
        }

        // Save to session
        const detailsData = { deliveryAddress, orderNotes };
        sessionStorage.setItem(DETAILS_SESSION_KEY, JSON.stringify(detailsData));

        navigate("/b2b-review-order");
    };

    const handleBack = () => navigate("/b2b-product-form");

    if (!vendorData || !productData) {
        return <div className="b2b-od-loading">Loading...</div>;
    }

    return (
        <div className="b2b-od-bg">
            {PopupComponent}

            {/* Header */}
            <header className="b2b-od-header">
                <img src={Logo} alt="logo" className="b2b-od-logo" onClick={handleBack} />
                <h1 className="b2b-od-title">B2B Order - Delivery Details</h1>
                {vendor && (
                    <div className="b2b-od-vendor-badge">
                        <span className="vendor-name">{vendor.store_brand_name}</span>
                        <span className="vendor-code">{vendor.vendor_code}</span>
                    </div>
                )}
            </header>

            <div className="b2b-od-container">
                <div className="b2b-od-main">
                    {/* Order Summary from Previous Steps */}
                    <div className="b2b-od-summary-card">
                        <h3>Order Summary</h3>
                        <div className="b2b-od-summary-grid">
                            <div className="b2b-od-summary-item">
                                <span className="label">Vendor</span>
                                <span className="value">{vendor?.store_brand_name} ({vendor?.vendor_code})</span>
                            </div>
                            <div className="b2b-od-summary-item">
                                <span className="label">PO Number</span>
                                <span className="value">{vendorData?.poNumber}</span>
                            </div>
                            <div className="b2b-od-summary-item">
                                <span className="label">Merchandiser</span>
                                <span className="value">{vendorData?.merchandiser}</span>
                            </div>
                            <div className="b2b-od-summary-item">
                                <span className="label">Order Type</span>
                                <span className={`value badge ${orderType === "Consignment" ? "badge-purple" : "badge-blue"}`}>{orderType}</span>
                            </div>
                            <div className="b2b-od-summary-item">
                                <span className="label">Products</span>
                                <span className="value">{items.length} item(s), {totalQuantity} unit(s)</span>
                            </div>
                            <div className="b2b-od-summary-item">
                                <span className="label">Markdown</span>
                                <span className="value">{discountPercent}%</span>
                            </div>
                        </div>

                        {/* Products List */}
                        <div className="b2b-od-products-list">
                            <h4>Products</h4>
                            {items.map((item, idx) => (
                                <div key={item._id || idx} className="b2b-od-product-item">
                                    <span className="product-name">{idx + 1}. {item.product_name}</span>
                                    <span className="product-details">
                                        {item.top}{item.top_color?.name && ` (${item.top_color.name})`} / {item.bottom}{item.bottom_color?.name && ` (${item.bottom_color.name})`}
                                    </span>
                                    <span className="product-size">Size: {item.size}</span>
                                    <span className="product-qty">Qty: {item.quantity}</span>
                                    <span className="product-price">₹{formatIndianNumber(item.price * item.quantity)}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Delivery Details Form */}
                    <div className="b2b-od-form-card">
                        <h3>Delivery Details</h3>

                        <div className="b2b-od-field">
                            <label>Delivery Address *</label>
                            <textarea
                                className="b2b-od-textarea"
                                placeholder="Enter complete delivery address..."
                                value={deliveryAddress}
                                onChange={(e) => setDeliveryAddress(e.target.value)}
                                rows={3}
                            />
                        </div>

                        <div className="b2b-od-field">
                            <label>Additional Notes (Optional)</label>
                            <textarea
                                className="b2b-od-textarea"
                                placeholder="Any special delivery instructions..."
                                value={orderNotes}
                                onChange={(e) => setOrderNotes(e.target.value)}
                                rows={2}
                            />
                        </div>
                    </div>

                    {/* Credit Warning */}
                    {exceedsCredit && (
                        <div className="b2b-od-credit-warning">
                            <span className="warning-icon">⚠️</span>
                            <div className="warning-content">
                                <strong>Credit Limit Warning</strong>
                                <p>This order will exceed the vendor's credit limit. Order will require approval.</p>
                                <p className="warning-details">
                                    Credit Limit: ₹{formatIndianNumber(creditLimit)} | 
                                    Current Used: ₹{formatIndianNumber(vendor?.current_credit_used || 0)} | 
                                    This Order: ₹{formatIndianNumber(finalTotal)} | 
                                    Projected: ₹{formatIndianNumber(projectedCredit)}
                                </p>
                            </div>
                        </div>
                    )}
                </div>

                {/* Sidebar - Order Totals */}
                <div className="b2b-od-sidebar">
                    <div className="b2b-od-totals-card">
                        <h3>Order Totals</h3>

                        <div className="b2b-od-total-row">
                            <span>Subtotal</span>
                            <span>₹{formatIndianNumber(subtotal.toFixed(2))}</span>
                        </div>
                        <div className="b2b-od-total-row">
                            <span>GST (18%)</span>
                            <span>₹{formatIndianNumber(taxes.toFixed(2))}</span>
                        </div>
                        <div className="b2b-od-total-row b2b-od-total-gross">
                            <span>Gross Total</span>
                            <span>₹{formatIndianNumber(grandTotal.toFixed(2))}</span>
                        </div>

                        {discountPercent > 0 && (
                            <div className="b2b-od-total-row b2b-od-markdown">
                                <span>Markdown ({discountPercent}%)</span>
                                <span>- ₹{formatIndianNumber(markdownAmount.toFixed(2))}</span>
                            </div>
                        )}

                        <div className="b2b-od-total-row b2b-od-final">
                            <span>Final Total</span>
                            <span>₹{formatIndianNumber(finalTotal.toFixed(2))}</span>
                        </div>

                        <div className="b2b-od-credit-info">
                            <div className="credit-row">
                                <span>Available Credit</span>
                                <span className={availableCredit <= 0 ? "credit-negative" : "credit-positive"}>
                                    ₹{formatIndianNumber(availableCredit)}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Actions */}
            <div className="b2b-od-actions">
                <button className="b2b-od-btn b2b-od-btn-secondary" onClick={handleBack}>
                    ← Back to Products
                </button>
                <button className="b2b-od-btn b2b-od-btn-primary" onClick={handleContinue}>
                    Review Order →
                </button>
            </div>

            {/* Floating Back Button */}
            <button className="b2b-od-floating-back" onClick={handleBack}>←</button>
        </div>
    );
}