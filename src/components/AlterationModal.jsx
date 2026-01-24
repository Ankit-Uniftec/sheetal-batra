import React, { useState, useEffect, useRef } from "react";
import "./AlterationModal.css";
import { supabase } from "../lib/supabaseClient";
import formatIndianNumber from "../utils/formatIndianNumber";

// Measurement categories and fields
const CATEGORY_KEY_MAP = {
  "Kurta/Choga/Kaftan": "KurtaChogaKaftan",
  "Blouse": "Blouse",
  "Anarkali": "Anarkali",
  "Salwar/Dhoti": "SalwarDhoti",
  "Churidaar/Trouser/Pants/Plazo": "ChuridaarTrouserPantsPlazo",
  "Sharara/Gharara": "ShararaGharara",
  "Lehenga": "Lehenga",
};

const measurementCategories = [
  "Kurta/Choga/Kaftan",
  "Blouse",
  "Anarkali",
  "Salwar/Dhoti",
  "Churidaar/Trouser/Pants/Plazo",
  "Sharara/Gharara",
  "Lehenga",
];

const measurementFields = {
  KurtaChogaKaftan: [
    "Height", "Shoulder", "Neck", "Upper Bust", "Bust", "Dart Point",
    "Sleeves", "Bicep", "Arm Hole", "Waist", "Hip", "Length",
    "Front Cross", "Back Cross", "Front Neck", "Back Neck",
  ],
  Blouse: [
    "Shoulder", "Upper Bust", "Bust", "Dart Point", "Sleeves", "Arm Hole",
    "Waist", "Length", "Front Cross", "Back Cross", "Front Neck", "Back Neck",
  ],
  Anarkali: [
    "Shoulder", "Upper Bust", "Bust", "Dart Point", "Sleeves", "Bicep",
    "Arm Hole", "Length", "Front Neck", "Back Neck",
  ],
  SalwarDhoti: ["Waist", "Hip", "Length"],
  ChuridaarTrouserPantsPlazo: [
    "Waist", "Hip", "Length", "Thigh", "Calf", "Ankle", "Knee", "Yoke Length",
  ],
  ShararaGharara: ["Waist", "Hip", "Length"],
  Lehenga: ["Waist", "Hip", "Length"],
};

// Size options
const WOMEN_SIZE_OPTIONS = ["XXS", "XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL", "6XL", "7XL", "8XL"];
const KIDS_SIZE_OPTIONS = [
  "1-2 yrs", "2-3 yrs", "3-4 yrs", "4-5 yrs", "5-6 yrs",
  "6-7 yrs", "7-8 yrs", "8-9 yrs", "9-10 yrs", "10-11 yrs",
  "11-12 yrs", "12-13 yrs", "13-14 yrs", "14-15 yrs", "15-16 yrs",
];

// Alteration type options
const ALTERATION_TYPES = [
  { value: "Fitting Issue (Tightening Required)", label: "Fitting Issue (Tightening Required)" },
  { value: "Fitting Issue (Loosening Required)", label: "Fitting Issue (Loosening Required)" },
  { value: "Length Issue", label: "Length Issue" },
  { value: "Fabric Issue", label: "Fabric Issue" },
  { value: "Other", label: "Other" },
];

// Alteration location options
const ALTERATION_LOCATIONS = [
  { value: "In-Store", label: "In-Store" },
  { value: "Warehouse", label: "Warehouse" },
];

// Delivery type options
const DELIVERY_TYPES = [
  { value: "Home Delivery", label: "Home Delivery" },
  { value: "Delhi Store", label: "Delhi Store" },
  { value: "Ludhiana Store", label: "Ludhiana Store" },
];

// Status options
const STATUS_OPTIONS = [
  { value: "Normal", label: "Normal" },
  { value: "Upcoming Occasion", label: "Upcoming Occasion (URGENT)" },
];

