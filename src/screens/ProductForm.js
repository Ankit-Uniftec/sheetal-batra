import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabaseClient";
import "./Screen4.css";
import Logo from "../images/logo.png";
import formatIndianNumber from "../utils/formatIndianNumber";
import formatPhoneNumber from "../utils/formatPhoneNumber";
import formatDate from "../utils/formatDate";
import Popup, { usePopup } from "../components/Popup"; // Import Popup component
import config from "../config/config";

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
    // Sync query from selected value ONLY when dropdown is closed
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
        onMouseDown={(e) => {
          e.preventDefault();     // ⛔ stops blur
          e.stopPropagation();    // ⛔ stops document close

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
  "1-2 yrs",
  "2-3 yrs",
  "3-4 yrs",
  "4-5 yrs",
  "5-6 yrs",
  "6-7 yrs",
  "7-8 yrs",
  "8-9 yrs",
  "9-10 yrs",
  "10-11 yrs",
  "11-12 yrs",
  "12-13 yrs",
  "13-14 yrs",
  "14-15 yrs",
  "15-16 yrs",
];

const KIDS_SIZE_CHART = {
  "1-2 yrs": { Bust: 20, Waist: 19, Hip: 21, Length: 18 },
  "2-3 yrs": { Bust: 21, Waist: 20, Hip: 22, Length: 20 },
  "3-4 yrs": { Bust: 22, Waist: 21, Hip: 23, Length: 22 },
  "4-5 yrs": { Bust: 23, Waist: 21.5, Hip: 24, Length: 24 },
  "5-6 yrs": { Bust: 24, Waist: 22, Hip: 25, Length: 26 },
  "6-7 yrs": { Bust: 25, Waist: 22.5, Hip: 26, Length: 28 },
  "7-8 yrs": { Bust: 26, Waist: 23, Hip: 27, Length: 30 },
  "8-9 yrs": { Bust: 27, Waist: 23.5, Hip: 28, Length: 32 },
  "9-10 yrs": { Bust: 28, Waist: 24, Hip: 29, Length: 34 },
  "10-11 yrs": { Bust: 29, Waist: 24.5, Hip: 30, Length: 36 },
  "11-12 yrs": { Bust: 30, Waist: 25, Hip: 31, Length: 38 },
  "12-13 yrs": { Bust: 31, Waist: 25.5, Hip: 32, Length: 40 },
  "13-14 yrs": { Bust: 32, Waist: 26, Hip: 33, Length: 42 },
  "14-15 yrs": { Bust: 33, Waist: 26.5, Hip: 34, Length: 44 },
  "15-16 yrs": { Bust: 34, Waist: 27, Hip: 35, Length: 46 },
};

const KIDS_DISCOUNT_PERCENT = {
  "1-2 yrs": 65,
  "2-3 yrs": 60,
  "3-4 yrs": 60,
  "4-5 yrs": 55,
  "5-6 yrs": 55,
  "6-7 yrs": 50,
  "7-8 yrs": 42,
  "8-9 yrs": 42,
  "9-10 yrs": 34,
  "10-11 yrs": 34,
  "11-12 yrs": 34,
  "12-13 yrs": 20,
  "13-14 yrs": 20,
  "14-15 yrs": 20,
  "15-16 yrs": 8,
};

const KIDS_MEASUREMENT_FIELDS = {
  KurtaChogaKaftan: [
    "Height",
    "Shoulder",
    "Neck",
    "Upper Bust",
    "Bust",
    "Dart Point",
    "Sleeves",
    "Mori",
    "Bicep",
    "Arm Hole",
    "Waist",
    "Hip",
    "Length",
    "Front Cross",
    "Back Cross",
    "Front Neck",
    "Back Neck",
  ],
  Blouse: [
    "Shoulder",
    "Upper Bust",
    "Bust",
    "Dart Point",
    "Sleeves",
    "Mori",
    "Arm Hole",
    "Waist",
    "Length",
    "Front Cross",
    "Back Cross",
    "Front Neck",
    "Back Neck",
  ],
  Anarkali: [
    "Shoulder",
    "Upper Bust",
    "Bust",
    "Dart Point",
    "Sleeves",
    "Mori",
    "Bicep",
    "Arm Hole",
    "Length",
    "Front Neck",
    "Back Neck",
  ],
  SalwarDhoti: [
    "Waist",
    "Hip",
    "Length",
  ],
  ChuridaarTrouserPantsPlazo: [
    "Waist",
    "Hip",
    "Length",
    "Thigh",
    "Calf",
    "Ankle",
    "Knee",
    "Yoke Length",
  ],
  ShararaGharara: [
    "Waist",
    "Hip",
    "Length",
  ],
  Lehenga: [
    "Waist",
    "Hip",
    "Length",
  ],
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
  // Tops - Kurta variants
  "Short Kurta": "KurtaChogaKaftan",
  "Kurta": "KurtaChogaKaftan",
  "Long Kurta": "KurtaChogaKaftan",
  "Short Choga": "KurtaChogaKaftan",
  "Choga": "KurtaChogaKaftan",
  "Long Choga": "KurtaChogaKaftan",
  "Kaftan": "KurtaChogaKaftan",

  // Tops - Others
  "Blouse": "Blouse",
  "Short Anarkali": "Anarkali",
  "Anarkali": "Anarkali",

  // Bottoms - Salwar variants
  "Salwar": "SalwarDhoti",
  "Dhoti": "SalwarDhoti",

  // Bottoms - Churidaar variants
  "Churidaar": "ChuridaarTrouserPantsPlazo",
  "Trouser": "ChuridaarTrouserPantsPlazo",
  "Pants": "ChuridaarTrouserPantsPlazo",
  "Palazzo": "ChuridaarTrouserPantsPlazo",

  // Bottoms - Sharara variants
  "Sharara": "ShararaGharara",
  "Gharara": "ShararaGharara",

  // One-piece
  "Lehenga": "Lehenga",
};

const CATEGORY_DISPLAY_NAMES = {
  "KurtaChogaKaftan": "Kurta / Choga / Kaftan",
  "Blouse": "Blouse",
  "Anarkali": "Anarkali",
  "SalwarDhoti": "Salwar / Dhoti",
  "ChuridaarTrouserPantsPlazo": "Churidaar / Trouser / Pants / Palazzo",
  "ShararaGharara": "Sharara / Gharara",
  "Lehenga": "Lehenga",
};


const ALL_MEASUREMENT_CATEGORIES = [
  "Kurta / Choga / Kaftan",
  "Blouse",
  "Anarkali",
  "Salwar / Dhoti",
  "Churidaar / Trouser / Pants / Palazzo",
  "Sharara / Gharara",
  "Lehenga",
];



const measurementFields = {
  KurtaChogaKaftan: [
    "Height",
    "Shoulder",
    "Neck",
    "Upper Bust",
    "Bust",
    "Dart Point",
    "Sleeves",
    "Mori",
    "Bicep",
    "Arm Hole",
    "Waist",
    "Hip",
    "Length",
    "Front Cross",
    "Back Cross",
    "Front Neck",
    "Back Neck",
  ],
  Blouse: [
    "Shoulder",
    "Upper Bust",
    "Bust",
    "Dart Point",
    "Sleeves",
    "Mori",
    "Arm Hole",
    "Waist",
    "Length",
    "Front Cross",
    "Back Cross",
    "Front Neck",
    "Back Neck",
  ],
  Anarkali: [
    "Shoulder",
    "Upper Bust",
    "Bust",
    "Dart Point",
    "Sleeves",
    "Mori",
    "Bicep",
    "Arm Hole",
    "Length",
    "Front Neck",
    "Back Neck",
  ],
  SalwarDhoti: [
    "Waist",
    "Hip",
    "Length",
  ],
  ChuridaarTrouserPantsPlazo: [
    "Waist",
    "Hip",
    "Length",
    "Thigh",
    "Calf",
    "Ankle",
    "Knee",
    "Yoke Length",
  ],
  ShararaGharara: [
    "Waist",
    "Hip",
    "Length",
  ],
  Lehenga: [
    "Waist",
    "Hip",
    "Length",
  ],
};

export default function ProductForm() {
  const navigate = useNavigate();
  const { user } = useAuth();

  // Initialize Popup hook
  const { showPopup, PopupComponent } = usePopup();

  useEffect(() => {
    const saved = sessionStorage.getItem("screen4FormData");
    // console.log("Saved data:", saved);
    if (saved) {
      // console.log("Parsed:", JSON.parse(saved));
    }
  }, []);


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
  const [customerSavedMeasurements, setCustomerSavedMeasurements] = useState(null); // Latest saved measurements from DB
  const [measurementsLoaded, setMeasurementsLoaded] = useState(false);

  // ADDITIONALS STATE - Default open with one empty row
  const [selectedAdditionals, setSelectedAdditionals] = useState([]);
  const [showAdditionals, setShowAdditionals] = useState(false);

  // CART
  const [orderItems, setOrderItems] = useState([]);

  // SYNC PRODUCT STATES (LXRTS)
  const [productVariants, setProductVariants] = useState([]);
  const [localInventory, setLocalInventory] = useState({}); // { "M": 4, "L": 2, ... }
  const [isSyncProduct, setIsSyncProduct] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);

  // MEASUREMENT DROPDOWN
  const [showMeasurements, setShowMeasurements] = useState(false);
  const [activeCategory, setActiveCategory] = useState("Kurta / Choga / Kaftan");
  const [expandedRowIds, setExpandedRowIds] = useState({}); // {[_id]: true/false}
  const [availableSizes, setAvailableSizes] = useState([]);
  const [isKidsProduct, setIsKidsProduct] = useState(false); // New state for Kids checkbox

  // URGENT POPUP
  const [showUrgentModal, setShowUrgentModal] = useState(false);
  const [urgentReason, setUrgentReason] = useState(""); // Selected reason from dropdown
  const [otherUrgentReason, setOtherUrgentReason] = useState(""); // Input for 'Others' option
  // Track active measurement category per expanded item
  const [expandedItemCategories, setExpandedItemCategories] = useState({}); // {[_id]: "Kurta/Choga/Kaftan"}

  // Flag to track if data was restored from sessionStorage
  // const [isRestored, setIsRestored] = useState(false);
  const isRestoredRef = useRef(false);

  // tiny id helper so list keys are stable
  const makeId = () => `${Date.now()}_${Math.random().toString(16).slice(2)}`;

  // update helpers
  const toggleExpand = (id) => {
    setExpandedRowIds((e) => ({ ...e, [id]: !e[id] }));
    // Initialize category for this item if not set
    if (!expandedItemCategories[id]) {
      const item = orderItems.find(it => it._id === id);
      let defaultDisplayName = "Kurta / Choga / Kaftan";

      if (item?.top && CATEGORY_KEY_MAP[item.top]) {
        const categoryKey = CATEGORY_KEY_MAP[item.top];
        defaultDisplayName = CATEGORY_DISPLAY_NAMES[categoryKey];
      } else if (item?.bottom && CATEGORY_KEY_MAP[item.bottom]) {
        const categoryKey = CATEGORY_KEY_MAP[item.bottom];
        defaultDisplayName = CATEGORY_DISPLAY_NAMES[categoryKey];
      }

      setExpandedItemCategories((prev) => ({ ...prev, [id]: defaultDisplayName }));
    }
  };

  const handleDelete = (id) =>
    setOrderItems((prev) => prev.filter((it) => it._id !== id));

  // Determine order type for an item (Custom or Standard)
  const getItemOrderType = (item) => {
    if (!item) return "Standard";

    const product = products.find((p) => p.id === item.product_id);
    if (!product) return "Standard";

    const defaultTop = product.default_top || product.top_options?.[0] || "";
    const defaultBottom = product.default_bottom || product.bottom_options?.[0] || "";
    const defaultColorName = product.default_color || "";

    // Check if top changed
    if (item.top && item.top !== defaultTop) return "Custom";

    // Check if bottom changed
    if (item.bottom && item.bottom !== defaultBottom) return "Custom";

    // Check if top color changed
    if (item.top_color?.name && item.top_color.name !== defaultColorName) return "Custom";

    // Check if bottom color changed
    if (item.bottom_color?.name && item.bottom_color.name !== defaultColorName) return "Custom";

    // ✅ Check if additionals are added
    if (item.additionals && item.additionals.length > 0) {
      const hasValidAdditional = item.additionals.some(
        (add) => add.name && add.name.trim() !== ""
      );
      if (hasValidAdditional) return "Custom";
    }

    // Check for CUSTOM measurements (different from size chart)
    const itemIsKids = item.isKids || false;
    const currentSizeChart = itemIsKids ? KIDS_SIZE_CHART : SIZE_CHART_US;
    const sizeData = currentSizeChart[item.size] || {};
    const sizeChartFields = ["Bust", "Waist", "Hip", "Length"];

    const hasCustomMeasurements = Object.entries(item.measurements || {}).some(([categoryKey, fields]) => {
      if (!fields || typeof fields !== "object") return false;

      return Object.entries(fields).some(([field, value]) => {
        if (value === "" || value === null || value === undefined) return false;

        // For size chart fields, check if matches size chart
        if (sizeChartFields.includes(field)) {
          const sizeChartValue = sizeData[field];
          if (sizeChartValue !== undefined && Number(value) === Number(sizeChartValue)) {
            return false; // Matches size chart = NOT custom
          }
        }

        return true;
      });
    });

    if (hasCustomMeasurements) return "Custom";

    return "Standard";
  };

  // ============= CHANGE #4: Add helper function (After state declarations in ProductForm) =============
  // ADD this function inside the ProductForm component:

  const getRelevantMeasurementCategories = () => {
    const categoryKeys = new Set(); // Use Set to avoid duplicates

    // Get category key for selected top
    if (selectedTop && CATEGORY_KEY_MAP[selectedTop]) {
      categoryKeys.add(CATEGORY_KEY_MAP[selectedTop]);
    }

    // Get category key for selected bottom
    if (selectedBottom && CATEGORY_KEY_MAP[selectedBottom]) {
      categoryKeys.add(CATEGORY_KEY_MAP[selectedBottom]);
    }

    // If no top/bottom selected, show all categories
    if (categoryKeys.size === 0) {
      return ALL_MEASUREMENT_CATEGORIES;
    }

    // Convert keys to display names
    return Array.from(categoryKeys).map(key => CATEGORY_DISPLAY_NAMES[key]);
  };


  const getRelevantMeasurements = () => {
    const relevantKeys = new Set();

    if (selectedTop && CATEGORY_KEY_MAP[selectedTop]) {
      relevantKeys.add(CATEGORY_KEY_MAP[selectedTop]);
    }
    if (selectedBottom && CATEGORY_KEY_MAP[selectedBottom]) {
      relevantKeys.add(CATEGORY_KEY_MAP[selectedBottom]);
    }

    // Filter measurements to only include relevant category keys
    const filteredMeasurements = {};
    for (const [key, value] of Object.entries(measurements)) {
      if (relevantKeys.has(key)) {
        filteredMeasurements[key] = value;
      }
    }

    return filteredMeasurements;
  };

  // ============= CHANGE #5: Add helper to get category key from display name =============
  // ADD this function inside the ProductForm component:

  const getCategoryKeyFromDisplayName = (displayName) => {
    // Find the key that matches this display name
    for (const [key, value] of Object.entries(CATEGORY_DISPLAY_NAMES)) {
      if (value === displayName) {
        return key;
      }
    }
    return null;
  };




  const updateItem = (id, patch) =>
    setOrderItems((prev) =>
      prev.map((it) => {
        if (it._id !== id) return it;
        const updated = { ...it, ...patch };
        // Recalculate order_type after update
        updated.order_type = getItemOrderType(updated);
        return updated;
      })
    );
  // Update measurement for a specific item
  const updateItemMeasurement = (itemId, categoryKey, field, value) => {
    setOrderItems((prev) =>
      prev.map((it) => {
        if (it._id !== itemId) return it;
        const currentMeasurements = it.measurements || {};
        return {
          ...it,
          measurements: {
            ...currentMeasurements,
            [categoryKey]: {
              ...(currentMeasurements[categoryKey] || {}),
              [field]: value,
            },
          },
        };
      })
    );
  };

  // MANUAL AUTO-POPULATE FUNCTION
  const handleAutoPopulate = () => {
    const categoryKey = getCategoryKeyFromDisplayName(activeCategory) || activeCategory;
    if (!categoryKey) return;

    // ONLY use customer saved measurements (this makes it Custom)
    if (customerSavedMeasurements && Object.keys(customerSavedMeasurements).length > 0) {
      const savedCategoryData = customerSavedMeasurements[categoryKey];
      if (savedCategoryData && Object.keys(savedCategoryData).length > 0) {
        setMeasurements((prev) => ({
          ...prev,
          [categoryKey]: {
            ...(prev[categoryKey] || {}),
            ...savedCategoryData,
          },
        }));
        showPopup({
          title: "Measurements Populated",
          message: "Customer's saved measurements have been applied.",
          type: "success",
        });
        return;
      }
    }

    showPopup({
      title: "No Saved Profile",
      message: "No saved measurements found for this customer.",
      type: "info",
    });
  };

  // Check if auto-populate data is available (only saved profile now)
  const hasAutoPopulateData = () => {
    return customerSavedMeasurements && Object.keys(customerSavedMeasurements).length > 0;
  };

  // CHANGE #3: Add prompt when adding extra without color
  const handleAddExtra = () => {
    if (!selectedExtra) return;

    // Check if color is selected
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

  const handleRemoveExtra = (index) => {
    setSelectedExtrasWithColors((prev) => prev.filter((_, i) => i !== index));
  };
  // Add extra to a specific item in edit mode
  const handleAddExtraToItem = (itemId, extraName, extraColor) => {
    if (!extraName) return;

    // Check if color is selected
    if (!extraColor || !extraColor.name) {
      showPopup({
        title: "Color Required",
        message: "Please select a color for the extra before adding.",
        type: "warning",
      });
      return;
    }

    const extraDetails = globalExtras.find((e) => e.name === extraName);
    setOrderItems((prev) =>
      prev.map((it) => {
        if (it._id !== itemId) return it;
        return {
          ...it,
          extras: [
            ...(it.extras || []),
            {
              name: extraName,
              color: extraColor,
              price: extraDetails?.price || 0,
            },
          ],
        };
      })
    );
  };

  // ==================== SESSION STORAGE RESTORE ====================
  useEffect(() => {
    const saved = sessionStorage.getItem("screen4FormData");
    if (saved) {
      try {
        isRestoredRef.current = true;
        const data = JSON.parse(saved);

        // Product & Colors
        if (data.selectedProduct) setSelectedProduct(data.selectedProduct);
        if (data.selectedColor) setSelectedColor(data.selectedColor);
        if (data.selectedTop) setSelectedTop(data.selectedTop);
        if (data.selectedBottom) setSelectedBottom(data.selectedBottom);
        if (data.selectedTopColor) setSelectedTopColor(data.selectedTopColor);
        if (data.selectedBottomColor) setSelectedBottomColor(data.selectedBottomColor);

        // Extras
        if (data.selectedExtra) setSelectedExtra(data.selectedExtra);
        if (data.selectedExtraColor) setSelectedExtraColor(data.selectedExtraColor);
        if (data.selectedExtrasWithColors) setSelectedExtrasWithColors(data.selectedExtrasWithColors);

        // Additionals - ensure at least one empty row and keep open
        if (data.selectedAdditionals && data.selectedAdditionals.length > 0) {
          setSelectedAdditionals(data.selectedAdditionals);
        }
        // Don't restore empty additionals - keep the default one empty row
        if (data.showAdditionals !== undefined) setShowAdditionals(data.showAdditionals);

        // Size & Quantity
        if (data.selectedSize) setSelectedSize(data.selectedSize);
        if (data.quantity) setQuantity(data.quantity);
        if (data.availableSizes) setAvailableSizes(data.availableSizes);

        // Measurements
        if (data.measurements) setMeasurements(data.measurements);
        if (data.showMeasurements !== undefined) setShowMeasurements(data.showMeasurements); // ✅ ADD
        if (data.activeCategory) setActiveCategory(data.activeCategory); // ✅ ADD

        // Order Items & Expanded States
        if (data.orderItems) setOrderItems(data.orderItems);
        if (data.expandedRowIds) setExpandedRowIds(data.expandedRowIds); // ✅ ADD
        if (data.expandedItemCategories) setExpandedItemCategories(data.expandedItemCategories); // ✅ ADD

        // Delivery & Order Details
        if (data.deliveryDate) setDeliveryDate(data.deliveryDate);
        if (data.deliveryNotes) setDeliveryNotes(data.deliveryNotes); // ✅ ADD
        if (data.modeOfDelivery) setModeOfDelivery(data.modeOfDelivery);
        if (data.orderFlag) setOrderFlag(data.orderFlag);
        if (data.comments) setComments(data.comments);
        if (data.attachments) setAttachments(data.attachments);

        // Kids Product
        if (data.isKidsProduct !== undefined) setIsKidsProduct(data.isKidsProduct);

        // Urgent
        if (data.urgentReason) setUrgentReason(data.urgentReason);
        if (data.otherUrgentReason) setOtherUrgentReason(data.otherUrgentReason);

        // Product Options (dropdown data)
        if (data.tops) setTops(data.tops);
        if (data.bottoms) setBottoms(data.bottoms);

        // Sync product states
        if (data.isSyncProduct !== undefined) setIsSyncProduct(data.isSyncProduct);
        if (data.productVariants) setProductVariants(data.productVariants);
        if (data.localInventory) setLocalInventory(data.localInventory);

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
      selectedColor,
      selectedTop,
      selectedBottom,
      selectedTopColor,
      selectedBottomColor,
      selectedExtra,
      selectedExtraColor,
      selectedExtrasWithColors,
      selectedAdditionals,
      showAdditionals,
      selectedSize,
      quantity,
      measurements,
      orderItems,
      deliveryDate,
      deliveryNotes,
      modeOfDelivery,
      orderFlag,
      comments,
      attachments,
      isKidsProduct,
      urgentReason,
      otherUrgentReason,
      availableSizes,
      tops,
      bottoms,
      showMeasurements,
      activeCategory,
      expandedRowIds,
      expandedItemCategories,
      // Sync product states
      isSyncProduct,
      productVariants,
      localInventory,
    };
    sessionStorage.setItem("screen4FormData", JSON.stringify(formData));
  }, [
    selectedProduct,
    selectedColor,
    selectedTop,
    selectedBottom,
    selectedTopColor,
    selectedBottomColor,
    selectedExtra,
    selectedExtraColor,
    selectedExtrasWithColors,
    selectedAdditionals,
    showAdditionals,
    selectedSize,
    quantity,
    measurements,
    orderItems,
    deliveryDate,
    deliveryNotes,
    modeOfDelivery,
    orderFlag,
    comments,
    attachments,
    isKidsProduct,
    urgentReason,
    otherUrgentReason,
    availableSizes,
    tops,
    bottoms,
    showMeasurements,
    activeCategory,
    expandedRowIds,
    expandedItemCategories,
    isSyncProduct,
    productVariants,
    localInventory,
  ]);

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

  // FETCH CUSTOMER'S LATEST SAVED MEASUREMENTS
  useEffect(() => {
    const fetchCustomerMeasurements = async () => {
      if (!user?.id) return;

      try {
        const { data, error } = await supabase
          .from("customer_measurements")
          .select("*")
          .eq("customer_id", user.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .single();

        if (error && error.code !== "PGRST116") {
          console.error("Error fetching customer measurements:", error);
        }

        if (data && data.measurements) {
          // console.log("✅ Found saved measurements:", data.measurements);
          setCustomerSavedMeasurements(data.measurements);
          // Directly set measurements from saved profile
        } else {
          // console.log("ℹ️ No saved measurements found for customer");
          setCustomerSavedMeasurements(null);
        }
        setMeasurementsLoaded(true);
      } catch (err) {
        console.error("Error:", err);
        setMeasurementsLoaded(true);
      }
    };

    fetchCustomerMeasurements();
  }, [user?.id]);

  // FETCH GLOBAL EXTRAS (ONE TIME)
  useEffect(() => {
    const fetchExtras = async () => {
      const { data, error } = await supabase
        .from("extras")
        .select("name, price, sort_order")
        .order("sort_order", { ascending: true });

      // console.log("extras:", data);


      if (error) {
        console.error("Error fetching extras:", error);
        return;
      }

      setGlobalExtras(data || []);
    };

    fetchExtras();
  }, []);

  // ==================== FETCH VARIANTS FOR SYNC PRODUCTS ====================
  useEffect(() => {
    const fetchVariants = async () => {
      if (!selectedProduct || !selectedProduct.sync_enabled) {
        setIsSyncProduct(false);
        setProductVariants([]);
        setLocalInventory({});
        return;
      }

      setIsSyncProduct(true);
      setSyncLoading(true);

      // Force Women for sync products
      if (isKidsProduct) {
        setIsKidsProduct(false);
      }

      try {
        // Fetch latest inventory from Shopify and update our database
        const { data: { session } } = await supabase.auth.getSession();

        // Fetch latest inventory from Shopify and update our database
        const response = await fetch(
          `${config.SUPABASE_URL}/functions/v1/shopify-inventory`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "apikey": config.SUPABASE_KEY,
              "Authorization": `Bearer ${config.SUPABASE_KEY}`,
            },
            body: JSON.stringify({
              action: "fetch",
              product_id: selectedProduct.id,
            }),
          }
        );

        const result = await response.json();

        if (result.success && result.inventory) {
          // Use inventory from Shopify sync
          setLocalInventory(result.inventory);

          // Set available sizes for sync products
          const syncSizes = Object.keys(result.inventory).filter(size => result.inventory[size] > 0);
          const sizeOrder = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "2XL", "3XL", "4XL", "5XL", "6XL"];
          syncSizes.sort((a, b) => {
            const aIdx = sizeOrder.indexOf(a);
            const bIdx = sizeOrder.indexOf(b);
            if (aIdx === -1 && bIdx === -1) return a.localeCompare(b);
            if (aIdx === -1) return 1;
            if (bIdx === -1) return -1;
            return aIdx - bIdx;
          });
          setAvailableSizes(syncSizes);

          // Set default size if current not in list
          if (!syncSizes.includes(selectedSize) && syncSizes.length > 0) {
            setSelectedSize(syncSizes[0]);
          }
        } else {
          // Fallback to database if Shopify sync fails
          console.warn("Shopify sync failed, falling back to database:", result.error);

          const { data: variants, error } = await supabase
            .from("product_variants")
            .select("*")
            .eq("product_id", selectedProduct.id);

          if (!error) {
            setProductVariants(variants || []);

            const inventoryMap = {};
            (variants || []).forEach((v) => {
              if (v.inventory > 0) {
                inventoryMap[v.size] = (inventoryMap[v.size] || 0) + v.inventory;
              }
            });

            setLocalInventory(inventoryMap);

            const syncSizes = Object.keys(inventoryMap).filter(size => inventoryMap[size] > 0);
            const sizeOrder = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "2XL", "3XL", "4XL", "5XL", "6XL"];
            syncSizes.sort((a, b) => {
              const aIdx = sizeOrder.indexOf(a);
              const bIdx = sizeOrder.indexOf(b);
              if (aIdx === -1 && bIdx === -1) return a.localeCompare(b);
              if (aIdx === -1) return 1;
              if (bIdx === -1) return -1;
              return aIdx - bIdx;
            });
            setAvailableSizes(syncSizes);

            if (!syncSizes.includes(selectedSize) && syncSizes.length > 0) {
              setSelectedSize(syncSizes[0]);
            }
          }
        }
      } catch (err) {
        console.error("Error fetching variants:", err);
      } finally {
        setSyncLoading(false);
      }
    };

    if (!isRestoredRef.current) {
      fetchVariants();
    }
  }, [selectedProduct]);

  // When product or isKidsProduct changes, load options
  // Skip if data was just restored from sessionStorage
  useEffect(() => {
    // Skip this effect if we just restored from sessionStorage
    if (isRestoredRef.current) {
      isRestoredRef.current = false;
      return;
    }

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
      setSelectedAdditionals([]);
      setShowAdditionals(false);
      setQuantity(1);
      setMeasurements({});
      setIsSyncProduct(false);
      setProductVariants([]);
      setLocalInventory({});
      return;
    }

    // Check if sync product
    const syncEnabled = selectedProduct.sync_enabled || false;
    setIsSyncProduct(syncEnabled);

    // Force Women for sync products
    if (syncEnabled && isKidsProduct) {
      setIsKidsProduct(false);
    }

    // Set product options
    setTops(selectedProduct.top_options || []);

    // CHANGE #5: Sort bottoms alphabetically
    const sortedBottoms = [...(selectedProduct.bottom_options || [])].sort((a, b) =>
      String(a).localeCompare(String(b))
    );
    setBottoms(sortedBottoms);

    // Calculate available sizes (skip for sync products - handled in fetch variants)
    let newAvailableSizes;
    if (syncEnabled) {
      // Sizes are set in fetchVariants useEffect, skip size logic but continue for defaults
      newAvailableSizes = null; // Will skip setAvailableSizes below
    } else if (isKidsProduct) {
      newAvailableSizes = KIDS_SIZE_OPTIONS;
    } else {
      newAvailableSizes = selectedProduct.available_size || [];
    }

    // Only set sizes for non-sync products
    if (newAvailableSizes !== null) {
      setAvailableSizes(newAvailableSizes);

      // Only set default size if current size is not in new sizes
      setSelectedSize((currentSize) => {
        if (newAvailableSizes.includes(currentSize)) {
          return currentSize;
        }
        return isKidsProduct
          ? KIDS_SIZE_OPTIONS[0] || ""
          : selectedProduct.available_size?.[0] || "";
      });
    }

    const topOptions = selectedProduct.top_options || [];
    const bottomOptions = selectedProduct.bottom_options || [];

    const defaultTop = selectedProduct.default_top || topOptions[0] || "";
    const defaultBottom = selectedProduct.default_bottom || bottomOptions[0] || "";

    const defaultColorName = selectedProduct.default_color || "";
    const defaultColor = colors.find(c => c.name === defaultColorName) || { name: "", hex: "" };

    // For sync products: always use defaults, no changes allowed
    if (syncEnabled) {
      setSelectedTop(defaultTop);
      setSelectedTopColor(defaultTop ? defaultColor : { name: "", hex: "" });
      setSelectedBottom(defaultBottom);
      setSelectedBottomColor(defaultBottom ? defaultColor : { name: "", hex: "" });
      setSelectedExtrasWithColors([]); // No extras for sync products
      setSelectedExtra("");
      setSelectedExtraColor({ name: "", hex: "" });
    } else {
      // Only set defaults if not already set
      setSelectedTop((current) => current || defaultTop);
      setSelectedTopColor((current) =>
        current?.name ? current : (defaultTop ? defaultColor : { name: "", hex: "" })
      );

      setSelectedBottom((current) => current || defaultBottom);
      setSelectedBottomColor((current) =>
        current?.name ? current : (defaultBottom ? defaultColor : { name: "", hex: "" })
      );

      // Auto-populate default extra only if no extras selected
      setSelectedExtrasWithColors((current) => {
        if (current.length > 0) return current;
        if (selectedProduct.default_extra) {
          const extraDetails = globalExtras.find((e) => e.name === selectedProduct.default_extra);
          if (extraDetails) {
            return [{
              name: selectedProduct.default_extra,
              color: defaultColor,
              price: extraDetails.price || 0,
            }];
          }
        }
        return [];
      });

      // Reset temporary selection states
      setSelectedExtra("");
      setSelectedExtraColor({ name: "", hex: "" });
    }

  }, [selectedProduct, isKidsProduct, colors, globalExtras, customerSavedMeasurements]);

  useEffect(() => {
    if (selectedTop && CATEGORY_KEY_MAP[selectedTop]) {
      const categoryKey = CATEGORY_KEY_MAP[selectedTop];
      const displayName = CATEGORY_DISPLAY_NAMES[categoryKey];
      setActiveCategory(displayName);
    } else if (selectedBottom && CATEGORY_KEY_MAP[selectedBottom]) {
      const categoryKey = CATEGORY_KEY_MAP[selectedBottom];
      const displayName = CATEGORY_DISPLAY_NAMES[categoryKey];
      setActiveCategory(displayName);
    }
  }, [selectedTop, selectedBottom]);


  // ✅ AUTO-FILL SIZE CHART VALUES FOR ALL RELEVANT CATEGORIES
  useEffect(() => {
    if (!selectedSize || !selectedProduct) return;

    const currentSizeChart = isKidsProduct ? KIDS_SIZE_CHART : SIZE_CHART_US;
    const sizeData = currentSizeChart[selectedSize];

    if (!sizeData) return;

    // Get all relevant categories (top + bottom)
    const relevantKeys = new Set();
    if (selectedTop && CATEGORY_KEY_MAP[selectedTop]) {
      relevantKeys.add(CATEGORY_KEY_MAP[selectedTop]);
    }
    if (selectedBottom && CATEGORY_KEY_MAP[selectedBottom]) {
      relevantKeys.add(CATEGORY_KEY_MAP[selectedBottom]);
    }

    // If no top/bottom selected, use activeCategory as fallback
    if (relevantKeys.size === 0) {
      const activeCategoryKey = getCategoryKeyFromDisplayName(activeCategory) || activeCategory;
      if (activeCategoryKey) {
        relevantKeys.add(activeCategoryKey);
      }
    }

    // Auto-fill measurements for ALL relevant categories
    const updatedMeasurements = {};

    relevantKeys.forEach(categoryKey => {
      const fieldsForCategory = isKidsProduct
        ? KIDS_MEASUREMENT_FIELDS[categoryKey] || []
        : measurementFields[categoryKey] || [];

      const newValues = {};
      if (fieldsForCategory.includes("Bust") && sizeData.Bust != null) newValues.Bust = sizeData.Bust;
      if (fieldsForCategory.includes("Waist") && sizeData.Waist != null) newValues.Waist = sizeData.Waist;
      if (fieldsForCategory.includes("Hip") && sizeData.Hip != null) newValues.Hip = sizeData.Hip;
      if (fieldsForCategory.includes("Length") && sizeData.Length != null) newValues.Length = sizeData.Length;

      if (Object.keys(newValues).length > 0) {
        updatedMeasurements[categoryKey] = newValues;
      }
    });

    // Update all categories at once
    if (Object.keys(updatedMeasurements).length > 0) {
      setMeasurements((prev) => {
        const updated = { ...prev };
        Object.entries(updatedMeasurements).forEach(([categoryKey, values]) => {
          updated[categoryKey] = {
            ...(prev[categoryKey] || {}),
            ...values,
          };
        });
        return updated;
      });
    }
  }, [selectedSize, isKidsProduct, selectedProduct, selectedTop, selectedBottom]);

  // ✅ Clean up measurements when product/top/bottom changes
  useEffect(() => {
    if (!selectedProduct) {
      // Clear all measurements when no product selected
      setMeasurements({});
      return;
    }

    // Get relevant category keys for current selection
    const relevantKeys = new Set();

    if (selectedTop && CATEGORY_KEY_MAP[selectedTop]) {
      relevantKeys.add(CATEGORY_KEY_MAP[selectedTop]);
    }
    if (selectedBottom && CATEGORY_KEY_MAP[selectedBottom]) {
      relevantKeys.add(CATEGORY_KEY_MAP[selectedBottom]);
    }

    // If no top/bottom selected yet, don't clean (user might be in process of selecting)
    if (relevantKeys.size === 0) return;

    // Remove measurements that are no longer relevant
    setMeasurements((prev) => {
      const cleaned = {};
      for (const [key, value] of Object.entries(prev)) {
        if (relevantKeys.has(key)) {
          cleaned[key] = value;
        }
      }
      return cleaned;
    });
  }, [selectedProduct, selectedTop, selectedBottom]);


  // ADD PRODUCT
  const handleAddProduct = () => {
    if (!selectedProduct) {
      showPopup({
        title: "Product Required",
        message: "Please select a product before adding.",
        type: "warning",
      });
      return;
    }

    // For sync products: validate inventory
    if (isSyncProduct) {
      const availableQty = localInventory[selectedSize] || 0;
      if (availableQty <= 0) {
        showPopup({
          title: "Out of Stock",
          message: `Size ${selectedSize} is out of stock.`,
          type: "warning",
        });
        return;
      }
      if (quantity > availableQty) {
        showPopup({
          title: "Insufficient Stock",
          message: `Only ${availableQty} available for size ${selectedSize}.`,
          type: "warning",
        });
        return;
      }
    }

    // Validate delivery date for this product
    if (!deliveryDate) {
      showPopup({
        title: "Delivery Date Required",
        message: "Please select a delivery date for this product.",
        type: "warning",
      });
      return;
    }

    // Capture pending extra if selected but not added
    let finalExtras = [...selectedExtrasWithColors];
    if (selectedExtra) {
      // Check if extra has color
      if (!selectedExtraColor.name) {
        showPopup({
          title: "Color Required",
          message: "Please select a color for the extra before adding the product.",
          type: "warning",
        });
        return;
      }
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
      color: selectedColor, // Now an object { name, hex }
      top: selectedTop,
      top_color: selectedTopColor, // Now an object { name, hex }
      bottom: selectedBottom,
      bottom_color: selectedBottomColor,
      extras: finalExtras,
      additionals: selectedAdditionals.filter(a => a.name && a.name.trim() !== ""),
      size: selectedSize,
      quantity: quantity,
      price: getBasePrice(), // CHANGE #1: Use base price without extras
      measurements: getRelevantMeasurements(),
      image_url: selectedProduct.image_url || selectedProduct.image || null,
      notes: "", // Initialize notes as empty for new products
      isKids: isKidsProduct,
      category: isKidsProduct ? "Kids" : "Women", // Store category string
      order_type: getOrderType(),
      delivery_date: deliveryDate, // Add delivery date per product
      // Sync product metadata
      sync_enabled: isSyncProduct,
      shopify_product_id: selectedProduct.shopify_product_id || null,
    };

    setOrderItems((prev) => [...prev, newProduct]);

    // For sync products: decrease local inventory
    if (isSyncProduct) {
      setLocalInventory((prev) => ({
        ...prev,
        [selectedSize]: Math.max(0, (prev[selectedSize] || 0) - quantity),
      }));
    }

    // Reset inputs
    setSelectedProduct(null);
    setSelectedColor({ name: "", hex: "" }); // Reset to initial object structure
    setSelectedTop("");
    setSelectedBottom("");
    setSelectedTopColor({ name: "", hex: "" }); // Reset to initial object structure
    setSelectedBottomColor({ name: "", hex: "" }); // Reset to initial object structure
    setSelectedExtra("");
    setSelectedExtraColor({ name: "", hex: "" }); // Reset to initial object structure
    setSelectedExtrasWithColors([]);
    setSelectedAdditionals([]); // ✅ RESET ADDITIONALS to one empty row
    setShowAdditionals(true);  // Keep additionals open
    setSelectedSize("S");
    setQuantity(1);
    setMeasurements({});
    setDeliveryDate(""); // Reset delivery date for next product
    setIsSyncProduct(false);
    setProductVariants([]);
    setLocalInventory({});
  };

  // LIVE SUMMARY CALC
  // CHANGE #4: Calculate extras count for quantity
  const getExtrasCount = (items) => {
    return items.reduce((total, item) => {
      return total + (item.extras?.length || 0);
    }, 0);
  };

  const cartQuantity = orderItems.reduce((a, b) => a + b.quantity, 0) + getExtrasCount(orderItems);
  const cartSubtotal = orderItems.reduce((a, b) => {
    // Product price * quantity
    let itemTotal = b.price * b.quantity;
    // Add extras prices
    if (b.extras && b.extras.length > 0) {
      b.extras.forEach(extra => {
        itemTotal += Number(extra.price || 0);
      });
    }
    // Add additionals prices
    if (b.additionals && b.additionals.length > 0) {
      b.additionals.forEach(additional => {
        itemTotal += Number(additional.price || 0);
      });
    }
    return a + itemTotal;
  }, 0);

  const liveQuantity = quantity + selectedExtrasWithColors.length;

  // CHANGE #1: Get base price without extras (for product display)
  const getBasePrice = () => {
    if (!selectedProduct) return 0;

    // BASE PRICE
    let price = Number(selectedProduct.base_price || 0);

    // 👶 APPLY KIDS DISCOUNT (ONLY IF KIDS + SIZE SELECTED)
    if (isKidsProduct && selectedSize && KIDS_DISCOUNT_PERCENT[selectedSize]) {
      const discountPercent = KIDS_DISCOUNT_PERCENT[selectedSize];
      const discountAmount = (price * discountPercent) / 100;
      price = price - discountAmount;
    }

    // ➕ ADD ADDITIONALS PRICE (additionals are part of product, not separate items)
    selectedAdditionals.forEach((additional) => {
      price += Number(additional.price || 0);
    });

    return Math.round(price);
  };

  // Get live price including extras (for order summary)
  const getLivePrice = () => {
    let price = getBasePrice();

    // ➕ ADD EXTRAS PRICE
    selectedExtrasWithColors.forEach((extraItem) => {
      const extraRow = globalExtras.find((e) => e.name === extraItem.name);
      if (extraRow) {
        price += Number(extraRow.price || 0);
      }
    });

    return Math.round(price);
  };

  // Determine if current selection is Custom or Standard
  const getOrderType = () => {
    if (!selectedProduct) return "Standard";

    const defaultTop = selectedProduct.default_top || selectedProduct.top_options?.[0] || "";
    const defaultBottom = selectedProduct.default_bottom || selectedProduct.bottom_options?.[0] || "";
    const defaultColorName = selectedProduct.default_color || "";

    // Check if top changed from default
    if (selectedTop && selectedTop !== defaultTop) return "Custom";

    // Check if bottom changed from default
    if (selectedBottom && selectedBottom !== defaultBottom) return "Custom";

    // Check if top color changed from default
    if (selectedTopColor?.name && selectedTopColor.name !== defaultColorName) return "Custom";

    // Check if bottom color changed from default
    if (selectedBottomColor?.name && selectedBottomColor.name !== defaultColorName) return "Custom";

    // ✅ Check if additionals are added
    if (selectedAdditionals && selectedAdditionals.length > 0) {
      // Check if any additional has a name (not just empty rows)
      const hasValidAdditional = selectedAdditionals.some(
        (add) => add.name && add.name.trim() !== ""
      );
      if (hasValidAdditional) return "Custom";
    }

    // Check for CUSTOM measurements (different from size chart)
    const currentSizeChart = isKidsProduct ? KIDS_SIZE_CHART : SIZE_CHART_US;
    const sizeData = currentSizeChart[selectedSize] || {};
    const sizeChartFields = ["Bust", "Waist", "Hip", "Length"];

    const hasCustomMeasurements = Object.entries(measurements).some(([categoryKey, fields]) => {
      if (!fields || typeof fields !== "object") return false;

      return Object.entries(fields).some(([field, value]) => {
        if (value === "" || value === null || value === undefined) return false;

        // For size chart fields, check if matches size chart
        if (sizeChartFields.includes(field)) {
          const sizeChartValue = sizeData[field];
          if (sizeChartValue !== undefined && Number(value) === Number(sizeChartValue)) {
            return false; // Matches size chart = NOT custom
          }
        }

        // Any non-size-chart field with value OR size chart field with different value = Custom
        return true;
      });
    });

    if (hasCustomMeasurements) return "Custom";

    return "Standard";
  };

  //==================
  // livePrice is TAX-INCLUSIVE
  const gstRate = 0.18;

  // LIVE (single product)
  const livePrice = getLivePrice();
  const liveSubtotalInclTax = getBasePrice() * quantity + selectedExtrasWithColors.reduce((sum, e) => sum + Number(e.price || 0), 0);

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

      // console.log("Uploading:", filePath);

      const { error: uploadError } = await supabase.storage
        .from("attachments")
        .upload(filePath, file, {
          cacheControl: "3600",
          upsert: false,
          contentType: file.type || "application/octet-stream",
        });

      if (uploadError) {
        console.error("Upload failed:", uploadError);
        showPopup({
          title: "Upload Failed",
          message: uploadError.message,
          type: "error",
        });
        return;
      }


      const { data: urlData } = supabase.storage
        .from("attachments")
        .getPublicUrl(filePath);

      uploadedUrls.push(urlData.publicUrl);
    }

    setAttachments((prev) => [...prev, ...uploadedUrls]);

    // ✅ Clear the input so same file can be uploaded again if needed
    event.target.value = "";
  };

  // SAVE ORDER
  const saveOrder = () => {
    // VALIDATION
    if (!modeOfDelivery) {
      showPopup({
        title: "Delivery Mode Required",
        message: "Please select a mode of delivery.",
        type: "warning",
      });
      return;
    }
    if (!orderFlag) {
      showPopup({
        title: "Order Flag Required",
        message: "Please select an order flag.",
        type: "warning",
      });
      return;
    }

    let finalItems = [...orderItems];

    // AUTO ADD LAST PRODUCT IF USER DIDN'T CLICK "ADD PRODUCT"
    if (orderItems.length === 0 && selectedProduct) {
      // Validate delivery date for this product
      if (!deliveryDate) {
        showPopup({
          title: "Delivery Date Required",
          message: "Please select a delivery date for this product.",
          type: "warning",
        });
        return;
      }
      // Capture pending extra if selected but not added
      let finalExtras = [...selectedExtrasWithColors];
      if (selectedExtra) {
        // Check if extra has color
        if (!selectedExtraColor.name) {
          showPopup({
            title: "Color Required",
            message: "Please select a color for the extra before continuing.",
            type: "warning",
          });
          return;
        }
        const extraDetails = globalExtras.find((e) => e.name === selectedExtra);
        finalExtras.push({
          name: selectedExtra,
          color: selectedExtraColor,
          price: extraDetails?.price || 0,
        });
      }
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
        extras: finalExtras,
        additionals: selectedAdditionals.filter(a => a.name && a.name.trim() !== ""),
        size: selectedSize,
        quantity,
        price: getBasePrice(), // Use base price
        measurements: getRelevantMeasurements(),
        image_url: selectedProduct.image_url || selectedProduct.image || null,
        notes: comments, // Initialize notes as empty for auto-added products
        isKids: isKidsProduct,
        order_type: getOrderType(),
        delivery_date: deliveryDate, // Add delivery date per product
        sync_enabled: isSyncProduct,
        shopify_product_id: selectedProduct.shopify_product_id || null,
      });
    }

    // NEW VALIDATION: Ensure at least one product is in the order
    if (finalItems.length === 0) {
      showPopup({
        title: "No Products",
        message: "Please add at least one product to the order.",
        type: "warning",
      });
      return;
    }

    // Validate all items have delivery dates
    const itemsWithoutDeliveryDate = finalItems.filter(item => !item.delivery_date);
    if (itemsWithoutDeliveryDate.length > 0) {
      showPopup({
        title: "Delivery Date Missing",
        message: `${itemsWithoutDeliveryDate.length} product(s) are missing delivery dates. Please expand and add delivery dates.`,
        type: "warning",
      });
      return;
    }

    const overallOrderType = finalItems.some((item) => item.order_type === "Custom")
      ? "Custom"
      : "Standard";

    // Calculate total quantity including extras
    const finalTotalQuantity = finalItems.reduce((a, b) => a + b.quantity, 0) + getExtrasCount(finalItems);

    // Get earliest delivery date from all items for order-level delivery_date
    const earliestDeliveryDate = finalItems.reduce((earliest, item) => {
      if (!earliest) return item.delivery_date;
      return new Date(item.delivery_date) < new Date(earliest) ? item.delivery_date : earliest;
    }, null);

    // Collect all measurements from order items for saving to customer profile
    const allMeasurements = {};
    finalItems.forEach(item => {
      if (item.measurements) {
        Object.entries(item.measurements).forEach(([categoryKey, fields]) => {
          if (!allMeasurements[categoryKey]) {
            allMeasurements[categoryKey] = {};
          }
          Object.entries(fields || {}).forEach(([field, value]) => {
            if (value !== "" && value !== null && value !== undefined) {
              allMeasurements[categoryKey][field] = value;
            }
          });
        });
      }
    });

    // Check if measurements have changed from saved measurements
    const measurementsChanged = JSON.stringify(allMeasurements) !== JSON.stringify(customerSavedMeasurements);

    const orderPayload = {
      user_id: user?.id,

      // Product level details
      items: finalItems,

      // Delivery Details
      delivery_date: formatDate(earliestDeliveryDate), // Use earliest date as order-level date
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
      total_quantity: finalTotalQuantity,
      order_type: overallOrderType,

      // Measurements for customer profile
      save_measurements: measurementsChanged && Object.keys(allMeasurements).length > 0,
      measurements_to_save: allMeasurements,

      // Timestamp
      created_at: new Date().toISOString(),
    };

    navigate("/confirmDetail", { state: { orderPayload } });
  };

  const handleLogout = async () => {
    try {
      // Clear form data
      sessionStorage.removeItem("screen4FormData");
      sessionStorage.removeItem("screen6FormData");

      // ✅ Check if we have a saved associate session
      const savedSession = sessionStorage.getItem("associateSession");

      if (savedSession) {
        // Restore the salesperson's session
        const session = JSON.parse(savedSession);

        // Set the session back in Supabase
        const { error } = await supabase.auth.setSession({
          access_token: session.access_token,
          refresh_token: session.refresh_token
        });

        if (error) {
          console.error("Failed to restore session:", error);
          navigate("/login", { replace: true });
          return;
        }


        // Clean up and navigate
        sessionStorage.removeItem("associateSession");
        sessionStorage.removeItem("returnToAssociate");
        sessionStorage.setItem("requirePasswordVerificationOnReturn", "true");
        navigate("/AssociateDashboard", { replace: true });
      } else {
        // No saved session - just navigate back
        console.log("⚠️ No saved session found");
        sessionStorage.setItem("requirePasswordVerificationOnReturn", "true");
        navigate("/AssociateDashboard", { replace: true });
      }
    } catch (e) {
      console.error("Logout error", e);
      navigate("/login", { replace: true });
    }
  };

  const toOptions = (arr = []) =>
    arr.map((x) => ({ label: String(x), value: x }));
  const toColorOptions = (colors = []) =>
    colors.map((c) => ({
      label: c.name,
      value: c.name, // ← Returns just the name string
      hex: c.hex,
    }));
  // const toExtraOptions = (extras = []) =>
  //   extras.map((e) => ({
  //     label: `${e.name} (₹${formatIndianNumber(e.price)})`,
  //     value: { name: e.name, hex: e.hex },
  //     price: e.price, // Also store price in the option object
  //   }));
  const toExtraOptions = (extras = []) =>
    extras.map((e) => ({
      label: `${e.name} (₹${formatIndianNumber(e.price)})`,
      value: e.name,           // ✅ STRING ONLY
      price: e.price,
    }));

  const categoryKey = CATEGORY_KEY_MAP[activeCategory];
  // Get product's available tops/bottoms for edit mode
  const getProductOptions = (productId) => {
    const product = products.find((p) => p.id === productId);
    // CHANGE #5: Sort bottoms alphabetically
    const sortedBottoms = [...(product?.bottom_options || [])].sort((a, b) =>
      String(a).localeCompare(String(b))
    );
    return {
      tops: product?.top_options || [],
      bottoms: sortedBottoms,
      sizes: product?.available_size || [],
    };
  };

  // Get max quantity for current size (for sync products)
  const getMaxQuantity = () => {
    if (!isSyncProduct) return 999;
    return localInventory[selectedSize] || 0;
  };

  return (
    <div className="screen4-bg">
      {/* Popup Component */}
      {PopupComponent}

      {/* HEADER */}
      <header className="pf-header">
        <img src={Logo} alt="logo" className="pf-header-logo" onClick={handleLogout} />
        <h1 className="pf-header-title">Order Form</h1>
      </header>

      <div className="screen4-card">
        <div className="screen4-layout">
          {/*left side */}
          <div className="screen4-form">
            <h4 className="product-title">Product</h4>

            {/* Category Dropdown - Women/Kids */}
            <div className="category-dropdown-container">
              <select
                className="category-select"
                value={isKidsProduct ? "kids" : "women"}
                onChange={(e) => setIsKidsProduct(e.target.value === "kids")}
                disabled={isSyncProduct}
              >
                <option value="women">Women</option>
                <option value="kids">Kids</option>
              </select>
              {isSyncProduct && <span className="sync-badge">LXRTS</span>}
            </div>

            {/* Product Image - Inline for tablet/mobile */}
            {selectedProduct?.image_url && (
              <div className="screen4-image-inline">
                <img src={selectedProduct.image_url} alt={selectedProduct.name} />
              </div>
            )}

            {/* ADDED PRODUCTS INSIDE CARD */}
            {orderItems.length > 0 && (
              <div className="added-products-box added-products-top">
                {orderItems.map((item, i) => {
                  const expanded = !!expandedRowIds[item._id];
                  const itemActiveCategory = expandedItemCategories[item._id] || "Kurta/Choga/Kaftan";
                  const itemCategoryKey = CATEGORY_KEY_MAP[itemActiveCategory];
                  const productOptions = getProductOptions(item.product_id);
                  const itemIsKids = item.isKids || false;
                  const itemSizes = itemIsKids ? KIDS_SIZE_OPTIONS : productOptions.sizes;

                  return (
                    <div className="added-product-row" key={item._id}>
                      <span className="product-info">
                        {i + 1}. {item.product_name} | {item.category || (item.isKids ? "Kids" : "Women")} | Size: {item.size} | Qty: {formatIndianNumber(item.quantity)} | ₹{formatIndianNumber(item.price)} | Delivery: {item.delivery_date ? formatDate(item.delivery_date) : "Not set"}
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

                      {/* FULL EDITABLE FORM */}
                      {expanded && (
                        <div className="expand-panel full-edit">
                          {/* ROW 1: Top, Top Color, Bottom, Bottom Color */}
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
                                  placeholder="Select Top Color"
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
                                  placeholder="Select Bottom Color"
                                />
                              </div>
                            )}
                          </div>

                          {/* ROW 2: Extras Section */}
                          <div className="row">
                            <div className="field extras-field">
                              <label>Extras</label>
                              {item.extras && item.extras.length > 0 ? (
                                <div className="extras-list">
                                  {item.extras.map((extraItem, idx) => (
                                    <div key={idx} className="added-extra-item-edit">
                                      <span className="extra-name">{extraItem.name}</span>
                                      <SearchableSelect
                                        options={toColorOptions(colors)}
                                        value={extraItem.color?.name || ""}
                                        onChange={(colorName) => {
                                          const colorObj = colors.find(c => c.name === colorName) || { name: "", hex: "" };
                                          const newExtras = [...item.extras];
                                          newExtras[idx].color = colorObj;
                                          updateItem(item._id, { extras: newExtras });
                                        }}
                                        placeholder="Color"
                                      />
                                      <span className="extra-price">
                                        ₹{formatIndianNumber(extraItem.price)}
                                      </span>
                                      <button
                                        className="remove-extra-btn"
                                        onClick={() => {
                                          const newExtras = item.extras.filter((_, i) => i !== idx);
                                          updateItem(item._id, { extras: newExtras });
                                        }}
                                      >
                                        ×
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <p className="muted">No extras added</p>
                              )}

                              {/* Add new extra */}
                              <div className="add-extra-row">
                                <SearchableSelect
                                  options={globalExtras.map((e) => ({
                                    label: `${e.name} (₹${formatIndianNumber(e.price)})`,
                                    value: e.name,
                                  }))}
                                  value=""
                                  onChange={(extraName) => {
                                    if (extraName) {
                                      // Show popup to select color first
                                      showPopup({
                                        title: "Select Color",
                                        message: "Please select a color for the extra using the color dropdown below.",
                                        type: "info",
                                      });
                                      // For edit mode, we add with empty color and user can edit
                                      handleAddExtraToItem(item._id, extraName, { name: "", hex: "" });
                                    }
                                  }}
                                  placeholder="Add Extra..."
                                />
                              </div>
                            </div>
                          </div>

                          {/* ROW: Additionals Section */}
                          <div className="row">
                            <div className="field additionals-field">
                              <label>Additionals</label>
                              {item.additionals && item.additionals.length > 0 ? (
                                <div className="additionals-list">
                                  {item.additionals.map((additional, idx) => (
                                    <div key={idx} className="additional-row-edit">
                                      <input
                                        type="text"
                                        className="input-line additional-name"
                                        placeholder="Item name"
                                        value={additional.name}
                                        onChange={(e) => {
                                          const newAdditionals = [...item.additionals];
                                          newAdditionals[idx].name = e.target.value;
                                          updateItem(item._id, { additionals: newAdditionals });
                                        }}
                                      />
                                      <input
                                        type="number"
                                        className="input-line additional-price"
                                        placeholder="Price"
                                        min={0}
                                        value={additional.price}
                                        onChange={(e) => {
                                          const newAdditionals = [...item.additionals];
                                          newAdditionals[idx].price = Number(e.target.value) || 0;
                                          updateItem(item._id, { additionals: newAdditionals });
                                        }}
                                      />
                                      <button
                                        className="remove-additional-btn"
                                        onClick={() => {
                                          const newAdditionals = item.additionals.filter((_, i) => i !== idx);
                                          updateItem(item._id, { additionals: newAdditionals });
                                        }}
                                      >
                                        ×
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <p className="muted">No additionals added</p>
                              )}

                              <button
                                className="add-additional-btn"
                                onClick={() => {
                                  const newAdditionals = [...(item.additionals || []), { name: "", price: 0 }];
                                  updateItem(item._id, { additionals: newAdditionals });
                                }}
                              >
                                + Add Additional
                              </button>
                            </div>
                          </div>

                          {/* ROW 3: Size Selection */}
                          <div className="size-box edit-size-box">
                            <span className="size-label">Size:</span>
                            <div className="sizes">
                              {itemSizes.length > 0 ? (
                                itemSizes.map((s, idx) => (
                                  <button
                                    key={idx}
                                    className={item.size === s ? "size-btn active" : "size-btn"}
                                    onClick={() => updateItem(item._id, { size: s })}
                                  >
                                    {s}
                                  </button>
                                ))
                              ) : (
                                <span style={{ opacity: 0.6 }}>No sizes available</span>
                              )}
                            </div>
                          </div>

                          {/* ROW 4: Custom Measurements */}
                          <div className="measure-container edit-measure-container">
                            <div className="measure-menu">
                              {(() => {
                                const categoryKeys = new Set();

                                if (item.top && CATEGORY_KEY_MAP[item.top]) {
                                  categoryKeys.add(CATEGORY_KEY_MAP[item.top]);
                                }
                                if (item.bottom && CATEGORY_KEY_MAP[item.bottom]) {
                                  categoryKeys.add(CATEGORY_KEY_MAP[item.bottom]);
                                }

                                const displayNames = categoryKeys.size > 0
                                  ? Array.from(categoryKeys).map(key => CATEGORY_DISPLAY_NAMES[key])
                                  : ALL_MEASUREMENT_CATEGORIES;

                                return displayNames.map((displayName) => {
                                  const categoryKey = getCategoryKeyFromDisplayName(displayName);
                                  const itemCategoryKey = getCategoryKeyFromDisplayName(itemActiveCategory) || itemActiveCategory;

                                  return (
                                    <div
                                      key={displayName}
                                      className={
                                        categoryKey === itemCategoryKey || displayName === itemActiveCategory
                                          ? "measure-item active break-words"
                                          : "measure-item break-words"
                                      }
                                      onClick={() =>
                                        setExpandedItemCategories((prev) => ({
                                          ...prev,
                                          [item._id]: displayName,
                                        }))
                                      }
                                    >
                                      {displayName}
                                    </div>
                                  );
                                });
                              })()}
                            </div>

                            <div className="measure-fields">
                              <h3 className="measure-title">Custom Measurements (in)</h3>
                              <div className="measure-grid">
                                {(() => {
                                  const itemCategoryKey = getCategoryKeyFromDisplayName(itemActiveCategory) || itemActiveCategory;
                                  const fields = itemIsKids
                                    ? KIDS_MEASUREMENT_FIELDS[itemCategoryKey] || []
                                    : measurementFields[itemCategoryKey] || [];

                                  return fields.map((field) => {
                                    const currentSizeChart = itemIsKids ? KIDS_SIZE_CHART : SIZE_CHART_US;
                                    const sizeData = currentSizeChart[item.size] || {};
                                    const autoFilledFields = ["Bust", "Waist", "Hip", "Length"];
                                    const isAutoField = autoFilledFields.includes(field);
                                    const sizeChartValue = sizeData[field];
                                    const currentValue = item.measurements?.[itemCategoryKey]?.[field];

                                    const isEdited = isAutoField &&
                                      currentValue !== undefined &&
                                      currentValue !== "" &&
                                      sizeChartValue !== undefined &&
                                      Number(currentValue) !== Number(sizeChartValue);

                                    const isAutoFilled = isAutoField && !isEdited && currentValue !== undefined && currentValue !== "";

                                    return (
                                      <div className="measure-field" key={field}>
                                        <label>{field}</label>
                                        <input
                                          type="number"
                                          className={`input-line ${isAutoFilled ? "auto-filled" : "manual-input"}`}
                                          value={currentValue || ""}
                                          onChange={(e) =>
                                            updateItemMeasurement(
                                              item._id,
                                              itemCategoryKey,
                                              field,
                                              e.target.value
                                            )
                                          }
                                        />
                                      </div>
                                    );
                                  });
                                })()}
                              </div>
                            </div>
                          </div>

                          {/* ROW 5: Quantity, Price, Delivery Date */}
                          <div className="row">
                            <div className="qty-field">
                              <label>Qty</label>
                              <div className="qty-controls">
                                <button
                                  onClick={() =>
                                    updateItem(item._id, {
                                      quantity: Math.max(1, (item.quantity || 1) - 1),
                                    })
                                  }
                                >
                                  −
                                </button>
                                <span>{item.quantity || 1}</span>
                                <button
                                  onClick={() =>
                                    updateItem(item._id, {
                                      quantity: (item.quantity || 1) + 1,
                                    })
                                  }
                                >
                                  +
                                </button>
                              </div>
                            </div>

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

                            <div className="field" style={{ maxWidth: 200 }}>
                              <label>Delivery Date*</label>
                              <input
                                type="date"
                                className="input-line"
                                value={item.delivery_date || ""}
                                min={new Date().toISOString().split("T")[0]}
                                onChange={(e) =>
                                  updateItem(item._id, {
                                    delivery_date: e.target.value,
                                  })
                                }
                              />
                            </div>
                          </div>

                          {/* ROW 6: Notes */}
                          <div className="row">
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
              <div className="flex items-center gap-2 pt-2 min-h-10 flex-1" style={{ borderBottom: "2px solid #D5B85A", margin: 0 }}>
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
                  className="product-select"
                />

                {/* CHANGE #1: Price Display - Show base price without extras */}
                {selectedProduct && (
                  <p className="product-price">
                    Price:{" "}
                    <strong>₹{formatIndianNumber(getBasePrice())}</strong>
                    {isSyncProduct && selectedSize && localInventory[selectedSize] !== undefined && (
                      <span className="inventory-badge">
                        {" "}| Stock: {localInventory[selectedSize]}
                      </span>
                    )}
                  </p>
                )}
                {syncLoading && <p className="sync-loading">Loading inventory...</p>}
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
                  <button onClick={() => setQuantity((q) => Math.max(1, q - 1))}>
                    −
                  </button>
                  <span>{quantity}</span>
                  <button
                    onClick={() => setQuantity((q) => Math.min(getMaxQuantity(), q + 1))}
                    disabled={isSyncProduct && quantity >= getMaxQuantity()}
                  >
                    +
                  </button>
                </div>
                {isSyncProduct && <span className="qty-max">Max: {getMaxQuantity()}</span>}
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
                  disabled={isSyncProduct}
                />
              </div>

              {selectedTop && (
                <div className="field">
                  {/* <label>Top Color</label> */}
                  <SearchableSelect
                    options={toColorOptions(colors)}
                    value={selectedTopColor.name} // Display name, but onChange gets object
                    onChange={(colorName) => {
                      const colorObj = colors.find(c => c.name === colorName) || { name: "", hex: "" };
                      setSelectedTopColor(colorObj);
                    }}
                    placeholder="Select Top Color"
                    disabled={isSyncProduct}
                  />
                </div>
              )}

              <div className="field">
                <SearchableSelect
                  options={toOptions(bottoms)}
                  value={selectedBottom}
                  onChange={setSelectedBottom}
                  placeholder="Select Bottom"
                  disabled={isSyncProduct}
                />
              </div>
              {selectedBottom && (
                <div className="field">
                  {/* <label>Bottom Color</label> */}
                  <SearchableSelect
                    options={toColorOptions(colors)}
                    value={selectedBottomColor.name} // Display name, but onChange gets object
                    onChange={(colorName) => {
                      const colorObj = colors.find(c => c.name === colorName) || { name: "", hex: "" };
                      setSelectedBottomColor(colorObj);
                    }}
                    placeholder="Select Bottom Color"
                    disabled={isSyncProduct}
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
            {selectedExtrasWithColors.map((extra, index) => (
              <div key={index} className="selected-extra-item">
                <span>
                  {extra.name} (₹{formatIndianNumber(extra.price)})
                  {extra.color?.name && ` (${extra.color.name})`}
                </span>
                <button onClick={() => handleRemoveExtra(index)}>x</button>
              </div>
            ))}


            {/* TOP / BOTTOM COLORS */}

            {/* SIZE */}

            <div className="size-box">
              <span className="size-label">Size:</span>

              <div className="sizes">
                {syncLoading ? (
                  <span style={{ opacity: 0.6 }}>Loading sizes...</span>
                ) : Array.isArray(availableSizes) && availableSizes.length > 0 ? (
                  availableSizes.map((s, i) => (
                    <button
                      key={i}
                      className={selectedSize === s ? "size-btn active" : "size-btn"}
                      onClick={() => {
                        setSelectedSize(s);
                        if (isSyncProduct) setQuantity(1);
                      }}
                    >
                      {s}
                      {isSyncProduct && localInventory[s] !== undefined && (
                        <span className="size-inventory">({localInventory[s]})</span>
                      )}
                    </button>
                  ))
                ) : (
                  <span style={{ opacity: 0.6 }}>
                    {isSyncProduct ? "No sizes in stock" : "No sizes available"}
                  </span>
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
                  {getRelevantMeasurementCategories().map((displayName) => {
                    const categoryKey = getCategoryKeyFromDisplayName(displayName);
                    return (
                      <div
                        key={displayName}
                        className={
                          getCategoryKeyFromDisplayName(activeCategory) === categoryKey ||
                            activeCategory === displayName
                            ? "measure-item active break-words"
                            : "measure-item break-words"
                        }
                        onClick={() => setActiveCategory(displayName)}
                      >
                        {displayName}
                      </div>
                    );
                  })}
                </div>

                <div className="measure-fields">
                  <div className="measure-header">
                    <h3 className="measure-title">Custom Measurements (in)</h3>
                    <button
                      className="auto-populate-btn"
                      onClick={handleAutoPopulate}
                      disabled={!hasAutoPopulateData()}
                      title={hasAutoPopulateData() ? "Auto-fill from saved profile or size chart" : "No saved data available"}
                    >
                      Auto Populate
                    </button>
                  </div>

                  <div className="measure-grid">
                    {(() => {
                      const categoryKey = getCategoryKeyFromDisplayName(activeCategory) || activeCategory;
                      const fields = isKidsProduct
                        ? KIDS_MEASUREMENT_FIELDS[categoryKey] || []
                        : measurementFields[categoryKey] || [];

                      return fields.map((field) => {
                        const currentSizeChart = isKidsProduct ? KIDS_SIZE_CHART : SIZE_CHART_US;
                        const sizeData = currentSizeChart[selectedSize] || {};
                        const autoFilledFields = ["Bust", "Waist", "Hip", "Length"];
                        const isAutoField = autoFilledFields.includes(field);
                        const sizeChartValue = sizeData[field];
                        const currentValue = measurements[categoryKey]?.[field];

                        const isEdited = isAutoField &&
                          currentValue !== undefined &&
                          currentValue !== "" &&
                          sizeChartValue !== undefined &&
                          Number(currentValue) !== Number(sizeChartValue);

                        const isAutoFilled = isAutoField && !isEdited && currentValue !== undefined && currentValue !== "";

                        return (
                          <div className="measure-field" key={field}>
                            <label>{field}</label>
                            <input
                              type="number"
                              className={`input-line ${isAutoFilled ? "auto-filled" : "manual-input"}`}
                              value={currentValue || ""}
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
                        );
                      });
                    })()}
                  </div>
                </div>
              </div>
            )}

            {/* ADDITIONALS */}
            <>
              <div className="measure-bar">
                <span>Additional Customization</span>
                <button
                  className="plus-btn"
                  onClick={() => setShowAdditionals(!showAdditionals)}
                >
                  {showAdditionals ? "−" : "+"}
                </button>
              </div>

              {showAdditionals && (
                <div className="additionals-container">
                  <div className="additionals-list">
                    {selectedAdditionals.map((item, index) => (
                      <div key={index} className="additional-row">
                        <input
                          type="text"
                          className="input-line additional-name"
                          placeholder="Item name"
                          value={item.name}
                          onChange={(e) => {
                            const newAdditionals = [...selectedAdditionals];
                            newAdditionals[index].name = e.target.value;
                            setSelectedAdditionals(newAdditionals);
                          }}
                        />
                        <input
                          type="number"
                          className="input-line additional-price"
                          placeholder="Price"
                          min={0}
                          value={item.price}
                          onChange={(e) => {
                            const newAdditionals = [...selectedAdditionals];
                            newAdditionals[index].price = Number(e.target.value) || 0;
                            setSelectedAdditionals(newAdditionals);
                          }}
                        />
                        <button
                          className="remove-additional-btn"
                          onClick={() => {
                            setSelectedAdditionals((prev) =>
                              prev.filter((_, i) => i !== index)
                            );
                          }}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>

                  <button
                    className="add-additional-btn"
                    onClick={() => {
                      setSelectedAdditionals((prev) => [
                        ...prev,
                        { name: "", price: "" },
                      ]);
                    }}
                  >
                    + Add More
                  </button>
                </div>
              )}
            </>

            {/* ORDER DETAILS */}
            <div className="row">
              <div className="field">
                <label>Delivery Date*</label>
                <input
                  type="date"
                  className="input-line"
                  value={deliveryDate}
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
                        <button
                          type="button"
                          className="remove-attachment-btn"
                          onClick={() => setAttachments((prev) => prev.filter((_, i) => i !== idx))}
                        >
                          ×
                        </button>
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
                style={{ marginTop: "20px", border: '1px solid #d5b85a', alignItems: "center" }}
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
                    showPopup({
                      title: "Reason Required",
                      message: "Please select or enter a reason for urgent order.",
                      type: "warning",
                    });
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