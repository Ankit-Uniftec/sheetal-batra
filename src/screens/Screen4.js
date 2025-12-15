// import React, { useEffect, useMemo, useRef, useState } from "react";
// import { useNavigate } from "react-router-dom";
// import { useAuth } from "../context/AuthContext";
// import { supabase } from "../lib/supabaseClient";
// import "./Screen4.css";
// import Logo from "../images/logo.png";

// /**
//  * Generic Searchable Select (no external libs)
//  * - Keyboard: ↑/↓ to move, Enter to select, Esc to close
//  * - Click outside closes menu
//  * - Works with arrays of primitives or {label, value}
//  */
// export function SearchableSelect({
//   options,
//   value,
//   onChange,
//   placeholder = "Select…",
//   disabled = false,
//   className = "",
// }) {
//   const normalized = useMemo(() => {
//     return (options || []).map((o) =>
//       typeof o === "object" && o !== null && "label" in o && "value" in o
//         ? o
//         : { label: String(o), value: o }
//     );
//   }, [options]);

//   const current = useMemo(
//     () => normalized.find((o) => String(o.value) === String(value)) || null,
//     [normalized, value]
//   );

//   const [open, setOpen] = useState(false);
//   const [query, setQuery] = useState("");
//   const [focusIdx, setFocusIdx] = useState(-1);
//   const rootRef = useRef(null);
//   const inputRef = useRef(null);
//   const listRef = useRef(null);

//   const filtered = useMemo(() => {
//     const q = query.trim().toLowerCase();
//     if (!q) return normalized;
//     return normalized.filter((o) => o.label.toLowerCase().includes(q));
//   }, [normalized, query]);

//   useEffect(() => {
//     const onDoc = (e) => {
//       if (!rootRef.current) return;
//       if (!rootRef.current.contains(e.target)) {
//         setOpen(false);
//         setFocusIdx(-1);
//       }
//     };
//     document.addEventListener("mousedown", onDoc);
//     return () => document.removeEventListener("mousedown", onDoc);
//   }, []);

//   useEffect(() => {
//     if (!open || !listRef.current || focusIdx < 0) return;
//     const el = listRef.current.querySelector(`[data-idx="${focusIdx}"]`);
//     if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
//   }, [focusIdx, open]);

//   const handleSelect = (opt) => {
//     onChange(opt?.value ?? "");
//     setOpen(false);
//     setQuery("");
//     setFocusIdx(-1);
//     requestAnimationFrame(() => inputRef.current?.focus());
//   };

//   const handleKeyDown = (e) => {
//     if (!open && (e.key === "ArrowDown" || e.key === "Enter")) {
//       setOpen(true);
//       setFocusIdx(0);
//       return;
//     }
//     if (!open) return;

//     if (e.key === "ArrowDown") {
//       e.preventDefault();
//       setFocusIdx((i) => Math.min((filtered.length || 1) - 1, i + 1));
//     } else if (e.key === "ArrowUp") {
//       e.preventDefault();
//       setFocusIdx((i) => Math.max(0, i - 1));
//     } else if (e.key === "Enter") {
//       e.preventDefault();
//       const opt = filtered[focusIdx];
//       if (opt) handleSelect(opt);
//     } else if (e.key === "Escape") {
//       e.preventDefault();
//       setOpen(false);
//       setFocusIdx(-1);
//     }
//   };

//   const clear = (e) => {
//     e.stopPropagation();
//     onChange("");
//     setQuery("");
//     inputRef.current?.focus();
//   };

//   return (
//     <div ref={rootRef} className={`ss-root ${disabled ? "ss-disabled" : ""} ${className}`}>
//       <div className={`ss-control ${open ? "ss-open" : ""}`} onClick={() => !disabled && setOpen((o) => !o)}>
//         <input
//           ref={inputRef}
//           className="ss-input"
//           placeholder={current ? current.label : placeholder}
//           value={query}
//           onChange={(e) => {
//             setQuery(e.target.value);
//             if (!open) setOpen(true);
//             setFocusIdx(0);
//           }}
//           onKeyDown={handleKeyDown}
//           disabled={disabled}
//         />
//         {current && (
//           <button className="ss-clear" title="Clear" onClick={clear}>
//             ×
//           </button>
//         )}
//         <span className="ss-caret">▾</span>
//       </div>

//       {open && (
//         <div className="ss-menu" role="listbox">
//           {filtered.length === 0 ? (
//             <div className="ss-empty">No matches</div>
//           ) : (
//             <ul ref={listRef} className="ss-list">
//               {filtered.map((opt, idx) => {
//                 const selected = String(opt.value) === String(value);
//                 const focused = idx === focusIdx;
//                 return (
//                   <li
//                     key={String(opt.value)}
//                     data-idx={idx}
//                     className={`ss-option ${selected ? "is-selected" : ""} ${focused ? "is-focused" : ""}`}
//                     onMouseEnter={() => setFocusIdx(idx)}
//                     onMouseDown={(e) => e.preventDefault()}
//                     onClick={() => handleSelect(opt)}
//                     role="option"
//                     aria-selected={selected}
//                   >
//                     {opt.label}
//                   </li>
//                 );
//               })}
//             </ul>
//           )}
//         </div>
//       )}
//     </div>
//   );
// }

// export default function Screen4() {
//   const navigate = useNavigate();
//   const { user } = useAuth();

//   // PRODUCT STATES
//   const [products, setProducts] = useState([]);
//   const [selectedProduct, setSelectedProduct] = useState(null);
//   const [comments, setComments] = useState("");
//   const [attachments, setAttachments] = useState([]);


