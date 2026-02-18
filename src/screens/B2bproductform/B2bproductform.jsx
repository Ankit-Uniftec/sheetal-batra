import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import "../Screen4.css";
import "./B2bProductForm.css";
import Logo from "../../images/logo.png";
import formatIndianNumber from "../../utils/formatIndianNumber";
import formatDate from "../../utils/formatDate";
import { usePopup } from "../../components/Popup";

/**
 * Session Storage Keys
 */
const VENDOR_SESSION_KEY = "b2bVendorData";
const PRODUCT_SESSION_KEY = "b2bProductFormData";

/**
 * Searchable Select
 */
export function SearchableSelect({ options, value, onChange, placeholder = "Select…", disabled = false, className = "" }) {
    const normalized = useMemo(() => (options || []).map((o) => typeof o === "object" && o !== null && "label" in o && "value" in o ? o : { label: String(o), value: o }), [options]);
    const current = useMemo(() => normalized.find((o) => String(o.value) === String(value)) || null, [normalized, value]);
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [focusIdx, setFocusIdx] = useState(-1);
    const rootRef = useRef(null);
    const inputRef = useRef(null);
    const listRef = useRef(null);
    const filtered = useMemo(() => { const q = query.trim().toLowerCase(); if (!q) return normalized; return normalized.filter((o) => o.label.toLowerCase().includes(q)); }, [normalized, query]);

    useEffect(() => { if (!open) { if (!value) setQuery(""); else if (current) setQuery(current.label); } }, [value, current, open]);
    useEffect(() => { const onDoc = (e) => { if (!rootRef.current?.contains(e.target)) { setOpen(false); setFocusIdx(-1); if (current) setQuery(current.label); } }; document.addEventListener("mousedown", onDoc); return () => document.removeEventListener("mousedown", onDoc); }, [current]);
    useEffect(() => { if (!open || !listRef.current || focusIdx < 0) return; const el = listRef.current.querySelector(`[data-idx="${focusIdx}"]`); if (el?.scrollIntoView) el.scrollIntoView({ block: "nearest" }); }, [focusIdx, open]);

    const handleSelect = (opt) => { onChange(opt?.value ?? ""); setOpen(false); setQuery(opt?.label ?? ""); setFocusIdx(-1); requestAnimationFrame(() => inputRef.current?.focus()); };
    const handleKeyDown = (e) => { if (!open && (e.key === "ArrowDown" || e.key === "Enter")) { setOpen(true); setFocusIdx(0); if (current) setQuery(""); return; } if (!open) return; if (e.key === "ArrowDown") { e.preventDefault(); setFocusIdx((i) => Math.min((filtered.length || 1) - 1, i + 1)); } else if (e.key === "ArrowUp") { e.preventDefault(); setFocusIdx((i) => Math.max(0, i - 1)); } else if (e.key === "Enter") { e.preventDefault(); const opt = filtered[focusIdx]; if (opt) handleSelect(opt); } else if (e.key === "Escape") { e.preventDefault(); setOpen(false); setFocusIdx(-1); if (current) setQuery(current.label); } };
    const clear = (e) => { e.stopPropagation(); onChange(""); setQuery(""); inputRef.current?.focus(); };

    return (
        <div ref={rootRef} className={`ss-root ${disabled ? "ss-disabled" : ""} ${className}`}>
            <div className={`ss-control ${open ? "ss-open" : ""}`} onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); if (disabled) return; setOpen(true); setFocusIdx(-1); requestAnimationFrame(() => inputRef.current?.focus()); }}>
                <input ref={inputRef} className="ss-input" placeholder={placeholder} value={query} onChange={(e) => { setQuery(e.target.value); if (!open) setOpen(true); setFocusIdx(0); }} onFocus={() => { if (current && query === current.label) setQuery(""); setOpen(true); }} onKeyDown={handleKeyDown} disabled={disabled} />
                {current && <button className="ss-clear" title="Clear" onClick={clear}>×</button>}
            </div>
            {open && (
                <div className="ss-menu" role="listbox">
                    {filtered.length === 0 ? <div className="ss-empty">No matches</div> : (
                        <ul ref={listRef} className="ss-list">
                            {filtered.map((opt, idx) => (
                                <li key={String(opt.value)} data-idx={idx} className={`ss-option ${String(opt.value) === String(value) ? "is-selected" : ""} ${idx === focusIdx ? "is-focused" : ""}`} onMouseEnter={() => setFocusIdx(idx)} onMouseDown={(e) => e.preventDefault()} onClick={() => handleSelect(opt)} role="option" aria-selected={String(opt.value) === String(value)}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                        {opt.hex && <div style={{ width: "14px", height: "14px", borderRadius: "50%", backgroundColor: opt.hex, border: "1px solid #ccc" }} />}
                                        {opt.label}
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}
        </div>
    );
}

const SIZE_OPTIONS = ["XXS", "XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL", "6XL", "7XL", "8XL"];

const SIZE_CHART_US = {
    XXS: { Bust: 30, Waist: 24, Hip: 34 }, XS: { Bust: 32, Waist: 26, Hip: 36 }, S: { Bust: 34, Waist: 28, Hip: 38 },
    M: { Bust: 36, Waist: 30, Hip: 40 }, L: { Bust: 38, Waist: 32, Hip: 42 }, XL: { Bust: 40, Waist: 34, Hip: 44 },
    "2XL": { Bust: 42, Waist: 36, Hip: 46 }, "3XL": { Bust: 44, Waist: 38, Hip: 48 }, "4XL": { Bust: 46, Waist: 40, Hip: 50 },
    "5XL": { Bust: 48, Waist: 42, Hip: 52 }, "6XL": { Bust: 50, Waist: 44, Hip: 54 }, "7XL": { Bust: 52, Waist: 46, Hip: 56 },
    "8XL": { Bust: 54, Waist: 48, Hip: 58 },
};

const CATEGORY_KEY_MAP = {
    "Short Kurta": "KurtaChogaKaftan", "Kurta": "KurtaChogaKaftan", "Long Kurta": "KurtaChogaKaftan",
    "Short Choga": "KurtaChogaKaftan", "Choga": "KurtaChogaKaftan", "Long Choga": "KurtaChogaKaftan", "Kaftan": "KurtaChogaKaftan",
    "Blouse": "Blouse", "Short Anarkali": "Anarkali", "Anarkali": "Anarkali",
    "Salwar": "SalwarDhoti", "Dhoti": "SalwarDhoti",
    "Churidaar": "ChuridaarTrouserPantsPlazo", "Trouser": "ChuridaarTrouserPantsPlazo", "Pants": "ChuridaarTrouserPantsPlazo", "Palazzo": "ChuridaarTrouserPantsPlazo",
    "Sharara": "ShararaGharara", "Gharara": "ShararaGharara", "Lehenga": "Lehenga",
};

const CATEGORY_DISPLAY_NAMES = {
    "Height": "Height", "KurtaChogaKaftan": "Kurta / Choga / Kaftan", "Blouse": "Blouse", "Anarkali": "Anarkali",
    "SalwarDhoti": "Salwar / Dhoti", "ChuridaarTrouserPantsPlazo": "Churidaar / Trouser / Pants / Palazzo",
    "ShararaGharara": "Sharara / Gharara", "Lehenga": "Lehenga",
};

const ALL_MEASUREMENT_CATEGORIES = ["Height", "Kurta / Choga / Kaftan", "Blouse", "Anarkali", "Salwar / Dhoti", "Churidaar / Trouser / Pants / Palazzo", "Sharara / Gharara", "Lehenga"];

const measurementFields = {
    Height: ["Height"],
    KurtaChogaKaftan: ["Shoulder", "Neck", "Upper Bust", "Bust", "Dart Point", "Sleeves", "Mori", "Bicep", "Arm Hole", "Waist", "Hip", "Length", "Front Cross", "Back Cross", "Front Neck", "Back Neck"],
    Blouse: ["Shoulder", "Upper Bust", "Bust", "Dart Point", "Sleeves", "Mori", "Arm Hole", "Waist", "Length", "Front Cross", "Back Cross", "Front Neck", "Back Neck"],
    Anarkali: ["Shoulder", "Upper Bust", "Bust", "Dart Point", "Sleeves", "Mori", "Bicep", "Arm Hole", "Length", "Front Neck", "Back Neck"],
    SalwarDhoti: ["Waist", "Hip", "Length"],
    ChuridaarTrouserPantsPlazo: ["Waist", "Hip", "Length", "Thigh", "Calf", "Ankle", "Knee", "Yoke Length"],
    ShararaGharara: ["Waist", "Hip", "Length"],
    Lehenga: ["Waist", "Hip", "Length"],
};

export default function B2bProductForm() {
    const navigate = useNavigate();
    const { showPopup, PopupComponent } = usePopup();

    // Vendor data from session
    const [vendorData, setVendorData] = useState(null);
    const [vendor, setVendor] = useState(null);

    // Products & Options
    const [products, setProducts] = useState([]);
    const [selectedProduct, setSelectedProduct] = useState(null);
    const [colors, setColors] = useState([]);
    const [tops, setTops] = useState([]);
    const [bottoms, setBottoms] = useState([]);
    const [globalExtras, setGlobalExtras] = useState([]);

    // Selections
    const [selectedTop, setSelectedTop] = useState("");
    const [selectedBottom, setSelectedBottom] = useState("");
    const [selectedTopColor, setSelectedTopColor] = useState({ name: "", hex: "" });
    const [selectedBottomColor, setSelectedBottomColor] = useState({ name: "", hex: "" });
    const [selectedExtra, setSelectedExtra] = useState("");
    const [selectedExtraColor, setSelectedExtraColor] = useState({ name: "", hex: "" });
    const [selectedExtrasWithColors, setSelectedExtrasWithColors] = useState([]);
    const [selectedAdditionals, setSelectedAdditionals] = useState([]);
    const [showAdditionals, setShowAdditionals] = useState(false);

    // Size & Quantity
    const [selectedSize, setSelectedSize] = useState("M");
    const [quantity, setQuantity] = useState(1);
    const [availableSizes, setAvailableSizes] = useState(SIZE_OPTIONS);

    // Measurements
    const [measurements, setMeasurements] = useState({});
    const [showMeasurements, setShowMeasurements] = useState(false);
    const [activeCategory, setActiveCategory] = useState("Kurta / Choga / Kaftan");

    // Order Items
    const [orderItems, setOrderItems] = useState([]);
    const [expandedRowIds, setExpandedRowIds] = useState({});

    // Order Details
    const [deliveryDate, setDeliveryDate] = useState("");
    const [modeOfDelivery, setModeOfDelivery] = useState("Delhi Store");
    const [orderFlag, setOrderFlag] = useState("Normal");
    const [comments, setComments] = useState("");
    const [attachments, setAttachments] = useState([]);

    // Urgent Modal
    const [showUrgentModal, setShowUrgentModal] = useState(false);
    const [urgentReason, setUrgentReason] = useState("");
    const [otherUrgentReason, setOtherUrgentReason] = useState("");

    const isRestoredRef = useRef(false);
    const makeId = () => `${Date.now()}_${Math.random().toString(16).slice(2)}`;

    // ==================== LOAD VENDOR DATA FROM SESSION ====================
    useEffect(() => {
        const saved = sessionStorage.getItem(VENDOR_SESSION_KEY);
        if (saved) {
            try {
                const data = JSON.parse(saved);
                setVendorData(data);
                setVendor(data.vendor);
            } catch (e) {
                console.error("Error loading vendor data:", e);
            }
        }
        
        if (!saved) {
            showPopup({ title: "No Vendor Selected", message: "Please select a vendor first.", type: "warning" });
            setTimeout(() => navigate("/b2b-vendor-selection"), 1500);
        }
    }, [navigate]);

    // ==================== RESTORE PRODUCT FORM DATA FROM SESSION ====================
    useEffect(() => {
        const saved = sessionStorage.getItem(PRODUCT_SESSION_KEY);
        if (saved) {
            try {
                isRestoredRef.current = true;
                const data = JSON.parse(saved);
                if (data.orderItems) setOrderItems(data.orderItems);
                if (data.deliveryDate) setDeliveryDate(data.deliveryDate);
                if (data.modeOfDelivery) setModeOfDelivery(data.modeOfDelivery);
                if (data.orderFlag) setOrderFlag(data.orderFlag);
                if (data.comments) setComments(data.comments);
                if (data.attachments) setAttachments(data.attachments);
                if (data.urgentReason) setUrgentReason(data.urgentReason);
                if (data.otherUrgentReason) setOtherUrgentReason(data.otherUrgentReason);
                setTimeout(() => { isRestoredRef.current = false; }, 100);
            } catch (e) {
                console.error("Error restoring product form data:", e);
                isRestoredRef.current = false;
            }
        }
    }, []);

    // ==================== SAVE PRODUCT FORM DATA TO SESSION ====================
    useEffect(() => {
        const data = {
            orderItems,
            deliveryDate,
            modeOfDelivery,
            orderFlag,
            comments,
            attachments,
            urgentReason,
            otherUrgentReason,
        };
        sessionStorage.setItem(PRODUCT_SESSION_KEY, JSON.stringify(data));
    }, [orderItems, deliveryDate, modeOfDelivery, orderFlag, comments, attachments, urgentReason, otherUrgentReason]);

    // ==================== FETCH DATA ====================
    useEffect(() => {
        supabase.from("products").select("*, product_extra_prices (*)").order("name").then(({ data }) => setProducts(data || []));
        supabase.from("colors").select("name, hex").order("name").then(({ data }) => setColors(data || []));
        supabase.from("extras").select("name, price, sort_order").order("sort_order").then(({ data }) => setGlobalExtras(data || []));
    }, []);

    // Product change
    useEffect(() => {
        if (isRestoredRef.current) return;
        if (!selectedProduct) {
            setTops([]); setBottoms([]); setAvailableSizes(SIZE_OPTIONS); setSelectedSize("M");
            setSelectedTop(""); setSelectedBottom(""); setSelectedTopColor({ name: "", hex: "" }); setSelectedBottomColor({ name: "", hex: "" });
            setSelectedExtrasWithColors([]); setSelectedAdditionals([]); setQuantity(1); setMeasurements({});
            return;
        }
        setTops(selectedProduct.top_options || []);
        setBottoms([...(selectedProduct.bottom_options || [])].sort((a, b) => String(a).localeCompare(String(b))));
        const sizes = selectedProduct.available_size?.length > 0 ? selectedProduct.available_size : SIZE_OPTIONS;
        setAvailableSizes(sizes);
        const defaultTop = selectedProduct.default_top || selectedProduct.top_options?.[0] || "";
        const defaultBottom = selectedProduct.default_bottom || selectedProduct.bottom_options?.[0] || "";
        const defaultColorName = selectedProduct.default_color || "";
        const defaultColor = colors.find(c => c.name === defaultColorName) || { name: "", hex: "" };
        setSelectedTop(defaultTop);
        setSelectedTopColor(defaultTop ? defaultColor : { name: "", hex: "" });
        setSelectedBottom(defaultBottom);
        setSelectedBottomColor(defaultBottom ? defaultColor : { name: "", hex: "" });
        if (!sizes.includes(selectedSize)) setSelectedSize(sizes[0] || "M");
        if (selectedProduct.default_extra) {
            const extra = globalExtras.find(e => e.name === selectedProduct.default_extra);
            if (extra) setSelectedExtrasWithColors([{ name: selectedProduct.default_extra, color: defaultColor, price: extra.price || 0 }]);
        } else setSelectedExtrasWithColors([]);
        setSelectedExtra(""); setSelectedExtraColor({ name: "", hex: "" });
    }, [selectedProduct, colors, globalExtras]);

    // Auto-fill size chart
    useEffect(() => {
        if (isRestoredRef.current || !selectedSize || !selectedProduct) return;
        const sizeData = SIZE_CHART_US[selectedSize];
        if (!sizeData) return;
        const relevantKeys = new Set();
        if (selectedTop && CATEGORY_KEY_MAP[selectedTop]) relevantKeys.add(CATEGORY_KEY_MAP[selectedTop]);
        if (selectedBottom && CATEGORY_KEY_MAP[selectedBottom]) relevantKeys.add(CATEGORY_KEY_MAP[selectedBottom]);
        if (relevantKeys.size === 0) {
            const key = getCategoryKeyFromDisplayName(activeCategory);
            if (key) relevantKeys.add(key);
        }
        const updated = {};
        relevantKeys.forEach(categoryKey => {
            const fields = measurementFields[categoryKey] || [];
            const vals = {};
            if (fields.includes("Bust") && sizeData.Bust) vals.Bust = sizeData.Bust;
            if (fields.includes("Waist") && sizeData.Waist) vals.Waist = sizeData.Waist;
            if (fields.includes("Hip") && sizeData.Hip) vals.Hip = sizeData.Hip;
            if (Object.keys(vals).length > 0) updated[categoryKey] = vals;
        });
        if (Object.keys(updated).length > 0) {
            setMeasurements(prev => {
                const newM = { ...prev };
                Object.entries(updated).forEach(([k, v]) => { newM[k] = { ...(prev[k] || {}), ...v }; });
                return newM;
            });
        }
    }, [selectedSize, selectedProduct, selectedTop, selectedBottom]);

    // Helpers
    const toOptions = (arr = []) => arr.map(x => ({ label: String(x), value: x }));
    const toColorOptions = (clrs = []) => clrs.map(c => ({ label: c.name, value: c.name, hex: c.hex }));
    const toExtraOptions = (extras = []) => extras.map(e => ({ label: `${e.name} (₹${formatIndianNumber(e.price)})`, value: e.name, price: e.price }));
    const getCategoryKeyFromDisplayName = (displayName) => { for (const [k, v] of Object.entries(CATEGORY_DISPLAY_NAMES)) if (v === displayName) return k; return null; };
    const getRelevantMeasurementCategories = () => {
        const keys = new Set(["Height"]);
        if (selectedTop && CATEGORY_KEY_MAP[selectedTop]) keys.add(CATEGORY_KEY_MAP[selectedTop]);
        if (selectedBottom && CATEGORY_KEY_MAP[selectedBottom]) keys.add(CATEGORY_KEY_MAP[selectedBottom]);
        return keys.size === 1 ? ALL_MEASUREMENT_CATEGORIES : Array.from(keys).map(k => CATEGORY_DISPLAY_NAMES[k]);
    };
    const getRelevantMeasurements = () => {
        const keys = new Set(["Height"]);
        if (selectedTop && CATEGORY_KEY_MAP[selectedTop]) keys.add(CATEGORY_KEY_MAP[selectedTop]);
        if (selectedBottom && CATEGORY_KEY_MAP[selectedBottom]) keys.add(CATEGORY_KEY_MAP[selectedBottom]);
        const filtered = {};
        for (const [k, v] of Object.entries(measurements)) if (keys.has(k)) filtered[k] = v;
        return filtered;
    };
    const getBasePrice = () => {
        if (!selectedProduct) return 0;
        let price = Number(selectedProduct.base_price || 0);
        selectedAdditionals.forEach(a => { price += Number(a.price || 0); });
        return Math.round(price);
    };
    const toggleExpand = (id) => setExpandedRowIds(e => ({ ...e, [id]: !e[id] }));
    const handleDelete = (id) => setOrderItems(prev => prev.filter(it => it._id !== id));
    const updateItem = (id, patch) => setOrderItems(prev => prev.map(it => it._id !== id ? it : { ...it, ...patch }));
    const handleAddExtra = () => {
        if (!selectedExtra) return;
        if (!selectedExtraColor.name) { showPopup({ title: "Color Required", message: "Please select a color for the extra.", type: "warning" }); return; }
        const extra = globalExtras.find(e => e.name === selectedExtra);
        setSelectedExtrasWithColors(prev => [...prev, { name: selectedExtra, color: selectedExtraColor, price: extra?.price || 0 }]);
        setSelectedExtra(""); setSelectedExtraColor({ name: "", hex: "" });
    };
    const handleRemoveExtra = (idx) => setSelectedExtrasWithColors(prev => prev.filter((_, i) => i !== idx));
    const handleFileUpload = async (e) => {
        const files = e.target.files;
        if (!files?.length) return;
        const urls = [];
        for (const file of files) {
            const name = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
            const { error } = await supabase.storage.from("attachments").upload(`attachments/${name}`, file);
            if (error) { showPopup({ title: "Upload Failed", message: error.message, type: "error" }); return; }
            const { data } = supabase.storage.from("attachments").getPublicUrl(`attachments/${name}`);
            urls.push(data.publicUrl);
        }
        setAttachments(prev => [...prev, ...urls]);
        e.target.value = "";
    };
    const getProductOptions = (productId) => {
        const p = products.find(x => x.id === productId);
        return { tops: p?.top_options || [], bottoms: [...(p?.bottom_options || [])].sort((a, b) => String(a).localeCompare(String(b))), sizes: p?.available_size?.length > 0 ? p.available_size : SIZE_OPTIONS };
    };

    // Add Product
    const handleAddProduct = () => {
        if (!selectedProduct) { showPopup({ title: "Product Required", message: "Please select a product.", type: "warning" }); return; }
        if (!deliveryDate) { showPopup({ title: "Delivery Date Required", message: "Please select a delivery date.", type: "warning" }); return; }
        let finalExtras = [...selectedExtrasWithColors];
        if (selectedExtra && selectedExtraColor.name) {
            const extra = globalExtras.find(e => e.name === selectedExtra);
            finalExtras.push({ name: selectedExtra, color: selectedExtraColor, price: extra?.price || 0 });
        }
        setOrderItems(prev => [...prev, {
            _id: makeId(), product_id: selectedProduct.id, product_name: selectedProduct.name, sku_id: selectedProduct.sku_id,
            top: selectedTop, top_color: selectedTopColor, bottom: selectedBottom, bottom_color: selectedBottomColor,
            extras: finalExtras, additionals: selectedAdditionals.filter(a => a.name?.trim()), size: selectedSize, quantity,
            price: getBasePrice(), measurements: getRelevantMeasurements(), image_url: selectedProduct.image_url, notes: comments, delivery_date: deliveryDate,
        }]);
        setSelectedProduct(null); setSelectedTop(""); setSelectedBottom(""); setSelectedTopColor({ name: "", hex: "" }); setSelectedBottomColor({ name: "", hex: "" });
        setSelectedExtra(""); setSelectedExtraColor({ name: "", hex: "" }); setSelectedExtrasWithColors([]); setSelectedAdditionals([]);
        setSelectedSize("M"); setQuantity(1); setMeasurements({}); setComments("");
    };

    // Calculations
    const cartQty = orderItems.reduce((a, b) => a + b.quantity, 0);
    const cartSubtotal = orderItems.reduce((a, b) => {
        let t = b.price * b.quantity;
        b.extras?.forEach(e => { t += Number(e.price || 0); });
        return a + t;
    }, 0);
    const liveQty = quantity + selectedExtrasWithColors.length;
    const liveSubtotal = getBasePrice() * quantity + selectedExtrasWithColors.reduce((s, e) => s + Number(e.price || 0), 0);
    const totalQty = orderItems.length > 0 ? cartQty : liveQty;
    const inclusiveSubtotal = orderItems.length > 0 ? cartSubtotal : liveSubtotal;
    const gstRate = 0.18;
    const subtotal = inclusiveSubtotal / (1 + gstRate);
    const taxes = inclusiveSubtotal - subtotal;
    const totalOrder = inclusiveSubtotal;

    // Continue
    const handleContinue = () => {
        let finalItems = [...orderItems];
        if (orderItems.length === 0 && selectedProduct) {
            if (!deliveryDate) { showPopup({ title: "Delivery Date Required", message: "Please select a delivery date.", type: "warning" }); return; }
            let finalExtras = [...selectedExtrasWithColors];
            if (selectedExtra && selectedExtraColor.name) {
                const extra = globalExtras.find(e => e.name === selectedExtra);
                finalExtras.push({ name: selectedExtra, color: selectedExtraColor, price: extra?.price || 0 });
            }
            finalItems.push({
                _id: makeId(), product_id: selectedProduct.id, product_name: selectedProduct.name, sku_id: selectedProduct.sku_id,
                top: selectedTop, top_color: selectedTopColor, bottom: selectedBottom, bottom_color: selectedBottomColor,
                extras: finalExtras, additionals: selectedAdditionals.filter(a => a.name?.trim()), size: selectedSize, quantity,
                price: getBasePrice(), measurements: getRelevantMeasurements(), image_url: selectedProduct.image_url, notes: comments, delivery_date: deliveryDate,
            });
        }
        if (finalItems.length === 0) { showPopup({ title: "No Products", message: "Please add at least one product.", type: "warning" }); return; }

        // Calculate totals
        const finalSubtotal = finalItems.reduce((a, b) => { let t = b.price * b.quantity; b.extras?.forEach(e => { t += Number(e.price || 0); }); return a + t; }, 0);
        const finalQuantity = finalItems.reduce((a, b) => a + b.quantity, 0);

        // Save to session
        const productData = {
            orderItems: finalItems,
            subtotal: finalSubtotal / (1 + gstRate),
            taxes: finalSubtotal - finalSubtotal / (1 + gstRate),
            grandTotal: finalSubtotal,
            totalQuantity: finalQuantity,
            modeOfDelivery,
            orderFlag,
            urgentReason: orderFlag === "Urgent" ? (urgentReason === "Others" ? otherUrgentReason : urgentReason) : null,
            attachments,
        };
        sessionStorage.setItem(PRODUCT_SESSION_KEY, JSON.stringify(productData));

        navigate("/b2b-order-details");
    };

    const handleBack = () => navigate("/b2b-vendor-selection");

    return (
        <div className="screen4-bg">
            {PopupComponent}

            <header className="pf-header">
                <img src={Logo} alt="logo" className="pf-header-logo" onClick={handleBack} />
                <h1 className="pf-header-title">B2B Order Form</h1>
                {vendor && <div className="b2b-vendor-badge"><span className="vendor-name">{vendor.store_brand_name}</span><span className="vendor-code">{vendor.vendor_code}</span></div>}
            </header>

            <div className="screen4-card">
                <div className="screen4-layout">
                    <div className="screen4-form">
                        <h4 className="product-title">Product</h4>

                        <div className="category-dropdown-container">
                            <select className="category-select" value="women" disabled><option value="women">Women</option></select>
                        </div>

                        {selectedProduct?.image_url && <div className="screen4-image-inline"><img src={selectedProduct.image_url} alt={selectedProduct.name} /></div>}

                        {orderItems.length > 0 && (
                            <div className="added-products-box added-products-top">
                                {orderItems.map((item, i) => {
                                    const expanded = !!expandedRowIds[item._id];
                                    const opts = getProductOptions(item.product_id);
                                    return (
                                        <div className="added-product-row" key={item._id}>
                                            <span className="product-info">{i + 1}. {item.product_name} | Size: {item.size} | Qty: {formatIndianNumber(item.quantity)} | ₹{formatIndianNumber(item.price)} | Delivery: {item.delivery_date ? formatDate(item.delivery_date) : "Not set"}</span>
                                            <div className="product-buttons"><button className="expand" onClick={() => toggleExpand(item._id)}>{expanded ? "−" : "✚"}</button><button className="delete" onClick={() => handleDelete(item._id)}>🗑</button></div>
                                            {expanded && (
                                                <div className="expand-panel full-edit">
                                                    <div className="row">
                                                        <div className="field"><label>Top</label><SearchableSelect options={toOptions(opts.tops)} value={item.top || ""} onChange={(v) => updateItem(item._id, { top: v })} placeholder="Select Top" /></div>
                                                        {item.top && <div className="field"><label>Top Color</label><SearchableSelect options={toColorOptions(colors)} value={item.top_color?.name || ""} onChange={(n) => updateItem(item._id, { top_color: colors.find(c => c.name === n) || { name: "", hex: "" } })} placeholder="Select Color" /></div>}
                                                        <div className="field"><label>Bottom</label><SearchableSelect options={toOptions(opts.bottoms)} value={item.bottom || ""} onChange={(v) => updateItem(item._id, { bottom: v })} placeholder="Select Bottom" /></div>
                                                        {item.bottom && <div className="field"><label>Bottom Color</label><SearchableSelect options={toColorOptions(colors)} value={item.bottom_color?.name || ""} onChange={(n) => updateItem(item._id, { bottom_color: colors.find(c => c.name === n) || { name: "", hex: "" } })} placeholder="Select Color" /></div>}
                                                    </div>
                                                    <div className="size-box edit-size-box"><span className="size-label">Size:</span><div className="sizes">{opts.sizes.map((s, idx) => <button key={idx} className={item.size === s ? "size-btn active" : "size-btn"} onClick={() => updateItem(item._id, { size: s })}>{s}</button>)}</div></div>
                                                    <div className="row"><div className="qty-field"><label>Qty</label><div className="qty-controls"><button onClick={() => updateItem(item._id, { quantity: Math.max(1, (item.quantity || 1) - 1) })}>−</button><span>{item.quantity || 1}</span><button onClick={() => updateItem(item._id, { quantity: (item.quantity || 1) + 1 })}>+</button></div></div><div className="field"><label>Delivery Date</label><input type="date" className="input-line" value={item.delivery_date || ""} min={new Date().toISOString().split("T")[0]} onChange={(e) => updateItem(item._id, { delivery_date: e.target.value })} /></div></div>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        <div className="row">
                            <div className="flex items-center gap-2 pt-2 min-h-10 flex-1" style={{ borderBottom: "2px solid #D5B85A", margin: 0 }}>
                                <SearchableSelect options={products.map(p => ({ label: p.name, value: p.id }))} value={selectedProduct?.id || ""} onChange={(v) => setSelectedProduct(products.find(p => String(p.id) === String(v)) || null)} placeholder="Select Product" className="product-select" />
                                {selectedProduct && <p className="product-price">Price: <strong>₹{formatIndianNumber(getBasePrice())}</strong></p>}
                            </div>
                            <div className="qty-field"><label>Qty</label><div className="qty-controls"><button onClick={() => setQuantity(q => Math.max(1, q - 1))}>−</button><span>{quantity}</span><button onClick={() => setQuantity(q => q + 1)}>+</button></div></div>
                        </div>

                        <div className="row">
                            <div className="field"><SearchableSelect options={toOptions(tops)} value={selectedTop} onChange={setSelectedTop} placeholder="Select Top" /></div>
                            {selectedTop && <div className="field"><SearchableSelect options={toColorOptions(colors)} value={selectedTopColor.name} onChange={(n) => setSelectedTopColor(colors.find(c => c.name === n) || { name: "", hex: "" })} placeholder="Select Top Color" /></div>}
                            <div className="field"><SearchableSelect options={toOptions(bottoms)} value={selectedBottom} onChange={setSelectedBottom} placeholder="Select Bottom" /></div>
                            {selectedBottom && <div className="field"><SearchableSelect options={toColorOptions(colors)} value={selectedBottomColor.name} onChange={(n) => setSelectedBottomColor(colors.find(c => c.name === n) || { name: "", hex: "" })} placeholder="Select Bottom Color" /></div>}
                            <div className="field"><SearchableSelect options={toExtraOptions(globalExtras)} value={selectedExtra} onChange={setSelectedExtra} placeholder="Select Extra" /></div>
                            {selectedExtra && <div className="field"><SearchableSelect options={toColorOptions(colors)} value={selectedExtraColor.name} onChange={(n) => setSelectedExtraColor(colors.find(c => c.name === n) || { name: "", hex: "" })} placeholder="Select Extra Color" /></div>}
                            <button className="add-extra-btn" style={{ background: "#d5b85a", border: "none", color: "white", borderRadius: "3px" }} onClick={handleAddExtra} disabled={!selectedExtra}>Add Extra</button>
                        </div>

                        {selectedExtrasWithColors.map((extra, idx) => <div key={idx} className="selected-extra-item"><span>{extra.name} (₹{formatIndianNumber(extra.price)}){extra.color?.name && ` (${extra.color.name})`}</span><button onClick={() => handleRemoveExtra(idx)}>x</button></div>)}

                        <div className="size-box"><span className="size-label">Size:</span><div className="sizes">{availableSizes.map((s, i) => <button key={i} className={selectedSize === s ? "size-btn active" : "size-btn"} onClick={() => setSelectedSize(s)}>{s}</button>)}</div></div>

                        <div className="measure-bar"><span>Custom Measurements</span><button className="plus-btn" onClick={() => setShowMeasurements(!showMeasurements)}>{showMeasurements ? "−" : "+"}</button></div>
                        {showMeasurements && (
                            <div className="measure-container">
                                <div className="measure-menu">{getRelevantMeasurementCategories().map(dn => <div key={dn} className={getCategoryKeyFromDisplayName(activeCategory) === getCategoryKeyFromDisplayName(dn) || activeCategory === dn ? "measure-item active break-words" : "measure-item break-words"} onClick={() => setActiveCategory(dn)}>{dn}</div>)}</div>
                                <div className="measure-fields"><h3 className="measure-title">Custom Measurements (in)</h3><div className="measure-grid">{(measurementFields[getCategoryKeyFromDisplayName(activeCategory)] || []).map(field => <div className="measure-field" key={field}><label>{field}</label><input type="number" className="input-line" value={measurements[getCategoryKeyFromDisplayName(activeCategory)]?.[field] || ""} onChange={(e) => setMeasurements(prev => ({ ...prev, [getCategoryKeyFromDisplayName(activeCategory)]: { ...(prev[getCategoryKeyFromDisplayName(activeCategory)] || {}), [field]: e.target.value } }))} /></div>)}</div></div>
                            </div>
                        )}

                        <div className="measure-bar"><span>Additional Customization</span><button className="plus-btn" onClick={() => setShowAdditionals(!showAdditionals)}>{showAdditionals ? "−" : "+"}</button></div>
                        {showAdditionals && (
                            <div className="additionals-container">
                                <div className="additionals-list">{selectedAdditionals.map((item, idx) => <div key={idx} className="additional-row"><input type="text" className="input-line additional-name" placeholder="Item name" value={item.name} onChange={(e) => { const n = [...selectedAdditionals]; n[idx].name = e.target.value; setSelectedAdditionals(n); }} /><input type="number" className="input-line additional-price" placeholder="Price" min={0} value={item.price} onChange={(e) => { const n = [...selectedAdditionals]; n[idx].price = Number(e.target.value) || 0; setSelectedAdditionals(n); }} /><button className="remove-additional-btn" onClick={() => setSelectedAdditionals(prev => prev.filter((_, i) => i !== idx))}>×</button></div>)}</div>
                                <button className="add-additional-btn" onClick={() => setSelectedAdditionals(prev => [...prev, { name: "", price: "" }])}>+ Add More</button>
                            </div>
                        )}

                        <div className="row">
                            <div className="field"><label>Delivery Date*</label><input type="date" className="input-line" value={deliveryDate} min={new Date().toISOString().split("T")[0]} onChange={(e) => setDeliveryDate(e.target.value)} /></div>
                            <div className="field"><SearchableSelect options={[{ label: "Home Delivery", value: "Home Delivery" }, { label: "Delhi Store", value: "Delhi Store" }, { label: "Ludhiana Store", value: "Ludhiana Store" }]} value={modeOfDelivery} onChange={setModeOfDelivery} placeholder="Mode of Delivery" /></div>
                            <div className="field"><SearchableSelect options={[{ label: "Urgent", value: "Urgent" }, { label: "Normal", value: "Normal" }]} value={orderFlag} onChange={(v) => { if (v === "Urgent") setShowUrgentModal(true); else { setOrderFlag(v); setUrgentReason(""); } }} placeholder="Order Flag" /></div>
                        </div>

                        <div className="row">
                            <div className="field"><label>Notes:</label><input style={{ border: "none", background: "transparent" }} className="input-line" placeholder="" value={comments} onChange={(e) => setComments(e.target.value)} /></div>
                            <div className="field"><label>Attachments</label><div className="custom-file-upload"><label className="upload-btn">Upload Files<input type="file" accept=".jpg,.jpeg,.png,.webp,.pdf,.doc,.docx,.xls,.xlsx" multiple onChange={handleFileUpload} /></label></div>{attachments.length > 0 && <div className="attachment-preview">{attachments.map((url, idx) => <span key={idx} className="file-item">{url.split("/").pop()}<button type="button" className="remove-attachment-btn" onClick={() => setAttachments(prev => prev.filter((_, i) => i !== idx))}>×</button></span>)}</div>}</div>
                        </div>

                        <div className="summary-box-fixed"><h3>Order Summary</h3><p>Total Quantity: <strong>{formatIndianNumber(totalQty)}</strong></p><p>Subtotal: <strong>₹{formatIndianNumber(subtotal.toFixed(2))}</strong></p><p>Taxes (18%): <strong>₹{formatIndianNumber(taxes.toFixed(2))}</strong></p><p className="grand-total">Total: <strong>₹{formatIndianNumber(totalOrder.toFixed(2))}</strong></p></div>

                        <div className="footer-btns"><button className="productBtn" onClick={handleAddProduct}>Add Product</button><button className="draftBtn">Save as Draft</button><button className="continueBtn" onClick={handleContinue}>Continue</button></div>
                    </div>

                    {selectedProduct?.image_url && <div className="screen4-image-fixed"><img src={selectedProduct.image_url} alt={selectedProduct.name} /></div>}
                </div>
            </div>

            {showUrgentModal && (
                <div className="modal-overlay"><div className="modal-box"><h3>Urgent Order</h3><label>Reason for Urgent</label><div style={{ border: "1px solid #D5B85A" }}><SearchableSelect options={[{ label: "Client Escalation", value: "Client Escalation" }, { label: "VIP Order", value: "VIP Order" }, { label: "Celebrity Order", value: "Celebrity Order" }, { label: "Others", value: "Others" }]} value={urgentReason} onChange={(v) => { setUrgentReason(v); if (v !== "Others") setOtherUrgentReason(""); }} placeholder="Select Urgent Reason" /></div>{urgentReason === "Others" && <textarea className="input-line" placeholder="Specify other reason..." value={otherUrgentReason} onChange={(e) => setOtherUrgentReason(e.target.value)} rows={2} style={{ marginTop: "20px", border: "1px solid #d5b85a" }} />}<div className="modal-actions"><button className="cancel-btn" onClick={() => { setShowUrgentModal(false); setOrderFlag("Normal"); setUrgentReason(""); setOtherUrgentReason(""); }}>Cancel</button><button className="confirm-btn" onClick={() => { const reason = urgentReason === "Others" ? otherUrgentReason : urgentReason; if (!reason.trim()) { showPopup({ title: "Reason Required", message: "Please select or enter a reason.", type: "warning" }); return; } setOrderFlag("Urgent"); setShowUrgentModal(false); }}>Confirm</button></div></div></div>
            )}

            <button className="back-btn" onClick={handleBack}>←</button>
        </div>
    );
}