import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  Image,
  StyleSheet,
} from "@react-pdf/renderer";

// Define colors locally
const COLORS = {
  gold: "#D4AF37",
  white: "#FFFFFF",
  gray: "#666666",
  lightGray: "#F5F5F5",
  black: "#000000",
};

// Helper to safely get string value (never returns empty string)
const safeString = (value, fallback = "—") => {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string") {
    return value.trim() === "" ? fallback : value;
  }
  return String(value) || fallback;
};

// Helper to format date
const formatDate = (dateStr) => {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).replace(/\//g, ".");
};

// Helper to calculate T-2 date (delivery date - 2 days)
const getWarehouseDate = (dateStr, orderDateStr) => {
  if (!dateStr) return "—";
  const deliveryDate = new Date(dateStr);
  if (isNaN(deliveryDate)) return "—";

  // If order date provided, check the gap
  if (orderDateStr) {
    const orderDate = new Date(orderDateStr);
    const daysDiff = Math.floor((deliveryDate - orderDate) / (1000 * 60 * 60 * 24));

    // Only subtract 2 days if there's enough gap
    if (daysDiff >= 2) {
      deliveryDate.setDate(deliveryDate.getDate() - 2);
    }
    // If gap < 2 days, show delivery date as-is (no subtraction)
  }

  return deliveryDate.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).replace(/\//g, ".");
};

// Get alteration type label
const getAlterationTypeLabel = (type) => {
  const types = {
    fitting_tightening: "Fitting Issue (Tightening)",
    fitting_loosening: "Fitting Issue (Loosening)",
    length_issue: "Length Issue",
    fabric_issue: "Fabric Issue",
    other: "Other",
  };
  return types[type] || type || "—";
};

/**
 * Helper to categorize measurement keys as "Top" or "Bottom"
 * Based on exact keys used in the system
 */
const getMeasurementLabel = (key) => {
  if (!key) return key;

  // TOP garments
  const topKeys = [
    "KurtaChogaKaftan",
    "Blouse",
    "Anarkali"
  ];

  // BOTTOM garments
  const bottomKeys = [
    "SalwarDhoti",
    "ChuridaarTrouserPantsPlazo",
    "ShararaGharara"
  ];

  if (topKeys.includes(key)) return "Top";
  if (bottomKeys.includes(key)) return "Bottom";
  if (key === "Lehenga") return "Lehenga";

  // Return original key if not matched
  return key;
};