//   const [colors, setColors] = useState([]);
//   const [tops, setTops] = useState([]);
//   const [bottoms, setBottoms] = useState([]);
//   const [extras, setExtras] = useState([]);

//   const [selectedColor, setSelectedColor] = useState("");
//   const [selectedTop, setSelectedTop] = useState("");
//   const [selectedBottom, setSelectedBottom] = useState("");
//   const [selectedExtra, setSelectedExtra] = useState("");

//   const [selectedSize, setSelectedSize] = useState("");
//   const [quantity, setQuantity] = useState(1);

//   const [modeOfDelivery, setModeOfDelivery] = useState("");
//   const [orderFlag, setOrderFlag] = useState("");
//   const [deliveryDate, setDeliveryDate] = useState("");

//   // MEASUREMENTS
//   const [measurements, setMeasurements] = useState({});

//   // CART
//   const [orderItems, setOrderItems] = useState([]);

//   // MEASUREMENT DROPDOWN
//   const [showMeasurements, setShowMeasurements] = useState(false);
//   const [activeCategory, setActiveCategory] = useState("Shirts");

//   const [expandedRowIds, setExpandedRowIds] = useState({}); // {[_id]: true/false}
//   const [availableSizes, setAvailableSizes] = useState([]);

//   const measurementCategories = [
//     "Shirts",
//     "Blouse",
//     "Salwar",
//     "Churidar",
//     "Trouser",
//     "Anarkali",
//     "Lehnga Length",
//   ];

//   const measurementFields = {
//     Shirts: [
//       "Shoulder",
//       "Length",
//       "Upper Bust",
//       "Bust",
//       "Waist",
//       "Mid Waist",
//       "Hip",
//       "Sleeves",
//       "Biceps",
//       "Armhole",
//       "Front Cross",
//       "Back Cross",
//       "Dart Point",
//       "Neck",
//     ],
//     Blouse: ["Bust", "Waist", "Shoulder", "Neck"],
//     Salwar: ["Waist", "Hip", "Length"],
//     Trouser: ["Waist", "Hip", "Inseam", "Outseam"],
//     Churidar: ["Waist", "Hip", "Length"],
//     Anarkali: ["Bust", "Waist", "Hip", "Length"],
//     "Lehnga Length": ["Waist", "Length"],
//   };

//   // tiny id helper so list keys are stable
//   const makeId = () => `${Date.now()}_${Math.random().toString(16).slice(2)}`;
//   // update helpers
//   const toggleExpand = (id) =>
//     setExpandedRowIds((e) => ({ ...e, [id]: !e[id] }));

//   const handleDelete = (id) =>
//     setOrderItems((prev) => prev.filter((it) => it._id !== id));

//   const updateItem = (id, patch) =>
//     setOrderItems((prev) =>
//       prev.map((it) => (it._id === id ? { ...it, ...patch } : it))
//     );

//   // Fetch products
//   useEffect(() => {
//     const fetchProducts = async () => {
//       const { data: productsData, error } = await supabase
//         .from("products")
//         .select(`
//         *,
//         product_extra_prices (*)
//       `);

//       if (error) {
//         console.error("Error fetching products:", error);
//         return;
//       }

//       setProducts(productsData || []);
//     };

//     fetchProducts();
//   }, []);


//   // When product changes, load options
//   useEffect(() => {
//     if (!selectedProduct) return;

//     setColors(selectedProduct.colors || []);
//     setTops(selectedProduct.top_options || []);
//     setBottoms(selectedProduct.bottom_options || []);
//     // LOAD extras FROM extra price table
//     const extraList =
//       selectedProduct.product_extra_prices?.map((e) => e.extra_option) || [];

//     setExtras(extraList);

//     //dynamic sizes
//     setAvailableSizes(selectedProduct.available_size || []);
//     setSelectedSize(selectedProduct.available_size?.[0] || "");

//     setSelectedColor("");
//     setSelectedTop("");
//     setSelectedBottom("");
//     setSelectedExtra("");
//     setQuantity(1);
//   }, [selectedProduct]);

//   // ADD PRODUCT
//   const handleAddProduct = () => {
//     if (!selectedProduct) return alert("Please select a product");

//     const newProduct = {
//       _id: makeId(),
//       product_id: selectedProduct.id,
//       product_name: selectedProduct.name,
//       sku_id: selectedProduct.sku_id,
//       color: selectedColor,
//       top: selectedTop,
//       bottom: selectedBottom,
//       extra: selectedExtra,
//       size: selectedSize,
//       quantity: quantity,
//       price: getLivePrice(),
//       measurements,
//        image_url: selectedProduct.image_url || selectedProduct.image || null,
//     };

//     setOrderItems((prev) => [...prev, newProduct]);

//     // Reset inputs
//     setSelectedProduct(null);
//     setSelectedColor("");
//     setSelectedTop("");
//     setSelectedBottom("");
//     setSelectedExtra("");
//     setSelectedSize("S");
//     setQuantity(1);
//     setMeasurements({});
//   };

//   // LIVE SUMMARY CALC
//   const cartQuantity = orderItems.reduce((a, b) => a + b.quantity, 0);
//   const cartSubtotal = orderItems.reduce((a, b) => a + b.price * b.quantity, 0);

//   const liveQuantity = quantity;
//   const getLivePrice = () => {
//     if (!selectedProduct) return 0;

//     // BASE PRICE FIRST
//     let price = selectedProduct.base_price ?? 0;

