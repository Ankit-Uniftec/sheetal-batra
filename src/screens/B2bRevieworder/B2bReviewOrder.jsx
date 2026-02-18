import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import "../Screen4.css";
import "./B2bReviewOrder.css";
import Logo from "../../images/logo.png";
import formatIndianNumber from "../../utils/formatIndianNumber";
import formatDate from "../../utils/formatDate";
import { usePopup } from "../../components/Popup";

const VENDOR_SESSION_KEY = "b2bVendorData";
const PRODUCT_SESSION_KEY = "b2bProductFormData";
const DETAILS_SESSION_KEY = "b2bOrderDetailsData";

function ColorDotDisplay({ colorObject }) {
    if (!colorObject) return null;
    let displayColorName = "";
    let displayColorHex = "#000000";
    if (typeof colorObject === "string") {
        displayColorName = colorObject;
        displayColorHex = colorObject.startsWith("#") ? colorObject : "gray";
    } else if (typeof colorObject === "object" && colorObject !== null) {
        displayColorName = colorObject.name || "";
        displayColorHex = colorObject.hex || "";
    }
    return (
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <div style={{ background: displayColorHex, height: "14px", width: "28px", borderRadius: "8px", border: "1px solid #ccc" }} />
            <span>{displayColorName}</span>
        </div>
    );
}