export default function AlterationModal({
  isOpen,
  onClose,
  onSubmit,
  item,
  itemIndex,
  order,
  existingAlterations = [],
}) {
  const fileInputRef = useRef(null);

  // Form state
  const [formData, setFormData] = useState({
    alteration_type: "",
    alteration_location: "Warehouse",
    notes: "",
    delivery_date: "",
    delivery_type: order?.mode_of_delivery || "Home Delivery",
    status: "Normal",
    size: item?.size || "",
  });

  // Address state (for Home Delivery)
  const [addressData, setAddressData] = useState({
    delivery_address: order?.delivery_address || "",
    delivery_city: order?.delivery_city || "",
    delivery_state: order?.delivery_state || "",
    delivery_pincode: order?.delivery_pincode || "",
    delivery_country: order?.delivery_country || "India",
  });

  // Measurements state
  const [measurements, setMeasurements] = useState({});
  const [showMeasurements, setShowMeasurements] = useState(false);
  const [activeCategory, setActiveCategory] = useState("Kurta/Choga/Kaftan");

  // Attachments state
  const [attachments, setAttachments] = useState([]);
  const [uploading, setUploading] = useState(false);

  // Loading state
  const [submitting, setSubmitting] = useState(false);

  // Initialize measurements from item
  useEffect(() => {
    if (item?.measurements) {
      setMeasurements(item.measurements);
    }
  }, [item]);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen && item) {
      setFormData({
        alteration_type: "",
        alteration_location: "Warehouse",
        notes: "",
        delivery_date: "",
        delivery_type: order?.mode_of_delivery || "Home Delivery",
        status: "Normal",
        size: item?.size || "",
      });
      setAddressData({
        delivery_address: order?.delivery_address || "",
        delivery_city: order?.delivery_city || "",
        delivery_state: order?.delivery_state || "",
        delivery_pincode: order?.delivery_pincode || "",
        delivery_country: order?.delivery_country || "India",
      });
      setMeasurements(item?.measurements || {});
      setAttachments([]);
      setShowMeasurements(false);
    }
  }, [isOpen, item, order]);

  // Handle form field change
  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  // Handle address field change
  const handleAddressChange = (field, value) => {
    setAddressData(prev => ({ ...prev, [field]: value }));
  };

  // Update measurement
  const updateMeasurement = (categoryKey, field, value) => {
    setMeasurements(prev => ({
      ...prev,
      [categoryKey]: {
        ...(prev[categoryKey] || {}),
        [field]: value,
      },
    }));
  };

  // Handle file upload
  const handleFileSelect = async (e) => {
    const files = Array.from(e.target.files);
    
    if (attachments.length + files.length > 3) {
      alert("Maximum 3 attachments allowed");
      return;
    }

    setUploading(true);

    try {
      const uploadPromises = files.map(async (file) => {
        const fileExt = file.name.split('.').pop();
        const fileName = `${order.user_id}/alteration_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.${fileExt}`;

        const { error: uploadError } = await supabase.storage
          .from("attachments")
          .upload(fileName, file, {
            upsert: true,
            contentType: file.type,
          });

        if (uploadError) throw uploadError;

        const { data } = supabase.storage.from("attachments").getPublicUrl(fileName);
        return data.publicUrl;
      });

      const urls = await Promise.all(uploadPromises);
      setAttachments(prev => [...prev, ...urls]);

    } catch (err) {
      console.error("Upload failed:", err);
      alert("Failed to upload file(s)");
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  // Remove attachment
  const removeAttachment = (index) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  // Validate form
  const validateForm = () => {
    if (!formData.alteration_type) {
      alert("Please select alteration type");
      return false;
    }
    if (!formData.delivery_date) {
      alert("Please select delivery date");
      return false;
    }
    if (formData.delivery_type === "Home Delivery") {
      if (!addressData.delivery_address || !addressData.delivery_city || 
          !addressData.delivery_state || !addressData.delivery_pincode) {
        alert("Please fill complete delivery address");
        return false;
      }
    }
    return true;
  };

  // Handle submit
  const handleSubmit = async () => {
    if (!validateForm()) return;

    setSubmitting(true);

    try {
      const alterationData = {
        ...formData,
        ...addressData,
        measurements,
        attachments,
      };

      await onSubmit(alterationData);

    } catch (err) {
      console.error("Submit failed:", err);
      alert("Failed to submit alteration: " + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen || !item) return null;

  const isKids = item.isKids || item.category === "Kids";
  const sizeOptions = isKids ? KIDS_SIZE_OPTIONS : WOMEN_SIZE_OPTIONS;
  const alterationNumber = existingAlterations.length + 1;
  const currentCategoryKey = CATEGORY_KEY_MAP[activeCategory];

  return (
    <div className="alteration-modal-overlay" onClick={onClose}>
      <div className="alteration-modal" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="alteration-modal-header">
          <h2>Request Alteration</h2>
          <span className="alteration-count-badge">Alteration #{alterationNumber} of 2</span>
          <button className="alteration-modal-close" onClick={onClose}>✕</button>
        </div>

        {/* Product Info */}
        <div className="alteration-product-info">
          <img 
            src={item.image_url || "/placeholder.png"} 
            alt={item.product_name} 
            className="alteration-product-img"
          />
          <div className="alteration-product-details">
            <h3>{item.product_name}</h3>
            <p>Size: {item.size} | {isKids ? "Kids" : "Women"}</p>
          </div>
        </div>

        {/* Form */}
        <div className="alteration-modal-body">
          {/* Alteration Type */}
          <div className="alteration-field">
            <label>Alteration Type *</label>
            <select
              value={formData.alteration_type}
              onChange={(e) => handleChange("alteration_type", e.target.value)}
            >
              <option value="">Select Type</option>
              {ALTERATION_TYPES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          {/* Alteration Location */}
          <div className="alteration-field">
            <label>Alteration Location *</label>
            <select
              value={formData.alteration_location}
              onChange={(e) => handleChange("alteration_location", e.target.value)}
            >
              {ALTERATION_LOCATIONS.map(l => (
                <option key={l.value} value={l.value}>{l.label}</option>
              ))}
            </select>
            {formData.alteration_location === "In-Store" && (
              <p className="alteration-field-note">
                No notification will be sent to warehouse for in-store alterations
              </p>
            )}
          </div>

          {/* Size */}
          <div className="alteration-field">
            <label>Size</label>
            <select
              value={formData.size}
              onChange={(e) => handleChange("size", e.target.value)}
            >
              {sizeOptions.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          {/* Measurements */}
          <div className="alteration-field">
            <label>Measurements</label>
            <button 
              type="button"
              className="alteration-measurements-btn"
              onClick={() => setShowMeasurements(!showMeasurements)}
            >
              {showMeasurements ? "Hide Measurements" : "Edit Measurements"}
            </button>
          </div>

          {showMeasurements && (
            <div className="alteration-measurements-section">
              <div className="alteration-measure-container">
                <div className="alteration-measure-menu">
                  {measurementCategories.map((cat) => (
                    <div
                      key={cat}
                      className={`alteration-measure-item ${activeCategory === cat ? "active" : ""}`}
                      onClick={() => setActiveCategory(cat)}
                    >
                      {cat}
                    </div>
                  ))}
                </div>
                <div className="alteration-measure-fields">
                  <div className="alteration-measure-grid">
                    {(measurementFields[currentCategoryKey] || []).map((field) => (
                      <div className="alteration-measure-field" key={field}>
                        <label>{field}</label>
                        <input
                          type="number"
                          value={measurements[currentCategoryKey]?.[field] || ""}
                          onChange={(e) => updateMeasurement(currentCategoryKey, field, e.target.value)}
                          placeholder="in"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Notes */}
          <div className="alteration-field">
            <label>Notes</label>
            <textarea
              value={formData.notes}
              onChange={(e) => handleChange("notes", e.target.value)}
              placeholder="Describe the alteration needed..."
              rows={3}
            />
          </div>

          {/* Attachments */}
          <div className="alteration-field">
            <label>Attachments (Max 3)</label>
            <div className="alteration-attachments">
              {attachments.map((url, i) => (
                <div key={i} className="alteration-attachment-item">
                  <img src={url} alt={`Attachment ${i + 1}`} />
                  <button 
                    type="button" 
                    className="remove-attachment"
                    onClick={() => removeAttachment(i)}
                  >
                    ✕
                  </button>
                </div>
              ))}
              {attachments.length < 3 && (
                <div 
                  className="alteration-attachment-add"
                  onClick={() => fileInputRef.current?.click()}
                >
                  {uploading ? "..." : "Add"}
                </div>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleFileSelect}
              style={{ display: "none" }}
            />
          </div>

          {/* Delivery Date */}
          <div className="alteration-field">
            <label>Delivery Date *</label>
            <input
              type="date"
              value={formData.delivery_date}
              onChange={(e) => handleChange("delivery_date", e.target.value)}
              min={new Date().toISOString().split('T')[0]}
            />
          </div>

          {/* Delivery Type */}
          <div className="alteration-field">
            <label>Delivery Type *</label>
            <select
              value={formData.delivery_type}
              onChange={(e) => handleChange("delivery_type", e.target.value)}
            >
              {DELIVERY_TYPES.map(d => (
                <option key={d.value} value={d.value}>{d.label}</option>
              ))}
            </select>
          </div>

          {/* Address Fields (for Home Delivery) */}
          {formData.delivery_type === "Home Delivery" && (
            <div className="alteration-address-section">
              <h4>Delivery Address</h4>
              <div className="alteration-address-grid">
                <div className="alteration-field">
                  <label>Address *</label>
                  <input
                    type="text"
                    value={addressData.delivery_address}
                    onChange={(e) => handleAddressChange("delivery_address", e.target.value)}
                  />
                </div>
                <div className="alteration-field">
                  <label>City *</label>
                  <input
                    type="text"
                    value={addressData.delivery_city}
                    onChange={(e) => handleAddressChange("delivery_city", e.target.value)}
                  />
                </div>
                <div className="alteration-field">
                  <label>State *</label>
                  <input
                    type="text"
                    value={addressData.delivery_state}
                    onChange={(e) => handleAddressChange("delivery_state", e.target.value)}
                  />
                </div>
                <div className="alteration-field">
                  <label>Pincode *</label>
                  <input
                    type="text"
                    value={addressData.delivery_pincode}
                    onChange={(e) => handleAddressChange("delivery_pincode", e.target.value)}
                    maxLength={6}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Status */}
          <div className="alteration-field">
            <label>Priority Status</label>
            <select
              value={formData.status}
              onChange={(e) => handleChange("status", e.target.value)}
            >
              {STATUS_OPTIONS.map(s => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
            {formData.status === "Upcoming Occasion" && (
              <p className="alteration-field-note urgent">
                Order will be marked as URGENT
              </p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="alteration-modal-footer">
          <button 
            type="button" 
            className="alteration-btn cancel" 
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </button>
          <button 
            type="button" 
            className="alteration-btn submit" 
            onClick={handleSubmit}
            disabled={submitting}
          >
            {submitting ? "Submitting..." : "Submit Alteration"}
          </button>
        </div>
      </div>
    </div>
  );
}