//     // IF EXTRA SELECTED → FIND ITS FINAL PRICE
//     if (selectedExtra) {
//       const extraRow = selectedProduct.product_extra_prices?.find(
//         (e) => e.extra_option === selectedExtra
//       );

//       if (extraRow) price = extraRow.final_price;
//     }

//     return price;
//   };
//   const livePrice = getLivePrice();
//   const liveSubtotal = livePrice * liveQuantity;

//   const totalQuantity = orderItems.length > 0 ? cartQuantity : liveQuantity;
//   const subtotal = orderItems.length > 0 ? cartSubtotal : liveSubtotal;
//   const taxes = subtotal * 0.18;
//   const totalOrder = subtotal + taxes;

//   const handleFileUpload = async (event) => {
//     const files = event.target.files;
//     if (!files || files.length === 0) return;

//     const uploadedUrls = [];

//     for (const file of files) {
//       const cleanName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
//       const fileName = `${Date.now()}_${cleanName}`;
//       const filePath = `attachments/${fileName}`;

//       console.log("Uploading:", filePath);

//       const { data, error } = await supabase.storage
//         .from("attachments")
//         .upload(filePath, file, {
//           cacheControl: "3600",
//           upsert: false,
//           contentType: file.type || "application/octet-stream",
//         });

//       if (error) {
//         console.error("Upload failed:", error);
//         alert("Upload failed: " + error.message);
//         return;
//       }

//       const { data: urlData } = supabase.storage
//         .from("attachments")
//         .getPublicUrl(filePath);

//       uploadedUrls.push(urlData.publicUrl);
//     }

//     setAttachments(uploadedUrls);
//   };



//   // SAVE ORDER
//   const saveOrder = () => {
//     // VALIDATION
//     if (!deliveryDate) return alert("Enter delivery date");
//     if (!modeOfDelivery) return alert("Select mode of delivery");
//     if (!orderFlag) return alert("Select order flag");

//     let finalItems = [...orderItems];

//     // AUTO ADD LAST PRODUCT IF USER DIDN'T CLICK "ADD PRODUCT"
//     if (orderItems.length === 0 && selectedProduct) {
//       finalItems.push({
//         product_id: selectedProduct.id,
//         product_name: selectedProduct.name,
//         sku_id: selectedProduct.sku_id,
//         color: selectedColor,
//         top: selectedTop,
//         bottom: selectedBottom,
//         extra: selectedExtra,
//         size: selectedSize,
//         quantity,
//         price: selectedProduct.price || 0,
//         measurements,
//          image_url: selectedProduct.image_url || selectedProduct.image || null,
//       });
//     }

//     const orderPayload = {
//       user_id: user?.id,

//       // Product level details
//       items: finalItems,

//       // Delivery Details
//       delivery_date: deliveryDate,
//       mode_of_delivery: modeOfDelivery,
//       order_flag: orderFlag,

//       // Extra fields
//       comments: comments,
//       attachments: attachments,

//       // Totals
//       subtotal: subtotal,
//       taxes: taxes,
//       grand_total: totalOrder,
//       total_quantity: totalQuantity,

//       // Timestamp
//       created_at: new Date().toISOString(),
//     };

//     navigate("/confirmDetail", { state: { orderPayload } });
//   };

//   const toOptions = (arr = []) => arr.map((x) => ({ label: String(x), value: x }));

//   return (
//     <div className="screen4-bg">
//       {/* HEADER */}
//       <div className="header">
//         <img src={Logo} className="logo4" alt="logo" />
//         <h2 className="order-title">Order Form</h2>
//       </div>

//       <div className="screen4-card">
//         <h2 className="product-title">Product</h2>

//         {/* ADDED PRODUCTS INSIDE CARD */}
//         {orderItems.length > 0 && (
//           <div className="added-products-box added-products-top">
//             {orderItems.map((item, i) => {
//               const productMeta = products.find((p) => p.id === item.product_id) || {};
//               const expanded = !!expandedRowIds[item._id];

//               return (
//                 <div className="added-product-row" key={item._id}>
//                   <span className="product-info">
//                     {i + 1}. Name: {item.product_name}, Size: {item.size}, Qty: {item.quantity}, Price: ₹{item.price}
//                   </span>

//                   <div className="product-buttons">
//                     <button
//                       className="expand"
//                       onClick={() => toggleExpand(item._id)}
//                       title={expanded ? "Collapse" : "Expand to edit"}
//                     >
//                       {expanded ? "−" : "✚"}
//                     </button>
//                     <button className="delete" onClick={() => handleDelete(item._id)} title="Remove">
//                       🗑
//                     </button>
//                   </div>

//                   {/* Simple editable form (plain inputs) */}
//                   {expanded && (
//                     <div className="row expand-panel simple-edit">
//                       {/* Color */}
//                       <div className="field">
//                         <label>Color</label>
//                         <input
//                           type="text"
//                           className="input-line"
//                           value={item.color || ""}
//                           onChange={(e) => updateItem(item._id, { color: e.target.value })}
//                           placeholder="Enter color"
//                         />
//                       </div>

//                       {/* Top */}
//                       <div className="field">
//                         <label>Top</label>
//                         <input
//                           type="text"
//                           className="input-line"
//                           value={item.top || ""}
//                           onChange={(e) => updateItem(item._id, { top: e.target.value })}
//                           placeholder="Enter top"
//                         />
//                       </div>