// Warehouse specific styles
const warehouseStyles = StyleSheet.create({
  page: {
    padding: 40,
    paddingBottom: 120,
    fontFamily: "Helvetica",
    fontSize: 10,
    backgroundColor: "#FFFFFF",
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 20,
  },
  logoSection: {
    alignItems: "center",
  },
  logo: {
    width: 70,
    marginBottom: 5,
  },
  barcodeSection: {
    alignItems: "center",
  },
  barcodeLabel: {
    fontSize: 9,
    marginBottom: 4,
  },
  barcodePlaceholder: {
    width: 120,
    height: 50,
    backgroundColor: "#F5F5F5",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#DDD",
  },
  barcodeText: {
    fontSize: 8,
    color: COLORS.gray,
  },

  titleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 15,
  },
  title: {
    fontSize: 20,
    fontFamily: "Helvetica-Bold",
    color: COLORS.gold,
  },
  titleAlteration: {
    fontSize: 20,
    fontFamily: "Helvetica-Bold",
    color: COLORS.gold,
  },
  productIndicator: {
    fontSize: 11,
    color: COLORS.gray,
    fontFamily: "Helvetica-Bold",
  },

  // Alteration Info Box
  alterationInfoBox: {
    backgroundColor: "#FFF8E1",
    borderWidth: 1,
    borderColor: "#FFE082",
    borderRadius: 4,
    padding: 12,
    marginBottom: 15,
  },
  alterationInfoTitle: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: COLORS.gold,
    marginBottom: 8,
  },
  alterationInfoGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  alterationInfoItem: {
    width: "50%",
    marginBottom: 6,
  },
  alterationInfoLabel: {
    fontSize: 8,
    color: COLORS.gray,
    marginBottom: 2,
  },
  alterationInfoValue: {
    fontSize: 10,
    color: "#333",
  },
  alterationNotesBox: {
    backgroundColor: "#FFF",
    borderWidth: 1,
    borderColor: "#DDD",
    borderRadius: 4,
    padding: 8,
    marginTop: 8,
  },
  alterationNotesLabel: {
    fontSize: 8,
    color: COLORS.gray,
    marginBottom: 4,
  },
  alterationNotesText: {
    fontSize: 9,
    color: "#333",
    lineHeight: 1.4,
  },

  infoGrid: {
    flexDirection: "row",
    marginBottom: 20,
  },
  infoColumn: {
    flex: 1,
  },
  infoRow: {
    flexDirection: "row",
    marginBottom: 6,
  },
  infoLabel: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    width: 110,
  },
  infoValue: {
    fontSize: 9,
    color: COLORS.gray,
    flex: 1,
  },
  infoValueHighlight: {
    fontSize: 9,
    color: COLORS.gold,
    fontFamily: "Helvetica-Bold",
    flex: 1,
  },
  infoValueUrgent: {
    fontSize: 9,
    color: COLORS.gold,
    fontFamily: "Helvetica-Bold",
    flex: 1,
  },

  sectionBar: {
    backgroundColor: COLORS.gold,
    padding: 8,
    paddingLeft: 12,
    marginBottom: 12,
  },
  sectionBarAlteration: {
    backgroundColor: COLORS.gold,
    padding: 8,
    paddingLeft: 12,
    marginBottom: 12,
  },
  sectionTitle: {
    color: COLORS.white,
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
  },

  productRow: {
    flexDirection: "row",
    marginBottom: 15,
    paddingBottom: 15,
    borderBottomWidth: 1,
    borderBottomColor: "#EEE",
  },
  productImage: {
    width: 90,
    height: 110,
    marginRight: 20,
    objectFit: "cover",
  },
  productDetails: {
    flex: 1,
  },
  productName: {
    fontSize: 14,
    fontFamily: "Helvetica-Bold",
    marginBottom: 12,
  },
  productGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  productField: {
    width: "25%",
    marginBottom: 10,
  },
  productFieldWide: {
    width: "50%",
    marginBottom: 10,
  },
  fieldLabel: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    marginBottom: 2,
  },
  fieldValue: {
    fontSize: 9,
    color: COLORS.gray,
  },
  colorRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  colorSwatch: {
    width: 24,
    height: 16,
    borderRadius: 2,
    marginLeft: 8,
  },

  extrasContainer: {
    marginTop: 4,
  },
  extraItem: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 4,
  },
  extraName: {
    fontSize: 9,
    color: COLORS.gray,
    marginRight: 8,
  },

  commentsSection: {
    marginBottom: 15,
  },
  commentsLabel: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    marginBottom: 6,
  },
  commentsBox: {
    minHeight: 50,
    borderWidth: 1,
    borderColor: "#DDD",
    padding: 10,
  },
  commentsText: {
    fontSize: 9,
    color: COLORS.gray,
  },

  measurementsBar: {
    backgroundColor: COLORS.gold,
    padding: 8,
    paddingLeft: 12,
    marginBottom: 12,
    marginTop: 10,
  },

  measurementsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginBottom: 20,
  },
  measurementBox: {
    width: "32%",
    marginRight: "2%",
    marginBottom: 10,
    backgroundColor: "#FAFAFA",
    borderWidth: 1,
    borderColor: "#EEE",
    borderRadius: 4,
    padding: 10,
  },
  measurementBoxTitle: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    marginBottom: 8,
    color: "#333",
  },
  measurementRow: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  measurementItem: {
    marginRight: 12,
    marginBottom: 4,
  },
  measurementLabel: {
    fontSize: 8,
    color: COLORS.gray,
  },
  measurementValue: {
    fontSize: 8,
    color: "#333",
  },

  bottomBarcodes: {
    position: "absolute",
    bottom: 40,
    left: 40,
    right: 40,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  barcodeItem: {
    alignItems: "center",
    width: "30%",
  },
  barcodeItemLabel: {
    fontSize: 10,
    marginBottom: 6,
  },
  barcodeItemBox: {
    width: "100%",
    height: 50,
    backgroundColor: "#F5F5F5",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#DDD",
  },

  // Parent order reference
  parentOrderRef: {
    backgroundColor: "#FFF8E1",
    borderWidth: 1,
    borderColor: "#FFE082",
    borderRadius: 4,
    padding: 8,
    marginBottom: 12,
    flexDirection: "row",
  },
  parentOrderLabel: {
    fontSize: 9,
    color: COLORS.gray,
  },
  parentOrderValue: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: "#F57C00",
    marginLeft: 4,
  },
});

