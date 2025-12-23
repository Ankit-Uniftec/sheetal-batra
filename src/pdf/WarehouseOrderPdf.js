import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  Image,
  StyleSheet,
} from "@react-pdf/renderer";
import { styles, COLORS } from "./pdfStyles";

// Helper to format date
const formatDate = (dateStr) => {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).replace(/\//g, ". ");
};

// Get color name from color object
const getColorName = (color) => {
  if (!color) return "—";
  if (typeof color === "string") return color;
  if (typeof color === "object" && color.name) return color.name;
  return "—";
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
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 25,
  },
  logoSection: {
    alignItems: "center",
  },
  logo: {
    width: 70,
    // height: 70,
    marginBottom: 5,
  },
  brandName: {
    fontSize: 7,
    letterSpacing: 3,
    color: COLORS.gold,
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

  title: {
    fontSize: 20,
    fontFamily: "Helvetica-Bold",
    color: COLORS.gold,
    marginBottom: 15,
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
    fontSize: 11,
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
    // gap: 4,
  },
  colorSwatch: {
    width: 24,
    height: 16,
    borderRadius: 2,
    marginLeft: 8,
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
  measurementsPlaceholder: {
    height: 120,
    backgroundColor: "#F9F9F9",
    borderWidth: 1,
    borderColor: "#DDD",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 20,
  },
  placeholderText: {
    fontSize: 10,
    color: COLORS.gray,
  },

  bottomBarcodes: {
    flexDirection: "row",
    justifyContent: "space-between",
    // marginTop: "auto",
    paddingTop: 30,
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

// Product Item Component
const ProductItem = ({ item }) => (
  <View style={warehouseStyles.productRow}>
    {item.image_url && (
      <Image src={item.image_url} style={warehouseStyles.productImage} />
    )}
    <View style={warehouseStyles.productDetails}>
      <Text style={warehouseStyles.productName}>{item?.product_name || "—"}</Text>

      <View style={warehouseStyles.productGrid}>
        {/* Top with color swatch */}
        <View style={warehouseStyles.productField}>
          <Text style={warehouseStyles.fieldLabel}>Top</Text>
          <View style={warehouseStyles.colorRow}>
            <Text style={warehouseStyles.fieldValue}>{item?.top || "—"}</Text>
            {item?.top_color && (
              <View
                style={[
                  warehouseStyles.colorSwatch,
                  { backgroundColor: getColorHex(item.top_color) },
                ]}
              />
            )}
          </View>
        </View>

        {/* Bottom with color swatch */}
        <View style={warehouseStyles.productField}>
          <Text style={warehouseStyles.fieldLabel}>Bottom</Text>
          <View style={warehouseStyles.colorRow}>
            <Text style={warehouseStyles.fieldValue}>{item?.bottom || "—"}</Text>
            {item?.bottom_color && (
              <View
                style={[
                  warehouseStyles.colorSwatch,
                  { backgroundColor: getColorHex(item.bottom_color) },
                ]}
              />
            )}
          </View>
        </View>

        {/* Size */}
        <View style={warehouseStyles.productField}>
          <Text style={warehouseStyles.fieldLabel}>Size</Text>
          <Text style={warehouseStyles.fieldValue}>{item?.size || "—"}</Text>
        </View>
      </View>

      <View style={warehouseStyles.productGrid}>
        {/* Color */}
        <View style={warehouseStyles.productField}>
          <Text style={warehouseStyles.fieldLabel}>Color</Text>
          <Text style={warehouseStyles.fieldValue}>{getColorName(item?.color)}</Text>
        </View>

        {/* Additionals/Extras */}
        <View style={warehouseStyles.productField}>
          <Text style={warehouseStyles.fieldLabel}>Additionals</Text>
          <Text style={warehouseStyles.fieldValue}>
            {item?.extras?.map((e) => e?.name).filter(Boolean).join(", ") || "—"}
          </Text>
        </View>
      </View>
    </View>
  </View>
);

// Barcode Placeholder Component
const BarcodePlaceholder = ({ label }) => (
  <View style={warehouseStyles.barcodeItem}>
    <Text style={warehouseStyles.barcodeItemLabel}>{label}</Text>
    <View style={warehouseStyles.barcodeItemBox}>
      <Text style={warehouseStyles.barcodeText}></Text>
    </View>
  </View>
);

// Main Warehouse PDF Document
const WarehouseOrderPdf = ({ order, logoUrl }) => {
  if (!order) {
    console.error("WarehouseOrderPdf received an undefined or null order prop.");
    return <Document><Page size="A4" style={styles.page}><Text>Error: Order data is missing.</Text></Page></Document>;
  }

  const items = order.items || [];

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header Row - Logo and Master Barcode */}
        <View style={warehouseStyles.headerRow}>
          <View style={warehouseStyles.logoSection}>
            {logoUrl && <Image src={logoUrl} style={warehouseStyles.logo} />}
            {/* <Text style={warehouseStyles.brandName}>S H E E T A L   B A T R A</Text> */}
          </View>
          <View style={warehouseStyles.barcodeSection}>
            <Text style={warehouseStyles.barcodeLabel}>Master</Text>
            <View style={warehouseStyles.barcodePlaceholder}>
              <Text style={warehouseStyles.barcodeText}></Text>
            </View>
          </View>
        </View>

        {/* Title */}
        <Text style={warehouseStyles.title}>Warehouse Order Copy</Text>

        {/* Order Info Grid */}
        <View style={warehouseStyles.infoGrid}>
          {/* Left Column */}
          <View style={warehouseStyles.infoColumn}>
            <InfoRow
              label="Order ID:"
              value={order.id || order.order_id}
            />
            <InfoRow
              label="DELIVERY TO:"
              value={order.delivery_location || order.delivery_city || "—"}
            />
            <InfoRow
              label="CLIENT NAME:"
              value={order.delivery_name}
            />
            <InfoRow
              label="DELIVERY DATE:"
              value={formatDate(order.delivery_date)}
              highlight={true}
            />
            <InfoRow
              label="ORDER PRIORITY:"
              value={order.priority || "NORMAL"}
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
          </View>
        </View>

        {/* Order Details Section */}
        <SectionBar title="Order Details" />
        {items.map((item, index) => (
          <ProductItem key={index} item={item} />
        ))}

        {/* Comments Section */}
        <View style={warehouseStyles.commentsSection}>
          <Text style={warehouseStyles.commentsLabel}>Comments:</Text>
          <View style={warehouseStyles.commentsBox}>
            <Text style={warehouseStyles.commentsText}>
              {order.comments || order.delivery_notes || "—"}
            </Text>
          </View>
        </View>

        {/* Measurements Section */}
        <View style={warehouseStyles.measurementsBar}>
          <Text style={warehouseStyles.sectionTitle}>Measurements</Text>
        </View>
        {/* <View style={warehouseStyles.measurementsPlaceholder}>
          <Text style={warehouseStyles.placeholderText}>
            [ Measurements will be added here ]
          </Text>
        </View> */}

        {/* Bottom Barcodes */}
        <View style={warehouseStyles.bottomBarcodes}>
          <BarcodePlaceholder label="Top" />
          <BarcodePlaceholder label="Bottom" />
          <BarcodePlaceholder label="Extra" />
        </View>
      </Page>
    </Document>
  );
};

export default WarehouseOrderPdf;
