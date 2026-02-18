import React, { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import "./B2bOrderView.css";
import Logo from "../../images/logo.png";
import formatIndianNumber from "../../utils/formatIndianNumber";
import formatDate from "../../utils/formatDate";

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
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchOrder = async () => {
            try {
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
                <button className="b2bov-back-btn" onClick={handleBack}>← Back</button>
            </header>

            <div className="b2bov-container">
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
                    </div>
                </div>

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
                                {item.extras && item.extras.length > 0 && (
                                    <div className="b2bov-field b2bov-field-wide">
                                        <label>Extras:</label>
                                        <div className="b2bov-extras-display">
                                            {item.extras.map((extra, idx) => (
                                                <div key={idx} className="b2bov-extra-item">
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
                            <span>{order.delivery_address || "—"}</span>
                        </div>
                    </div>
                    {order.order_notes && (
                        <div className="b2bov-field b2bov-field-wide" style={{ marginTop: 12 }}>
                            <label>Order Notes:</label>
                            <span>{order.order_notes}</span>
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
                        {order.discount_percent > 0 && (
                            <div className="b2bov-field">
                                <label>Markdown ({order.discount_percent}%):</label>
                                <span>- ₹{formatIndianNumber(Math.round(order.discount_amount || 0))}</span>
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
            <button className="b2bov-floating-back" onClick={handleBack}>←</button>
        </div>
    );
}