import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import "./B2bProductForm.css";
import Logo from "../../images/logo.png";
import formatIndianNumber from "../../utils/formatIndianNumber";
import { usePopup } from "../../components/Popup";

/**
 * Searchable Select Component (same as B2C)
 */
export function SearchableSelect({
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
                                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                            {opt.hex && (
                                                <div
                                                    style={{
                                                        width: "14px",
                                                        height: "14px",
                                                        borderRadius: "50%",
                                                        backgroundColor: opt.hex,
                                                        border: "1px solid #ccc",
                                                    }}
                                                />
                                            )}
                                            {opt.label}
                                        </div>
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

// Standard B2B sizes
const B2B_SIZE_OPTIONS = ["XXS", "XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL"];

export default function B2bProductForm() {
    const navigate = useNavigate();
    const location = useLocation();
    const { showPopup, PopupComponent } = usePopup();

    // Get vendor from previous step
    const [vendor, setVendor] = useState(null);

    // Product states
    const [products, setProducts] = useState([]);
    const [selectedProduct, setSelectedProduct] = useState(null);
    const [colors, setColors] = useState([]);
    const [tops, setTops] = useState([]);
    const [bottoms, setBottoms] = useState([]);
    const [globalExtras, setGlobalExtras] = useState([]);

    // Selection states
    const [selectedTop, setSelectedTop] = useState("");
    const [selectedBottom, setSelectedBottom] = useState("");
    const [selectedTopColor, setSelectedTopColor] = useState({ name: "", hex: "" });
    const [selectedBottomColor, setSelectedBottomColor] = useState({ name: "", hex: "" });
    const [selectedExtra, setSelectedExtra] = useState("");
    const [selectedExtraColor, setSelectedExtraColor] = useState({ name: "", hex: "" });
    const [selectedExtrasWithColors, setSelectedExtrasWithColors] = useState([]);

    // Size & Quantity
    const [selectedSize, setSelectedSize] = useState("M");
    const [quantity, setQuantity] = useState(1);
    const [availableSizes, setAvailableSizes] = useState(B2B_SIZE_OPTIONS);

    // Order items (cart)
    const [orderItems, setOrderItems] = useState([]);
    const [expandedRowIds, setExpandedRowIds] = useState({});

    // Notes
    const [itemNotes, setItemNotes] = useState("");

    // Session restore flag
    const isRestoredRef = useRef(false);

    // ID helper
    const makeId = () => `${Date.now()}_${Math.random().toString(16).slice(2)}`;

    // ==================== LOAD VENDOR FROM LOCATION STATE ====================
    useEffect(() => {
        if (location.state?.vendor) {
            setVendor(location.state.vendor);
        } else {
            // No vendor selected, redirect back
            showPopup({
                title: "No Vendor Selected",
                message: "Please select a vendor first.",
                type: "warning",
            });
            setTimeout(() => navigate("/b2b-vendor-selection"), 1500);
        }
    }, [location.state, navigate]);

    // ==================== SESSION STORAGE RESTORE ====================
    useEffect(() => {
        const saved = sessionStorage.getItem("b2bProductFormData");
        if (saved) {
            try {
                isRestoredRef.current = true;
                const data = JSON.parse(saved);

                if (data.selectedProduct) setSelectedProduct(data.selectedProduct);
                if (data.selectedTop) setSelectedTop(data.selectedTop);
                if (data.selectedBottom) setSelectedBottom(data.selectedBottom);
                if (data.selectedTopColor) setSelectedTopColor(data.selectedTopColor);
                if (data.selectedBottomColor) setSelectedBottomColor(data.selectedBottomColor);
                if (data.selectedExtrasWithColors) setSelectedExtrasWithColors(data.selectedExtrasWithColors);
                if (data.selectedSize) setSelectedSize(data.selectedSize);
                if (data.quantity) setQuantity(data.quantity);
                if (data.orderItems) setOrderItems(data.orderItems);
                if (data.expandedRowIds) setExpandedRowIds(data.expandedRowIds);
                if (data.tops) setTops(data.tops);
                if (data.bottoms) setBottoms(data.bottoms);
                if (data.itemNotes) setItemNotes(data.itemNotes);

                setTimeout(() => { isRestoredRef.current = false; }, 100);
            } catch (e) {
                console.error("Error restoring form data:", e);
                isRestoredRef.current = false;
            }
        }
    }, []);

    // ==================== SESSION STORAGE SAVE ====================
    useEffect(() => {
        const formData = {
            selectedProduct,
            selectedTop,
            selectedBottom,
            selectedTopColor,
            selectedBottomColor,
            selectedExtra,
            selectedExtraColor,
            selectedExtrasWithColors,
            selectedSize,
            quantity,
            orderItems,
            expandedRowIds,
            tops,
            bottoms,
            itemNotes,
        };
        sessionStorage.setItem("b2bProductFormData", JSON.stringify(formData));
    }, [
        selectedProduct, selectedTop, selectedBottom, selectedTopColor,
        selectedBottomColor, selectedExtra, selectedExtraColor,
        selectedExtrasWithColors, selectedSize, quantity, orderItems,
        expandedRowIds, tops, bottoms, itemNotes
    ]);

    // ==================== FETCH PRODUCTS ====================
    useEffect(() => {
        const fetchProducts = async () => {
            const { data, error } = await supabase
                .from("products")
                .select("*, product_extra_prices (*)")
                .order("name");

            if (error) {
                console.error("Error fetching products:", error);
                return;
            }
            setProducts(data || []);
        };
        fetchProducts();
    }, []);

    // ==================== FETCH COLORS ====================
    useEffect(() => {
        const fetchColors = async () => {
            const { data, error } = await supabase
                .from("colors")
                .select("name, hex")
                .order("name");

            if (error) {
                console.error("Error fetching colors:", error);
                return;
            }
            setColors(data || []);
        };
        fetchColors();
    }, []);

    // ==================== FETCH EXTRAS ====================
    useEffect(() => {
        const fetchExtras = async () => {
            const { data, error } = await supabase
                .from("extras")
                .select("name, price, sort_order")
                .order("sort_order", { ascending: true });

            if (error) {
                console.error("Error fetching extras:", error);
                return;
            }
            setGlobalExtras(data || []);
        };
        fetchExtras();
    }, []);

    // ==================== PRODUCT CHANGE HANDLER ====================
    useEffect(() => {
        if (isRestoredRef.current) return;

        if (!selectedProduct) {
            setTops([]);
            setBottoms([]);
            setAvailableSizes(B2B_SIZE_OPTIONS);
            setSelectedSize("M");
            setSelectedTop("");
            setSelectedBottom("");
            setSelectedTopColor({ name: "", hex: "" });
            setSelectedBottomColor({ name: "", hex: "" });
            setSelectedExtrasWithColors([]);
            setQuantity(1);
            return;
        }

        // Set product options
        setTops(selectedProduct.top_options || []);
        const sortedBottoms = [...(selectedProduct.bottom_options || [])].sort((a, b) =>
            String(a).localeCompare(String(b))
        );
        setBottoms(sortedBottoms);

        // Set available sizes
        const sizes = selectedProduct.available_size?.length > 0
            ? selectedProduct.available_size
            : B2B_SIZE_OPTIONS;
        setAvailableSizes(sizes);

        // Set defaults
        const defaultTop = selectedProduct.default_top || selectedProduct.top_options?.[0] || "";
        const defaultBottom = selectedProduct.default_bottom || selectedProduct.bottom_options?.[0] || "";
        const defaultColorName = selectedProduct.default_color || "";
        const defaultColor = colors.find(c => c.name === defaultColorName) || { name: "", hex: "" };

        setSelectedTop(defaultTop);
        setSelectedTopColor(defaultTop ? defaultColor : { name: "", hex: "" });
        setSelectedBottom(defaultBottom);
        setSelectedBottomColor(defaultBottom ? defaultColor : { name: "", hex: "" });

        // Set default size
        if (!sizes.includes(selectedSize)) {
            setSelectedSize(sizes[0] || "M");
        }

        // Auto-populate default extra
        if (selectedProduct.default_extra) {
            const extraDetails = globalExtras.find(e => e.name === selectedProduct.default_extra);
            if (extraDetails) {
                setSelectedExtrasWithColors([{
                    name: selectedProduct.default_extra,
                    color: defaultColor,
                    price: extraDetails.price || 0,
                }]);
            }
        } else {
            setSelectedExtrasWithColors([]);
        }

        setSelectedExtra("");
        setSelectedExtraColor({ name: "", hex: "" });

    }, [selectedProduct, colors, globalExtras]);

    // ==================== HELPERS ====================
    const toOptions = (arr = []) => arr.map((x) => ({ label: String(x), value: x }));
    const toColorOptions = (clrs = []) => clrs.map((c) => ({
        label: c.name,
        value: c.name,
        hex: c.hex,
    }));
    const toExtraOptions = (extras = []) => extras.map((e) => ({
        label: `${e.name} (₹${formatIndianNumber(e.price)})`,
        value: e.name,
        price: e.price,
    }));

    // Get base price
    const getBasePrice = () => {
        if (!selectedProduct) return 0;
        return Number(selectedProduct.base_price || 0);
    };

    // Toggle expand
    const toggleExpand = (id) => {
        setExpandedRowIds((e) => ({ ...e, [id]: !e[id] }));
    };

    // Delete item
    const handleDelete = (id) => {
        setOrderItems((prev) => prev.filter((it) => it._id !== id));
    };

    // Update item
    const updateItem = (id, patch) => {
        setOrderItems((prev) =>
            prev.map((it) => (it._id !== id ? it : { ...it, ...patch }))
        );
    };

    // Add extra
    const handleAddExtra = () => {
        if (!selectedExtra) return;

        if (!selectedExtraColor.name) {
            showPopup({
                title: "Color Required",
                message: "Please select a color for the extra before adding.",
                type: "warning",
            });
            return;
        }

        const extraDetails = globalExtras.find((e) => e.name === selectedExtra);
        setSelectedExtrasWithColors((prev) => [
            ...prev,
            {
                name: selectedExtra,
                color: selectedExtraColor,
                price: extraDetails?.price || 0,
            },
        ]);
        setSelectedExtra("");
        setSelectedExtraColor({ name: "", hex: "" });
    };

    // Remove extra
    const handleRemoveExtra = (index) => {
        setSelectedExtrasWithColors((prev) => prev.filter((_, i) => i !== index));
    };

    // Add product to cart
    const handleAddProduct = () => {
        if (!selectedProduct) {
            showPopup({
                title: "Product Required",
                message: "Please select a product before adding.",
                type: "warning",
            });
            return;
        }

        // Capture pending extra if selected
        let finalExtras = [...selectedExtrasWithColors];
        if (selectedExtra && selectedExtraColor.name) {
            const extraDetails = globalExtras.find((e) => e.name === selectedExtra);
            finalExtras.push({
                name: selectedExtra,
                color: selectedExtraColor,
                price: extraDetails?.price || 0,
            });
        }

        const newProduct = {
            _id: makeId(),
            product_id: selectedProduct.id,
            product_name: selectedProduct.name,
            sku_id: selectedProduct.sku_id,
            top: selectedTop,
            top_color: selectedTopColor,
            bottom: selectedBottom,
            bottom_color: selectedBottomColor,
            extras: finalExtras,
            size: selectedSize,
            quantity: quantity,
            price: getBasePrice(),
            image_url: selectedProduct.image_url || null,
            notes: itemNotes,
        };

        setOrderItems((prev) => [...prev, newProduct]);

        // Reset inputs
        setSelectedProduct(null);
        setSelectedTop("");
        setSelectedBottom("");
        setSelectedTopColor({ name: "", hex: "" });
        setSelectedBottomColor({ name: "", hex: "" });
        setSelectedExtra("");
        setSelectedExtraColor({ name: "", hex: "" });
        setSelectedExtrasWithColors([]);
        setSelectedSize("M");
        setQuantity(1);
        setItemNotes("");
    };

    // Get product options for edit mode
    const getProductOptions = (productId) => {
        const product = products.find((p) => p.id === productId);
        const sortedBottoms = [...(product?.bottom_options || [])].sort((a, b) =>
            String(a).localeCompare(String(b))
        );
        return {
            tops: product?.top_options || [],
            bottoms: sortedBottoms,
            sizes: product?.available_size?.length > 0 ? product.available_size : B2B_SIZE_OPTIONS,
        };
    };

    // ==================== CALCULATIONS ====================
    const getExtrasTotal = (items) => {
        return items.reduce((total, item) => {
            return total + (item.extras?.reduce((sum, e) => sum + Number(e.price || 0), 0) || 0);
        }, 0);
    };

    const cartQuantity = orderItems.reduce((a, b) => a + b.quantity, 0);
    const cartSubtotal = orderItems.reduce((a, b) => {
        let itemTotal = b.price * b.quantity;
        if (b.extras?.length > 0) {
            b.extras.forEach(extra => { itemTotal += Number(extra.price || 0); });
        }
        return a + itemTotal;
    }, 0);

    const liveQuantity = quantity;
    const liveSubtotal = getBasePrice() * quantity + selectedExtrasWithColors.reduce((sum, e) => sum + Number(e.price || 0), 0);

    const totalQuantity = orderItems.length > 0 ? cartQuantity : liveQuantity;
    const subtotal = orderItems.length > 0 ? cartSubtotal : liveSubtotal;

    // GST calculation
    const gstRate = 0.18;
    const taxableAmount = subtotal / (1 + gstRate);
    const taxes = subtotal - taxableAmount;
    const grandTotal = subtotal;

    // ==================== CONTINUE TO NEXT STEP ====================
    const handleContinue = () => {
        let finalItems = [...orderItems];

        // Auto-add current product if not added
        if (orderItems.length === 0 && selectedProduct) {
            let finalExtras = [...selectedExtrasWithColors];
            if (selectedExtra && selectedExtraColor.name) {
                const extraDetails = globalExtras.find((e) => e.name === selectedExtra);
                finalExtras.push({
                    name: selectedExtra,
                    color: selectedExtraColor,
                    price: extraDetails?.price || 0,
                });
            }

            finalItems.push({
                _id: makeId(),
                product_id: selectedProduct.id,
                product_name: selectedProduct.name,
                sku_id: selectedProduct.sku_id,
                top: selectedTop,
                top_color: selectedTopColor,
                bottom: selectedBottom,
                bottom_color: selectedBottomColor,
                extras: finalExtras,
                size: selectedSize,
                quantity: quantity,
                price: getBasePrice(),
                image_url: selectedProduct.image_url || null,
                notes: itemNotes,
            });
        }

        if (finalItems.length === 0) {
            showPopup({
                title: "No Products",
                message: "Please add at least one product to the order.",
                type: "warning",
            });
            return;
        }

        // Calculate totals for final items
        const finalSubtotal = finalItems.reduce((a, b) => {
            let itemTotal = b.price * b.quantity;
            if (b.extras?.length > 0) {
                b.extras.forEach(extra => { itemTotal += Number(extra.price || 0); });
            }
            return a + itemTotal;
        }, 0);

        const finalTaxable = finalSubtotal / (1 + gstRate);
        const finalTaxes = finalSubtotal - finalTaxable;
        const finalQuantity = finalItems.reduce((a, b) => a + b.quantity, 0);

        // Navigate to B2B Order Details page
        navigate("/b2b-order-details", {
            state: {
                vendor: vendor,
                items: finalItems,
                subtotal: finalTaxable,
                taxes: finalTaxes,
                grandTotal: finalSubtotal,
                totalQuantity: finalQuantity,
            },
        });
    };

    // ==================== BACK ====================
    const handleBack = () => {
        sessionStorage.removeItem("b2bProductFormData");
        navigate("/b2b-vendor-selection");
    };

    return (
        <div className="b2b-pf-bg">
            {PopupComponent}

            {/* HEADER */}
            <header className="b2b-pf-header">
                <img src={Logo} alt="logo" className="b2b-pf-logo" onClick={handleBack} />
                <h1 className="b2b-pf-title">B2B Order - Select Products</h1>
                {vendor && (
                    <div className="b2b-pf-vendor-info">
                        <span className="vendor-name">{vendor.store_brand_name}</span>
                        <span className="vendor-code">{vendor.vendor_code}</span>
                    </div>
                )}
            </header>

            <div className="b2b-pf-card">
                <div className="b2b-pf-layout">
                    {/* LEFT SIDE - FORM */}
                    <div className="b2b-pf-form">
                        <h4 className="b2b-pf-section-title">Product Selection</h4>

                        {/* Product Image - Inline for tablet/mobile */}
                        {selectedProduct?.image_url && (
                            <div className="b2b-pf-image-inline">
                                <img src={selectedProduct.image_url} alt={selectedProduct.name} />
                            </div>
                        )}

                        {/* ADDED PRODUCTS */}
                        {orderItems.length > 0 && (
                            <div className="b2b-added-products">
                                {orderItems.map((item, i) => {
                                    const expanded = !!expandedRowIds[item._id];
                                    const productOptions = getProductOptions(item.product_id);

                                    return (
                                        <div className="b2b-added-row" key={item._id}>
                                            <span className="product-info">
                                                {i + 1}. {item.product_name} | Size: {item.size} | Qty: {formatIndianNumber(item.quantity)} | ₹{formatIndianNumber(item.price * item.quantity)}
                                            </span>

                                            <div className="product-buttons">
                                                <button className="expand" onClick={() => toggleExpand(item._id)} title={expanded ? "Collapse" : "Expand"}>
                                                    {expanded ? "−" : "✚"}
                                                </button>
                                                <button className="delete" onClick={() => handleDelete(item._id)} title="Remove">
                                                    🗑
                                                </button>
                                            </div>

                                            {/* EXPANDED EDIT PANEL */}
                                            {expanded && (
                                                <div className="b2b-expand-panel">
                                                    {/* Top & Bottom */}
                                                    <div className="row">
                                                        <div className="field">
                                                            <label>Top</label>
                                                            <SearchableSelect
                                                                options={toOptions(productOptions.tops)}
                                                                value={item.top || ""}
                                                                onChange={(val) => updateItem(item._id, { top: val })}
                                                                placeholder="Select Top"
                                                            />
                                                        </div>
                                                        {item.top && (
                                                            <div className="field">
                                                                <label>Top Color</label>
                                                                <SearchableSelect
                                                                    options={toColorOptions(colors)}
                                                                    value={item.top_color?.name || ""}
                                                                    onChange={(colorName) => {
                                                                        const colorObj = colors.find(c => c.name === colorName) || { name: "", hex: "" };
                                                                        updateItem(item._id, { top_color: colorObj });
                                                                    }}
                                                                    placeholder="Select Color"
                                                                />
                                                            </div>
                                                        )}
                                                        <div className="field">
                                                            <label>Bottom</label>
                                                            <SearchableSelect
                                                                options={toOptions(productOptions.bottoms)}
                                                                value={item.bottom || ""}
                                                                onChange={(val) => updateItem(item._id, { bottom: val })}
                                                                placeholder="Select Bottom"
                                                            />
                                                        </div>
                                                        {item.bottom && (
                                                            <div className="field">
                                                                <label>Bottom Color</label>
                                                                <SearchableSelect
                                                                    options={toColorOptions(colors)}
                                                                    value={item.bottom_color?.name || ""}
                                                                    onChange={(colorName) => {
                                                                        const colorObj = colors.find(c => c.name === colorName) || { name: "", hex: "" };
                                                                        updateItem(item._id, { bottom_color: colorObj });
                                                                    }}
                                                                    placeholder="Select Color"
                                                                />
                                                            </div>
                                                        )}
                                                    </div>

                                                    {/* Size */}
                                                    <div className="b2b-size-box">
                                                        <span className="size-label">Size:</span>
                                                        <div className="sizes">
                                                            {productOptions.sizes.map((s, idx) => (
                                                                <button
                                                                    key={idx}
                                                                    className={item.size === s ? "size-btn active" : "size-btn"}
                                                                    onClick={() => updateItem(item._id, { size: s })}
                                                                >
                                                                    {s}
                                                                </button>
                                                            ))}
                                                        </div>
                                                    </div>

                                                    {/* Quantity & Notes */}
                                                    <div className="row">
                                                        <div className="qty-field">
                                                            <label>Qty</label>
                                                            <div className="qty-controls">
                                                                <button onClick={() => updateItem(item._id, { quantity: Math.max(1, (item.quantity || 1) - 1) })}>−</button>
                                                                <span>{item.quantity || 1}</span>
                                                                <button onClick={() => updateItem(item._id, { quantity: (item.quantity || 1) + 1 })}>+</button>
                                                            </div>
                                                        </div>
                                                        <div className="field" style={{ flex: 2 }}>
                                                            <label>Notes</label>
                                                            <input
                                                                type="text"
                                                                className="input-line"
                                                                placeholder="Product notes..."
                                                                value={item.notes || ""}
                                                                onChange={(e) => updateItem(item._id, { notes: e.target.value })}
                                                            />
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {/* PRODUCT SELECT ROW */}
                        <div className="row">
                            <div className="field product-field">
                                <SearchableSelect
                                    options={products.map((p) => ({ label: p.name, value: p.id }))}
                                    value={selectedProduct?.id || ""}
                                    onChange={(val) => setSelectedProduct(products.find((p) => String(p.id) === String(val)) || null)}
                                    placeholder="Select Product"
                                    className="product-select"
                                />
                                {selectedProduct && (
                                    <p className="product-price">
                                        Price: <strong>₹{formatIndianNumber(getBasePrice())}</strong>
                                    </p>
                                )}
                            </div>

                            <div className="qty-field">
                                <label>Qty</label>
                                <div className="qty-controls">
                                    <button onClick={() => setQuantity((q) => Math.max(1, q - 1))}>−</button>
                                    <span>{quantity}</span>
                                    <button onClick={() => setQuantity((q) => q + 1)}>+</button>
                                </div>
                            </div>
                        </div>

                        {/* TOP / BOTTOM / EXTRA */}
                        <div className="row">
                            <div className="field">
                                <SearchableSelect
                                    options={toOptions(tops)}
                                    value={selectedTop}
                                    onChange={setSelectedTop}
                                    placeholder="Select Top"
                                />
                            </div>
                            {selectedTop && (
                                <div className="field">
                                    <SearchableSelect
                                        options={toColorOptions(colors)}
                                        value={selectedTopColor.name}
                                        onChange={(colorName) => {
                                            const colorObj = colors.find(c => c.name === colorName) || { name: "", hex: "" };
                                            setSelectedTopColor(colorObj);
                                        }}
                                        placeholder="Top Color"
                                    />
                                </div>
                            )}

                            <div className="field">
                                <SearchableSelect
                                    options={toOptions(bottoms)}
                                    value={selectedBottom}
                                    onChange={setSelectedBottom}
                                    placeholder="Select Bottom"
                                />
                            </div>
                            {selectedBottom && (
                                <div className="field">
                                    <SearchableSelect
                                        options={toColorOptions(colors)}
                                        value={selectedBottomColor.name}
                                        onChange={(colorName) => {
                                            const colorObj = colors.find(c => c.name === colorName) || { name: "", hex: "" };
                                            setSelectedBottomColor(colorObj);
                                        }}
                                        placeholder="Bottom Color"
                                    />
                                </div>
                            )}

                            <div className="field">
                                <SearchableSelect
                                    options={toExtraOptions(globalExtras)}
                                    value={selectedExtra}
                                    onChange={setSelectedExtra}
                                    placeholder="Select Extra"
                                />
                            </div>
                            {selectedExtra && (
                                <div className="field">
                                    <SearchableSelect
                                        options={toColorOptions(colors)}
                                        value={selectedExtraColor.name}
                                        onChange={(colorName) => {
                                            const colorObj = colors.find(c => c.name === colorName) || { name: "", hex: "" };
                                            setSelectedExtraColor(colorObj);
                                        }}
                                        placeholder="Extra Color"
                                    />
                                </div>
                            )}
                            <button className="add-extra-btn" onClick={handleAddExtra} disabled={!selectedExtra}>
                                Add Extra
                            </button>
                        </div>

                        {/* Selected Extras Display */}
                        {selectedExtrasWithColors.length > 0 && (
                            <div className="selected-extras">
                                {selectedExtrasWithColors.map((extra, index) => (
                                    <div key={index} className="selected-extra-item">
                                        <span>
                                            {extra.name} (₹{formatIndianNumber(extra.price)})
                                            {extra.color?.name && ` - ${extra.color.name}`}
                                        </span>
                                        <button onClick={() => handleRemoveExtra(index)}>×</button>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* SIZE SELECTION */}
                        <div className="b2b-size-box">
                            <span className="size-label">Size:</span>
                            <div className="sizes">
                                {availableSizes.map((s, i) => (
                                    <button
                                        key={i}
                                        className={selectedSize === s ? "size-btn active" : "size-btn"}
                                        onClick={() => setSelectedSize(s)}
                                    >
                                        {s}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* NOTES */}
                        <div className="row">
                            <div className="field full-width">
                                <label>Product Notes</label>
                                <input
                                    type="text"
                                    className="input-line"
                                    placeholder="Notes for this product..."
                                    value={itemNotes}
                                    onChange={(e) => setItemNotes(e.target.value)}
                                />
                            </div>
                        </div>

                        {/* ORDER SUMMARY */}
                        <div className="b2b-summary-box">
                            <h3>Order Summary</h3>
                            <p>Total Quantity: <strong>{formatIndianNumber(totalQuantity)}</strong></p>
                            <p>Subtotal: <strong>₹{formatIndianNumber(taxableAmount.toFixed(2))}</strong></p>
                            <p>Taxes (18%): <strong>₹{formatIndianNumber(taxes.toFixed(2))}</strong></p>
                            <p className="grand-total">Total: <strong>₹{formatIndianNumber(grandTotal.toFixed(2))}</strong></p>
                        </div>

                        {/* BUTTONS */}
                        <div className="b2b-footer-btns">
                            <button className="b2b-add-btn" onClick={handleAddProduct}>Add Product</button>
                            <button className="b2b-continue-btn" onClick={handleContinue}>Continue</button>
                        </div>
                    </div>

                    {/* RIGHT SIDE - PRODUCT IMAGE */}
                    {selectedProduct?.image_url && (
                        <div className="b2b-pf-image-fixed">
                            <img src={selectedProduct.image_url} alt={selectedProduct.name} />
                        </div>
                    )}
                </div>
            </div>

            {/* BACK BUTTON */}
            <button className="b2b-back-btn" onClick={handleBack}>←</button>
        </div>
    );
}