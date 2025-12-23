import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabaseClient";
import "./Screen4.css";
import Logo from "../images/logo.png";
import formatIndianNumber from "../utils/formatIndianNumber";
import formatPhoneNumber from "../utils/formatPhoneNumber";
import formatDate from "../utils/formatDate"; // Import formatDate

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
    // When the external value changes, update the internal query to reflect it.
    // This handles cases where the parent component clears the value or sets a new one.
    if (value === null || value === undefined || value === "") {
      setQuery("");
    } else if (current && query !== current.label && !open) {
      // If a value is selected and the menu is closed, ensure query matches label
      setQuery(current.label);
    }
  }, [value, current, open, query]);

  useEffect(() => {
    const onDoc = (e) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target)) {
        setOpen(false);
        setFocusIdx(-1);
        // When closing by clicking outside, if a value is selected, ensure query reflects its label
        if (current) {
          setQuery(current.label);
        }
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
    setQuery(opt?.label ?? ""); // Set query to the selected label
    setFocusIdx(-1);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const handleKeyDown = (e) => {
    if (!open && (e.key === "ArrowDown" || e.key === "Enter")) {
      setOpen(true);
      setFocusIdx(0);
      // If opening with keyboard and a value is selected, clear query for new search
      if (current) {
        setQuery("");
      }
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
      // When closing with Escape, if a value is selected, ensure query reflects its label
      if (current) {
        setQuery(current.label);
      }
    }
  };

  const clear = (e) => {
    e.stopPropagation();
    onChange("");
    setQuery(""); // Clear the query when clearing the selection
    inputRef.current?.focus();
  };

  return (
    <div
      ref={rootRef}
      className={`ss-root ${disabled ? "ss-disabled" : ""} ${className}`}
    >
      <div
        className={`ss-control ${open ? "ss-open" : ""}`}
        onMouseDown={(e) => e.stopPropagation()} // Prevent mousedown from bubbling to document
        onClick={() => {
          if (disabled) return;
          if (!open) {
            // If currently closed, open it
            setOpen(true);
            // If an item is selected, clear query for new search when opening via click
            if (current) {
              setQuery("");
            }
          } else {
            // If currently open, close it
            setOpen(false);
            // When closing, if a value is selected, ensure query reflects its label
            if (current) {
              setQuery(current.label);
            }
          }
          setFocusIdx(-1); // Reset focus index
          requestAnimationFrame(() => inputRef.current?.focus()); // Focus input
        }}
      >
        <input
          ref={inputRef}
          className="ss-input"
          placeholder={placeholder}
          value={query} /* Always bind to query for typing */
          onChange={(e) => {
            setQuery(e.target.value);
            if (!open) setOpen(true);
            setFocusIdx(0);
          }}
          onFocus={() => {
            // When input is focused, if a value is selected, clear query for new search
            if (current && query === current.label) {
              setQuery("");
            }
            setOpen(true);
          }}
          onKeyDown={handleKeyDown}
          disabled={disabled}
        />
        {current && (
          <button className="ss-clear" title="Clear" onClick={clear}>
            ×
          </button>
        )}
        {/* <span className="ss-caret">▾</span> */}
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
                    className={`ss-option ${selected ? "is-selected" : ""} ${focused ? "is-focused" : ""
                      }`}
                    onMouseEnter={() => setFocusIdx(idx)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handleSelect(opt)}
                    role="option"
                    aria-selected={selected}
                  >
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 8 }}
                    >
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

const KIDS_SIZE_OPTIONS = [
  "1-2 Years",
  "2-3 Years",
  "3-4 Years",
  "4-5 Years",
  "5-6 Years",
  "6-7 Years",
  "7-8 Years",
  "8-9 Years",
  "9-10 Years",
  "10-11 Years",
  "11-12 Years",
  "12-13 Years",
  "13-14 Years",
  "14-15 Years",
  "15-16 Years",
];

const KIDS_SIZE_CHART = {
  "1-2 Years": { Bust: 20, Waist: 19, Hip: 21, Length: 18 },
  "2-3 Years": { Bust: 21, Waist: 20, Hip: 22, Length: 20 },
  "3-4 Years": { Bust: 22, Waist: 21, Hip: 23, Length: 22 },
  "4-5 Years": { Bust: 23, Waist: 21.5, Hip: 24, Length: 24 },
  "5-6 Years": { Bust: 24, Waist: 22, Hip: 25, Length: 26 },
  "6-7 Years": { Bust: 25, Waist: 22.5, Hip: 26, Length: 28 },
  "7-8 Years": { Bust: 26, Waist: 23, Hip: 27, Length: 30 },
  "8-9 Years": { Bust: 27, Waist: 23.5, Hip: 28, Length: 32 },
  "9-10 Years": { Bust: 28, Waist: 24, Hip: 29, Length: 34 },
  "10-11 Years": { Bust: 29, Waist: 24.5, Hip: 30, Length: 36 },
  "11-12 Years": { Bust: 30, Waist: 25, Hip: 31, Length: 38 },
  "12-13 Years": { Bust: 31, Waist: 25.5, Hip: 32, Length: 40 },
  "13-14 Years": { Bust: 32, Waist: 26, Hip: 33, Length: 42 },
  "14-15 Years": { Bust: 33, Waist: 26.5, Hip: 34, Length: 44 },
  "15-16 Years": { Bust: 34, Waist: 27, Hip: 35, Length: 46 },
};