//                       {/* Bottom */}
//                       <div className="field">
//                         <label>Bottom</label>
//                         <input
//                           type="text"
//                           className="input-line"
//                           value={item.bottom || ""}
//                           onChange={(e) => updateItem(item._id, { bottom: e.target.value })}
//                           placeholder="Enter bottom"
//                         />
//                       </div>

//                       {/* Extra */}
//                       <div className="field">
//                         <label>Extra</label>
//                         <input
//                           type="text"
//                           className="input-line"
//                           value={item.extra || ""}
//                           onChange={(e) => updateItem(item._id, { extra: e.target.value })}
//                           placeholder="Enter extra"
//                         />
//                       </div>

//                       {/* Size */}
//                       <div className="field">
//                         <label>Size</label>
//                         <input
//                           type="text"
//                           className="input-line"
//                           value={item.size || ""}
//                           onChange={(e) => updateItem(item._id, { size: e.target.value })}
//                           placeholder="e.g. S / M / L or custom"
//                         />
//                       </div>


//                       {/* Quantity */}
//                       <div className="field" style={{ maxWidth: 160 }}>
//                         <label>Quantity</label>
//                         <input
//                           type="number"
//                           min={1}
//                           className="input-line"
//                           value={item.quantity ?? 1}
//                           onChange={(e) =>
//                             updateItem(item._id, {
//                               quantity: Math.max(1, Number(e.target.value || 1)),
//                             })
//                           }
//                         />
//                       </div>

//                       {/* Price */}
//                       <div className="field" style={{ maxWidth: 200 }}>
//                         <label>Price (₹)</label>
//                         <input
//                           type="number"
//                           min={0}
//                           className="input-line"
//                           value={item.price ?? 0}
//                           onChange={(e) => updateItem(item._id, { price: Number(e.target.value || 0) })}
//                         />
//                       </div>
//                     </div>
//                   )}
//                 </div>
//               );
//             })}
//           </div>
//         )}

//         {/* PRODUCT ROW */}
//         <div className="row">
//           {/* PRODUCT SELECT */}
//           <div className="field">
//             <SearchableSelect
//               options={products.map((p) => ({ label: p.name, value: p.id }))}
//               value={selectedProduct?.id || ""}
//               onChange={(val) =>
//                 setSelectedProduct(
//                   products.find((p) => String(p.id) === String(val)) || null
//                 )
//               }
//               placeholder="Select Product"
//             />

//             {/* PRICE DISPLAY */}
//             {selectedProduct && (
//               <p className="product-price">
//                 Price: <strong>₹{getLivePrice()}</strong>
//               </p>
//             )}

//           </div>

//           {/* COLOR */}
//           <div className="field">
//             <SearchableSelect
//               options={toOptions(colors)}
//               value={selectedColor}
//               onChange={setSelectedColor}
//               placeholder="Select Color"
//             />
//           </div>

//           {/* QUANTITY */}
//           <div className="qty-field">
//             <label>Qty</label>
//             <div className="qty-controls">
//               <button onClick={() => setQuantity((q) => Math.max(1, q - 1))}>−</button>
//               <span>{quantity}</span>
//               <button onClick={() => setQuantity((q) => q + 1)}>+</button>
//             </div>
//           </div>
//         </div>

//         {/* TOP / BOTTOM / EXTRA */}
//         <div className="row">
//           <div className="field">
//             <SearchableSelect
//               options={toOptions(tops)}
//               value={selectedTop}
//               onChange={setSelectedTop}
//               placeholder="Select Top"
//             />
//           </div>

//           <div className="field">
//             <SearchableSelect
//               options={toOptions(bottoms)}
//               value={selectedBottom}
//               onChange={setSelectedBottom}
//               placeholder="Select Bottom"
//             />
//           </div>

//           <div className="field">
//             <SearchableSelect
//               options={toOptions(extras)}
//               value={selectedExtra}
//               onChange={setSelectedExtra}
//               placeholder="Select Extra"
//             />
//           </div>
//         </div>

//         {/* SIZE */}

//         <div className="size-box">
//           <span className="size-label">Size:</span>

//           <div className="sizes">
//             {Array.isArray(availableSizes) && availableSizes.length > 0 ? (
//               availableSizes.map((s, i) => (
//                 <button
//                   key={i}
//                   className={selectedSize === s ? "size-btn active" : "size-btn"}
//                   onClick={() => setSelectedSize(s)}
//                 >
//                   {s}
//                 </button>
//               ))
//             ) : (
//               <span style={{ opacity: 0.6 }}>No sizes available</span>
//             )}
//           </div>
//         </div>


//         {/* MEASUREMENTS */}
//         <div className="measure-bar">
//           <span>Custom Measurements</span>
//           <button className="plus-btn" onClick={() => setShowMeasurements(!showMeasurements)}>
//             {showMeasurements ? "−" : "+"}
//           </button>
//         </div>

//         {showMeasurements && (
//           <div className="measure-container">
//             <div className="measure-menu">
//               {measurementCategories.map((cat) => (
//                 <div
//                   key={cat}
//                   className={activeCategory === cat ? "measure-item active" : "measure-item"}
//                   onClick={() => setActiveCategory(cat)}
//                 >
//                   {cat}
//                 </div>
//               ))}
//             </div>

//             <div className="measure-fields">
//               <h3 className="measure-title">Custom Measurements</h3>

//               <div className="measure-grid">
//                 {measurementFields[activeCategory].map((field) => (
//                   <div className="measure-field" key={field}>
//                     <label>{field} </label>
//                     <input placeholder={`Enter ${field.toLowerCase()}..`} />
//                   </div>
//                 ))}
//               </div>
//             </div>
//           </div>
//         )}