// Section Header Component
const SectionBar = ({ title, isAlteration = false }) => (
  <View style={isAlteration ? warehouseStyles.sectionBarAlteration : warehouseStyles.sectionBar}>
    <Text style={warehouseStyles.sectionTitle}>{title}</Text>
  </View>
);

// Info Row Component
const InfoRow = ({ label, value, highlight = false, urgent = false }) => (
  <View style={warehouseStyles.infoRow}>
    <Text style={warehouseStyles.infoLabel}>{label}</Text>
    <Text style={urgent ? warehouseStyles.infoValueUrgent : (highlight ? warehouseStyles.infoValueHighlight : warehouseStyles.infoValue)}>
      {safeString(value)}
    </Text>
  </View>
);

// Product Item Component
const ProductItem = ({ item }) => {
  const hasTop = item?.top && item.top.trim() !== "";
  const hasBottom = item?.bottom && item.bottom.trim() !== "";
  const hasSize = item?.size && item.size.trim() !== "";

  const validExtras = (item?.extras || []).filter(e => e.name && e.name.trim() !== "");
  const hasExtras = validExtras.length > 0;

  const validAdditionals = (item?.additionals || []).filter(a => a.name && a.name.trim() !== "" && a.name.trim() !== " ");
  const hasAdditionals = validAdditionals.length > 0;

  const category = item?.category || (item?.isKids ? "Kids" : "Women");

  return (
    <View style={warehouseStyles.productRow}>
      {item.image_url && (
        <Image src={item.image_url} style={warehouseStyles.productImage} />
      )}
      <View style={warehouseStyles.productDetails}>
        <Text style={warehouseStyles.productName}>{safeString(item?.product_name)}</Text>

        <View style={warehouseStyles.productGrid}>
          {hasTop && (
            <View style={warehouseStyles.productField}>
              <Text style={warehouseStyles.fieldLabel}>Top</Text>
              <View style={warehouseStyles.colorRow}>
                <Text style={warehouseStyles.fieldValue}>{safeString(item.top)}</Text>
                {item?.top_color?.hex && (
                  <View
                    style={[
                      warehouseStyles.colorSwatch,
                      { backgroundColor: item.top_color.hex },
                    ]}
                  />
                )}
              </View>
            </View>
          )}

          {hasBottom && (
            <View style={warehouseStyles.productField}>
              <Text style={warehouseStyles.fieldLabel}>Bottom</Text>
              <View style={warehouseStyles.colorRow}>
                <Text style={warehouseStyles.fieldValue}>{safeString(item.bottom)}</Text>
                {item?.bottom_color?.hex && (
                  <View
                    style={[
                      warehouseStyles.colorSwatch,
                      { backgroundColor: item.bottom_color.hex },
                    ]}
                  />
                )}
              </View>
            </View>
          )}

          <View style={warehouseStyles.productField}>
            <Text style={warehouseStyles.fieldLabel}>Category</Text>
            <Text style={warehouseStyles.fieldValue}>{safeString(category)}</Text>
          </View>

          <View style={warehouseStyles.productField}>
            <Text style={warehouseStyles.fieldLabel}>Quantity</Text>
            <Text style={warehouseStyles.fieldValue}>{item?.quantity || 1}</Text>
          </View>
        </View>

        <View style={warehouseStyles.productGrid}>
          {hasSize && (
            <View style={warehouseStyles.productField}>
              <Text style={warehouseStyles.fieldLabel}>Size</Text>
              <Text style={warehouseStyles.fieldValue}>{safeString(item.size)}</Text>
            </View>
          )}

          {hasExtras && (
            <View style={warehouseStyles.productFieldWide}>
              <Text style={warehouseStyles.fieldLabel}>Extras</Text>
              <View style={warehouseStyles.extrasContainer}>
                {validExtras.map((extra, idx) => (
                  <View key={idx} style={warehouseStyles.extraItem}>
                    <Text style={warehouseStyles.extraName}>{safeString(extra.name)}</Text>
                    {extra.color?.hex && (
                      <View
                        style={[
                          warehouseStyles.colorSwatch,
                          { backgroundColor: extra.color.hex, marginLeft: 0 },
                        ]}
                      />
                    )}
                  </View>
                ))}
              </View>
            </View>
          )}

          {hasAdditionals && (
            <View style={warehouseStyles.productFieldWide}>
              <Text style={warehouseStyles.fieldLabel}>Additionals</Text>
              <Text style={warehouseStyles.fieldValue}>
                {validAdditionals.map((a) => a.name).join(", ") || "—"}
              </Text>
            </View>
          )}
        </View>
      </View>
    </View>
  );
};