const KIDS_DISCOUNT_PERCENT = {
  "1-2 Years": 65,
  "2-3 Years": 60,
  "3-4 Years": 60,
  "4-5 Years": 55,
  "5-6 Years": 55,
  "6-7 Years": 50,
  "7-8 Years": 42,
  "8-9 Years": 42,
  "9-10 Years": 34,
  "10-11 Years": 34,
  "11-12 Years": 34,
  "12-13 Years": 20,
  "13-14 Years": 20,
  "14-15 Years": 20,
  "15-16 Years": 8,
};

const KIDS_MEASUREMENT_FIELDS = {
  Choga: [
    "Shoulder",
    "Neck",
    "Upper Bust",
    "Bust",
    "Dart Point",
    "Sleeves",
    "Bicep",
    "Arm Hole",
    "Waist",
    "Hip",
    "Length",
    "Front Cross",
    "Back Cross",
  ],
  Kurta: [
    "Shoulder",
    "Neck",
    "Upper Bust",
    "Bust",
    "Dart Point",
    "Sleeves",
    "Bicep",
    "Arm Hole",
    "Waist",
    "Hip",
    "Length",
    "Front Cross",
    "Back Cross",
  ],
  ShortKurta: [
    "Shoulder",
    "Neck",
    "Upper Bust",
    "Bust",
    "Dart Point",
    "Sleeves",
    "Bicep",
    "Arm Hole",
    "Waist",
    "Hip",
    "Length",
    "Front Cross",
    "Back Cross",
  ],
  LongKurta: [
    "Shoulder",
    "Neck",
    "Upper Bust",
    "Bust",
    "Dart Point",
    "Sleeves",
    "Bicep",
    "Arm Hole",
    "Waist",
    "Hip",
    "Length",
    "Front Cross",
    "Back Cross",
  ],
  LongChoga: [
    "Shoulder",
    "Neck",
    "Upper Bust",
    "Bust",
    "Dart Point",
    "Sleeves",
    "Bicep",
    "Arm Hole",
    "Waist",
    "Hip",
    "Length",
    "Front Cross",
    "Back Cross",
  ],
  Blouse: [
    "Shoulder",
    "Front Neck",
    "Back Neck",
    "Upper Bust",
    "Bust",
    "Dart Point",
    "Length",
    "Waist",
    "Front Cross",
    "Back Cross",
  ],

  Anarkali: [
    "Shoulder",
    "Bust",
    "Upper Bust",
    "Length",
    "Sleeve",
    "Biceps",
    "Arm Hole",
    "Dart Point",
    "Waist",
    "Yoke Length",
  ],
  Salwar: [
    "Waist",
    "Hip",
    "Length",
    "Ankle",
    "Thigh"
  ],

  TulipPant: [
    "Waist",
    "Hip",
    "Length",
    "Thigh",
    "Knee",
    "Calf"
  ],

  StraightPants: [
    "Waist",
    "Hip",
    "Length",
    "Thigh",
    "Ankle",
    "Knee"
  ],

  Palazzo: [
    "Waist",
    "Hip",
    "Length"
  ],

  Sharara: [
    "Waist",
    "Hip",
    "Length",
    "Thigh"
  ],

  Garara: [
    "Waist",
    "Hip",
    "Length",
    "Thigh",
    "Knee"
  ],

  Lehenga: [
    "Waist",
    "Hip",
    "Length"
  ]
};

const SIZE_CHART_US = {
  XXS: { Bust: 30, Waist: 24, Hip: 34 },
  XS: { Bust: 32, Waist: 26, Hip: 36 },
  S: { Bust: 34, Waist: 28, Hip: 38 },
  M: { Bust: 36, Waist: 30, Hip: 40 },
  L: { Bust: 38, Waist: 32, Hip: 42 },
  XL: { Bust: 40, Waist: 34, Hip: 44 },
  "2XL": { Bust: 42, Waist: 36, Hip: 46 },
  "3XL": { Bust: 44, Waist: 38, Hip: 48 },
  "4XL": { Bust: 46, Waist: 40, Hip: 50 },
  "5XL": { Bust: 48, Waist: 42, Hip: 52 },
  "6XL": { Bust: 50, Waist: 44, Hip: 54 },
  "7XL": { Bust: 52, Waist: 46, Hip: 56 },
  "8XL": { Bust: 54, Waist: 48, Hip: 58 },
};

// 🔑 UI label → internal key mapping
const CATEGORY_KEY_MAP = {
  "Choga": "Choga",
  "Kurta": "Kurta",
  "Short Kurta": "ShortKurta",
  "Long Kurta": "LongKurta",
  "Long Choga": "LongChoga",
  "Anarkali": "Anarkali",
  "Blouse": "Blouse",
  "Salwar": "Salwar",
  "Tulip Pant": "TulipPant",
  "Straight Paint": "StraightPants",
  "Plazzo": "Palazzo",
  "Sharara": "Sharara",
  "Garara": "Garara",
  "Lehenga": "Lehenga",
};


const measurementCategories = [
  "Choga",
  "Kurta",
  "Short Kurta",
  "Long Kurta",
  "Long Choga",
  "Anarkali",
  "Blouse",
  "Salwar",
  "Tulip Pant",
  "Straight Paint",
  "Plazzo",
  "Sharara",
  "Garara",
  "Lehenga"
];



