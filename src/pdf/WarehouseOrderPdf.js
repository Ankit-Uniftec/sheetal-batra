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

// Get color hex from color object
const getColorHex = (color) => {
  if (!color) return "#CCCCCC";
  if (typeof color === "string") return color.startsWith("#") ? color : "#CCCCCC";
  if (typeof color === "object" && color.hex) return color.hex;
  return "#CCCCCC";
};

// Warehouse specific styles
const warehouseStyles = StyleSheet.create({
  page: {
    padding: 40,
    paddingBottom: 120, // Extra space for fixed bottom barcodes
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
  productIndicator: {
    fontSize: 11,
    color: COLORS.gray,
    fontFamily: "Helvetica-Bold",
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

  sectionBar: {
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

  // Extras with colors
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

  // Measurements grid styles
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
});

// Section Header Component
const SectionBar = ({ title }) => (
  <View style={warehouseStyles.sectionBar}>
    <Text style={warehouseStyles.sectionTitle}>{title}</Text>
  </View>
);

// Info Row Component
const InfoRow = ({ label, value, highlight = false }) => (
  <View style={warehouseStyles.infoRow}>
    <Text style={warehouseStyles.infoLabel}>{label}</Text>
    <Text style={highlight ? warehouseStyles.infoValueHighlight : warehouseStyles.infoValue}>
      {value || "—"}
    </Text>
  </View>
);

// Product Item Component - Shows top/bottom/extras WITH colors, additionals WITHOUT price
// Hides empty fields
const ProductItem = ({ item }) => {
  const hasTop = item?.top;
  const hasBottom = item?.bottom;
  const hasSize = item?.size;
  const hasExtras = item?.extras && item.extras.length > 0;
  const hasAdditionals = item?.additionals && item.additionals.length > 0;
  const category = item?.category || (item?.isKids ? "Kids" : "Women");

  return (
    <View style={warehouseStyles.productRow}>
      {item.image_url && (
        <Image src={item.image_url} style={warehouseStyles.productImage} />
      )}
      <View style={warehouseStyles.productDetails}>
        <Text style={warehouseStyles.productName}>{item?.product_name || "—"}</Text>

        <View style={warehouseStyles.productGrid}>
          {/* Top with color swatch - only if present */}
          {hasTop && (
            <View style={warehouseStyles.productField}>
              <Text style={warehouseStyles.fieldLabel}>Top</Text>
              <View style={warehouseStyles.colorRow}>
                <Text style={warehouseStyles.fieldValue}>{item.top}</Text>
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

          {/* Bottom with color swatch - only if present */}
          {hasBottom && (
            <View style={warehouseStyles.productField}>
              <Text style={warehouseStyles.fieldLabel}>Bottom</Text>
              <View style={warehouseStyles.colorRow}>
                <Text style={warehouseStyles.fieldValue}>{item.bottom}</Text>
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

          {/* Category - always show */}
          <View style={warehouseStyles.productField}>
            <Text style={warehouseStyles.fieldLabel}>Category</Text>
            <Text style={warehouseStyles.fieldValue}>{category}</Text>
          </View>

          {/* Quantity - always show */}
          <View style={warehouseStyles.productField}>
            <Text style={warehouseStyles.fieldLabel}>Quantity</Text>
            <Text style={warehouseStyles.fieldValue}>{item?.quantity || 1}</Text>
          </View>
        </View>

        {/* Second Row: Size, Extras, Additionals */}
        <View style={warehouseStyles.productGrid}>
          {/* Size - only if present */}
          {hasSize && (
            <View style={warehouseStyles.productField}>
              <Text style={warehouseStyles.fieldLabel}>Size</Text>
              <Text style={warehouseStyles.fieldValue}>{item.size}</Text>
            </View>
          )}

          {/* Extras with colors - only if present */}
          {hasExtras && (
            <View style={warehouseStyles.productFieldWide}>
              <Text style={warehouseStyles.fieldLabel}>Extras</Text>
              <View style={warehouseStyles.extrasContainer}>
                {item.extras.map((extra, idx) => (
                  <View key={idx} style={warehouseStyles.extraItem}>
                    <Text style={warehouseStyles.extraName}>{extra.name}</Text>
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

          {/* Additionals - names only, NO PRICES - only if present */}
          {hasAdditionals && (
            <View style={warehouseStyles.productFieldWide}>
              <Text style={warehouseStyles.fieldLabel}>Additionals</Text>
              <Text style={warehouseStyles.fieldValue}>
                {item.additionals.map((a) => a.name).join(", ")}
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
      <Text style={warehouseStyles.barcodeText}></Text>
    </View>
  </View>
);

// Measurements Display Component
const MeasurementsDisplay = ({ measurements }) => {
  if (!measurements || typeof measurements !== "object") {
    return null;
  }

  // Get all categories that have measurements
  const categories = Object.keys(measurements).filter((category) => {
    const fields = measurements[category];
    if (!fields || typeof fields !== "object") return false;
    // Check if any field has a value
    return Object.values(fields).some((val) => val !== "" && val !== undefined && val !== null);
  });

  if (categories.length === 0) {
    return null;
  }

  return (
    <View style={warehouseStyles.measurementsGrid}>
      {categories.map((category) => {
        const fields = measurements[category];
        // Get only fields with values
        const fieldEntries = Object.entries(fields).filter(
          ([_, value]) => value !== "" && value !== undefined && value !== null
        );

        if (fieldEntries.length === 0) return null;

        return (
          <View key={category} style={warehouseStyles.measurementBox}>
            <Text style={warehouseStyles.measurementBoxTitle}>{category}</Text>
            <View style={warehouseStyles.measurementRow}>
              {fieldEntries.map(([fieldName, value]) => (
                <View key={fieldName} style={warehouseStyles.measurementItem}>
                  <Text style={warehouseStyles.measurementLabel}>
                    {fieldName}: <Text style={warehouseStyles.measurementValue}>{value}</Text>
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

/**
 * Warehouse PDF Document - ONE PDF PER PRODUCT
 * 
 * @param {object} order - Full order object
 * @param {object} item - Single product item from order.items
 * @param {number} itemIndex - Index of this item (0-based)
 * @param {number} totalItems - Total number of items in order
 * @param {string} logoUrl - Logo URL
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

  // Use item's delivery date, fallback to order's delivery date
  const itemDeliveryDate = item.delivery_date || order.delivery_date;

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
              <Text style={warehouseStyles.barcodeText}></Text>
            </View>
          </View>
        </View>

        {/* Title Row with Product Indicator */}
        <View style={warehouseStyles.titleRow}>
          <Text style={warehouseStyles.title}>Warehouse Order Copy</Text>
          <Text style={warehouseStyles.productIndicator}>
            Product {itemIndex + 1} of {totalItems}
          </Text>
        </View>

        {/* Order Info Grid */}
        <View style={warehouseStyles.infoGrid}>
          {/* Left Column */}
          <View style={warehouseStyles.infoColumn}>
            <InfoRow
              label="Order ID:"
              value={order.order_no || order.order_id}
            />
            <InfoRow
              label="DELIVERY TO:"
              value={order.delivery_location || order.delivery_city || order.mode_of_delivery || "—"}
            />
            <InfoRow
              label="CLIENT NAME:"
              value={order.delivery_name}
            />
            <InfoRow
              label="DELIVERY DATE:"
              value={formatDate(itemDeliveryDate)}
              highlight={true}
            />
            <InfoRow
              label="ORDER PRIORITY:"
              value={order.order_flag || order.priority || "NORMAL"}
            />
          </View>

          {/* Right Column */}
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
              value={item.order_type || order.order_type || "Standard"}
            />
          </View>
        </View>

        {/* Product Details Section - Single Item */}
        <SectionBar title="Product Details" />
        <ProductItem item={item} />

        {/* Notes Section - only show if notes exist */}
        {(item.notes || order.comments || order.delivery_notes) && (
          <View style={warehouseStyles.commentsSection}>
            <Text style={warehouseStyles.commentsLabel}>Notes:</Text>
            <View style={warehouseStyles.commentsBox}>
              <Text style={warehouseStyles.commentsText}>
                {item.notes || order.comments || order.delivery_notes}
              </Text>
            </View>
          </View>
        )}

        {/* Measurements Section */}
        <View style={warehouseStyles.measurementsBar}>
          <Text style={warehouseStyles.sectionTitle}>Measurements</Text>
        </View>
        
        {/* Measurements Grid - show all categories with values */}
        <MeasurementsDisplay measurements={item.measurements} />

        {/* Bottom Barcodes - fixed at bottom, unique per product */}
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