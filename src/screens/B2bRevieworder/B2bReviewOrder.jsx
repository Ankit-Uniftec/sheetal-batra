import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import "./B2bReviewOrder.css";
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

export default function B2bReviewOrder() {
    const navigate = useNavigate();
    const { showPopup, PopupComponent } = usePopup();

    // User from supabase
    const [user, setUser] = useState(null);

    // Data from all steps
    const [vendorData, setVendorData] = useState(null);
    const [productData, setProductData] = useState(null);
    const [detailsData, setDetailsData] = useState(null);

    // Loading state
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Get current user
    useEffect(() => {
        supabase.auth.getUser().then(({ data }) => {
            setUser(data?.user || null);
        });
    }, []);

    // ==================== LOAD ALL DATA FROM SESSION ====================
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

    // ==================== DERIVED DATA ====================
    const vendor = vendorData?.vendor;
    const items = productData?.orderItems || [];
    const subtotal = productData?.subtotal || 0;
    const taxes = productData?.taxes || 0;
    const grandTotal = productData?.grandTotal || 0;
    const totalQuantity = productData?.totalQuantity || 0;

    // From vendor selection
    const poNumber = vendorData?.poNumber || "";
    const merchandiser = vendorData?.merchandiser || "";
    const orderType = vendorData?.orderType || "Buyout";
    const discountPercent = vendorData?.discountPercent || 0;
    const remarks = vendorData?.remarks || "";
    const availableCredit = vendorData?.availableCredit || 0;

    // From delivery details
    const deliveryAddress = detailsData?.deliveryAddress || "";
    const orderNotes = detailsData?.orderNotes || "";

    // Calculations
    const markdownAmount = grandTotal * (discountPercent / 100);
    const finalTotal = grandTotal - markdownAmount;

    // Credit check
    const projectedCredit = (vendor?.current_credit_used || 0) + (orderType === "Buyout" ? finalTotal : 0);
    const creditLimit = vendor?.credit_limit || 0;
    const exceedsCredit = orderType === "Buyout" && projectedCredit > creditLimit;

    // ==================== SUBMIT ORDER ====================
    const handleSubmit = async () => {
        if (isSubmitting) return;
        setIsSubmitting(true);

        try {
            // Generate order number using RPC (same as B2C)
            const { data: orderNo, error: orderNoError } = await supabase.rpc(
                "generate_order_no",
                { p_store: productData?.modeOfDelivery || "Delhi Store" }
            );

            if (orderNoError) {
                console.error("Order number generation error:", orderNoError);
                throw orderNoError;
            }

            if (!orderNo) {
                throw new Error("Failed to generate order number. Please try again.");
            }

            // Get earliest delivery date from items for order-level delivery_date
            const deliveryDates = items
                .map(item => item.delivery_date)
                .filter(Boolean)
                .sort();
            const earliestDeliveryDate = deliveryDates[0] || null;

            // Prepare order payload
            const orderPayload = {
                order_no: orderNo,
                user_id: user?.id,
                is_b2b: true,
                vendor_id: vendor?.id,
                po_number: poNumber,
                b2b_order_type: orderType,
                merchandiser_name: merchandiser,
                markdown_percent: discountPercent,
                markdown_amount: markdownAmount,
                delivery_date: earliestDeliveryDate, // Order-level: earliest from items
                delivery_address: deliveryAddress,
                items: items, // Each item also has its own delivery_date
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

            // Insert order
            const { data: orderData, error: orderError } = await supabase
                .from("orders")
                .insert([orderPayload])
                .select()
                .single();

            if (orderError) throw orderError;

            // Create approval record
            const { error: approvalError } = await supabase
                .from("b2b_approvals")
                .insert([{
                    order_id: orderData.id,
                    status: "pending",
                    submitted_by: user?.email || "unknown",
                    submitted_at: new Date().toISOString(),
                }]);

            if (approvalError) {
                console.warn("Failed to create approval record:", approvalError);
            }

            // Clear session storage
            sessionStorage.removeItem(VENDOR_SESSION_KEY);
            sessionStorage.removeItem(PRODUCT_SESSION_KEY);
            sessionStorage.removeItem(DETAILS_SESSION_KEY);

            // Success
            showPopup({
                title: "Order Submitted",
                message: `Order ${orderNo} has been submitted for approval.`,
                type: "success",
            });

            setTimeout(() => {
                navigate("/b2b-executive-dashboard");
            }, 2000);

        } catch (error) {
            console.error("Error submitting order:", error);
            showPopup({
                title: "Submission Failed",
                message: error.message || "Failed to submit order. Please try again.",
                type: "error",
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleBack = () => navigate("/b2b-order-details");

    if (!vendorData || !productData || !detailsData) {
        return <div className="b2b-review-loading">Loading...</div>;
    }

    return (
        <div className="b2b-review-bg">
            {PopupComponent}

            {/* Header */}
            <header className="b2b-review-header">
                <img src={Logo} alt="logo" className="b2b-review-logo" onClick={handleBack} />
                <h1 className="b2b-review-title">B2B Order - Review & Submit</h1>
            </header>

            <div className="b2b-review-container">
                {/* Vendor Information */}
                <div className="b2b-review-section">
                    <h3>Vendor Information</h3>
                    <div className="b2b-review-grid">
                        <div className="b2b-review-item">
                            <span className="label">Vendor Name</span>
                            <span className="value">{vendor?.store_brand_name}</span>
                        </div>
                        <div className="b2b-review-item">
                            <span className="label">Vendor Code</span>
                            <span className="value">{vendor?.vendor_code}</span>
                        </div>
                        <div className="b2b-review-item">
                            <span className="label">Location</span>
                            <span className="value">{vendor?.location || "N/A"}</span>
                        </div>
                        <div className="b2b-review-item">
                            <span className="label">GST Number</span>
                            <span className="value">{vendor?.gst_number || "N/A"}</span>
                        </div>
                    </div>
                </div>

                {/* Order Information */}
                <div className="b2b-review-section">
                    <h3>Order Information</h3>
                    <div className="b2b-review-grid">
                        <div className="b2b-review-item">
                            <span className="label">PO Number</span>
                            <span className="value">{poNumber}</span>
                        </div>
                        <div className="b2b-review-item">
                            <span className="label">Order Type</span>
                            <span className={`value badge ${orderType === "Consignment" ? "badge-purple" : "badge-blue"}`}>
                                {orderType}
                            </span>
                        </div>
                        <div className="b2b-review-item">
                            <span className="label">Merchandiser</span>
                            <span className="value">{merchandiser}</span>
                        </div>
                        <div className="b2b-review-item">
                            <span className="label">Markdown</span>
                            <span className="value">{discountPercent}%</span>
                        </div>
                        <div className="b2b-review-item">
                            <span className="label">Mode of Delivery</span>
                            <span className="value">{productData?.modeOfDelivery || "Delhi Store"}</span>
                        </div>
                    </div>
                    <div className="b2b-review-address">
                        <span className="label">Delivery Address</span>
                        <span className="value">{deliveryAddress || "N/A"}</span>
                    </div>
                </div>

                {/* Products Table */}
                <div className="b2b-review-section">
                    <h3>Products ({items.length} items, {totalQuantity} units)</h3>
                    <div className="b2b-review-table-wrapper">
                        <table className="b2b-review-table">
                            <thead>
                                <tr>
                                    <th>#</th>
                                    <th>Product</th>
                                    <th>Top / Bottom</th>
                                    <th>Size</th>
                                    <th>Qty</th>
                                    <th>Delivery</th>
                                    <th>Unit Price</th>
                                    <th>Total</th>
                                </tr>
                            </thead>
                            <tbody>
                                {items.map((item, idx) => (
                                    <tr key={item._id || idx}>
                                        <td>{idx + 1}</td>
                                        <td className="product-name">{item.product_name}</td>
                                        <td>
                                            {item.top}{item.top_color?.name && ` (${item.top_color.name})`}
                                            {" / "}
                                            {item.bottom}{item.bottom_color?.name && ` (${item.bottom_color.name})`}
                                        </td>
                                        <td>{item.size}</td>
                                        <td>{item.quantity}</td>
                                        <td>{item.delivery_date ? formatDate(item.delivery_date) : "N/A"}</td>
                                        <td>₹{formatIndianNumber(item.price)}</td>
                                        <td className="total-col">₹{formatIndianNumber(item.price * item.quantity)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Order Summary */}
                <div className="b2b-review-section b2b-review-summary-section">
                    <h3>Order Summary</h3>
                    <div className="b2b-review-summary">
                        <div className="summary-row">
                            <span>Total Items</span>
                            <span>{totalQuantity}</span>
                        </div>
                        <div className="summary-row">
                            <span>Subtotal</span>
                            <span>₹{formatIndianNumber(subtotal.toFixed(2))}</span>
                        </div>
                        <div className="summary-row">
                            <span>GST (18%)</span>
                            <span>₹{formatIndianNumber(taxes.toFixed(2))}</span>
                        </div>
                        <div className="summary-row gross">
                            <span>Gross Total</span>
                            <span>₹{formatIndianNumber(grandTotal.toFixed(2))}</span>
                        </div>
                        {discountPercent > 0 && (
                            <div className="summary-row markdown">
                                <span>Markdown ({discountPercent}%)</span>
                                <span>- ₹{formatIndianNumber(markdownAmount.toFixed(2))}</span>
                            </div>
                        )}
                        <div className="summary-row final">
                            <span>Final Total</span>
                            <span>₹{formatIndianNumber(finalTotal.toFixed(2))}</span>
                        </div>
                    </div>
                </div>

                {/* Notes */}
                {(remarks || orderNotes) && (
                    <div className="b2b-review-section">
                        <h3>Notes & Remarks</h3>
                        {remarks && (
                            <div className="b2b-review-notes">
                                <strong>Order Remarks:</strong>
                                <p>{remarks}</p>
                            </div>
                        )}
                        {orderNotes && (
                            <div className="b2b-review-notes">
                                <strong>Delivery Notes:</strong>
                                <p>{orderNotes}</p>
                            </div>
                        )}
                    </div>
                )}

                {/* Credit Warning */}
                {exceedsCredit && (
                    <div className="b2b-review-warning">
                        <span className="warning-icon">⚠️</span>
                        <div>
                            <strong>Credit Limit Warning</strong>
                            <p>This order exceeds the vendor's available credit and will require approval.</p>
                        </div>
                    </div>
                )}

                {/* Approval Notice */}
                <div className="b2b-review-approval-notice">
                    <span className="info-icon">ℹ️</span>
                    <div>
                        <strong>Approval Required</strong>
                        <p>This order will be submitted for approval. You will be notified once it's approved.</p>
                    </div>
                </div>
            </div>

            {/* Actions */}
            <div className="b2b-review-actions">
                <button className="b2b-review-btn b2b-review-btn-secondary" onClick={handleBack} disabled={isSubmitting}>
                    ← Back to Edit
                </button>
                <button className="b2b-review-btn b2b-review-btn-submit" onClick={handleSubmit} disabled={isSubmitting}>
                    {isSubmitting ? "Submitting..." : "Submit for Approval"}
                </button>
            </div>

            {/* Floating Back */}
            <button className="b2b-review-floating-back" onClick={handleBack} disabled={isSubmitting}>←</button>
        </div>
    );
}