import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";        // FIX 1
import { useAuth } from "../context/AuthContext";      // FIX 2
import { supabase } from "../lib/supabaseClient";
import "./Screen4.css";

export default function Screen4() {
  const navigate = useNavigate();
  const { user } = useAuth();
  // PRODUCT STATES
  const [products, setProducts] = useState([]);
  const [selectedProduct, setSelectedProduct] = useState(null);

  const [colors, setColors] = useState([]);
  const [tops, setTops] = useState([]);
  const [bottoms, setBottoms] = useState([]);
  const [extras, setExtras] = useState([]);

  const [selectedColor, setSelectedColor] = useState("");
  const [selectedTop, setSelectedTop] = useState("");
  const [selectedBottom, setSelectedBottom] = useState("");
  const [selectedExtra, setSelectedExtra] = useState("");

  const [selectedSize, setSelectedSize] = useState("S");
  const [modeOfDelivery, setModeOfDelivery] = useState("");
  const [orderFlag, setOrderFlag] = useState("");
  const [deliveryDate, setDeliveryDate] = useState("");


  // MEASUREMENT STATES
  const [measurements, setMeasurements] = useState({});   // FIX 5

  // MULTI-PRODUCT ORDER CART
  const [orderItems, setOrderItems] = useState([]);       // FIX 6

  // MEASUREMENT DROPDOWN
  const [showMeasurements, setShowMeasurements] = useState(false);
  const [activeCategory, setActiveCategory] = useState("Shirts");
  //Measurement categories
  const measurementCategories = [
    "Shirts",
    "Blouse",
    "Salwar",
    "Churidar",
    "Trouser",
    "Anarkali",
    "Lehnga Length"
  ];
  //Measurement field per category
  const measurementFields = {
    Shirts: [
      "Shoulder", "Length", "Upper Bust", "Bust", "Waist", "Mid Waist",
      "Hip", "Sleeves", "Biceps", "Armhole", "Front Cross", "Back Cross",
      "Dart Point", "Neck"
    ],
    Blouse: ["Bust", "Waist", "Shoulder", "Neck"],
    Salwar: ["Waist", "Hip", "Length"],
    Trouser: ["Waist", "Hip", "Inseam", "Outseam"],
    Churidar: ["Waist", "Hip", "Length"],
    Anarkali: ["Bust", "Waist", "Hip", "Length"],
    "Lehnga Length": ["Waist", "Length"]
  };

  // Fetch products from Supabase
  useEffect(() => {
    const fetchProducts = async () => {
      const { data, error } = await supabase.from("products").select("*");

      if (error) {
        console.log(error);
        return;
      }

      setProducts(data);
    };

    fetchProducts();
  }, []);

  // When a product is selected → load its options
  useEffect(() => {
    if (!selectedProduct) return;

    setColors(selectedProduct.colors || []);
    setTops(selectedProduct.top_options || []);
    setBottoms(selectedProduct.bottom_options || []);
    setExtras(selectedProduct.extra_options || []);

    // Reset earlier selections
    setSelectedColor("");
    setSelectedTop("");
    setSelectedBottom("");
    setSelectedExtra("");
  }, [selectedProduct]);

  //function to handle adding product to order items
  const handleAddProduct = () => {
    if (!selectedProduct) {
      alert("Please select a product.");
      return;
    }
    const newProduct = {
      product_id: selectedProduct.id,
      product_name: selectedProduct.name,
      sku_id: selectedProduct.sku_id,
      color: selectedColor,
      top: selectedTop,
      bottom: selectedBottom,
      extra: selectedExtra,
      size: selectedSize,

      measurements: measurements,
    };
    setOrderItems((prev) => [...prev, newProduct]);

    // Reset UI after adding product
    setSelectedProduct(null);
    setSelectedColor("");
    setSelectedTop("");
    setSelectedBottom("");
    setSelectedExtra("");
    setSelectedSize("S");
    setMeasurements({});

  };
  const saveOrder = async () => {
    if (orderItems.length === 0) {
      alert("Please add at least one product.");
      return;
    }

    const orderPayload = {
      user_id: user?.id,         // if using auth
      items: orderItems,         // ARRAY of all products
      mode_of_delivery: modeOfDelivery,
      order_flag: orderFlag,
      delivery_date: deliveryDate,
      // created_at: new Date(),
    };

    // const { data, error } = await supabase
    //   .from("orders")
    //   .insert(orderPayload);

    // if (error) {
    //   alert(error.message);
    // } else {
    //   alert("Order saved successfully!");
    //   navigate("/nextpage");
    // }
    // Now navigate to Screen6 with complete payload
  navigate("/confirmDetail", { state: { orderPayload } });
  };


  return (
    <div className="screen4-bg">

      {/* HEADER */}
      <div className="header">
        <img src="/logo.png" className="logo4" alt="logo" />
        <h2 className="order-title">Order Form</h2>
      </div>

      <div className="screen4-card">

        <h2 className="product-title">Product</h2>

        {/* PRODUCT & COLOR */}
        <div className="row">
          <div className="field">
            <label>Select Product</label>
            <select
              value={selectedProduct?.id || ""}
              onChange={(e) => {
                const p = products.find((prod) => prod.id === e.target.value);
                setSelectedProduct(p);
              }}
            >
              <option value="">Select</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>Select Color</label>
            <select
              value={selectedColor}
              onChange={(e) => setSelectedColor(e.target.value)}
            >
              <option value="">Select</option>
              {colors.map((c, i) => (
                <option key={i} value={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>

        {/* TOP / BOTTOM / EXTRAS */}
        <div className="row">
          <div className="field">
            <label>Select Top</label>
            <select
              value={selectedTop}
              onChange={(e) => setSelectedTop(e.target.value)}
            >
              <option value="">Select</option>
              {tops.map((t, i) => (
                <option key={i} value={t}>{t}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>Select Bottom</label>
            <select
              value={selectedBottom}
              onChange={(e) => setSelectedBottom(e.target.value)}
            >
              <option value="">Select</option>
              {bottoms.map((b, i) => (
                <option key={i} value={b}>{b}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>Select Extras</label>
            <select
              value={selectedExtra}
              onChange={(e) => setSelectedExtra(e.target.value)}
            >
              <option value="">Select</option>
              {extras.map((x, i) => (
                <option key={i} value={x}>{x}</option>
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
          <span>Measurements</span>
          <button
            className="plus-btn"
            onClick={() => setShowMeasurements(!showMeasurements)}
          >
            {showMeasurements ? "−" : "+"}
          </button>

        </div>
        {/* MEASUREMENTS DROPDOWN */}
        {showMeasurements && (
          <div className="measure-container">

            {/* LEFT CATEGORY MENU */}
            <div className="measure-menu">
              {measurementCategories.map((cat) => (
                <div
                  key={cat}
                  className={
                    activeCategory === cat ? "measure-item active" : "measure-item"
                  }
                  onClick={() => setActiveCategory(cat)}
                >
                  {cat}
                </div>
              ))}
            </div>

            {/* RIGHT INPUT FIELDS */}
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
            <label>Mode of Delivery</label>
            <select
              value={modeOfDelivery}
              onChange={(e) => setModeOfDelivery(e.target.value)}
            >
              <option value="">Select</option>
              <option value="Home Delivery">Home Delivery</option>
              <option value="Store Pickup">Store Pickup</option>
              <option value="Courier">Courier</option>
            </select>
          </div>

          <div className="field">
            <label>Order Flag</label>
            <select
              value={orderFlag}
              onChange={(e) => setOrderFlag(e.target.value)}
            >
              <option value="">Select</option>
              <option value="Urgent">Urgent</option>
              <option value="Normal">Normal</option>
              <option value="Priority">Priority</option>
            </select>
          </div>

          <div className="field">
            <label>Delivery Date</label>
            <input
              type="date"
              value={deliveryDate}
              onChange={(e) => setDeliveryDate(e.target.value)}
              className="input-line"
            />
          </div>
        </div>


        {/* COMMENTS & ATTACHMENTS */}
        <div className="row">
          <div className="field">
            <label>Comments</label>
            <input className="input-line" placeholder="Write comments..." />
          </div>

          <div className="field">
            <label>Attachments</label>
            <input className="input-line" placeholder="Upload file..." />
          </div>
        </div>

        {/* ACTION BUTTONS */}
        <div className="footer-btns">
          <button className="add-product-btn" onClick={handleAddProduct}>
            Add Product
          </button>
          <button className="continue-btn" onClick={saveOrder}>
            Continue
          </button>
        </div>

      </div>
      {orderItems.length > 0 && (
        <div className="added-products-box">
          <h3>Added Products</h3>

          {orderItems.map((item, i) => (
            <div className="added-product-row" key={i}>
              <span>{i + 1}. {item.product_name} ({item.size})</span>
            </div>
          ))}
        </div>
      )}

      {/* BACK BUTTON */}
      <button className="back-btn">←</button>
    </div>
  );
}