//         {/* DELIVERY */}
//         <div className="row">
//           <div className="field">
//             <label>Delivery Date</label>
//             <input
//               type="date"
//               className="input-line"
//               value={deliveryDate}
//               onChange={(e) => setDeliveryDate(e.target.value)}
//             />
//           </div>

//           <div className="field">
//             <SearchableSelect
//               options={[
//                 { label: "Home Delivery", value: "Home Delivery" },
//                 { label: "Store Pickup", value: "Store Pickup" },
//               ]}
//               value={modeOfDelivery}
//               onChange={setModeOfDelivery}
//               placeholder="Mode of Delivery"
//             />
//           </div>

//           <div className="field">
//             <SearchableSelect
//               options={[
//                 { label: "Urgent", value: "Urgent" },
//                 { label: "Normal", value: "Normal" },
//               ]}
//               value={orderFlag}
//               onChange={setOrderFlag}
//               placeholder="Order Flag"
//             />
//           </div>
//         </div>

//         {/* COMMENTS */}
//         <div className="row">
//           <div className="field">
//             <label>Comments</label>
//             <input
//               className="input-line"
//               placeholder=""
//               value={comments}
//               onChange={(e) => setComments(e.target.value)}
//             />
//           </div>


//           <div className="field">
//             <label>Attachments</label>

//             <div className="custom-file-upload">
//               <label className="upload-btn">
//                 Upload Files
//                 <input
//                   type="file"
//                   accept=".jpg,.jpeg,.png,.webp,.pdf,.doc,.docx,.xls,.xlsx"
//                   multiple
//                   onChange={handleFileUpload}
//                 />
//               </label>
//             </div>

//             {attachments && attachments.length > 0 && (
//               <div className="attachment-preview">
//                 {attachments.map((url, idx) => (
//                   <span key={idx} className="file-item">
//                     {url.split("/").pop()}
//                   </span>
//                 ))}
//               </div>
//             )}

//           </div>


//         </div>

//         {/* ALWAYS-VISIBLE SUMMARY */}
//         <div className="summary-box-fixed">
//           <h3>Order Summary</h3>

//           <p>
//             Total Quantity: <strong>{totalQuantity}</strong>
//           </p>
//           <p>
//             Subtotal: <strong>₹{subtotal.toFixed(2)}</strong>
//           </p>
//           <p>
//             Taxes (18%): <strong>₹{taxes.toFixed(2)}</strong>
//           </p>

//           <p className="grand-total">
//             Total: <strong>₹{totalOrder.toFixed(2)}</strong>
//           </p>
//         </div>

//         {/* BUTTONS */}
//         <div className="footer-btns">
//           <button className="productBtn" onClick={handleAddProduct}>
//             Add Product
//           </button>

//           <button className="continueBtn" onClick={saveOrder}>
//             Continue
//           </button>
//         </div>
//       </div>

//       {/* BACK BUTTON */}
//       <button className="back-btn">←</button>
//     </div>
//   );
// }


import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabaseClient";
import "./Screen4.css";
import Logo from "../images/logo.png";

