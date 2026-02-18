import React, { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import "./B2bReviewOrder.css";
import Logo from "../../images/logo.png";
import formatIndianNumber from "../../utils/formatIndianNumber";
import formatDate from "../../utils/formatDate";
import { usePopup } from "../../components/Popup";

export default function B2bReviewOrder() {
    const navigate = useNavigate();
    const location = useLocation();
    const { showPopup, PopupComponent } = usePopup();

    // Order data
    const [orderPayload, setOrderPayload] = useState(null);
    const [vendor, setVendor] = useState(null);

    // Submission state
    const [isSubmitting, setIsSubmitting] = useState(false);

    // ==================== LOAD DATA ====================
    useEffect(() => {
        if (location.state) {
            const { orderPayload, vendor } = location.state;

            if (!orderPayload || !vendor) {
                showPopup({
                    title: "Missing Data",
                    message: "Please complete all previous steps.",
                    type: "warning",
                });
                setTimeout(() => navigate("/b2b-vendor-selection"), 1500);
                return;
            }

            setOrderPayload(orderPayload);
            setVendor(vendor);
        } else {
            showPopup({
                title: "No Data",
                message: "Please start from vendor selection.",
                type: "warning",
            });
            setTimeout(() => navigate("/b2b-vendor-selection"), 1500);
        }
    }, [location.state, navigate]);

    // ==================== HANDLERS ====================
    const handleBack = () => {
        navigate("/b2b-order-details", {
            state: {
                vendor,
                items: orderPayload?.items || [],
                subtotal: orderPayload?.subtotal || 0,
                taxes: orderPayload?.taxes || 0,
                grandTotal: orderPayload?.grand_total || 0,
                totalQuantity: orderPayload?.total_quantity || 0,
            },
        });
    };

    const handleSubmitOrder = async () => {
        if (!orderPayload || !vendor) {
            showPopup({
                title: "Error",
                message: "Order data is missing.",
                type: "error",
            });
            return;
        }

        setIsSubmitting(true);

        try {
            // Get current user (salesperson)
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) {
                throw new Error("User not authenticated");
            }

            // Generate order number
            const orderNo = `B2B-${Date.now().toString(36).toUpperCase()}`;

            // Prepare order data for database
            const orderData = {
                // Order identification
                order_no: orderNo,
                is_b2b: true,

                // Vendor info
                vendor_id: vendor.id,

                // B2B specific fields
                po_number: orderPayload.po_number,
                b2b_order_type: orderPayload.b2b_order_type,
                merchandiser_name: orderPayload.merchandiser_name,
                markdown_percent: orderPayload.markdown_type === "percent" ? orderPayload.markdown_value : null,
                markdown_amount: orderPayload.markdown_type === "amount" ? orderPayload.markdown_value : orderPayload.markdown_amount,

                // Delivery
                delivery_date: orderPayload.delivery_date,
                delivery_address: orderPayload.delivery_address,

                // Products (stored as JSONB)
                items: orderPayload.items,

                // Notes
                comments: orderPayload.order_notes,

                // Totals
                subtotal: orderPayload.subtotal,
                taxes: orderPayload.taxes,
                grand_total: orderPayload.final_total,
                total_quantity: orderPayload.total_quantity,

                // Approval workflow
                approval_status: "pending",
                submitted_for_approval_at: new Date().toISOString(),

                // Metadata
                created_by: user.email,
                created_at: new Date().toISOString(),
            };

            // Insert order
            const { data: insertedOrder, error: insertError } = await supabase
                .from("orders")
                .insert(orderData)
                .select()
                .single();

            if (insertError) {
                throw insertError;
            }

            // Create approval record
            const { error: approvalError } = await supabase
                .from("b2b_approvals")
                .insert({
                    order_id: insertedOrder.id,
                    status: "pending",
                    submitted_by: user.email,
                    submitted_at: new Date().toISOString(),
                });

            if (approvalError) {
                console.warn("Could not create approval record:", approvalError);
                // Non-blocking error
            }

            // Clear session storage
            sessionStorage.removeItem("b2bProductFormData");

            // Show success and redirect
            showPopup({
                title: "Order Submitted!",
                message: `Order ${orderNo} has been submitted for approval.`,
                type: "success",
            });

            setTimeout(() => {
                navigate("/b2b-executive-dashboard");
            }, 2000);

        } catch (err) {
            console.error("Submit error:", err);
            showPopup({
                title: "Submission Failed",
                message: err.message || "Failed to submit order. Please try again.",
                type: "error",
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    if (!orderPayload || !vendor) {
        return (
            <div className="b2b-rv-bg">
                <div className="b2b-rv-loading">
                    <p>Loading...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="b2b-rv-bg">
            {PopupComponent}

            {/* HEADER */}
            <header className="b2b-rv-header">
                <img src={Logo} alt="logo" className="b2b-rv-logo" onClick={() => navigate("/b2b-vendor-selection")} />
                <h1 className="b2b-rv-title">B2B Order - Review & Submit</h1>
            </header>

            <div className="b2b-rv-card">
                {/* VENDOR INFO */}
                <div className="b2b-rv-section">
                    <h3 className="section-title">Vendor Information</h3>
                    <div className="info-grid">
                        <div className="info-item">
                            <span className="label">Vendor Name</span>
                            <span className="value">{vendor.store_brand_name}</span>
                        </div>
                        <div className="info-item">
                            <span className="label">Vendor Code</span>
                            <span className="value">{vendor.vendor_code}</span>
                        </div>
                        <div className="info-item">
                            <span className="label">Location</span>
                            <span className="value">{vendor.location || "-"}</span>
                        </div>
                        <div className="info-item">
                            <span className="label">Contact</span>
                            <span className="value">{vendor.contact_person || vendor.email || "-"}</span>
                        </div>
                    </div>
                </div>

                {/* ORDER INFO */}
                <div className="b2b-rv-section">
                    <h3 className="section-title">Order Information</h3>
                    <div className="info-grid">
                        <div className="info-item">
                            <span className="label">PO Number</span>
                            <span className="value highlight">{orderPayload.po_number}</span>
                        </div>
                        <div className="info-item">
                            <span className="label">Order Type</span>
                            <span className={`value badge ${orderPayload.b2b_order_type.toLowerCase()}`}>
                                {orderPayload.b2b_order_type}
                            </span>
                        </div>
                        <div className="info-item">
                            <span className="label">Merchandiser</span>
                            <span className="value">{orderPayload.merchandiser_name}</span>
                        </div>
                        <div className="info-item">
                            <span className="label">Delivery Date</span>
                            <span className="value">{formatDate(orderPayload.delivery_date)}</span>
                        </div>
                    </div>

                    {orderPayload.delivery_address && (
                        <div className="info-item full-width">
                            <span className="label">Delivery Address</span>
                            <span className="value">{orderPayload.delivery_address}</span>
                        </div>
                    )}
                </div>

                {/* PRODUCTS */}
                <div className="b2b-rv-section">
                    <h3 className="section-title">Products ({orderPayload.items?.length || 0})</h3>
                    <div className="products-table-wrapper">
                        <table className="products-table">
                            <thead>
                                <tr>
                                    <th>#</th>
                                    <th>Product</th>
                                    <th>Top / Bottom</th>
                                    <th>Size</th>
                                    <th>Qty</th>
                                    <th>Unit Price</th>
                                    <th>Total</th>
                                </tr>
                            </thead>
                            <tbody>
                                {orderPayload.items?.map((item, i) => (
                                    <tr key={item._id || i}>
                                        <td>{i + 1}</td>
                                        <td>
                                            <div className="product-cell">
                                                <span className="product-name">{item.product_name}</span>
                                                {item.sku_id && <span className="product-sku">{item.sku_id}</span>}
                                            </div>
                                        </td>
                                        <td>
                                            <div className="variant-cell">
                                                {item.top && (
                                                    <span>
                                                        {item.top}
                                                        {item.top_color?.name && ` (${item.top_color.name})`}
                                                    </span>
                                                )}
                                                {item.bottom && (
                                                    <span>
                                                        {item.bottom}
                                                        {item.bottom_color?.name && ` (${item.bottom_color.name})`}
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        <td>{item.size}</td>
                                        <td>{item.quantity}</td>
                                        <td>₹{formatIndianNumber(item.price)}</td>
                                        <td>₹{formatIndianNumber(item.price * item.quantity)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* ORDER SUMMARY */}
                <div className="b2b-rv-section summary-section">
                    <h3 className="section-title">Order Summary</h3>
                    <div className="summary-box">
                        <div className="summary-row">
                            <span>Total Items</span>
                            <span>{orderPayload.total_quantity}</span>
                        </div>
                        <div className="summary-row">
                            <span>Subtotal</span>
                            <span>₹{formatIndianNumber(orderPayload.subtotal?.toFixed(2))}</span>
                        </div>
                        <div className="summary-row">
                            <span>GST (18%)</span>
                            <span>₹{formatIndianNumber(orderPayload.taxes?.toFixed(2))}</span>
                        </div>
                        <div className="summary-row">
                            <span>Gross Total</span>
                            <span>₹{formatIndianNumber(orderPayload.grand_total?.toFixed(2))}</span>
                        </div>

                        {orderPayload.markdown_amount > 0 && (
                            <div className="summary-row discount">
                                <span>
                                    Markdown
                                    {orderPayload.markdown_type === "percent" && ` (${orderPayload.markdown_value}%)`}
                                </span>
                                <span>-₹{formatIndianNumber(orderPayload.markdown_amount?.toFixed(2))}</span>
                            </div>
                        )}

                        <div className="summary-divider"></div>

                        <div className="summary-row total">
                            <span>Final Total</span>
                            <span>₹{formatIndianNumber(orderPayload.final_total?.toFixed(2))}</span>
                        </div>
                    </div>
                </div>

                {/* NOTES */}
                {orderPayload.order_notes && (
                    <div className="b2b-rv-section">
                        <h3 className="section-title">Order Notes</h3>
                        <div className="notes-box">
                            <p>{orderPayload.order_notes}</p>
                        </div>
                    </div>
                )}

                {/* APPROVAL INFO */}
                <div className="b2b-rv-approval-info">
                    <span className="info-icon">ℹ️</span>
                    <span>
                        This order will be submitted for approval. You can track its status in the Executive Dashboard.
                    </span>
                </div>

                {/* BUTTONS */}
                <div className="b2b-rv-buttons">
                    <button className="b2b-rv-back-btn" onClick={handleBack} disabled={isSubmitting}>
                        ← Back to Edit
                    </button>
                    <button
                        className="b2b-rv-submit-btn"
                        onClick={handleSubmitOrder}
                        disabled={isSubmitting}
                    >
                        {isSubmitting ? "Submitting..." : "Submit for Approval"}
                    </button>
                </div>
            </div>

            {/* FLOATING BACK */}
            <button className="b2b-floating-back" onClick={handleBack} disabled={isSubmitting}>←</button>
        </div>
    );
}