// Barcode Placeholder Component
const BarcodePlaceholder = ({ label }) => (
  <View style={warehouseStyles.barcodeItem}>
    <Text style={warehouseStyles.barcodeItemLabel}>{label}</Text>
    <View style={warehouseStyles.barcodeItemBox}>
      <Text style={warehouseStyles.barcodeText}> </Text>
    </View>
  </View>
);

// Measurements Display Component - NOW WITH Top/Bottom LABELS
const MeasurementsDisplay = ({ measurements }) => {
  if (!measurements || typeof measurements !== "object") {
    return null;
  }

  const categories = Object.keys(measurements).filter((category) => {
    const fields = measurements[category];
    if (!fields || typeof fields !== "object") return false;
    return Object.values(fields).some((val) =>
      val !== "" && val !== " " && val !== undefined && val !== null
    );
  });

  if (categories.length === 0) {
    return null;
  }

  return (
    <View style={warehouseStyles.measurementsGrid}>
      {categories.map((category) => {
        const fields = measurements[category];
        const fieldEntries = Object.entries(fields).filter(
          ([_, value]) => value !== "" && value !== " " && value !== undefined && value !== null
        );

        if (fieldEntries.length === 0) return null;

        // Get simplified label (Top/Bottom) instead of raw key
        const displayLabel = getMeasurementLabel(category);

        return (
          <View key={category} style={warehouseStyles.measurementBox}>
            <Text style={warehouseStyles.measurementBoxTitle}>{displayLabel}</Text>
            <View style={warehouseStyles.measurementRow}>
              {fieldEntries.map(([fieldName, value]) => (
                <View key={fieldName} style={warehouseStyles.measurementItem}>
                  <Text style={warehouseStyles.measurementLabel}>
                    {fieldName}: <Text style={warehouseStyles.measurementValue}>{safeString(value)}</Text>
                  </Text>
                </View>
              ))}
            </View>
          </View>
        );
      })}
    </View>
  );
};

// Alteration Info Box Component
const AlterationInfoBox = ({ order }) => (
  <View style={warehouseStyles.alterationInfoBox}>
    <Text style={warehouseStyles.alterationInfoTitle}>ALTERATION DETAILS</Text>
    <View style={warehouseStyles.alterationInfoGrid}>
      <View style={warehouseStyles.alterationInfoItem}>
        <Text style={warehouseStyles.alterationInfoLabel}>Alteration Type</Text>
        <Text style={warehouseStyles.alterationInfoValue}>
          {getAlterationTypeLabel(order.alteration_type)}
        </Text>
      </View>
      <View style={warehouseStyles.alterationInfoItem}>
        <Text style={warehouseStyles.alterationInfoLabel}>Location</Text>
        <Text style={warehouseStyles.alterationInfoValue}>
          {safeString(order.alteration_location)}
        </Text>
      </View>
      <View style={warehouseStyles.alterationInfoItem}>
        <Text style={warehouseStyles.alterationInfoLabel}>Alteration #</Text>
        <Text style={warehouseStyles.alterationInfoValue}>
          {order.alteration_number || 1}
        </Text>
      </View>
      <View style={warehouseStyles.alterationInfoItem}>
        <Text style={warehouseStyles.alterationInfoLabel}>Priority</Text>
        <Text style={[warehouseStyles.alterationInfoValue, order.alteration_status === "upcoming_occasion" && { color: COLORS.gold }]}>
          {order.alteration_status === "upcoming_occasion" ? "URGENT" : "Normal"}
        </Text>
      </View>
    </View>

    {order.alteration_notes && (
      <View style={warehouseStyles.alterationNotesBox}>
        <Text style={warehouseStyles.alterationNotesLabel}>ALTERATION NOTES</Text>
        <Text style={warehouseStyles.alterationNotesText}>
          {order.alteration_notes}
        </Text>
      </View>
    )}
  </View>
);

/**
 * Warehouse PDF Document - ONE PDF PER PRODUCT
 * Now supports both regular orders and alteration orders
 */