const measurementFields = {
  Choga: [
    "Shoulder",
    "Neck",
    "Upper Bust",
    "Bust",
    "Dart Point",
    "Sleeves",
    "Bicep",
    "Arm Hole",
    "Waist",
    "Hip",
    "Length",
    "Front Cross",
    "Back Cross",
  ],
  Kurta: [
    "Shoulder",
    "Neck",
    "Upper Bust",
    "Bust",
    "Dart Point",
    "Sleeves",
    "Bicep",
    "Arm Hole",
    "Waist",
    "Hip",
    "Length",
    "Front Cross",
    "Back Cross",
  ],
  ShortKurta: [
    "Shoulder",
    "Neck",
    "Upper Bust",
    "Bust",
    "Dart Point",
    "Sleeves",
    "Bicep",
    "Arm Hole",
    "Waist",
    "Hip",
    "Length",
    "Front Cross",
    "Back Cross",
  ],
  LongKurta: [
    "Shoulder",
    "Neck",
    "Upper Bust",
    "Bust",
    "Dart Point",
    "Sleeves",
    "Bicep",
    "Arm Hole",
    "Waist",
    "Hip",
    "Length",
    "Front Cross",
    "Back Cross",
  ],
  LongChoga: [
    "Shoulder",
    "Neck",
    "Upper Bust",
    "Bust",
    "Dart Point",
    "Sleeves",
    "Bicep",
    "Arm Hole",
    "Waist",
    "Hip",
    "Length",
    "Front Cross",
    "Back Cross",
  ],
  Blouse: [
    "Shoulder",
    "Front Neck",
    "Back Neck",
    "Upper Bust",
    "Bust",
    "Dart Point",
    "Length",
    "Waist",
    "Front Cross",
    "Back Cross",
  ],

  Anarkali: [
    "Shoulder",
    "Bust",
    "Upper Bust",
    "Length",
    "Sleeve",
    "Biceps",
    "Arm Hole",
    "Dart Point",
    "Waist",
    "Yoke Length",
  ],
  Salwar: [
    "Waist",
    "Hip",
    "Length",
    "Ankle",
    "Thigh"
  ],

  TulipPant: [
    "Waist",
    "Hip",
    "Length",
    "Thigh",
    "Knee",
    "Calf"
  ],

  StraightPants: [
    "Waist",
    "Hip",
    "Length",
    "Thigh",
    "Ankle",
    "Knee"
  ],

  Palazzo: [
    "Waist",
    "Hip",
    "Length"
  ],

  Sharara: [
    "Waist",
    "Hip",
    "Length",
    "Thigh"
  ],

  Garara: [
    "Waist",
    "Hip",
    "Length",
    "Thigh",
    "Knee"
  ],

  Lehenga: [
    "Waist",
    "Hip",
    "Length"
  ]
};

