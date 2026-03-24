import React, { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import "./B2bOrderView.css";
import Logo from "../../images/logo.png";
import formatIndianNumber from "../../utils/formatIndianNumber";
import formatDate from "../../utils/formatDate";
import { downloadCustomerPdf, downloadWarehousePdf } from "../../utils/pdfUtils";

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

export default function B2bOrderView() {
    const navigate = useNavigate();
    const { id } = useParams();
    const [order, setOrder] = useState(null);
    const [vendor, setVendor] = useState(null);
    const [vendorContacts, setVendorContacts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [userRole, setUserRole] = useState(null);
    const [pdfLoading, setPdfLoading] = useState(null);

    const handleDownloadPdf = async (type) => {
        if (!order) return;
        setPdfLoading(type);
        try {
            if (type === "customer") await downloadCustomerPdf(order);
            else await downloadWarehousePdf(order, null, true);
        } catch (err) {
            console.error("PDF download failed:", err);
        } finally {
            setPdfLoading(null);
        }
    };

    useEffect(() => {
        const fetchOrder = async () => {
            try {
                // ✅ Auth check - only B2B users allowed
                const { data: { user } } = await supabase.auth.getUser();
                if (!user) {
                    navigate("/login", { replace: true });
                    return;
                }

                const { data: profile } = await supabase.from("salesperson").select("role").eq("email", user.email?.toLowerCase()).maybeSingle();

                const allowedRoles = ["executive", "merchandiser", "production"];
                if (!profile?.role || !allowedRoles.includes(profile.role)) {
                    console.log("❌ Access denied - not a B2B user");
                    await supabase.auth.signOut();
                    navigate("/login", { replace: true });
                    return;
                }

                setUserRole(profile.role);

                const { data, error } = await supabase
                    .from("orders")
                    .select("*")
                    .eq("id", id)
                    .single();
                if (error) throw error;
                setOrder(data);

                // Fetch vendor
                if (data.vendor_id) {
                    const { data: vendorData } = await supabase
                        .from("vendors")
                        .select("*")
                        .eq("id", data.vendor_id)
                        .single();
                    setVendor(vendorData);

                    // Fetch vendor contacts
                    const { data: contacts } = await supabase
                        .from("vendor_contacts")
                        .select("*")
                        .eq("vendor_id", data.vendor_id)
                        .order("is_primary", { ascending: false });
                    setVendorContacts(contacts || []);
                }
            } catch (err) {
                console.error("Error fetching order:", err);
            } finally {
                setLoading(false);
            }
        };
        fetchOrder();
    }, [id]);

    const handleBack = () => navigate(-1);

    // ==================== EDIT LOGIC ====================
    const getHoursSinceSubmission = () => {
        if (!order?.submitted_for_approval_at && !order?.created_at) return Infinity;
        const submittedAt = new Date(order.submitted_for_approval_at || order.created_at);
        return (Date.now() - submittedAt.getTime()) / (1000 * 60 * 60);
    };

    const canEdit = () => {
        if (!order) return false;
        const status = order.approval_status?.toLowerCase();
        // Rejected orders — always editable
        if (status === "rejected") return true;
        // Already dispatched — not editable
        if (order.production_status === "dispatched") return false;
        // Within 30-hour edit window for pending orders
        if (status === "pending" && getHoursSinceSubmission() <= 30) return true;
        // Merchandiser can edit approved orders too
        if (userRole?.toLowerCase().includes("merchandiser") && status === "approved") return true;
        return false;
    };

    const handleEdit = () => {
        if (!order || !vendor) return;

        // Store editing order ID
        sessionStorage.setItem("b2bEditingOrderId", order.id);

        // Populate vendor session data
        const vendorSessionData = {
            selectedVendorId: vendor.id,
            vendor: vendor,
            vendorContacts: [],
            primaryContact: null,
            poNumber: order.po_number || "",
            merchandiser: order.merchandiser_name || "",
            orderType: order.b2b_order_type || "Buyout",
            discountPercent: order.markdown_percent || 0,
            collectorDiscount: order.discount_percent || 0,
            collectorCode: order.discount_code || "",
            collectorApplied: (order.discount_percent || 0) > 0,
            remarks: order.comments || "",
            availableCredit: (vendor.credit_limit || 0) - (vendor.current_credit_used || 0),
        };
        sessionStorage.setItem("b2bVendorData", JSON.stringify(vendorSessionData));

        // Populate product session data
        const productSessionData = {
            orderItems: order.items || [],
            deliveryDate: order.delivery_date || "",
            modeOfDelivery: order.mode_of_delivery || "Delhi Store",
            orderFlag: order.order_flag || "Normal",
            comments: order.comments || "",
            attachments: order.attachments || [],
            urgentReason: order.urgent_reason || "",
            subtotal: order.subtotal || 0,
            taxes: order.taxes || 0,
            grandTotal: order.grand_total || 0,
            totalQuantity: order.total_quantity || 0,
        };
        sessionStorage.setItem("b2bProductFormData", JSON.stringify(productSessionData));

        // Populate details session data
        const detailsSessionData = {
            deliveryAddress: order.delivery_address || "",
            orderNotes: order.delivery_notes || order.comments || "",
        };
        sessionStorage.setItem("b2bOrderDetailsData", JSON.stringify(detailsSessionData));

        // Navigate to vendor selection to allow full editing
        navigate("/b2b-vendor-selection");
    };

    const getStatusClass = (status) => {
        switch (status?.toLowerCase()) {
            case "approved": return "status-approved";
            case "rejected": return "status-rejected";
            default: return "status-pending";
        }
    };

    if (loading) return <p className="loading">Loading...</p>;
    if (!order) return <p className="loading">Order not found.</p>;

    const items = order.items || [];
    const grandTotal = Number(order.grand_total) || 0;

    return (
        <div className="b2bov-page">
            {/* Header */}
            <header className="b2bov-header">
                <img src={Logo} alt="logo" className="b2bov-logo" onClick={handleBack} />
                <h1 className="b2bov-title">Order Details</h1>
                <div className="b2bov-header-actions">
                    {canEdit() && userRole !== "production" && (
                        <button className="b2bov-edit-btn" onClick={handleEdit}>
                            {"\u270E"} Edit Order
                        </button>
                    )}
                    <button className="b2bov-back-btn" onClick={handleBack}>{"\u2190"} Back</button>
                </div>
            </header>

            <div className="b2bov-container">
                {/* Rejection Reason Banner */}
                {order.approval_status?.toLowerCase() === "rejected" && (
                    <div className="b2bov-rejection-banner">
                        <div className="b2bov-rejection-icon">{"\u26A0\uFE0F"}</div>
                        <div className="b2bov-rejection-content">
                            <strong>Order Rejected</strong>
                            {order.rejection_reason && <p className="b2bov-rejection-reason">{order.rejection_reason}</p>}
                            {order.approved_by && <p className="b2bov-rejection-by">Rejected by: {order.approved_by} {order.approved_at ? `on ${formatDate(order.approved_at)}` : ""}</p>}
                            {userRole !== "production" && (
                                <button className="b2bov-edit-inline-btn" onClick={handleEdit}>{"\u270E"} Edit & Resubmit</button>
                            )}
                        </div>
                    </div>
                )}

                {/* Edit Window Notice */}
                {order.approval_status?.toLowerCase() === "pending" && getHoursSinceSubmission() <= 30 && userRole !== "production" && (
                    <div className="b2bov-edit-notice">
                        Edit window: {Math.max(0, Math.ceil(30 - getHoursSinceSubmission()))} hours remaining
                    </div>
                )}

                {/* Order Status Banner */}
                <div className={`b2bov-status-banner ${getStatusClass(order.approval_status)}`}>
                    <div className="b2bov-status-left">
                        <span className="b2bov-order-no">Order #{order.order_no}</span>
                        <span className="b2bov-order-date">Placed on {formatDate(order.created_at)}</span>
                    </div>
                    <div className="b2bov-status-right">
                        <span className={`b2bov-status-badge ${getStatusClass(order.approval_status)}`}>
                            {order.approval_status || "Pending"}
                        </span>
                        {order.b2b_order_type && (
                            <span className={`b2bov-type-badge ${order.b2b_order_type === "Buyout" ? "type-buyout" : "type-consignment"}`}>
                                {order.b2b_order_type}
                            </span>
                        )}
                        {order.order_flag === "Urgent" && (
                            <span className="b2bov-urgent-badge">{"\u26A0"} Urgent</span>
                        )}
                        {order.credit_exceeded && (
                            <span className="b2bov-credit-badge">Credit Exceeded</span>
                        )}
                    </div>
                </div>

                {/* PDF Actions */}
                <div className="b2bov-actions-bar" style={{ display: "flex", gap: 10, justifyContent: "flex-end", padding: "10px 20px", flexWrap: "wrap" }}>
                    {userRole !== "production" && (
                        <button className="b2bov-action-btn" onClick={() => handleDownloadPdf("customer")} disabled={pdfLoading === "customer"} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #d5b85a", background: "#fff", color: "#8b7240", fontWeight: 600, cursor: "pointer", fontSize: 13 }}>
                            {pdfLoading === "customer" ? "Downloading..." : "\uD83D\uDCC4 Customer PDF"}
                        </button>
                    )}
                    <button className="b2bov-action-btn" onClick={() => handleDownloadPdf("warehouse")} disabled={pdfLoading === "warehouse"} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #d5b85a", background: "#fff", color: "#8b7240", fontWeight: 600, cursor: "pointer", fontSize: 13 }}>
                        {pdfLoading === "warehouse" ? "Downloading..." : "\uD83D\uDCC4 Warehouse PDF"}
                    </button>
                </div>

                {/* Urgent Reason Banner */}
                {order.order_flag === "Urgent" && order.urgent_reason && (
                    <div className="b2bov-urgent-banner">
                        <strong>{"\u26A0"} Urgent Order</strong>
                        <p>Reason: {order.urgent_reason}</p>
                    </div>
                )}

                {/* Credit Exceeded Banner */}
                {order.credit_exceeded && (
                    <div className="b2bov-credit-banner">
                        <strong>{"\u26A0"} Credit Limit Exceeded</strong>
                        <p>This order exceeds the vendor's available credit and requires merchandiser approval.</p>
                    </div>
                )}

                {/* Product Details */}
                <div className="b2bov-section">
                    <h3>Product Details</h3>
                    {items.map((item, i) => (
                        <div key={i} className="b2bov-product-box">
                            {item.image_url && (
                                <img src={item.image_url} className="b2bov-prod-img" alt="" />
                            )}
                            <div className="b2bov-product-fields">
                                <div className="b2bov-row">
                                    <div className="b2bov-field b2bov-field-wide">
                                        <label>Product Name:</label>
                                        <span>{item.product_name || "—"}</span>
                                    </div>
                                </div>
                                <div className="b2bov-grid">
                                    <div className="b2bov-field">
                                        <label>Top:</label>
                                        <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                                            <span>{item.top || "—"}</span>
                                            {item.top_color && <ColorDotDisplay colorObject={item.top_color} />}
                                        </div>
                                    </div>
                                    <div className="b2bov-field">
                                        <label>Bottom:</label>
                                        <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                                            <span>{item.bottom || "—"}</span>
                                            {item.bottom_color && <ColorDotDisplay colorObject={item.bottom_color} />}
                                        </div>
                                    </div>
                                    <div className="b2bov-field">
                                        <label>Size:</label>
                                        <span>{item.size || "—"}</span>
                                    </div>
                                    <div className="b2bov-field">
                                        <label>Quantity:</label>
                                        <span>{item.quantity || 1}</span>
                                    </div>
                                    <div className="b2bov-field">
                                        <label>Price:</label>
                                        <span>₹{formatIndianNumber(item.price || 0)}</span>
                                    </div>
                                </div>
                                {Array.isArray(item.extras) && item.extras.length > 0 && (
                                    <div className="b2bov-field b2bov-field-wide">
                                        <label>Extras:</label>
                                        <div className="b2bov-extras-display">
                                            {item.extras.map((extra, idx) => (
                                                <div key={idx} className="b2bov-extra-item">
                                                    <span>{extra.name} ({"\u20B9"}{formatIndianNumber(extra.price || 0)})</span>
                                                    {extra.color && extra.color.name && <ColorDotDisplay colorObject={extra.color} />}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>

                {/* Vendor & Order Info */}
                <div className="b2bov-section">
                    <h3>Order Information</h3>
                    <div className="b2bov-info-grid">
                        <div className="b2bov-field">
                            <label>PO Number:</label>
                            <span>{order.po_number || "—"}</span>
                        </div>
                        <div className="b2bov-field">
                            <label>Merchandiser:</label>
                            <span>{order.merchandiser || order.merchandiser_name || "—"}</span>
                        </div>
                        {vendor && (
                            <>
                                <div className="b2bov-field">
                                    <label>Vendor:</label>
                                    <span>{vendor.store_brand_name} ({vendor.vendor_code})</span>
                                </div>
                                <div className="b2bov-field">
                                    <label>Vendor Location:</label>
                                    <span>{vendor.location || "—"}</span>
                                </div>
                            </>
                        )}
                        <div className="b2bov-field">
                            <label>Delivery Date:</label>
                            <span>{formatDate(order.delivery_date) || "—"}</span>
                        </div>
                        <div className="b2bov-field">
                            <label>Delivery Address:</label>
                            <span>{order.delivery_address || "\u2014"}</span>
                        </div>
                        {vendorContacts.length > 0 && vendorContacts.map((contact, idx) => (
                            <div key={idx} className="b2bov-field">
                                <label>{contact.is_primary ? "Primary Contact:" : "Contact:"}</label>
                                <span>
                                    {contact.contact_name || ""}
                                    {contact.contact_phone && ` \u2022 ${contact.contact_phone}`}
                                    {contact.contact_email && ` \u2022 ${contact.contact_email}`}
                                </span>
                            </div>
                        ))}
                    </div>
                    {(order.order_notes || order.delivery_notes || order.comments) && (
                        <div className="b2bov-field b2bov-field-wide" style={{ marginTop: 12 }}>
                            <label>Order Notes:</label>
                            <span>{order.order_notes || order.delivery_notes || order.comments}</span>
                        </div>
                    )}
                </div>

                {/* Payment Details */}
                <div className="b2bov-section">
                    <h3>Payment Details</h3>
                    <div className="b2bov-info-grid">
                        <div className="b2bov-field">
                            <label>Subtotal:</label>
                            <span>₹{formatIndianNumber(Math.round(order.subtotal || 0))}</span>
                        </div>
                        <div className="b2bov-field">
                            <label>GST (18%):</label>
                            <span>₹{formatIndianNumber(Math.round(order.taxes || 0))}</span>
                        </div>
                        {order.markdown_percent > 0 && (
                            <div className="b2bov-field">
                                <label>Markdown ({order.markdown_percent}%):</label>
                                <span style={{ color: "#4caf50" }}>- ₹{formatIndianNumber(Math.round(order.markdown_amount || 0))}</span>
                            </div>
                        )}
                        {order.discount_percent > 0 && (
                            <div className="b2bov-field">
                                <label>Collector Code ({order.discount_percent}%){order.discount_code ? ` — ${order.discount_code}` : ""}:</label>
                                <span style={{ color: "#4caf50" }}>- ₹{formatIndianNumber(Math.round(order.discount_amount || 0))}</span>
                            </div>
                        )}
                        <div className="b2bov-field b2bov-field-total">
                            <label>Grand Total:</label>
                            <span>₹{formatIndianNumber(grandTotal)}</span>
                        </div>
                        <div className="b2bov-field">
                            <label>Total Quantity:</label>
                            <span>{order.total_quantity || 1} unit(s)</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Floating Back */}
            <button className="b2bov-floating-back" onClick={handleBack}>←</button>
        </div>
    );
}