const WarehouseOrderPdf = ({ order, item, itemIndex = 0, totalItems = 1, logoUrl }) => {
  if (!order || !item) {
    console.error("WarehouseOrderPdf received undefined order or item.");
    return (
      <Document>
        <Page size="A4" style={warehouseStyles.page}>
          <Text>Error: Order or item data is missing.</Text>
        </Page>
      </Document>
    );
  }

  const isAlteration = order.is_alteration;
  const isUrgent = order.alteration_status === "upcoming_occasion" || order.is_urgent;
  const itemDeliveryDate = order.delivery_date;
  const notes = item.notes || order.comments || order.delivery_notes;
  const hasNotes = notes && notes.trim() !== "";

  return (
    <Document>
      <Page size="A4" style={warehouseStyles.page}>
        {/* Header Row - Logo and Master Barcode */}
        <View style={warehouseStyles.headerRow}>
          <View style={warehouseStyles.logoSection}>
            {logoUrl && <Image src={logoUrl} style={warehouseStyles.logo} />}
          </View>
          <View style={warehouseStyles.barcodeSection}>
            <Text style={warehouseStyles.barcodeLabel}>Master</Text>
            <View style={warehouseStyles.barcodePlaceholder}>
              <Text style={warehouseStyles.barcodeText}> </Text>
            </View>
          </View>
        </View>

        {/* Title Row with Product Indicator */}
        <View style={warehouseStyles.titleRow}>
          <Text style={isAlteration ? warehouseStyles.titleAlteration : warehouseStyles.title}>
            {isAlteration ? "Alteration Order Copy" : "Warehouse Order Copy"}
          </Text>
          <Text style={warehouseStyles.productIndicator}>
            Product {itemIndex + 1} of {totalItems}
          </Text>
        </View>

        {/* Parent Order Reference (for alterations) */}
        {isAlteration && order.parent_order_no && (
          <View style={warehouseStyles.parentOrderRef}>
            <Text style={warehouseStyles.parentOrderLabel}>Original Order:</Text>
            <Text style={warehouseStyles.parentOrderValue}>{order.parent_order_no}</Text>
          </View>
        )}

        {/* Alteration Info Box (for alterations) */}
        {isAlteration && <AlterationInfoBox order={order} />}

        {/* Order Info Grid */}
        <View style={warehouseStyles.infoGrid}>
          <View style={warehouseStyles.infoColumn}>
            <InfoRow
              label="Order ID:"
              value={order.order_no || order.order_id}
            />
            <InfoRow
              label="DELIVERY TO:"
              value={order.delivery_location || order.delivery_city || order.mode_of_delivery}
            />
            <InfoRow
              label="CLIENT NAME:"
              value={order.delivery_name}
            />
            <InfoRow
              label="DELIVERY DATE:"
              value={getWarehouseDate(itemDeliveryDate)}
              highlight={!isUrgent}
              urgent={isUrgent}
            />
            <InfoRow
              label="ORDER PRIORITY:"
              value={isUrgent ? "🔥 URGENT" : (order.order_flag || order.priority || "NORMAL")}
              urgent={isUrgent}
            />
          </View>

          <View style={warehouseStyles.infoColumn}>
            <InfoRow
              label="ORDER DATE:"
              value={formatDate(order.created_at)}
            />
            <InfoRow
              label="SALES ASSOCIATE:"
              value={order.salesperson}
            />
            <InfoRow
              label="ORDER TYPE:"
              value={isAlteration ? "ALTERATION" : (item.order_type || order.order_type || "Standard")}
            />
          </View>
        </View>

        {/* Product Details Section */}
        <SectionBar title="Product Details" isAlteration={isAlteration} />
        <ProductItem item={item} />

        {/* Notes Section */}
        {hasNotes && (
          <View style={warehouseStyles.commentsSection}>
            <Text style={warehouseStyles.commentsLabel}>Notes:</Text>
            <View style={warehouseStyles.commentsBox}>
              <Text style={warehouseStyles.commentsText}>
                {notes}
              </Text>
            </View>
          </View>
        )}

        {/* Measurements Section */}
        <View style={warehouseStyles.measurementsBar}>
          <Text style={warehouseStyles.sectionTitle}>
            {isAlteration ? "Updated Measurements" : "Measurements"}
          </Text>
        </View>

        <MeasurementsDisplay measurements={item.measurements} />

        {/* Bottom Barcodes */}
        <View style={warehouseStyles.bottomBarcodes} fixed>
          <BarcodePlaceholder label="Top" />
          <BarcodePlaceholder label="Bottom" />
          <BarcodePlaceholder label="Extra" />
        </View>
      </Page>
    </Document>
  );
};

export default WarehouseOrderPdf;