export default function ProductForm() {
  const navigate = useNavigate();
  const { user } = useAuth();

  // PRODUCT STATES
  const [products, setProducts] = useState([]);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [comments, setComments] = useState(""); // General order comments
  const [deliveryNotes, setDeliveryNotes] = useState(""); // Order-wide delivery notes
  const [attachments, setAttachments] = useState([]);

  const [colors, setColors] = useState([]);
  const [tops, setTops] = useState([]);
  const [bottoms, setBottoms] = useState([]);
  const [globalExtras, setGlobalExtras] = useState([]);

  const [selectedColor, setSelectedColor] = useState({ name: "", hex: "" });
  const [selectedTopColor, setSelectedTopColor] = useState({
    name: "",
    hex: "",
  });
  const [selectedBottomColor, setSelectedBottomColor] = useState({
    name: "",
    hex: "",
  });
  const [selectedExtraColor, setSelectedExtraColor] = useState({
    name: "",
    hex: "",
  }); // Temporary state for extra color selection
  const [selectedTop, setSelectedTop] = useState("");
  const [selectedBottom, setSelectedBottom] = useState("");
  const [selectedExtra, setSelectedExtra] = useState(""); // Temporary state for extra selection
  const [selectedExtrasWithColors, setSelectedExtrasWithColors] = useState([]); // Array to hold multiple selected extras with their colors

  const [selectedSize, setSelectedSize] = useState("");
  const [quantity, setQuantity] = useState(1);

  const [modeOfDelivery, setModeOfDelivery] = useState("Delhi Store");
  const [orderFlag, setOrderFlag] = useState("Normal");
  const [deliveryDate, setDeliveryDate] = useState("");

  // MEASUREMENTS
  const [measurements, setMeasurements] = useState({});

  // CART
  const [orderItems, setOrderItems] = useState([]);

  // MEASUREMENT DROPDOWN
  const [showMeasurements, setShowMeasurements] = useState(false);
  const [activeCategory, setActiveCategory] = useState("Kurta");
  const [expandedRowIds, setExpandedRowIds] = useState({}); // {[_id]: true/false}
  const [availableSizes, setAvailableSizes] = useState([]);
  const [isKidsProduct, setIsKidsProduct] = useState(false); // New state for Kids checkbox

  // URGENT POPUP
  const [showUrgentModal, setShowUrgentModal] = useState(false);
  const [urgentReason, setUrgentReason] = useState(""); // Selected reason from dropdown
  const [otherUrgentReason, setOtherUrgentReason] = useState(""); // Input for 'Others' option

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

  const handleAddExtra = () => {
    if (!selectedExtra) return;
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
    setSelectedExtraColor("");
  };

  const handleRemoveExtra = (index) => {
    setSelectedExtrasWithColors((prev) => prev.filter((_, i) => i !== index));
  };

  // Fetch products
  useEffect(() => {
    const fetchProducts = async () => {
      const { data: productsData, error } = await supabase.from("products")
        .select(`
        *,
        product_extra_prices (*)
      `);

      if (error) {
        console.error("Error fetching products:", error);
        return;
      }

      const sorted = (productsData || [])
        .slice()
        .sort((a, b) =>
          String(a.name || "").localeCompare(String(b.name || ""))
        );

      setProducts(sorted);

      
      
    };

    fetchProducts();
  }, []);

  // FETCH COLORS (ONE TIME)
  useEffect(() => {
    const fetchColors = async () => {
      const { data, error } = await supabase
        .from("colors")
        .select("name, hex")
        .order("name");

      if (error) {
        console.error(error);
        return;
      }

      setColors(data);
    };

    fetchColors();
  }, []);

  //........................................
// ✅ Only reset when cleared, not when changed
// useEffect(() => {
//   if (!selectedTop) {
//     setSelectedTopColor({ name: "", hex: "" });
//   }
// }, [selectedTop]);

// useEffect(() => {
//   if (!selectedBottom) {
//     setSelectedBottomColor({ name: "", hex: "" });
//   }
// }, [selectedBottom]);

  //-----------------------------------------------
  // automatic size chart value filled
  useEffect(() => {
  if (!selectedSize || !activeCategory) return;

  const categoryKey = CATEGORY_KEY_MAP[activeCategory];
  if (!categoryKey) return;

  const currentSizeChart = isKidsProduct ? KIDS_SIZE_CHART : SIZE_CHART_US;
  const sizeData = currentSizeChart[selectedSize];
  if (!sizeData) return;

  setMeasurements((prev) => {
    const prevCategory = prev[categoryKey] || {};

    const fieldsForCategory = isKidsProduct
      ? KIDS_MEASUREMENT_FIELDS[categoryKey] || []
      : measurementFields[categoryKey] || [];

    const nextCategory = { ...prevCategory };

    if (fieldsForCategory.includes("Bust") && sizeData.Bust != null) {
      nextCategory.Bust = sizeData.Bust;
    }
    if (fieldsForCategory.includes("Waist") && sizeData.Waist != null) {
      nextCategory.Waist = sizeData.Waist;
    }
    if (fieldsForCategory.includes("Hip") && sizeData.Hip != null) {
      nextCategory.Hip = sizeData.Hip;
    }
    if (fieldsForCategory.includes("Length") && sizeData.Length != null) {
      nextCategory.Length = sizeData.Length;
    }

    // ⛔ prevent unnecessary rerender
    if (JSON.stringify(prevCategory) === JSON.stringify(nextCategory)) {
      return prev;
    }

    return {
      ...prev,
      [categoryKey]: nextCategory, // ✅ CORRECT
    };
  });
}, [selectedSize, activeCategory, isKidsProduct]);

  // FETCH GLOBAL EXTRAS (ONE TIME)
  useEffect(() => {
    const fetchExtras = async () => {
      const { data, error } = await supabase
        .from("extras")
        .select("name, price")
        .order("name");

      if (error) {
        console.error("Error fetching extras:", error);
        return;
      }

      setGlobalExtras(data || []);
    };

    fetchExtras();
  }, []);

  // When product or isKidsProduct changes, load options
  useEffect(() => {
    if (!selectedProduct) {
      setTops([]);
      setBottoms([]);
      setAvailableSizes([]);
      setSelectedSize("");
      setSelectedColor({ name: "", hex: "" });
      setSelectedTop("");
      setSelectedBottom("");
      setSelectedTopColor({ name: "", hex: "" });
      setSelectedBottomColor({ name: "", hex: "" });
      setSelectedExtra("");
      setSelectedExtraColor({ name: "", hex: "" });
      setSelectedExtrasWithColors([]);
      setQuantity(1);
      setMeasurements({});
      return;
    }

    setTops(selectedProduct.top_options || []);
    setBottoms(selectedProduct.bottom_options || []);

    // Calculate new available sizes and selected size
    const newAvailableSizes = isKidsProduct
      ? KIDS_SIZE_OPTIONS
      : selectedProduct.available_size || [];
    const newSelectedSize = isKidsProduct
      ? KIDS_SIZE_OPTIONS[0] || ""
      : selectedProduct.available_size?.[0] || "";

    // Only update state if the new values are different from the current state
    // This prevents infinite re-renders if the values are effectively the same
    if (JSON.stringify(availableSizes) !== JSON.stringify(newAvailableSizes)) {
      setAvailableSizes(newAvailableSizes);
    }
    if (selectedSize !== newSelectedSize) {
      setSelectedSize(newSelectedSize);
    }

  const topOptions = selectedProduct.top_options || [];
  const bottomOptions = selectedProduct.bottom_options || [];

  const defaultTop = selectedProduct.default_top || topOptions[0] || "";
  const defaultBottom = selectedProduct.default_bottom || bottomOptions[0] || "";

  const defaultColorName = selectedProduct.default_color || "";
  const defaultColor = colors.find(c => c.name === defaultColorName) || { name: "", hex: "" };
  
  setSelectedTop(defaultTop);
  setSelectedBottom(defaultBottom);
  
  // Use default_color for both top and bottom colors (or you can add separate columns later)
  setSelectedTopColor(defaultTop ? defaultColor : { name: "", hex: "" });
  setSelectedBottomColor(defaultBottom ? defaultColor : { name: "", hex: "" });
  // setSelectedColor(selectedProduct.defaultColor);

  // Auto-populate default extra if exists
  if (selectedProduct.default_extra) {
    const extraDetails = globalExtras.find((e) => e.name === selectedProduct.default_extra);
    if (extraDetails) {
      setSelectedExtrasWithColors([{
        name: selectedProduct.default_extra,
        color: defaultColor,
        price: extraDetails.price || 0,
      }]);
    } else {
      setSelectedExtrasWithColors([]);
    }
  } else {
    setSelectedExtrasWithColors([]);
  }

  // Reset other states
  setSelectedExtra("");
  setSelectedExtraColor({ name: "", hex: "" });
  setQuantity(1);
  setMeasurements({});
  }, [selectedProduct, isKidsProduct]);

  // ADD PRODUCT
  const handleAddProduct = () => {
    if (!selectedProduct) return alert("Please select a product");

    const newProduct = {
      _id: makeId(),
      product_id: selectedProduct.id,
      product_name: selectedProduct.name,
      sku_id: selectedProduct.sku_id,
      color: selectedColor, // Now an object { name, hex }
      top: selectedTop,
      top_color: selectedTopColor, // Now an object { name, hex }
      bottom: selectedBottom,
      bottom_color: selectedBottomColor, // Now an object { name, hex }
      extras: selectedExtrasWithColors, // Use the array of extras
      size: selectedSize,
      quantity: quantity,
      price: getLivePrice(),
      measurements,
      image_url: selectedProduct.image_url || selectedProduct.image || null,
      notes: "", // Initialize notes as empty for new products
    };

    setOrderItems((prev) => [...prev, newProduct]);

    // Reset inputs
    setSelectedProduct(null);
    setSelectedColor({ name: "", hex: "" }); // Reset to initial object structure
    setSelectedTop("");
    setSelectedBottom("");
    setSelectedTopColor({ name: "", hex: "" }); // Reset to initial object structure
    setSelectedBottomColor({ name: "", hex: "" }); // Reset to initial object structure
    setSelectedExtra("");
    setSelectedExtraColor({ name: "", hex: "" }); // Reset to initial object structure
    setSelectedExtrasWithColors([]); // Reset the array of selected extras
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

    // BASE PRICE
    let price = Number(selectedProduct.base_price || 0);

    // 👶 APPLY KIDS DISCOUNT (ONLY IF KIDS + SIZE SELECTED)
    if (isKidsProduct && selectedSize && KIDS_DISCOUNT_PERCENT[selectedSize]) {
      const discountPercent = KIDS_DISCOUNT_PERCENT[selectedSize];
      const discountAmount = (price * discountPercent) / 100;
      price = price - discountAmount;
    }

    // ➕ ADD EXTRAS PRICE
    selectedExtrasWithColors.forEach((extraItem) => {
      const extraRow = globalExtras.find((e) => e.name === extraItem.name);
      if (extraRow) {
        price += Number(extraRow.price || 0);
      }
    });

    return Math.round(price); // optional rounding
  };

  //==================
  // livePrice is TAX-INCLUSIVE
  const gstRate = 0.18;

  // LIVE (single product)
  const livePrice = getLivePrice();
  const liveSubtotalInclTax = livePrice * liveQuantity;

  // CART vs LIVE inclusive subtotal
  const inclusiveSubtotal =
    orderItems.length > 0 ? cartSubtotal : liveSubtotalInclTax;

  // Reverse GST calculation
  const subtotal = inclusiveSubtotal / (1 + gstRate); // taxable amount
  const taxes = inclusiveSubtotal - subtotal; // GST amount

  const totalQuantity = orderItems.length > 0 ? cartQuantity : liveQuantity;

  // Final payable (already tax-inclusive)
  const totalOrder = inclusiveSubtotal;

  //====================

  const handleFileUpload = async (event) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const uploadedUrls = [];

    for (const file of files) {
      const cleanName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const fileName = `${Date.now()}_${cleanName}`;
      const filePath = `attachments/${fileName}`;

      console.log("Uploading:", filePath);

      const { error: uploadError } = await supabase.storage
        .from("attachments")
        .upload(filePath, file, {
          cacheControl: "3600",
          upsert: false,
          contentType: file.type || "application/octet-stream",
        });

      if (uploadError) {
        console.error("Upload failed:", uploadError);
        alert("Upload failed: " + uploadError.message);
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
        _id: makeId(), // Ensure a unique ID for the item
        product_id: selectedProduct.id,
        product_name: selectedProduct.name,
        sku_id: selectedProduct.sku_id,
        color: selectedColor,
        top: selectedTop,
        top_color: selectedTopColor,
        bottom: selectedBottom,
        bottom_color: selectedBottomColor,
        extras: selectedExtrasWithColors, // Use the array of extras
        size: selectedSize,
        quantity,
        price: getLivePrice(), // Use getLivePrice to calculate price including extras
        measurements,
        image_url: selectedProduct.image_url || selectedProduct.image || null,
        notes: comments, // Initialize notes as empty for auto-added products
      });
    }

    // NEW VALIDATION: Ensure at least one product is in the order
    if (finalItems.length === 0) {
      return alert("Please add at least one product to the order.");
    }

    const orderPayload = {
      user_id: user?.id,

      // Product level details
      items: finalItems,

      // Delivery Details
      delivery_date: formatDate(deliveryDate), // Use formatDate
      mode_of_delivery: modeOfDelivery,
      order_flag: orderFlag,

      urgent_reason:
        orderFlag === "Urgent"
          ? urgentReason === "Others"
            ? otherUrgentReason
            : urgentReason
          : null,

      // Extra fields
      comments: comments, // General order comments
      delivery_notes: deliveryNotes, // Order-wide delivery notes
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

  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();

      const raw = sessionStorage.getItem("associateSession");
      const saved = raw ? JSON.parse(raw) : null;

      if (saved?.access_token && saved?.refresh_token) {
        const { error } = await supabase.auth.setSession({
          access_token: saved.access_token,
          refresh_token: saved.refresh_token,
        });

        if (!error) {
          // 🔴 FORCE verification again
          sessionStorage.setItem("requireVerification", "true");

          sessionStorage.removeItem("associateSession");
          sessionStorage.removeItem("returnToAssociate");

          navigate("/AssociateDashboard", { replace: true });
          return;
        }
      }

      navigate("/login", { replace: true });
    } catch (e) {
      console.error("Logout restore error", e);
      navigate("/login", { replace: true });
    }
  };

  const toOptions = (arr = []) =>
    arr.map((x) => ({ label: String(x), value: x }));
  const toColorOptions = (colors = []) =>
    colors.map((c) => ({
      label: c.name,
      value: c.name, // Store full object as value
      hex: c.hex,
    }));
  const toExtraOptions = (extras = []) =>
    extras.map((e) => ({
      label: `${e.name} (₹${formatIndianNumber(e.price)})`,
      value: { name: e.name, hex: e.hex },
      price: e.price, // Also store price in the option object
    }));
  const categoryKey = CATEGORY_KEY_MAP[activeCategory];

  return (
    <div className="screen4-bg">
      {/* HEADER */}
      <div className="header">
        <img src={Logo} className="logo4" alt="logo" onClick={handleLogout} />
        <h2 className="order-title">Order Form</h2>
      </div>

      <div className="screen4-card">
        <div className="screen4-layout">
          {/*left side */}
          <div className="screen4-form">
            <h2 className="product-title">Product</h2>

            {/* Kids Checkbox */}
            <div className="kids-checkbox-container">
              <input
                type="checkbox"
                id="kids-product"
                checked={isKidsProduct}
                onChange={(e) => setIsKidsProduct(e.target.checked)}
              />
              <label htmlFor="kids-product">Kids</label>
            </div>

            {/* ADDED PRODUCTS INSIDE CARD */}
            {orderItems.length > 0 && (
              <div className="added-products-box added-products-top">
                {orderItems.map((item, i) => {
                  const expanded = !!expandedRowIds[item._id];

                  return (
                    <div className="added-product-row" key={item._id}>
                      <span className="product-info">
                        {i + 1}. Name: {item.product_name}, Size: {item.size},
                        Qty: {formatIndianNumber(item.quantity)}, Price: ₹
                        {formatIndianNumber(item.price)}
                      </span>

                      <div className="product-buttons">
                        <button
                          className="expand"
                          onClick={() => toggleExpand(item._id)}
                          title={expanded ? "Collapse" : "Expand to edit"}
                        >
                          {expanded ? "−" : "✚"}
                        </button>
                        <button
                          className="delete"
                          onClick={() => handleDelete(item._id)}
                          title="Remove"
                        >
                          🗑
                        </button>
                      </div>

                      {/* Simple editable form (plain inputs) */}
                      {expanded && (
                        <div className="row expand-panel simple-edit">
                          {/* Color */}
                          <div className="field">
                            <label>Color</label>
                            <SearchableSelect
                              options={toColorOptions(colors)}
                              value={item.color?.name || ""}
                              onChange={(colorName) => {
                                const colorObj = colors.find(c => c.name === colorName) || { name: "", hex: "" };
                                updateItem(item._id, { color: colorObj });
                              }}
                              placeholder="Select Color"
                            />
                          </div>

                          {/* Top */}
                          <div className="field">
                            <label>Top</label>
                            <input
                              type="text"
                              className="input-line"
                              value={item.top || ""}
                              onChange={(e) =>
                                updateItem(item._id, { top: e.target.value })
                              }
                              placeholder="Enter top"
                            />
                          </div>

                          {/* Top Color */}
                          <div className="field">
                            <label>Top Color</label>
                            <SearchableSelect
                              options={toColorOptions(colors)}
                              value={item.top_color?.name || ""}
                              onChange={(colorName) => {
                                const colorObj = colors.find(c => c.name === colorName) || { name: "", hex: "" };
                                updateItem(item._id, { top_color: colorObj });
                              }}
                              placeholder="Select Top Color"
                            />
                          </div>

                          {/* Bottom */}
                          <div className="field">
                            <label>Bottom</label>
                            <input
                              type="text"
                              className="input-line"
                              value={item.bottom || ""}
                              onChange={(e) =>
                                updateItem(item._id, { bottom: e.target.value })
                              }
                              placeholder="Enter bottom"
                            />
                          </div>

                          {/* Bottom Color */}
                          <div className="field">
                            <label>Bottom Color</label>
                            <SearchableSelect
                              options={toColorOptions(colors)}
                              value={item.bottom_color?.name || ""}
                              onChange={(colorName) => {
                                const colorObj = colors.find(c => c.name === colorName) || { name: "", hex: "" };
                                updateItem(item._id, { bottom_color: colorObj });
                              }}
                              placeholder="Select Bottom Color"
                            />
                          </div>

                          {/* Extras */}
                          <div className="field">
                            <label>Extras</label>
                            {item.extras && item.extras.length > 0 ? (
                              item.extras.map((extraItem, idx) => (
                                <div
                                  key={idx}
                                  className="added-extra-item-edit"
                                >
                                  <input
                                    type="text"
                                    className="input-line"
                                    value={extraItem.name || ""}
                                    onChange={(e) => {
                                      const newExtras = [...item.extras];
                                      newExtras[idx].name = e.target.value;
                                      updateItem(item._id, {
                                        extras: newExtras,
                                      });
                                    }}
                                    placeholder="Extra name"
                                  />
                                  <SearchableSelect
                                    options={toColorOptions(colors)}
                                    value={extraItem.color?.name || ""}
                                    onChange={(colorName) => {
                                      const colorObj = colors.find(c => c.name === colorName) || { name: "", hex: "" };
                                      const newExtras = [...item.extras];
                                      newExtras[idx].color = colorObj;
                                      updateItem(item._id, { extras: newExtras });
                                    }}
                                    placeholder="Select Extra Color"
                                  />
                                  <span className="extra-price">
                                    ₹{formatIndianNumber(extraItem.price)}
                                  </span>
                                  <button
                                    onClick={() => {
                                      const newExtras = item.extras.filter(
                                        (_, i) => i !== idx
                                      );
                                      updateItem(item._id, {
                                        extras: newExtras,
                                      });
                                    }}
                                  >
                                    x
                                  </button>
                                </div>
                              ))
                            ) : (
                              <p className="muted">No extras added</p>
                            )}
                          </div>

                          {/* Size */}
                          <div className="field">
                            <label>Size</label>
                            <input
                              type="text"
                              className="input-line"
                              value={item.size || ""}
                              onChange={(e) =>
                                updateItem(item._id, { size: e.target.value })
                              }
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
                                  quantity: Math.max(
                                    1,
                                    Number(e.target.value || 1)
                                  ),
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
                              onChange={(e) =>
                                updateItem(item._id, {
                                  price: Number(e.target.value || 0),
                                })
                              }
                            />
                          </div>

                          {/* Product Notes */}
                          <div className="field full-width-field">
                            <label>Notes:</label>
                            <textarea
                              className="input-line"
                              placeholder="Add notes for this product item..."
                              value={item.notes || ""}
                              onChange={(e) =>
                                updateItem(item._id, { notes: e.target.value })
                              }
                              rows={2}
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
                  options={products.map((p) => ({
                    label: p.name,
                    value: p.id,
                  }))}
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
                    Price:{" "}
                    <strong>₹{formatIndianNumber(getLivePrice())}</strong>
                  </p>
                )}
              </div>

              {/* COLOR */}
              {/* <div className="field" >
                <SearchableSelect
                  options={toColorOptions(colors)}
                  value={selectedColor.name} // Display name, but onChange gets object
                  onChange={(colorObj) => setSelectedColor(colorObj)}
                  placeholder="Select Color"
                />
              </div> */}

              {/* QUANTITY */}
              <div className="qty-field">
                <label>Qty</label>
                <div className="qty-controls">
                  <button
                    onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                  >
                    −
                  </button>
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
                  {/* <label>Top Color</label> */}
                  <SearchableSelect
                    options={toColorOptions(colors)}
                    value={selectedTopColor.name} // Display name, but onChange gets object
                    onChange={(colorName)=>{
                      const colorObj = colors.find(c => c.name === colorName) || {name: "", hex: ""};
                      setSelectedTopColor(colorObj);
                    }}
                    placeholder="Select Top Color"
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
                  {/* <label>Bottom Color</label> */}
                  <SearchableSelect
                    options={toColorOptions(colors)}
                    value={selectedBottomColor.name} // Display name, but onChange gets object
                    onChange={(colorName)=>{
                      const colorObj = colors.find(c => c.name === colorName) || {name: "", hex: ""};
                      setSelectedBottomColor(colorObj);
                    }}
                    placeholder="Select Bottom Color"
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
                      setSelectedExtraColor(colorObj);  // ✅ Stores {name, hex}
                    }}
                    placeholder="Select Extra Color"
                  />
                </div>
              )}
              <button
                className="add-extra-btn"
                style={{
                  background: "#d5b85a",
                  border: "none",
                  color: "white",
                  borderRadius: "3px",
                }}
                onClick={handleAddExtra}
                disabled={!selectedExtra}
              >
                Add Extra
              </button>
            </div>

            {/* Display selected extras */}
            {selectedExtrasWithColors.length > 0 && (
              <div className="selected-extras-list">
                <h4>Added Extras:</h4>
                {selectedExtrasWithColors.map((extra, index) => (
                  <div key={index} className="selected-extra-item">
                    <span>
                      {extra.name} (₹{formatIndianNumber(extra.price)}){" "}
                      {extra.color && `(${extra.color})`}
                    </span>
                    <button onClick={() => handleRemoveExtra(index)}>x</button>
                  </div>
                ))}
              </div>
            )}

            {/* TOP / BOTTOM COLORS */}

            {/* SIZE */}

            <div className="size-box">
              <span className="size-label">Size:</span>

              <div className="sizes">
                {Array.isArray(availableSizes) && availableSizes.length > 0 ? (
                  availableSizes.map((s, i) => (
                    <button
                      key={i}
                      className={
                        selectedSize === s ? "size-btn active" : "size-btn"
                      }
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
              <span>Custom Measurements </span>
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
                  <h3 className="measure-title">Custom Measurements (in)</h3>

                  <div className="measure-grid">
                    {(isKidsProduct
                      ? KIDS_MEASUREMENT_FIELDS[categoryKey] || []
                      : measurementFields[categoryKey] || []
                    ).map((field) => (
                      <div className="measure-field" key={field}>
                        <label>{field}</label>

                        <input
                          type="number"
                          className="input-line"
                          value={measurements[categoryKey]?.[field] || ""}
                          onChange={(e) => {
                            const val = e.target.value;

                            setMeasurements((prev) => ({
                              ...prev,
                              [categoryKey]: {
                                ...(prev[categoryKey] || {}),
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
                <label>Delivery Date*</label>
                {/* <input
              type="date"
              className="input-line"
              value={deliveryDate}
              onChange={(e) => setDeliveryDate(e.target.value)}
            /> */}
                <input
                  type="date"
                  className="input-line"
                  value={deliveryDate}
                  style={{ border: "none", background: "transparent" }}
                  min={new Date().toISOString().split("T")[0]}
                  onChange={(e) => setDeliveryDate(e.target.value)}
                />
              </div>

              <div className="field">
                <SearchableSelect
                  options={[
                    { label: "Home Delivery", value: "Home Delivery" },
                    { label: "Delhi Store", value: "Delhi Store" },
                    { label: " Ludhiana Store ", value: "Ludhiana Store" },
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
                  onChange={(val) => {
                    if (val === "Urgent") {
                      setShowUrgentModal(true);
                    } else {
                      setOrderFlag(val);
                      setUrgentReason("");
                    }
                  }}
                  placeholder="Order Flag"
                />
              </div>
            </div>

            {/* GENERAL ORDER COMMENTS */}
            <div className="row">
              <div className="field">
                <label>Notes:</label>
                <input
                  style={{ border: "none", background: "transparent" }}
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
                Total Quantity:{" "}
                <strong>{formatIndianNumber(totalQuantity)}</strong>
              </p>
              <p>
                Subtotal:{" "}
                <strong>₹{formatIndianNumber(subtotal.toFixed(2))}</strong>
              </p>
              <p>
                Taxes (18%):{" "}
                <strong>₹{formatIndianNumber(taxes.toFixed(2))}</strong>
              </p>

              <p className="grand-total">
                Total:{" "}
                <strong>₹{formatIndianNumber(totalOrder.toFixed(2))}</strong>
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
          {/* ================= RIGHT IMAGE ================= */}
          {selectedProduct?.image_url && (
            <div className="screen4-image-fixed">
              <img src={selectedProduct.image_url} alt={selectedProduct.name} />
            </div>
          )}
        </div>
      </div>
      {/*Urgent reason modal ------------------------------------- */}
      {showUrgentModal && (
        <div className="modal-overlay">
          <div className="modal-box">
            <h3>Urgent Order</h3>

            <label>Reason for Urgent</label>
            <div style={{ border: "1px solid #D5B85A" }}>
              <SearchableSelect
                options={[
                  { label: "Client Escalation", value: "Client Escalation" },
                  { label: "VIP Order", value: "VIP Order" },
                  { label: "Celebrity Order", value: "Celebrity Order" },
                  { label: "Others", value: "Others" },
                ]}
                value={urgentReason}
                onChange={(val) => {
                  setUrgentReason(val);
                  if (val !== "Others") {
                    setOtherUrgentReason(""); // Clear other reason if not 'Others'
                  }
                }}
                placeholder="Select Urgent Reason"
              />
            </div>

            {urgentReason === "Others" && (
              <textarea
                className="input-line"
                placeholder="Specify other reason..."
                value={otherUrgentReason}
                onChange={(e) => setOtherUrgentReason(e.target.value)}
                rows={2}
                style={{ marginTop: "20px",border:'1px solid #d5b85a',alignItems:"center" }}
              />
            )}

            <div className="modal-actions">
              <button
                className="cancel-btn"
                onClick={() => {
                  setShowUrgentModal(false);
                  setOrderFlag("Normal"); // Revert order flag if cancelled
                  setUrgentReason("");
                  setOtherUrgentReason("");
                }}
              >
                Cancel
              </button>

              <button
                className="confirm-btn"
                onClick={() => {
                  const finalReason =
                    urgentReason === "Others"
                      ? otherUrgentReason
                      : urgentReason;
                  if (!finalReason.trim()) {
                    alert("Please select or enter a reason for urgent order");
                    return;
                  }
                  setOrderFlag("Urgent");
                  setShowUrgentModal(false);
                }}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* BACK BUTTON */}
      <button className="back-btn" onClick={handleLogout}>
        ←
      </button>
    </div>
  );
}