export default function B2bReviewOrder() {
    const navigate = useNavigate();
    const { showPopup, PopupComponent } = usePopup();

    const [user, setUser] = useState(null);
    const [salespersonStore, setSalespersonStore] = useState("Delhi Store");
    const [vendorData, setVendorData] = useState(null);
    const [productData, setProductData] = useState(null);
    const [detailsData, setDetailsData] = useState(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        const fetchUser = async () => {
            const { data } = await supabase.auth.getUser();
            const currentUser = data?.user || null;
            setUser(currentUser);

            if (currentUser) {
                // Try 1: Get store from currentSalesperson session (same as B2C)
                const savedSP = sessionStorage.getItem("currentSalesperson");
                if (savedSP) {
                    try {
                        const spData = JSON.parse(savedSP);
                        if (spData.store) { setSalespersonStore(spData.store); return; }
                    } catch (e) {}
                }

                // Try 2: Fetch from salesperson table by email
                if (currentUser.email) {
                    const { data: spData } = await supabase
                        .from("salesperson")
                        .select("store_name")
                        .eq("email", currentUser.email.toLowerCase())
                        .single();
                    if (spData?.store_name) { setSalespersonStore(spData.store_name); return; }
                }

                // Try 3: Fetch from profiles table
                const { data: profileData } = await supabase
                    .from("profiles")
                    .select("store")
                    .eq("id", currentUser.id)
                    .single();
                if (profileData?.store) setSalespersonStore(profileData.store);
            }
        };
        fetchUser();
    }, []);

    useEffect(() => {
        const vendorSaved = sessionStorage.getItem(VENDOR_SESSION_KEY);
        const productSaved = sessionStorage.getItem(PRODUCT_SESSION_KEY);
        const detailsSaved = sessionStorage.getItem(DETAILS_SESSION_KEY);

        if (!vendorSaved || !productSaved || !detailsSaved) {
            showPopup({ title: "Missing Data", message: "Please complete all steps first.", type: "warning" });
            setTimeout(() => navigate("/b2b-vendor-selection"), 1500);
            return;
        }

        try {
            setVendorData(JSON.parse(vendorSaved));
            setProductData(JSON.parse(productSaved));
            setDetailsData(JSON.parse(detailsSaved));
        } catch (e) {
            console.error("Error loading session data:", e);
            showPopup({ title: "Error", message: "Failed to load order data.", type: "error" });
        }
    }, [navigate]);

    // Derived data
    const vendor = vendorData?.vendor;
    const items = productData?.orderItems || [];
    const subtotal = productData?.subtotal || 0;
    const taxes = productData?.taxes || 0;
    const grandTotal = productData?.grandTotal || 0;
    const totalQuantity = productData?.totalQuantity || 0;

    const poNumber = vendorData?.poNumber || "";
    const merchandiser = vendorData?.merchandiser || "";
    const orderType = vendorData?.orderType || "Buyout";
    const discountPercent = vendorData?.discountPercent || 0;
    const remarks = vendorData?.remarks || "";
    const availableCredit = vendorData?.availableCredit || 0;

    const deliveryAddress = detailsData?.deliveryAddress || "";
    const orderNotes = detailsData?.orderNotes || "";

    const markdownAmount = grandTotal * (discountPercent / 100);
    const finalTotal = grandTotal - markdownAmount;

    const projectedCredit = (vendor?.current_credit_used || 0) + (orderType === "Buyout" ? finalTotal : 0);
    const creditLimit = vendor?.credit_limit || 0;
    const exceedsCredit = orderType === "Buyout" && projectedCredit > creditLimit;

    // Submit Order
    const handleSubmit = async () => {
        if (isSubmitting) return;
        setIsSubmitting(true);

        try {
            // Generate order number using salesperson store (same as B2C)
            const { data: orderNo, error: orderNoError } = await supabase.rpc(
                "generate_order_no",
                { p_store: salespersonStore || "Delhi Store" }
            );
            if (orderNoError) throw orderNoError;
            if (!orderNo) throw new Error("Failed to generate order number.");

            const deliveryDates = items.map(item => item.delivery_date).filter(Boolean).sort();
            const earliestDeliveryDate = deliveryDates[0] || null;

            const orderPayload = {
                order_no: orderNo,
                user_id: user?.id,
                is_b2b: true,
                vendor_id: vendor?.id,
                po_number: poNumber,
                b2b_order_type: orderType,
                merchandiser_name: merchandiser,
                salesperson_store: salespersonStore || "Delhi Store",
                markdown_percent: discountPercent,
                markdown_amount: markdownAmount,
                delivery_date: earliestDeliveryDate,
                delivery_address: deliveryAddress,
                items: items,
                comments: [remarks, orderNotes].filter(Boolean).join("\n\n"),
                subtotal: subtotal,
                taxes: taxes,
                grand_total: grandTotal,
                total_quantity: totalQuantity,
                approval_status: "pending",
                submitted_for_approval_at: new Date().toISOString(),
                mode_of_delivery: productData?.modeOfDelivery || "Delhi Store",
                order_flag: productData?.orderFlag || "Normal",
                urgent_reason: productData?.urgentReason || null,
                attachments: productData?.attachments || [],
            };

            const { data: orderData, error: orderError } = await supabase
                .from("orders")
                .insert([orderPayload])
                .select()
                .single();
            if (orderError) throw orderError;

            const { error: approvalError } = await supabase
                .from("b2b_approvals")
                .insert([{
                    order_id: orderData.id,
                    status: "pending",
                    submitted_by: user?.email || "unknown",
                    submitted_at: new Date().toISOString(),
                }]);
            if (approvalError) console.warn("Failed to create approval record:", approvalError);

            sessionStorage.removeItem(VENDOR_SESSION_KEY);
            sessionStorage.removeItem(PRODUCT_SESSION_KEY);
            sessionStorage.removeItem(DETAILS_SESSION_KEY);

            showPopup({
                title: "Order Submitted!",
                message: `Order #${orderNo} has been submitted for approval.`,
                type: "success",
                onConfirm: () => navigate("/b2b-executive-dashboard"),
            });
        } catch (err) {
            console.error("Order submission error:", err);
            showPopup({ title: "Submission Failed", message: err.message || "Failed to submit order.", type: "error" });
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleBack = () => navigate("/b2b-order-details");

    if (!vendorData || !productData || !detailsData) {
        return <div className="b2b-ro-loading">Loading...</div>;
    }

    return (
        <div className="screen4-bg">
            {PopupComponent}

            {isSubmitting && (
                <div className="b2b-ro-loader">
                    <img src={Logo} alt="Loading" className="b2b-ro-loader-logo" />
                    <p>Submitting order...</p>
                </div>
            )}

            <header className="pf-header">
                <img src={Logo} alt="logo" className="pf-header-logo" onClick={handleBack} />
                <h1 className="pf-header-title">Review Order</h1>
                {vendor && (
                    <div className="b2b-vendor-badge">
                        <span className="vendor-name">{vendor.store_brand_name}</span>
                        <span className="vendor-code">{vendor.vendor_code}</span>
                    </div>
                )}
            </header>

            <div className="b2b-ro-container">
                {/* Vendor Details */}
                <div className="b2b-ro-section">
                    <h3>Vendor Details</h3>
                    <div className="b2b-ro-row3">
                        <div className="b2b-ro-field"><label>Vendor:</label><span>{vendor?.store_brand_name}</span></div>
                        <div className="b2b-ro-field"><label>Vendor Code:</label><span>{vendor?.vendor_code}</span></div>
                        <div className="b2b-ro-field"><label>Location:</label><span>{vendor?.location || "N/A"}</span></div>
                    </div>
                    <div className="b2b-ro-row3">
                        <div className="b2b-ro-field"><label>GST Number:</label><span>{vendor?.gst_number || "N/A"}</span></div>
                        <div className="b2b-ro-field"><label>Payment Terms:</label><span>{vendor?.payment_terms || "N/A"}</span></div>
                    </div>
                </div>

                {/* Order Information */}
                <div className="b2b-ro-section">
                    <h3>Order Information</h3>
                    <div className="b2b-ro-row3">
                        <div className="b2b-ro-field"><label>PO Number:</label><span>{poNumber}</span></div>
                        <div className="b2b-ro-field">
                            <label>Order Type:</label>
                            <span className={`b2b-ro-badge ${orderType === "Consignment" ? "badge-purple" : "badge-blue"}`}>{orderType}</span>
                        </div>
                        <div className="b2b-ro-field"><label>Merchandiser:</label><span>{merchandiser}</span></div>
                    </div>
                    <div className="b2b-ro-row3">
                        <div className="b2b-ro-field"><label>Markdown:</label><span>{discountPercent}%</span></div>
                        <div className="b2b-ro-field"><label>Mode of Delivery:</label><span>{productData?.modeOfDelivery || "Delhi Store"}</span></div>
                    </div>
                    {deliveryAddress && (
                        <div className="b2b-ro-field b2b-ro-field-wide" style={{ marginTop: 12 }}>
                            <label>Delivery Address:</label>
                            <span>{deliveryAddress}</span>
                        </div>
                    )}
                </div>

                {/* Product Details */}
                <div className="b2b-ro-section">
                    <h3>Product Details ({items.length} items, {totalQuantity} units)</h3>
                    {items.map((item, i) => (
                        <div key={item._id || i} className="b2b-ro-product-box">
                            {item.image_url && <img src={item.image_url} className="b2b-ro-prod-img" alt="" />}
                            <div className="b2b-ro-product-fields">
                                <div className="b2b-ro-field b2b-ro-field-wide">
                                    <label>Product Name:</label>
                                    <span>{item.product_name}</span>
                                </div>
                                <div className="b2b-ro-product-grid">
                                    <div className="b2b-ro-field">
                                        <label>Top:</label>
                                        <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                                            <span>{item.top || "—"}</span>
                                            {item.top_color && <ColorDotDisplay colorObject={item.top_color} />}
                                        </div>
                                    </div>
                                    <div className="b2b-ro-field">
                                        <label>Bottom:</label>
                                        <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                                            <span>{item.bottom || "—"}</span>
                                            {item.bottom_color && <ColorDotDisplay colorObject={item.bottom_color} />}
                                        </div>
                                    </div>
                                    <div className="b2b-ro-field"><label>Size:</label><span>{item.size}</span></div>
                                    <div className="b2b-ro-field"><label>Qty:</label><span>{item.quantity || 1}</span></div>
                                    <div className="b2b-ro-field"><label>Unit Price:</label><span>₹{formatIndianNumber(item.price)}</span></div>
                                    <div className="b2b-ro-field"><label>Total:</label><span style={{ fontWeight: 600 }}>₹{formatIndianNumber(item.price * (item.quantity || 1))}</span></div>
                                    {item.delivery_date && (
                                        <div className="b2b-ro-field"><label>Delivery:</label><span>{formatDate(item.delivery_date)}</span></div>
                                    )}
                                </div>
                                {item.extras && item.extras.length > 0 && (
                                    <div className="b2b-ro-field b2b-ro-field-wide">
                                        <label>Extras:</label>
                                        <div className="b2b-ro-extras">
                                            {item.extras.map((extra, idx) => (
                                                <div key={idx} className="b2b-ro-extra-item">
                                                    <span>{extra.name} (₹{formatIndianNumber(extra.price)})</span>
                                                    {extra.color && <ColorDotDisplay colorObject={extra.color} />}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>

                {/* Payment Details */}
                <div className="b2b-ro-section">
                    <h3>Payment Details</h3>
                    <div className="b2b-ro-row3">
                        <div className="b2b-ro-field"><label>Subtotal:</label><span>₹{formatIndianNumber(Math.round(subtotal))}</span></div>
                        <div className="b2b-ro-field"><label>GST (18%):</label><span>₹{formatIndianNumber(Math.round(taxes))}</span></div>
                        <div className="b2b-ro-field"><label>Gross Total:</label><span style={{ fontWeight: 600 }}>₹{formatIndianNumber(Math.round(grandTotal))}</span></div>
                    </div>
                    {discountPercent > 0 && (
                        <div className="b2b-ro-row3">
                            <div className="b2b-ro-field"><label>Markdown ({discountPercent}%):</label><span style={{ color: "#4caf50" }}>- ₹{formatIndianNumber(Math.round(markdownAmount))}</span></div>
                        </div>
                    )}
                    <div className="b2b-ro-row3">
                        <div className="b2b-ro-field b2b-ro-final-total">
                            <label>Final Total:</label>
                            <span>₹{formatIndianNumber(Math.round(finalTotal))}</span>
                        </div>
                    </div>
                </div>

                {/* Notes */}
                {(remarks || orderNotes) && (
                    <div className="b2b-ro-section">
                        <h3>Notes & Remarks</h3>
                        {remarks && (
                            <div className="b2b-ro-field b2b-ro-field-wide" style={{ marginBottom: 12 }}>
                                <label>Order Remarks:</label>
                                <span>{remarks}</span>
                            </div>
                        )}
                        {orderNotes && (
                            <div className="b2b-ro-field b2b-ro-field-wide">
                                <label>Delivery Notes:</label>
                                <span>{orderNotes}</span>
                            </div>
                        )}
                    </div>
                )}

                {/* Credit Warning */}
                {exceedsCredit && (
                    <div className="b2b-ro-warning">
                        <span>⚠️</span>
                        <div>
                            <strong>Credit Limit Warning</strong>
                            <p>This order exceeds the vendor's available credit and will require approval.</p>
                        </div>
                    </div>
                )}

                {/* Approval Notice */}
                <div className="b2b-ro-approval-notice">
                    <span>ℹ️</span>
                    <div>
                        <strong>Approval Required</strong>
                        <p>This order will be submitted for approval. You will be notified once it's approved.</p>
                    </div>
                </div>

                {/* Action Buttons */}
                <div className="footer-btns">
                    <button className="draftBtn" onClick={handleBack} disabled={isSubmitting}>← Back to Edit</button>
                    <button className="continueBtn" onClick={handleSubmit} disabled={isSubmitting} style={{ background: isSubmitting ? "#ccc" : "#4caf50" }}>
                        {isSubmitting ? "Submitting..." : "Submit for Approval"}
                    </button>
                </div>
            </div>

            <button className="back-btn" onClick={handleBack} disabled={isSubmitting}>←</button>
        </div>
    );
}