/**
 * Generic Searchable Select (no external libs)
 * - Keyboard: ↑/↓ to move, Enter to select, Esc to close
 * - Click outside closes menu
 * - Works with arrays of primitives or {label, value}
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
    const onDoc = (e) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target)) {
        setOpen(false);
        setFocusIdx(-1);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    if (!open || !listRef.current || focusIdx < 0) return;
    const el = listRef.current.querySelector(`[data-idx="${focusIdx}"]`);
    if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
  }, [focusIdx, open]);

  const handleSelect = (opt) => {
    onChange(opt?.value ?? "");
    setOpen(false);
    setQuery("");
    setFocusIdx(-1);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const handleKeyDown = (e) => {
    if (!open && (e.key === "ArrowDown" || e.key === "Enter")) {
      setOpen(true);
      setFocusIdx(0);
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
      <div className={`ss-control ${open ? "ss-open" : ""}`} onClick={() => !disabled && setOpen((o) => !o)}>
        <input
          ref={inputRef}
          className="ss-input"
          placeholder={current ? current.label : placeholder}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!open) setOpen(true);
            setFocusIdx(0);
          }}
          onKeyDown={handleKeyDown}
          disabled={disabled}
        />
        {current && (
          <button className="ss-clear" title="Clear" onClick={clear}>
            ×
          </button>
        )}
        <span className="ss-caret">▾</span>
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
                    {opt.label}
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

export default function Screen4() {
  const navigate = useNavigate();
  const { user } = useAuth();

  // PRODUCT STATES
  const [products, setProducts] = useState([]);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [comments, setComments] = useState("");
  const [attachments, setAttachments] = useState([]);


  const [colors, setColors] = useState([]);
  const [tops, setTops] = useState([]);
  const [bottoms, setBottoms] = useState([]);
  const [extras, setExtras] = useState([]);

  const [selectedColor, setSelectedColor] = useState("");
  const [selectedTop, setSelectedTop] = useState("");
  const [selectedBottom, setSelectedBottom] = useState("");
  const [selectedExtra, setSelectedExtra] = useState("");

  const [selectedSize, setSelectedSize] = useState("");
  const [quantity, setQuantity] = useState(1);

  const [modeOfDelivery, setModeOfDelivery] = useState("");
  const [orderFlag, setOrderFlag] = useState("");
  const [deliveryDate, setDeliveryDate] = useState("");

  // MEASUREMENTS
  const [measurements, setMeasurements] = useState({});

  // CART
  const [orderItems, setOrderItems] = useState([]);

  // MEASUREMENT DROPDOWN
  const [showMeasurements, setShowMeasurements] = useState(false);
  const [activeCategory, setActiveCategory] = useState("Shirts");

  const [expandedRowIds, setExpandedRowIds] = useState({}); // {[_id]: true/false}
  const [availableSizes, setAvailableSizes] = useState([]);

  const measurementCategories = [
    "Shirts",
    "Blouse",
    "Salwar",
    "Churidar",
    "Trouser",
    "Anarkali",
    "Lehnga Length",
  ];

  const measurementFields = {
    Shirts: [
      "Shoulder",
      "Length",
      "Upper Bust",
      "Bust",
      "Waist",
      "Mid Waist",
      "Hip",
      "Sleeves",
      "Biceps",
      "Armhole",
      "Front Cross",
      "Back Cross",
      "Dart Point",
      "Neck",
    ],
    Blouse: ["Bust", "Waist", "Shoulder", "Neck"],
    Salwar: ["Waist", "Hip", "Length"],
    Trouser: ["Waist", "Hip", "Inseam", "Outseam"],
    Churidar: ["Waist", "Hip", "Length"],
    Anarkali: ["Bust", "Waist", "Hip", "Length"],
    "Lehnga Length": ["Waist", "Length"],
  };

  // tiny id helper so list keys are stable
  const makeId = () => `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  // update helpers
  const toggleExpand = (id) =>
    setExpandedRowIds((e) => ({ ...e, [id]: !e[id] }));

  const handleDelete = (id) =>
    setOrderItems((prev) => prev.filter((it) => it._id !== id));

  const updateItem = (id, patch) =>
    setOrderItems((prev) =>
      prev.map((it) => (it._id === id ? { ...it, ...patch } : it))
    );

  // Fetch products
  useEffect(() => {
    const fetchProducts = async () => {
      const { data: productsData, error } = await supabase
        .from("products")
        .select(`
        *,
        product_extra_prices (*)
      `);

      if (error) {
        console.error("Error fetching products:", error);
        return;
      }

      setProducts(productsData || []);
    };

    fetchProducts();
  }, []);


  // When product changes, load options
  useEffect(() => {
    if (!selectedProduct) return;

    setColors(selectedProduct.colors || []);
    setTops(selectedProduct.top_options || []);
    setBottoms(selectedProduct.bottom_options || []);
    // LOAD extras FROM extra price table
    const extraList =
      selectedProduct.product_extra_prices?.map((e) => e.extra_option) || [];

    setExtras(extraList);

    //dynamic sizes
    setAvailableSizes(selectedProduct.available_size || []);
    setSelectedSize(selectedProduct.available_size?.[0] || "");

    setSelectedColor("");
    setSelectedTop("");
    setSelectedBottom("");
    setSelectedExtra("");
    setQuantity(1);
  }, [selectedProduct]);

  // ADD PRODUCT
  const handleAddProduct = () => {
    if (!selectedProduct) return alert("Please select a product");

    const newProduct = {
      _id: makeId(),
      product_id: selectedProduct.id,
      product_name: selectedProduct.name,
      sku_id: selectedProduct.sku_id,
      color: selectedColor,
      top: selectedTop,
      bottom: selectedBottom,
      extra: selectedExtra,
      size: selectedSize,
      quantity: quantity,
      price: getLivePrice(),
      measurements,
       image_url: selectedProduct.image_url || selectedProduct.image || null,
    };

    setOrderItems((prev) => [...prev, newProduct]);

    // Reset inputs
    setSelectedProduct(null);
    setSelectedColor("");
    setSelectedTop("");
    setSelectedBottom("");
    setSelectedExtra("");
    setSelectedSize("S");
    setQuantity(1);
    setMeasurements({});
  };

  // LIVE SUMMARY CALC
  const cartQuantity = orderItems.reduce((a, b) => a + b.quantity, 0);
  const cartSubtotal = orderItems.reduce((a, b) => a + b.price * b.quantity, 0);

  const liveQuantity = quantity;
  const getLivePrice = () => {
    if (!selectedProduct) return 0;

    // BASE PRICE FIRST
    let price = selectedProduct.base_price ?? 0;

    // IF EXTRA SELECTED → FIND ITS FINAL PRICE
    if (selectedExtra) {
      const extraRow = selectedProduct.product_extra_prices?.find(
        (e) => e.extra_option === selectedExtra
      );

      if (extraRow) price = extraRow.final_price;
    }

    return price;
  };
  const livePrice = getLivePrice();
  const liveSubtotal = livePrice * liveQuantity;

  const totalQuantity = orderItems.length > 0 ? cartQuantity : liveQuantity;
  const subtotal = orderItems.length > 0 ? cartSubtotal : liveSubtotal;
  const taxes = subtotal * 0.18;
  const totalOrder = subtotal + taxes;

  const handleFileUpload = async (event) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const uploadedUrls = [];

    for (const file of files) {
      const cleanName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const fileName = `${Date.now()}_${cleanName}`;
      const filePath = `attachments/${fileName}`;

      console.log("Uploading:", filePath);

      const { data, error } = await supabase.storage
        .from("attachments")
        .upload(filePath, file, {
          cacheControl: "3600",
          upsert: false,
          contentType: file.type || "application/octet-stream",
        });

      if (error) {
        console.error("Upload failed:", error);
        alert("Upload failed: " + error.message);
        return;
      }

      const { data: urlData } = supabase.storage
        .from("attachments")
        .getPublicUrl(filePath);

      uploadedUrls.push(urlData.publicUrl);
    }

    setAttachments(uploadedUrls);
  };



  // SAVE ORDER
  const saveOrder = () => {
    // VALIDATION
    if (!deliveryDate) return alert("Enter delivery date");
    if (!modeOfDelivery) return alert("Select mode of delivery");
    if (!orderFlag) return alert("Select order flag");

    let finalItems = [...orderItems];

    // AUTO ADD LAST PRODUCT IF USER DIDN'T CLICK "ADD PRODUCT"
    if (orderItems.length === 0 && selectedProduct) {
      finalItems.push({
        product_id: selectedProduct.id,
        product_name: selectedProduct.name,
        sku_id: selectedProduct.sku_id,
        color: selectedColor,
        top: selectedTop,
        bottom: selectedBottom,
        extra: selectedExtra,
        size: selectedSize,
        quantity,
        price: selectedProduct.price || 0,
        measurements,
         image_url: selectedProduct.image_url || selectedProduct.image || null,
      });
    }

    const orderPayload = {
      user_id: user?.id,

      // Product level details
      items: finalItems,

      // Delivery Details
      delivery_date: deliveryDate,
      mode_of_delivery: modeOfDelivery,
      order_flag: orderFlag,

      // Extra fields
      comments: comments,
      attachments: attachments,

      // Totals
      subtotal: subtotal,
      taxes: taxes,
      grand_total: totalOrder,
      total_quantity: totalQuantity,

      // Timestamp
      created_at: new Date().toISOString(),
    };

    navigate("/confirmDetail", { state: { orderPayload } });
  };

  const toOptions = (arr = []) => arr.map((x) => ({ label: String(x), value: x }));

  return (
    <div className="screen4-bg">
      {/* HEADER */}
      <div className="header">
        <img src={Logo} className="logo4" alt="logo" />
        <h2 className="order-title">Order Form</h2>
      </div>

      <div className="screen4-card">
        <h2 className="product-title">Product</h2>

        {/* ADDED PRODUCTS INSIDE CARD */}
        {orderItems.length > 0 && (
          <div className="added-products-box added-products-top">
            {orderItems.map((item, i) => {
              const productMeta = products.find((p) => p.id === item.product_id) || {};
              const expanded = !!expandedRowIds[item._id];

              return (
                <div className="added-product-row" key={item._id}>
                  <span className="product-info">
                    {i + 1}. Name: {item.product_name}, Size: {item.size}, Qty: {item.quantity}, Price: ₹{item.price}
                  </span>

                  <div className="product-buttons">
                    <button
                      className="expand"
                      onClick={() => toggleExpand(item._id)}
                      title={expanded ? "Collapse" : "Expand to edit"}
                    >
                      {expanded ? "−" : "✚"}
                    </button>
                    <button className="delete" onClick={() => handleDelete(item._id)} title="Remove">
                      🗑
                    </button>
                  </div>

                  {/* Simple editable form (plain inputs) */}
                  {expanded && (
                    <div className="row expand-panel simple-edit">
                      {/* Color */}
                      <div className="field">
                        <label>Color</label>
                        <input
                          type="text"
                          className="input-line"
                          value={item.color || ""}
                          onChange={(e) => updateItem(item._id, { color: e.target.value })}
                          placeholder="Enter color"
                        />
                      </div>

                      {/* Top */}
                      <div className="field">
                        <label>Top</label>
                        <input
                          type="text"
                          className="input-line"
                          value={item.top || ""}
                          onChange={(e) => updateItem(item._id, { top: e.target.value })}
                          placeholder="Enter top"
                        />
                      </div>

                      {/* Bottom */}
                      <div className="field">
                        <label>Bottom</label>
                        <input
                          type="text"
                          className="input-line"
                          value={item.bottom || ""}
                          onChange={(e) => updateItem(item._id, { bottom: e.target.value })}
                          placeholder="Enter bottom"
                        />
                      </div>

                      {/* Extra */}
                      <div className="field">
                        <label>Extra</label>
                        <input
                          type="text"
                          className="input-line"
                          value={item.extra || ""}
                          onChange={(e) => updateItem(item._id, { extra: e.target.value })}
                          placeholder="Enter extra"
                        />
                      </div>

                      {/* Size */}
                      <div className="field">
                        <label>Size</label>
                        <input
                          type="text"
                          className="input-line"
                          value={item.size || ""}
                          onChange={(e) => updateItem(item._id, { size: e.target.value })}
                          placeholder="e.g. S / M / L or custom"
                        />
                      </div>


                      {/* Quantity */}
                      <div className="field" style={{ maxWidth: 160 }}>
                        <label>Quantity</label>
                        <input
                          type="number"
                          min={1}
                          className="input-line"
                          value={item.quantity ?? 1}
                          onChange={(e) =>
                            updateItem(item._id, {
                              quantity: Math.max(1, Number(e.target.value || 1)),
                            })
                          }
                        />
                      </div>

                      {/* Price */}
                      <div className="field" style={{ maxWidth: 200 }}>
                        <label>Price (₹)</label>
                        <input
                          type="number"
                          min={0}
                          className="input-line"
                          value={item.price ?? 0}
                          onChange={(e) => updateItem(item._id, { price: Number(e.target.value || 0) })}
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* PRODUCT ROW */}
        <div className="row">
          {/* PRODUCT SELECT */}
          <div className="field">
            <SearchableSelect
              options={products.map((p) => ({ label: p.name, value: p.id }))}
              value={selectedProduct?.id || ""}
              onChange={(val) =>
                setSelectedProduct(
                  products.find((p) => String(p.id) === String(val)) || null
                )
              }
              placeholder="Select Product"
            />

            {/* PRICE DISPLAY */}
            {selectedProduct && (
              <p className="product-price">
                Price: <strong>₹{getLivePrice()}</strong>
              </p>
            )}

          </div>

          {/* COLOR */}
          <div className="field">
            <SearchableSelect
              options={toOptions(colors)}
              value={selectedColor}
              onChange={setSelectedColor}
              placeholder="Select Color"
            />
          </div>

          {/* QUANTITY */}
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

          <div className="field">
            <SearchableSelect
              options={toOptions(bottoms)}
              value={selectedBottom}
              onChange={setSelectedBottom}
              placeholder="Select Bottom"
            />
          </div>

          <div className="field">
            <SearchableSelect
              options={toOptions(extras)}
              value={selectedExtra}
              onChange={setSelectedExtra}
              placeholder="Select Extra"
            />
          </div>
        </div>

        {/* SIZE */}

        <div className="size-box">
          <span className="size-label">Size:</span>

          <div className="sizes">
            {Array.isArray(availableSizes) && availableSizes.length > 0 ? (
              availableSizes.map((s, i) => (
                <button
                  key={i}
                  className={selectedSize === s ? "size-btn active" : "size-btn"}
                  onClick={() => setSelectedSize(s)}
                >
                  {s}
                </button>
              ))
            ) : (
              <span style={{ opacity: 0.6 }}>No sizes available</span>
            )}
          </div>
        </div>


        {/* MEASUREMENTS */}
        <div className="measure-bar">
          <span>Custom Measurements</span>
          <button className="plus-btn" onClick={() => setShowMeasurements(!showMeasurements)}>
            {showMeasurements ? "−" : "+"}
          </button>
        </div>

        {showMeasurements && (
          <div className="measure-container">
            <div className="measure-menu">
              {measurementCategories.map((cat) => (
                <div
                  key={cat}
                  className={activeCategory === cat ? "measure-item active" : "measure-item"}
                  onClick={() => setActiveCategory(cat)}
                >
                  {cat}
                </div>
              ))}
            </div>

            <div className="measure-fields">
              <h3 className="measure-title">Custom Measurements</h3>

              <div className="measure-grid">
                {measurementFields[activeCategory].map((field) => (
                  <div className="measure-field" key={field}>
                    <label>{field} </label>
                   <input
  type="number"
  className="input-line"
  placeholder={`Enter ${field.toLowerCase()}..`}
  value={measurements[activeCategory]?.[field] || ""}
  onChange={(e) => {
    const val = e.target.value;

    setMeasurements((prev) => ({
      ...prev,
      [activeCategory]: {
        ...(prev[activeCategory] || {}),
        [field]: val,
      },
    }));
  }}
/>

                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* DELIVERY */}
        <div className="row">
          <div className="field">
            <label>Delivery Date</label>
            <input
              type="date"
              className="input-line"
              value={deliveryDate}
              onChange={(e) => setDeliveryDate(e.target.value)}
            />
          </div>

          <div className="field">
            <SearchableSelect
              options={[
                { label: "Home Delivery", value: "Home Delivery" },
                { label: "Store Pickup", value: "Store Pickup" },
              ]}
              value={modeOfDelivery}
              onChange={setModeOfDelivery}
              placeholder="Mode of Delivery"
            />
          </div>

          <div className="field">
            <SearchableSelect
              options={[
                { label: "Urgent", value: "Urgent" },
                { label: "Normal", value: "Normal" },
              ]}
              value={orderFlag}
              onChange={setOrderFlag}
              placeholder="Order Flag"
            />
          </div>
        </div>

        {/* COMMENTS */}
        <div className="row">
          <div className="field">
            <label>Comments</label>
            <input
              className="input-line"
              placeholder=""
              value={comments}
              onChange={(e) => setComments(e.target.value)}
            />
          </div>


          <div className="field">
            <label>Attachments</label>

            <div className="custom-file-upload">
              <label className="upload-btn">
                Upload Files
                <input
                  type="file"
                  accept=".jpg,.jpeg,.png,.webp,.pdf,.doc,.docx,.xls,.xlsx"
                  multiple
                  onChange={handleFileUpload}
                />
              </label>
            </div>

            {attachments && attachments.length > 0 && (
              <div className="attachment-preview">
                {attachments.map((url, idx) => (
                  <span key={idx} className="file-item">
                    {url.split("/").pop()}
                  </span>
                ))}
              </div>
            )}

          </div>


        </div>

        {/* ALWAYS-VISIBLE SUMMARY */}
        <div className="summary-box-fixed">
          <h3>Order Summary</h3>

          <p>
            Total Quantity: <strong>{totalQuantity}</strong>
          </p>
          <p>
            Subtotal: <strong>₹{subtotal.toFixed(2)}</strong>
          </p>
          <p>
            Taxes (18%): <strong>₹{taxes.toFixed(2)}</strong>
          </p>

          <p className="grand-total">
            Total: <strong>₹{totalOrder.toFixed(2)}</strong>
          </p>
        </div>

        {/* BUTTONS */}
        <div className="footer-btns">
          <button className="productBtn" onClick={handleAddProduct}>
            Add Product
          </button>

          <button className="continueBtn" onClick={saveOrder}>
            Continue
          </button>
        </div>
      </div>

      {/* BACK BUTTON */}
      <button className="back-btn">←</button>
    </div>
  );
}
