import React from "react";
import { getWarehouseDateObj } from "../utils/warehouseDate";
import { standardSizeMeasurementsByCategory } from "../utils/b2bSizeChart";
import { mergeOrderNotes } from "../utils/orderNotes";
import {
  Document,
  Page,
  Text,
  View,
  Image,
  StyleSheet,
} from "@react-pdf/renderer";

// Barcode workflow is live — barcodes render on warehouse PDFs.
const SHOW_BARCODES = true;

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

// A colour's display NAME, whatever shape it is stored in.
// Colours are normally { hex, name } objects, but older rows hold a bare
// string. Returns "" when there is nothing to show, so callers can guard.
// NOTE safeString() must never be used on a colour: on an object it yields
// the literal "[object Object]".
const colorName = (color) => {
  if (!color) return "";
  if (typeof color === "string") return color.trim();
  if (typeof color === "object") return String(color.name || "").trim();
  return "";
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

// The T-2 warehouse date. The rule itself lives in src/utils/warehouseDate.js —
// one definition shared with the warehouse dashboard and the Production Manager.
// Only the formatting differs here: the printed sheet uses dots (15.07.2026).
const getWarehouseDate = (dateStr, orderDateStr) => {
  const d = getWarehouseDateObj(dateStr, orderDateStr);
  if (!d) return "—";
  return d.toLocaleDateString("en-GB", {
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
    paddingHorizontal: 40,
    paddingVertical: 36,
    fontFamily: "Helvetica",
    fontSize: 10,
    backgroundColor: "#FFFFFF",
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 16,
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
    marginBottom: 12,
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
    marginBottom: 16,
  },
  infoColumn: {
    flex: 1,
  },
  infoRow: {
    flexDirection: "row",
    marginBottom: 5,
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
    marginBottom: 10,
  },
  sectionBarAlteration: {
    backgroundColor: COLORS.gold,
    padding: 8,
    paddingLeft: 12,
    marginBottom: 10,
  },
  sectionTitle: {
    color: COLORS.white,
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
  },

  productRow: {
    flexDirection: "row",
    marginBottom: 12,
    paddingBottom: 12,
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
    marginBottom: 10,
  },
  productGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  productField: {
    width: "25%",
    marginBottom: 8,
    paddingRight: 8,
  },
  // A garment piece + swatch + colour name needs more room than a bare value
  // like Quantity. At 25% ("Long Choga" + swatch + "Deep Blue") the colour was
  // forced onto a second line under the garment, which read as though the colour
  // belonged to the row below. A third of the width keeps each piece on ONE line.
  productFieldGarment: {
    width: "33.33%",
    marginBottom: 8,
    paddingRight: 8,
  },
  productFieldWide: {
    width: "50%",
    marginBottom: 8,
    paddingRight: 8,
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
    // The garment name, swatch and colour name share one grid cell. Wrapping
    // stays on as a safety net: a very long colour ("Carnation Pink" on a
    // narrow piece name) would otherwise overflow and print on top of the
    // neighbouring column. With productFieldGarment's wider cell it should not
    // normally need to.
    flexWrap: "wrap",
  },
  colorSwatch: {
    // Small enough to sit INLINE between the garment name and its colour name.
    // At 24x16 the swatch dominated the row and pushed the colour name onto a
    // second line.
    width: 12,
    height: 12,
    borderRadius: 2,
    marginLeft: 6,
    marginRight: 4,
  },
  // Was referenced but never defined, so the colour name rendered unstyled at
  // @react-pdf's default font size (~18pt) — the real cause of the overlap.
  // Matches fieldValue, with room to wrap onto its own line.
  colorName: {
    fontSize: 9,
    color: COLORS.gray,
    marginLeft: 6,
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
    marginBottom: 12,
  },
  commentsLabel: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    marginBottom: 5,
  },
  commentsBox: {
    minHeight: 44,
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
    marginBottom: 10,
    marginTop: 8,
  },

  measurementsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginBottom: 12,
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

  // In-flow component barcode block — sits under the component's details, in
  // the normal flow (replaces the old absolute/`fixed` footer that duplicated
  // onto overflow pages and produced near-blank second pages).
  componentBarcode: {
    marginTop: 16,
    alignItems: "center",
    width: "100%",
  },
  // In-flow fallback placeholder barcodes (old orders without components).
  fallbackBarcodes: {
    marginTop: 24,
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-start",
    gap: 8,
  },
  barcodeItem: {
    alignItems: "center",
    width: "31%",
    marginBottom: 4,
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
  // Gifting Order Banner
  giftingBanner: {
    backgroundColor: "#E91E63",
    padding: 6,
    paddingHorizontal: 12,
    marginBottom: 10,
    borderRadius: 4,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  giftingBannerText: {
    color: "#FFFFFF",
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
  },
  giftingRecipientText: {
    color: "#FFFFFF",
    fontSize: 8,
    opacity: 0.9,
  },
});

// Section Header Component
const SectionBar = ({ title, isAlteration = false }) => (
  <View style={isAlteration ? warehouseStyles.sectionBarAlteration : warehouseStyles.sectionBar}>
    <Text style={warehouseStyles.sectionTitle}>{title}</Text>
  </View>
);

// Info Row Component
/**
 * The header info rows for an order, as DATA rather than JSX.
 *
 * These used to be two hardcoded columns — 6 rows on the left, 3 on the right —
 * which looked lopsided, and got worse as rows appeared or vanished: PO NUMBER
 * is B2B-only, GIFT RECIPIENT gifting-only and SHOPIFY ORDER NO Shopify-only,
 * so the real count swings between 7 and 10. Returning a flat list lets the
 * caller split it down the middle, so the two columns stay even whatever
 * combination of optional rows this particular order has.
 */
const buildInfoRows = ({ order, item, clientNameForHeader, itemDeliveryDate, isUrgent, isAlteration }) => {
  const rows = [
    { label: "Order ID:", value: order.order_no || order.order_id },
  ];

  // Shopify's own order number (e.g. "#26946"). The warehouse and the catalogue
  // team refer to these by this number rather than our SB- one, so the work
  // order carries both. NULL on every other channel.
  if (order.shopify_order_name) {
    rows.push({ label: "SHOPIFY ORDER NO:", value: order.shopify_order_name, highlight: true });
  }

  rows.push(
    { label: "DELIVERY TO:", value: order.delivery_location || order.delivery_city || order.mode_of_delivery },
    { label: "CLIENT NAME:", value: clientNameForHeader },
    // "DISPATCH DATE", not "delivery": this field is getWarehouseDate() — the
    // T-2 production deadline (customer delivery_date minus 2 days), which is
    // when the piece must LEAVE, not when the customer receives it. The old
    // label named the customer's date while printing the warehouse's, which
    // read as a two-day reprieve that does not exist.
    { label: "DISPATCH DATE:", value: getWarehouseDate(itemDeliveryDate, order.created_at), highlight: !isUrgent, urgent: isUrgent },
    { label: "ORDER PRIORITY:", value: isUrgent ? "🔥 URGENT" : (order.order_flag || order.priority || "NORMAL"), urgent: isUrgent },
    { label: "ORDER DATE:", value: formatDate(order.created_at) },
  );

  // PO number is a B2B-only field — gate on is_b2b like WarehouseDashboard does.
  if (order.is_b2b && order.po_number) {
    rows.push({ label: "PO NUMBER:", value: order.po_number });
  }
  if (order.is_gifting && order.gift_recipient_name) {
    rows.push({
      label: "GIFT RECIPIENT:",
      value: `${order.gift_recipient_name}${order.gift_recipient_contact ? ` (${order.gift_recipient_contact})` : ""}`,
    });
  }

  rows.push(
    { label: "SALES ASSOCIATE:", value: order.salesperson },
    { label: "ORDER TYPE:", value: isAlteration ? "ALTERATION" : (item?.order_type || order.order_type || "Standard") },
  );

  return rows;
};

// Two even columns from one list. Ceil so an odd count puts the extra row on the
// LEFT, which reads better than a left column shorter than the right.
const InfoGrid = ({ rows }) => {
  const split = Math.ceil(rows.length / 2);
  return (
    <View style={warehouseStyles.infoGrid}>
      {[rows.slice(0, split), rows.slice(split)].map((col, i) => (
        <View key={i} style={warehouseStyles.infoColumn}>
          {col.map((r) => <InfoRow key={r.label} {...r} />)}
        </View>
      ))}
    </View>
  );
};

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
  const hasDupatta = item?.includes_dupatta === true;
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

        {/* Row 1 — the garment pieces, each in a wider cell so the piece name,
            its swatch and its colour name stay on ONE line. Three across. */}
        <View style={warehouseStyles.productGrid}>
          {hasTop && (
            <View style={warehouseStyles.productFieldGarment}>
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
                {/* Print the NAME too: the swatch alone disappears whenever the
                    hex is unknown, leaving the tailor no colour at all. Kept
                    directly after the swatch so the two read as one unit. */}
                {colorName(item?.top_color) && (
                  <Text style={warehouseStyles.colorName}>{colorName(item.top_color)}</Text>
                )}
              </View>
            </View>
          )}

          {hasBottom && (
            <View style={warehouseStyles.productFieldGarment}>
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
                {colorName(item?.bottom_color) && (
                  <Text style={warehouseStyles.colorName}>{colorName(item.bottom_color)}</Text>
                )}
              </View>
            </View>
          )}

          {hasDupatta && (
            <View style={warehouseStyles.productFieldGarment}>
              <Text style={warehouseStyles.fieldLabel}>Dupatta</Text>
              {/* dupatta_color is a { hex, name } object like the others —
                  safeString() on it printed "[object Object]". */}
              <View style={warehouseStyles.colorRow}>
                <Text style={warehouseStyles.fieldValue}>
                  {colorName(item?.dupatta_color) || "Included"}
                </Text>
                {item?.dupatta_color?.hex && (
                  <View
                    style={[
                      warehouseStyles.colorSwatch,
                      { backgroundColor: item.dupatta_color.hex },
                    ]}
                  />
                )}
              </View>
            </View>
          )}

        </View>

        {/* Row 2 — the plain scalars. Kept OUT of the garment row above: mixed
            in, they made the pieces and their colours wrap unpredictably
            depending on how many pieces the garment has. */}
        <View style={warehouseStyles.productGrid}>
          {hasSize && (
            <View style={warehouseStyles.productField}>
              <Text style={warehouseStyles.fieldLabel}>Size</Text>
              <Text style={warehouseStyles.fieldValue}>{safeString(item.size)}</Text>
            </View>
          )}

          <View style={warehouseStyles.productField}>
            <Text style={warehouseStyles.fieldLabel}>Quantity</Text>
            <Text style={warehouseStyles.fieldValue}>{item?.quantity || 1}</Text>
          </View>

          <View style={warehouseStyles.productField}>
            <Text style={warehouseStyles.fieldLabel}>Category</Text>
            <Text style={warehouseStyles.fieldValue}>{safeString(category)}</Text>
          </View>

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

// The measurement categories that actually carry a value. Shared by the
// renderer and by MeasurementsSection's decision to render at all, so the
// heading and the grid can never disagree about whether there is anything here.
const populatedMeasurementCategories = (measurements) => {
  if (!measurements || typeof measurements !== "object") return [];
  return Object.keys(measurements).filter((category) => {
    const fields = measurements[category];
    if (!fields || typeof fields !== "object") return false;
    return Object.values(fields).some((val) =>
      val !== "" && val !== " " && val !== undefined && val !== null
    );
  });
};

// Measurements Display Component - NOW WITH Top/Bottom LABELS
const MeasurementsDisplay = ({ measurements }) => {
  const categories = populatedMeasurementCategories(measurements);

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

/**
 * MeasurementsSection — heading + body as ONE unit, for both Document branches.
 *
 * Measurements come from one of two places, and render IDENTICALLY either way
 * — same gold "Body Measurements" bar, same Top / Bottom boxes:
 *
 *   1. The order HAS measurements → print them. Real measurements always win;
 *      they are what the customer was actually measured to.
 *   2. It does not, but it has a STANDARD SIZE (every Shopify order) → fill
 *      them from the house size chart, exactly as the retail order form
 *      auto-fills when an associate picks a size. A web "L" and a store "L"
 *      are the same garment and now print the same work order.
 *   3. Neither → print nothing at all.
 *
 * Case 3 is why the heading lives in here. The gold bar used to render inline
 * and UNCONDITIONALLY while MeasurementsDisplay returned null when empty, so an
 * order with nothing to show printed a heading over blank space.
 *
 * The test is on the DATA, not the channel: a retail order with no stored
 * measurements but a standard size gets the chart values too, which is right —
 * that is what it was ordered as.
 *
 * Both Document branches call this one component — the same consolidation
 * InfoGrid received, and for the same reason: these two blocks were duplicated
 * verbatim and duplicated blocks in this file have already drifted once.
 */
const MeasurementsSection = ({ item, isAlteration }) => {
  const stored = populatedMeasurementCategories(item?.measurements).length > 0;

  // Only consult the chart when nothing was measured. Yields {} for Custom /
  // Free Size / kids ages / unknown sizes, which collapses the whole section.
  const measurements = stored
    ? item.measurements
    : standardSizeMeasurementsByCategory(item);

  if (populatedMeasurementCategories(measurements).length === 0) {
    return null;
  }

  return (
    <>
      <View style={warehouseStyles.measurementsBar}>
        <Text style={warehouseStyles.sectionTitle}>
          {isAlteration ? "Updated Body Measurements" : "Body Measurements"}
        </Text>
      </View>
      <MeasurementsDisplay measurements={measurements} />
    </>
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
const WarehouseOrderPdf = ({ order, item, itemIndex = 0, totalItems = 1, logoUrl, masterBarcodeImage = null, componentBarcodes = [], resolvedClientName = "" }) => {
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
  // For B2B orders, delivery_name is empty; caller resolves the vendor brand
  // and passes it as resolvedClientName. Falls back to delivery_name for retail.
  const clientNameForHeader = resolvedClientName || order.delivery_name;
  const notes = mergeOrderNotes(order, item);
  const hasNotes = notes && notes.trim() !== "";

  return (
    <Document>
      {/* If we have component barcodes, one page per component */}
      {SHOW_BARCODES && componentBarcodes && componentBarcodes.length > 0 ? (
        componentBarcodes.map((comp, compIdx) => (
          <Page key={compIdx} size="A4" style={warehouseStyles.page}>
            {/* Header Row - Logo and Master Barcode */}
            <View style={warehouseStyles.headerRow}>
              <View style={warehouseStyles.logoSection}>
                {logoUrl && <Image src={logoUrl} style={warehouseStyles.logo} />}
              </View>
              <View style={warehouseStyles.barcodeSection}>
                <Text style={warehouseStyles.barcodeLabel}>Master</Text>
                {masterBarcodeImage ? (
                  <Image src={masterBarcodeImage} style={{ width: 150, height: 60 }} />
                ) : (
                  <View style={warehouseStyles.barcodePlaceholder}>
                    <Text style={warehouseStyles.barcodeText}>{order.order_no || " "}</Text>
                  </View>
                )}
              </View>
            </View>

            {/* Title Row with Product & Component Indicator */}
            <View style={warehouseStyles.titleRow}>
              <Text style={isAlteration ? warehouseStyles.titleAlteration : warehouseStyles.title}>
                {isAlteration ? "Alteration Order Copy" : order.is_gifting ? "Gift - Warehouse Order Copy" : "Warehouse Order Copy"}
              </Text>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={warehouseStyles.productIndicator}>
                  Product {itemIndex + 1} of {totalItems}
                </Text>
                <Text style={{ fontSize: 12, fontFamily: "Helvetica-Bold", color: COLORS.gold, marginTop: 2 }}>
                  {comp.label} ({compIdx + 1} of {componentBarcodes.length})
                </Text>
              </View>
            </View>

            {/* Gifting Order Banner */}
            {order.is_gifting && (
              <View style={warehouseStyles.giftingBanner}>
                <Text style={warehouseStyles.giftingBannerText}>🎁 GIFTING ORDER</Text>
                {order.gift_recipient_name && (
                  <Text style={warehouseStyles.giftingRecipientText}>
                    Gift For: {order.gift_recipient_name}
                  </Text>
                )}
              </View>
            )}

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
            <InfoGrid rows={buildInfoRows({ order, item, clientNameForHeader, itemDeliveryDate, isUrgent, isAlteration })} />

            {/* Product Details Section */}
            <SectionBar title="Product Details" isAlteration={isAlteration} />
            <ProductItem item={item} />

            {/* Notes Section */}
            {hasNotes && (
              <View style={warehouseStyles.commentsSection}>
                <Text style={warehouseStyles.commentsLabel}>Notes:</Text>
                <View style={warehouseStyles.commentsBox}>
                  <Text style={warehouseStyles.commentsText}>{notes}</Text>
                </View>
              </View>
            )}

            {/* Measurements. Heading and body live in ONE component so they
                can't disagree — renders nothing at all when there are none
                (e.g. Shopify), instead of a heading over blank space. */}
            <MeasurementsSection item={item} isAlteration={isAlteration} />

            {/* Component barcode — rendered IN-FLOW (not `fixed`/absolute) so it
                sits under the component's details and never duplicates onto an
                overflow page. We let it flow naturally (no wrap={false}) so it
                fills the remaining space on the page rather than being pushed
                whole to the next page, which would leave a large gap. */}
            <View style={warehouseStyles.componentBarcode}>
              <Text style={{ fontSize: 14, fontFamily: "Helvetica-Bold", marginBottom: 8, color: COLORS.gold }}>
                {comp.label}
              </Text>
              {comp.image ? (
                <Image src={comp.image} style={{ width: 200, height: 60 }} />
              ) : (
                <View style={warehouseStyles.barcodeItemBox}>
                  <Text style={warehouseStyles.barcodeText}>{comp.barcode}</Text>
                </View>
              )}
            </View>
          </Page>
        ))
      ) : (
        /* Fallback: single page with placeholder barcodes (for old orders without components) */
        <Page size="A4" style={warehouseStyles.page}>
          {/* Header Row - Logo and Master Barcode */}
          <View style={warehouseStyles.headerRow}>
            <View style={warehouseStyles.logoSection}>
              {logoUrl && <Image src={logoUrl} style={warehouseStyles.logo} />}
            </View>
            {SHOW_BARCODES && (
              <View style={warehouseStyles.barcodeSection}>
                <Text style={warehouseStyles.barcodeLabel}>Master</Text>
                <View style={warehouseStyles.barcodePlaceholder}>
                  <Text style={warehouseStyles.barcodeText}>{order.order_no || " "}</Text>
                </View>
              </View>
            )}
          </View>

          {/* Title Row */}
          <View style={warehouseStyles.titleRow}>
            <Text style={isAlteration ? warehouseStyles.titleAlteration : warehouseStyles.title}>
              {isAlteration ? "Alteration Order Copy" : order.is_gifting ? "Gift - Warehouse Order Copy" : "Warehouse Order Copy"}
            </Text>
            <Text style={warehouseStyles.productIndicator}>
              Product {itemIndex + 1} of {totalItems}
            </Text>
          </View>

          {/* Gifting Order Banner */}
          {order.is_gifting && (
            <View style={warehouseStyles.giftingBanner}>
              <Text style={warehouseStyles.giftingBannerText}>🎁 GIFTING ORDER</Text>
              {order.gift_recipient_name && (
                <Text style={warehouseStyles.giftingRecipientText}>
                  Gift For: {order.gift_recipient_name}
                </Text>
              )}
            </View>
          )}

          {/* Parent Order Reference (for alterations) */}
          {isAlteration && order.parent_order_no && (
            <View style={warehouseStyles.parentOrderRef}>
              <Text style={warehouseStyles.parentOrderLabel}>Original Order:</Text>
              <Text style={warehouseStyles.parentOrderValue}>{order.parent_order_no}</Text>
            </View>
          )}

          {/* Alteration Info Box */}
          {isAlteration && <AlterationInfoBox order={order} />}

          {/* Order Info Grid — the SAME component as the per-component branch
              above. This block used to be duplicated verbatim across both
              Document branches, and had already drifted (one said "SHOPIFY
              ORDER NO:", the other still "WEBSITE ORDER:"). One shared
              InfoGrid/buildInfoRows makes that drift impossible. */}
          <InfoGrid rows={buildInfoRows({ order, item, clientNameForHeader, itemDeliveryDate, isUrgent, isAlteration })} />

          {/* Product Details */}
          <SectionBar title="Product Details" isAlteration={isAlteration} />
          <ProductItem item={item} />

          {/* Notes */}
          {hasNotes && (
            <View style={warehouseStyles.commentsSection}>
              <Text style={warehouseStyles.commentsLabel}>Notes:</Text>
              <View style={warehouseStyles.commentsBox}>
                <Text style={warehouseStyles.commentsText}>{notes}</Text>
              </View>
            </View>
          )}

          {/* Measurements — same shared component as the branch above. */}
          <MeasurementsSection item={item} isAlteration={isAlteration} />

          {/* Fallback barcodes — in-flow (not `fixed`) so they don't duplicate
              onto an overflow page. */}
          {SHOW_BARCODES && (
            <View style={warehouseStyles.fallbackBarcodes}>
              <BarcodePlaceholder label="Top" />
              <BarcodePlaceholder label="Bottom" />
              {item?.includes_dupatta === true && <BarcodePlaceholder label="Dupatta" />}
              <BarcodePlaceholder label="Extra" />
            </View>
          )}
        </Page>
      )}
    </Document>
  );
};

export default WarehouseOrderPdf;