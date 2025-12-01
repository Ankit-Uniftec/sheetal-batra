import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabaseClient";
import "./Screen4.css";

export default function Screen4() {
  const navigate = useNavigate();
  const { user } = useAuth();

  // PRODUCT STATES
  const [products, setProducts] = useState([]);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [comments, setComments] = useState("");
const [attachments, setAttachments] = useState("");


  const [colors, setColors] = useState([]);
  const [tops, setTops] = useState([]);
  const [bottoms, setBottoms] = useState([]);
  const [extras, setExtras] = useState([]);

  const [selectedColor, setSelectedColor] = useState("");
  const [selectedTop, setSelectedTop] = useState("");
  const [selectedBottom, setSelectedBottom] = useState("");
  const [selectedExtra, setSelectedExtra] = useState("");

  const [selectedSize, setSelectedSize] = useState("S");
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

  // Fetch products
  useEffect(() => {
    const fetchProducts = async () => {
      const { data } = await supabase.from("products").select("*");
      setProducts(data || []);
    };
    fetchProducts();
  }, []);

  // When product changes, load options
  useEffect(() => {
    if (!selectedProduct) return;

    setColors(selectedProduct.colors || []);
    setTops(selectedProduct.top_options || []);
    setBottoms(selectedProduct.bottom_options || []);
    setExtras(selectedProduct.extra_options || []);

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
      product_id: selectedProduct.id,
      product_name: selectedProduct.name,
      sku_id: selectedProduct.sku_id,
      color: selectedColor,
      top: selectedTop,
      bottom: selectedBottom,
      extra: selectedExtra,
      size: selectedSize,
      quantity: quantity,
      price: selectedProduct.price || 0,
      measurements,
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
  const livePrice = selectedProduct?.price || 0;
  const liveSubtotal = livePrice * liveQuantity;

  const totalQuantity = orderItems.length > 0 ? cartQuantity : liveQuantity;
  const subtotal = orderItems.length > 0 ? cartSubtotal : liveSubtotal;
  const taxes = subtotal * 0.18;
  const totalOrder = subtotal + taxes;

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


  return (
    <div className="screen4-bg">
      {/* ADDED PRODUCTS INSIDE CARD */}

      {/* HEADER */}
      <div className="header">
        <img src="/logo.png" className="logo4" alt="logo" />
        <h2 className="order-title">Order Form</h2>
      </div>

      <div className="screen4-card">
        <h2 className="product-title">Product</h2>
        {orderItems.length > 0 && (
          <div className="added-products-box added-products-top">
            

            {orderItems.map((item, i) => (
              <div className="added-product-row" key={i}>
                <span>
                  {i + 1}. {item.product_name} ({item.size}) × {item.quantity}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* PRODUCT ROW */}
       <div className="row">
  {/* PRODUCT SELECT */}
  <div className="field">
    {/* <label>Select Product</label> */}
    <select
      value={selectedProduct?.id || ""}
      onChange={(e) =>
        setSelectedProduct(products.find((p) => p.id == e.target.value))
      }
    >
      <option value="" > Select Product</option>
      {products.map((p) => (
        <option key={p.id} value={p.id} >
          {p.name}
        </option>
      ))}
    </select>

    {/* PRICE DISPLAY */}
    {selectedProduct && (
      <p className="product-price">
        Price: <strong>₹{selectedProduct.price}</strong>
      </p>
    )}
  </div>

  {/* COLOR */}
  <div className="field">
    {/* <label>Select Color</label> */}
    <select
      value={selectedColor}
      onChange={(e) => setSelectedColor(e.target.value)}
    >
      <option value="" >Select Color</option>
      {colors.map((c, i) => (
        <option key={i} value={c}>
          {c}
        </option>
      ))}
    </select>
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
            {/* <label>Select Top</label> */}
            <select
              value={selectedTop}
              onChange={(e) => setSelectedTop(e.target.value)}
            >
              <option value="" >Select Top</option>
              {tops.map((t, i) => (
                <option key={i} value={t} >
                  {t}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            {/* <label>Select Bottom</label> */}
            <select
              value={selectedBottom}
              onChange={(e) => setSelectedBottom(e.target.value)}
            >
              <option value="" >Select Bottom</option>
              {bottoms.map((b, i) => (
                <option key={i} value={b} >
                  {b}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            {/* <label>Select Extras</label> */}
            <select
              value={selectedExtra}
              onChange={(e) => setSelectedExtra(e.target.value)}
            >
              <option value="" >Select Extra</option>
              {extras.map((x, i) => (
                <option key={i} value={x} >
                  {x}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* SIZE */}
        <div className="size-box">
          <span className="size-label">Size:</span>
          <div className="sizes">
            {["XS", "S", "M", "L", "XL", "XXL", "3XL", "4XL"].map((s, i) => (
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

        {/* MEASUREMENTS */}
        <div className="measure-bar">
          <span>Custom Measurements</span>
          <button
            className="plus-btn"
            onClick={() => setShowMeasurements(!showMeasurements)}
          >
            {showMeasurements ? "−" : "+"}
          </button>
        </div>

        {showMeasurements && (
          <div className="measure-container">
            <div className="measure-menu">
              {measurementCategories.map((cat) => (
                <div
                  key={cat}
                  className={
                    activeCategory === cat
                      ? "measure-item active"
                      : "measure-item"
                  }
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
                    <label>{field} *</label>
                    <input placeholder={`Enter ${field.toLowerCase()}..`} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* DELIVERY */}
        <div className="row">
          <div className="field">
            <label >Delivery Date</label>
            <input
              type="date"
              className="input-line"
              value={deliveryDate}
              onChange={(e) => setDeliveryDate(e.target.value)}
            />
          </div>

          <div className="field">
            {/* <label>Mode of Delivery</label> */}
            <select
              value={modeOfDelivery}
              onChange={(e) => setModeOfDelivery(e.target.value)}
            >
              <option value="" > Mode of Delivery</option>
              <option value="Home Delivery" >Home Delivery</option>
              <option value="Store Pickup" >Store Pickup</option>
            </select>
          </div>

          <div className="field">
            {/* <label>Order Flag</label> */}
            <select
              value={orderFlag}
              onChange={(e) => setOrderFlag(e.target.value)}
            >
              <option value="" >Order Flag</option>
              <option value="Urgent" >Urgent</option>
              <option value="Normal" >Normal</option>
            </select>
          </div>
        </div>

        {/* COMMENTS */}
        <div className="row">
          <div className="field">
            <label >Comments</label>
            <input
  className="input-line"
  placeholder=""
  value={comments}
  onChange={(e) => setComments(e.target.value)}
/>
          </div>

          <div className="field">
            <label >Attachments</label>
            <input
  className="input-line"
  placeholder=""
  value={attachments}
  onChange={(e) => setAttachments(e.target.value)}
/>
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
