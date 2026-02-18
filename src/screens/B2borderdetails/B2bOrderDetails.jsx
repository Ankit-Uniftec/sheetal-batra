import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import "../Screen4.css";
import "./B2bOrderDetails.css";
import Logo from "../../images/logo.png";
import formatIndianNumber from "../../utils/formatIndianNumber";
import formatDate from "../../utils/formatDate";
import { usePopup } from "../../components/Popup";

const VENDOR_SESSION_KEY = "b2bVendorData";
const PRODUCT_SESSION_KEY = "b2bProductFormData";
const DETAILS_SESSION_KEY = "b2bOrderDetailsData";

export default function B2bOrderDetails() {
    const navigate = useNavigate();
    const { showPopup, PopupComponent } = usePopup();

    const [vendorData, setVendorData] = useState(null);
    const [productData, setProductData] = useState(null);
    const [orderNotes, setOrderNotes] = useState("");

    // Load data from session
    useEffect(() => {
        const vendorSaved = sessionStorage.getItem(VENDOR_SESSION_KEY);
        if (vendorSaved) {
            try { setVendorData(JSON.parse(vendorSaved)); } catch (e) { console.error("Error loading vendor data:", e); }
        }

        const productSaved = sessionStorage.getItem(PRODUCT_SESSION_KEY);
        if (productSaved) {
            try { setProductData(JSON.parse(productSaved)); } catch (e) { console.error("Error loading product data:", e); }
        }

        const detailsSaved = sessionStorage.getItem(DETAILS_SESSION_KEY);
        if (detailsSaved) {
            try {
                const data = JSON.parse(detailsSaved);
                if (data.orderNotes) setOrderNotes(data.orderNotes);
            } catch (e) { console.error("Error loading details data:", e); }
        }

        if (!vendorSaved || !productSaved) {
            showPopup({ title: "Missing Data", message: "Please complete previous steps first.", type: "warning" });
            setTimeout(() => navigate("/b2b-vendor-selection"), 1500);
        }
    }, [navigate]);

    // Save to session
    useEffect(() => {
        const vendor = vendorData?.vendor;
        const deliveryAddress = vendor?.shipping_address || vendor?.location || "N/A";
        const data = { deliveryAddress, orderNotes };
        sessionStorage.setItem(DETAILS_SESSION_KEY, JSON.stringify(data));
    }, [vendorData, orderNotes]);

    // Derived data
    const vendor = vendorData?.vendor;
    const items = productData?.orderItems || [];
    const subtotal = productData?.subtotal || 0;
    const taxes = productData?.taxes || 0;
    const grandTotal = productData?.grandTotal || 0;
    const totalQuantity = productData?.totalQuantity || 0;

    const discountPercent = vendorData?.discountPercent || 0;
    const markdownAmount = grandTotal * (discountPercent / 100);
    const finalTotal = grandTotal - markdownAmount;

    const availableCredit = vendorData?.availableCredit || 0;
    const orderType = vendorData?.orderType || "Buyout";
    const projectedCredit = (vendor?.current_credit_used || 0) + (orderType === "Buyout" ? finalTotal : 0);
    const creditLimit = vendor?.credit_limit || 0;
    const exceedsCredit = orderType === "Buyout" && projectedCredit > creditLimit;

    const deliveryAddress = vendor?.shipping_address || vendor?.location || "N/A";

    const handleContinue = () => {
        const detailsData = { deliveryAddress, orderNotes };
        sessionStorage.setItem(DETAILS_SESSION_KEY, JSON.stringify(detailsData));
        navigate("/b2b-review-order");
    };

    const handleBack = () => navigate("/b2b-product-form");

    if (!vendorData || !productData) {
        return <div className="b2b-od-loading">Loading...</div>;
    }

    return (
        <div className="screen4-bg">
            {PopupComponent}

            <header className="pf-header">
                <img src={Logo} alt="logo" className="pf-header-logo" onClick={handleBack} />
                <h1 className="pf-header-title">Order Details</h1>
                {vendor && (
                    <div className="b2b-vendor-badge">
                        <span className="vendor-name">{vendor.store_brand_name}</span>
                        <span className="vendor-code">{vendor.vendor_code}</span>
                    </div>
                )}
            </header>

            <div className="b2b-od-container">
                {/* Order Summary */}
                <div className="b2b-od-section">
                    <h3>Order Summary</h3>
                    <div className="b2b-od-row3">
                        <div className="b2b-od-field"><label>Vendor:</label><span>{vendor?.store_brand_name} ({vendor?.vendor_code})</span></div>
                        <div className="b2b-od-field"><label>PO Number:</label><span>{vendorData?.poNumber}</span></div>
                        <div className="b2b-od-field"><label>Merchandiser:</label><span>{vendorData?.merchandiser}</span></div>
                    </div>
                    <div className="b2b-od-row3">
                        <div className="b2b-od-field">
                            <label>Order Type:</label>
                            <span className={`b2b-od-badge ${orderType === "Consignment" ? "badge-purple" : "badge-blue"}`}>{orderType}</span>
                        </div>
                        <div className="b2b-od-field"><label>Products:</label><span>{items.length} item(s), {totalQuantity} unit(s)</span></div>
                        <div className="b2b-od-field"><label>Markdown:</label><span>{discountPercent}%</span></div>
                    </div>
                </div>

                {/* Products List */}
                <div className="b2b-od-section">
                    <h3>Products</h3>
                    {items.map((item, idx) => (
                        <div key={item._id || idx} className="b2b-od-product-item">
                            <span className="b2b-od-product-num">{idx + 1}.</span>
                            <div className="b2b-od-product-info">
                                <span className="b2b-od-product-name">{item.product_name}</span>
                                <span className="b2b-od-product-detail">
                                    {item.top}{item.top_color?.name && ` (${item.top_color.name})`} / {item.bottom}{item.bottom_color?.name && ` (${item.bottom_color.name})`} | Size: {item.size} | Qty: {item.quantity}
                                </span>
                            </div>
                            <span className="b2b-od-product-price">₹{formatIndianNumber(item.price * item.quantity)}</span>
                        </div>
                    ))}
                </div>

                {/* Delivery Details - READ ONLY */}
                <div className="b2b-od-section">
                    <h3>Delivery Details</h3>
                    <div className="b2b-od-row3">
                        <div className="b2b-od-field"><label>Delivery Address:</label><span>{deliveryAddress}</span></div>
                        <div className="b2b-od-field"><label>Mode of Delivery:</label><span>{productData?.modeOfDelivery || "Delhi Store"}</span></div>
                    </div>
                    <div className="b2b-od-row3" style={{ marginTop: 16 }}>
                        <div className="b2b-od-field" style={{ flex: "1 1 100%" }}>
                            <label>Additional Notes (Optional):</label>
                            <input
                                type="text"
                                className="input-line"
                                placeholder="Any special delivery instructions..."
                                value={orderNotes}
                                onChange={(e) => setOrderNotes(e.target.value)}
                            />
                        </div>
                    </div>
                </div>

                {/* Order Totals */}
                <div className="b2b-od-section">
                    <h3>Order Totals</h3>
                    <div className="b2b-od-row3">
                        <div className="b2b-od-field"><label>Subtotal:</label><span>₹{formatIndianNumber(Math.round(subtotal))}</span></div>
                        <div className="b2b-od-field"><label>GST (18%):</label><span>₹{formatIndianNumber(Math.round(taxes))}</span></div>
                        <div className="b2b-od-field"><label>Gross Total:</label><span style={{ fontWeight: 600 }}>₹{formatIndianNumber(Math.round(grandTotal))}</span></div>
                    </div>
                    {discountPercent > 0 && (
                        <div className="b2b-od-row3">
                            <div className="b2b-od-field"><label>Markdown ({discountPercent}%):</label><span style={{ color: "#4caf50" }}>- ₹{formatIndianNumber(Math.round(markdownAmount))}</span></div>
                        </div>
                    )}
                    <div className="b2b-od-row3">
                        <div className="b2b-od-field b2b-od-final-total"><label>Final Total:</label><span>₹{formatIndianNumber(Math.round(finalTotal))}</span></div>
                        <div className="b2b-od-field">
                            <label>Available Credit:</label>
                            <span style={{ color: availableCredit <= 0 ? "#c62828" : "#2e7d32", fontWeight: 600 }}>₹{formatIndianNumber(availableCredit)}</span>
                        </div>
                    </div>
                </div>

                {/* Credit Warning */}
                {exceedsCredit && (
                    <div className="b2b-od-warning">
                        <span>⚠️</span>
                        <div>
                            <strong>Credit Limit Warning</strong>
                            <p>This order will exceed the vendor's credit limit and will require approval.</p>
                        </div>
                    </div>
                )}

                {/* Footer Buttons */}
                <div className="footer-btns">
                    <button className="draftBtn" onClick={handleBack}>← Back to Products</button>
                    <button className="continueBtn" onClick={handleContinue}>Review Order →</button>
                </div>
            </div>

            <button className="back-btn" onClick={handleBack}>←</button>
        </div>
    );
}