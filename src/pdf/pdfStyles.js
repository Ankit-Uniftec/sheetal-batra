import { StyleSheet, Font } from "@react-pdf/renderer";

// Register fonts if needed (optional - uses default sans-serif)
// Font.register({ family: 'Helvetica', src: '...' });

export const COLORS = {
  gold: "#C9A34A",
  dark: "#262626",
  gray: "#737373",
  lightGray: "#F5F5F5",
  white: "#FFFFFF",
  black: "#000000",
};

export const styles = StyleSheet.create({
  // Page
  page: {
    padding: 40,
    fontSize: 10,
    fontFamily: "Helvetica",
    color: COLORS.dark,
  },

  // Header
  header: {
    alignItems: "center",
    marginBottom: 20,
  },
  logo: {
    width: 90,
    // height: 40,
    marginBottom: 5,
  },
  brandName: {
    fontSize: 8,
    letterSpacing: 4,
    color: COLORS.gold,
  },

  // Title Section
  titleSection: {
    marginBottom: 20,
  },
  title: {
    fontSize: 22,
    fontFamily: "Helvetica-Bold",
    marginBottom: 8,
    fontWeight:700,
  },
  orderInfo: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  orderId: {
    fontSize: 10,
    color: COLORS.gray,
  },
  orderDate: {
    fontSize: 10,
    color: COLORS.gray,
    fontWeight: 700,
  },

  // Section Bar
  sectionBar: {
    backgroundColor: COLORS.gold,
    padding: 8,
    paddingLeft: 12,
    marginBottom: 12,
    marginTop: 15,
  },
  sectionTitle: {
    color: COLORS.white,
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
  },

  // Row layouts
  row: {
    flexDirection: "row",
    marginBottom: 6,
  },
  rowSpaceBetween: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 6,
  },

  // Field styles
  label: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: COLORS.dark,
    marginBottom: 2,
  },
  value: {
    fontSize: 10,
    color: COLORS.gray,
  },
  fieldBlock: {
    marginBottom: 8,
  },

  // Product section
  productRow: {
    flexDirection: "row",
    marginBottom: 15,
    paddingBottom: 15,
    borderBottomWidth: 1,
    borderBottomColor: "#EEEEEE",
  },
  productImage: {
    width: 80,
    height: 100,
    marginRight: 15,
    objectFit: "cover",
  },
  productDetails: {
    flex: 1,
  },
  productName: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    marginBottom: 10,
  },
  productGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 15,
  },
  productField: {
    width: "18%",
    marginBottom: 8,
  },
  productFieldWide: {
    width: "30%",
    marginBottom: 8,
  },

  // Color swatch
  colorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  colorSwatch: {
    width: 20,
    height: 12,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "#CCCCCC",
  },

  // Pricing row
  pricingRow: {
    flexDirection: "row",
    marginTop: 10,
    gap: 20,
  },
  pricingField: {
    width: "30%",
  },

  // Payment details
  paymentRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: "#EEEEEE",
  },
  paymentLabel: {
    fontSize: 10,
    color: COLORS.dark,
  },
  paymentValue: {
    fontSize: 10,
    color: COLORS.dark,
  },
  paymentTotal: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 6,
    borderTopWidth: 2,
    borderTopColor: COLORS.dark,
    marginTop: 4,
  },
  paymentTotalLabel: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
  },
  paymentTotalValue: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: COLORS.gold,
  },

  // Signature
  signatureSection: {
    marginTop: 20,
    alignItems: "flex-end",
  },
  signatureLabel: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    marginBottom: 5,
  },
  signatureImage: {
    width: 120,
    height: 50,
    objectFit: "contain",
  },

  // Footer note
  noteSection: {
    marginTop: 30,
    paddingTop: 15,
    borderTopWidth: 1,
    borderTopColor: "#EEEEEE",
  },
  noteTitle: {
    fontSize: 10,
    fontFamily: "Helvetica-BoldOblique",
    marginBottom: 6,
  },
  noteText: {
    fontSize: 8,
    color: COLORS.gray,
    lineHeight: 1.4,
  },

  // Policy section
  policySection: {
    marginTop: 20,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "#EEEEEE",
  },
  policyItem: {
    fontSize: 7,
    color: COLORS.gray,
    marginBottom: 4,
    lineHeight: 1.3,
  },

  // Warehouse specific
  warehouseHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  barcodeSection: {
    alignItems: "flex-end",
  },
  barcodeLabel: {
    fontSize: 8,
    marginBottom: 2,
  },
  barcodePlaceholder: {
    width: 100,
    height: 40,
    backgroundColor: COLORS.lightGray,
    justifyContent: "center",
    alignItems: "center",
  },

  warehouseInfoGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginBottom: 20,
  },
  warehouseInfoItem: {
    width: "50%",
    flexDirection: "row",
    marginBottom: 6,
  },
  warehouseLabel: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    width: 100,
  },
  warehouseValue: {
    fontSize: 9,
    color: COLORS.gray,
    flex: 1,
  },
  deliveryDateValue: {
    fontSize: 9,
    color: COLORS.gold,
    fontFamily: "Helvetica-Bold",
  },

  // Comments section
  commentsBox: {
    minHeight: 60,
    borderWidth: 1,
    borderColor: "#DDDDDD",
    padding: 8,
    marginBottom: 15,
  },
  commentsText: {
    fontSize: 9,
    color: COLORS.gray,
  },

  // Measurements placeholder
  measurementsPlaceholder: {
    height: 100,
    backgroundColor: COLORS.lightGray,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 15,
  },

  // Bottom barcodes
  bottomBarcodes: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: "auto",
    paddingTop: 20,
  },
  barcodeItem: {
    alignItems: "center",
  },
  barcodeItemLabel: {
    fontSize: 9,
    marginBottom: 4,
  },

  // Two column layout
  twoColumn: {
    flexDirection: "row",
    gap: 30,
  },
  column: {
    flex: 1,
  },

  // Delivery date highlight
  deliveryDateHighlight: {
    color: COLORS.gold,
    fontFamily: "Helvetica-Bold",
  },

  // Contact footer
  contactFooter: {
    marginTop: 15,
    paddingTop: 10,
  },
  contactText: {
    fontSize: 8,
    color: COLORS.gray,
    fontStyle: "italic",
  },
  contactEmail: {
    fontSize: 8,
    color: COLORS.gray,
    fontStyle: "italic",
    marginTop: 8,
  },
});