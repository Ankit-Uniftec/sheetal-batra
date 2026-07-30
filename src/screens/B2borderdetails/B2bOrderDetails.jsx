import React, { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import "../Screen4.css";
import "./B2bOrderDetails.css";
import Logo from "../../images/logo.png";
import formatIndianNumber from "../../utils/formatIndianNumber";
import formatDate from "../../utils/formatDate";
import { usePopup } from "../../components/Popup";
import { isB2bStockOrder, B2B_STOCK_DELIVERY } from "../../utils/b2bStockOrder";

const VENDOR_SESSION_KEY = "b2bVendorData";
const PRODUCT_SESSION_KEY = "b2bProductFormData";
const DETAILS_SESSION_KEY = "b2bOrderDetailsData";

export default function B2bOrderDetails() {
    const navigate = useNavigate();
    const location = useLocation();
    const { showPopup, PopupComponent } = usePopup();

    // B2B STOCK ORDER: no vendor, no pricing. The vendor-data guards below must
    // not fire, and the delivery destination is the fixed internal one rather
    // than a vendor's shipping address. See src/utils/b2bStockOrder.js.
    const isStockOrder = isB2bStockOrder(location.state);

    const [vendorData, setVendorData] = useState(null);
    const [productData, setProductData] = useState(null);
    const [orderNotes, setOrderNotes] = useState("");

    // Load data from session
    useEffect(() => {
        const checkAuthAndLoad = async () => {
            // ✅ Auth check - only B2B users allowed
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) {
                navigate("/login", { replace: true });
                return;
            }

            const { data: sp } = await supabase.from("salesperson").select("role").eq("email", user.email?.toLowerCase()).maybeSingle();
            const allowedRoles = ["executive", "merchandiser", "production"];
            if (!sp?.role || !allowedRoles.includes(sp.role)) {
                await supabase.auth.signOut();
                navigate("/login", { replace: true });
                return;
            }

            // Load session data
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

            // A stock order has no vendor step, so only the product data is
            // required; missing products sends it back to the product form
            // rather than to vendor selection it never visited.
            if (isStockOrder) {
                if (!productSaved) {
                    showPopup({ title: "Missing Data", message: "Please add products first.", type: "warning" });
                    setTimeout(() => navigate("/b2b-product-form"), 1500);
                }
            } else if (!vendorSaved || !productSaved) {
                showPopup({ title: "Missing Data", message: "Please complete previous steps first.", type: "warning" });
                setTimeout(() => navigate("/b2b-vendor-selection"), 1500);
            }
        };

        checkAuthAndLoad();
    }, [navigate]);

    // Save to session
    useEffect(() => {
        const vendor = vendorData?.vendor;
        const deliveryAddress = isStockOrder
            ? B2B_STOCK_DELIVERY.delivery_address
            : (vendor?.shipping_address || vendor?.location || "N/A");
        const data = { deliveryAddress, orderNotes };
        sessionStorage.setItem(DETAILS_SESSION_KEY, JSON.stringify(data));
    }, [vendorData, orderNotes, isStockOrder]);

    // Derived data
    const vendor = vendorData?.vendor;
    const items = productData?.orderItems || [];
    const subtotal = productData?.subtotal || 0;
    const taxes = productData?.taxes || 0;
    const grandTotal = productData?.grandTotal || 0;
    const totalQuantity = productData?.totalQuantity || 0;

    const discountPercent = vendorData?.discountPercent || 0;
    const markdownAmount = grandTotal * (discountPercent / 100);
    const collectorDiscount = vendorData?.collectorDiscount || 0;
    const collectorDiscountAmount = grandTotal * (collectorDiscount / 100);
    const finalTotal = grandTotal - markdownAmount - collectorDiscountAmount;

    const availableCredit = vendorData?.availableCredit || 0;
    const orderType = vendorData?.orderType || "Buyout";
    const projectedCredit = (vendor?.current_credit_used || 0) + (orderType === "Buyout" ? finalTotal : 0);
    const creditLimit = vendor?.credit_limit || 0;
    // Stock orders draw against no vendor credit at all. Without this guard the
    // check would compare against creditLimit 0 (no vendor row) and warn on any
    // non-zero total — it only stays quiet today because stock totals are zeroed.
    const exceedsCredit = !isStockOrder && orderType === "Buyout" && projectedCredit > creditLimit;

    const deliveryAddress = isStockOrder
        ? B2B_STOCK_DELIVERY.delivery_address
        : (vendor?.shipping_address || vendor?.location || "N/A");

    const handleContinue = () => {
        const detailsData = { deliveryAddress, orderNotes };
        sessionStorage.setItem(DETAILS_SESSION_KEY, JSON.stringify(detailsData));
        navigate("/b2b-review-order");
    };

    const handleBack = () => navigate("/b2b-product-form");

    // A stock order has no vendorData at all, so gating the render on it would
    // hang on "Loading..." forever — only the product data is required.
    if (!productData || (!isStockOrder && !vendorData)) {
        return <div className="b2b-od-loading">Loading...</div>;
    }

    return (
        <div className="screen4-bg">
            {PopupComponent}

            <header className="pf-header">
                <img src={Logo} alt="logo" className="pf-header-logo" onClick={handleBack} />
                <h1 className="pf-header-title">{isStockOrder ? "B2B Stock Order Details" : "Order Details"}</h1>
                {isStockOrder ? (
                    <div className="b2b-vendor-badge">
                        <span className="vendor-name">Internal Stock</span>
                        <span className="vendor-code">{B2B_STOCK_DELIVERY.delivery_address}</span>
                    </div>
                ) : vendor && (
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
                    {/* Stock orders have no vendor, PO, order type or markdown — the
                        whole commercial half of this summary is meaningless for them. */}
                    {isStockOrder ? (
                        <div className="b2b-od-row3">
                            <div className="b2b-od-field"><label>Order For:</label><span>Internal Stock</span></div>
                            <div className="b2b-od-field"><label>Products:</label><span>{items.length} item(s), {totalQuantity} unit(s)</span></div>
                        </div>
                    ) : (
                        <>
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
                        </>
                    )}
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
                            {!isStockOrder && <span className="b2b-od-product-price">₹{formatIndianNumber(item.price * item.quantity)}</span>}
                        </div>
                    ))}
                </div>

                {/* Delivery Details - READ ONLY */}
                <div className="b2b-od-section">
                    <h3>Delivery Details</h3>
                    <div className="b2b-od-row3">
                        <div className="b2b-od-field"><label>Delivery Address:</label><span>{deliveryAddress}</span></div>
                        <div className="b2b-od-field"><label>Mode of Delivery:</label><span>{productData?.modeOfDelivery || "B2B Store"}</span></div>
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

                {/* Order Totals — a stock order has none (no charge, no vendor
                    credit to draw against), so the whole block is omitted rather
                    than rendered as a column of zeros. */}
                {!isStockOrder && (
                <div className="b2b-od-section">
                    <h3>Order Totals</h3>
                    <div className="b2b-od-payment-rows">
                        <div className="b2b-od-field-inline"><label>Subtotal:</label><span>{"\u20B9"}{formatIndianNumber(Math.round(subtotal))}</span></div>
                        <div className="b2b-od-field-inline"><label>GST (18%):</label><span>{"\u20B9"}{formatIndianNumber(Math.round(taxes))}</span></div>
                        <div className="b2b-od-field-inline"><label>Gross Total:</label><span>{"\u20B9"}{formatIndianNumber(Math.round(grandTotal))}</span></div>
                        {discountPercent > 0 && (
                            <div className="b2b-od-field-inline"><label>Markdown ({discountPercent}%):</label><span style={{ color: "#4caf50" }}>- {"\u20B9"}{formatIndianNumber(Math.round(markdownAmount))}</span></div>
                        )}
                        {collectorDiscount > 0 && (
                            <div className="b2b-od-field-inline"><label>Collector Code ({collectorDiscount}%):</label><span style={{ color: "#4caf50" }}>- {"\u20B9"}{formatIndianNumber(Math.round(collectorDiscountAmount))}</span></div>
                        )}
                        <div className="b2b-od-final-total-inline"><label>Final Total:</label><span>{"\u20B9"}{formatIndianNumber(Math.round(finalTotal))}</span></div>
                        <div className="b2b-od-field-inline"><label>Available Credit:</label><span style={{ color: availableCredit <= 0 ? "#c62828" : "#2e7d32" }}>{"\u20B9"}{formatIndianNumber(availableCredit)}</span></div>
                    </div>
                </div>
                )}

                {/* Credit Warning */}
                {exceedsCredit && (
                    <div className="b2b-od-warning">
                        <span>{"⚠️"}</span>
                        <div>
                            <strong>Credit Limit Warning</strong>
                            <p>This order will exceed the vendor's credit limit and will require approval.</p>
                        </div>
                    </div>
                )}

                {/* Footer Buttons */}
                <div className="footer-btns">
                    <button className="draftBtn" onClick={handleBack}>Back to Products</button>
                    <button className="continueBtn" onClick={handleContinue}>Review Order</button>
                </div>
            </div>

            <button className="back-btn" onClick={handleBack}>{"←"}</button>
        </div>
    );
}