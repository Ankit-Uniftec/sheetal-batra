import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  Image,
  StyleSheet,
  Font,
} from "@react-pdf/renderer";
import { styles, COLORS } from "./pdfStyles";
import formatPhoneNumber from "../utils/formatPhoneNumber";

// Register Noto Sans font for Rupee symbol support
Font.register({
  family: "NotoSans",
  fonts: [
    {
      src: "https://cdn.jsdelivr.net/npm/@fontsource/noto-sans@4.5.0/files/noto-sans-all-400-normal.woff",
      fontWeight: 400,
    },
    {
      src: "https://cdn.jsdelivr.net/npm/@fontsource/noto-sans@4.5.0/files/noto-sans-all-700-normal.woff",
      fontWeight: 700,
    },
  ],
});

// Helper to safely get string value (never returns empty string)
const safeString = (value, fallback = "—") => {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string") {
    return value.trim() === "" ? fallback : value;
  }
  return String(value) || fallback;
};

// Helper to format Indian numbers with ₹ symbol
const formatINR = (num) => {
  if (!num) return "₹ 0";
  return `₹ ${Number(num).toLocaleString("en-IN")}`;
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

// Helper to format datetime
const formatDateTime = (dateStr) => {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Asia/Kolkata"
  }).replace(/\//g, ".");
  
  // const time = d.toLocaleTimeString("en-GB", {
  //   hour: "2-digit",
  //   minute: "2-digit",
  //   second: "2-digit",
  //   timeZone: "Asia/Kolkata"
  // });
  
  // return `${date}  ${time}`;
};

// Output: "02.02.2026  15:30:00" (correct IST)

const formatPhone = (phone) => {
  if (!phone) return '';
  const cleaned = phone.replace(/^\+?91\s?/, '');
  return `+91 ${cleaned}`;
};

// Get color name from color object
const getColorName = (color) => {
  if (!color) return "—";
  if (typeof color === "string") return color.trim() === "" ? "—" : color;
  if (typeof color === "object" && color.name) {
    return color.name.trim() === "" ? "—" : color.name;
  }
  return "—";
};

// Get color hex from color object
const getColorHex = (color) => {
  if (!color) return "#CCCCCC";
  if (typeof color === "string") return color.startsWith("#") ? color : "#CCCCCC";
  if (typeof color === "object" && color.hex) return color.hex;
  return "#CCCCCC";
};

// Check if color name is valid (not empty)
const hasValidColorName = (color) => {
  if (!color) return false;
  if (typeof color === "object" && color.name) {
    return color.name.trim() !== "";
  }
  return false;
};

// Custom styles for this component
const pdfStyles = StyleSheet.create({
  // Watermark styles - half visible on page edge, maintain aspect ratio
  watermarkRight: {
    position: "absolute",
    right: -340,
    top: "20%",
    width: 700,
    opacity: 0.08,
  },
  watermarkLeft: {
    position: "absolute",
    left: -340,
    top: "20%",
    width: 700,
    opacity: 0.08,
  },
  // Sales Associate section - fixed at bottom
  salesAssociateSection: {
    marginTop: 20,
  },
  // Sales Associate row
  salesAssociateRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 8,
    marginBottom: 8,
  },
  salesNameSection: {
    flexDirection: "row",
    alignItems: "center",
    // flex: 1,
  },
  Namelabel: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    // marginBottom: 2,
  },
  salesTeamText: {
    // flex: 1,
    // textAlign: "right",
    fontSize: 10,
    color: "#333",
  },
  salesPhoneText: {
    // textAlign: "right",
    fontSize: 10,
    color: "#333",
  },
  // Footer styles
  pageFooter: {
    position: "absolute",
    bottom: 20,
    left: 40,
    right: 40,
  },
  footerDivider: {
    borderTopWidth: 1,
    borderTopColor: "#E0E0E0",
    marginBottom: 8,
  },
  footerText: {
    fontSize: 8,
    color: "#666",
    textAlign: "center",
    fontStyle: "italic",
  },
  // Contact section (above footer)
  contactSection: {
    marginTop: 10,
    marginBottom: 10,
  },
  contactText: {
    fontSize: 9,
    color: "#666",
    textAlign: "left",
    marginBottom: 4,
    fontStyle: "italic",
  },
  // INR text with font
  inrText: {
    fontFamily: "NotoSans",
  },
});

// Section Header Component
const SectionBar = ({ title }) => (
  <View style={styles.sectionBar}>
    <Text style={styles.sectionTitle}>{title}</Text>
  </View>
);

// Field Component
const Field = ({ label, value, style }) => (
  <View style={[styles.fieldBlock, style]}>
    <Text style={styles.label}>{label}</Text>
    <Text style={[styles.value, pdfStyles.inrText]}>{safeString(value)}</Text>
  </View>
);

// Color Field Component
const ColorField = ({ label, color }) => (
  <View style={styles.fieldBlock}>
    <Text style={styles.label}>{label}</Text>
    <View style={styles.colorRow}>
      <View style={[styles.colorSwatch, { backgroundColor: getColorHex(color) }]} />
      <Text style={styles.value}>{getColorName(color)}</Text>
    </View>
  </View>
);

// Product Item Component
const ProductItem = ({ item, order, showPricing = true }) => {
  const category = item?.category || (item?.isKids ? "Kids" : "Women");
  const hasTop = item?.top && item.top.trim() !== "";
  const hasBottom = item?.bottom && item.bottom.trim() !== "";
  const hasExtras = item?.extras && item.extras.length > 0;
  const hasAdditionals = item?.additionals && item.additionals.filter(a => a.name && a.name.trim() !== "").length > 0;

  return (
    <View style={styles.productRow}>
      {item.image_url && (
        <Image src={item.image_url} style={styles.productImage} />
      )}
      <View style={styles.productDetails}>
        {/* Product Name and Delivery Date Row */}
        <View style={styles.rowSpaceBetween}>
          <Text style={styles.productName}>{safeString(item?.product_name)}</Text>
          {order.delivery_date && (
            <View style={{ alignItems: "flex-end" }}>
              <Text style={styles.label}>Delivery Date:</Text>
              <Text style={styles.deliveryDateHighlight}>
                {formatDate(order.delivery_date)}
              </Text>
            </View>
          )}
        </View>

        {/* Product Details Grid */}
        <View style={styles.productGrid}>
          {/* Top - only if present */}
          {hasTop && (
            <View style={[styles.productField, { width: "25%" }]}>
              <Text style={styles.label}>Top</Text>
              <Text style={styles.value}>{safeString(item.top)}</Text>
              {item?.top_color?.hex && (
                <View style={{ flexDirection: "row", alignItems: "center", marginTop: 3 }}>
                  <View style={[styles.colorSwatch, { backgroundColor: item.top_color.hex }]} />
                  {hasValidColorName(item.top_color) && (
                    <Text style={[styles.value, { marginLeft: 4, fontSize: 8 }]}>{item.top_color.name}</Text>
                  )}
                </View>
              )}
            </View>
          )}

          {/* Bottom - only if present */}
          {hasBottom && (
            <View style={[styles.productField, { width: "25%" }]}>
              <Text style={styles.label}>Bottom</Text>
              <Text style={styles.value}>{safeString(item.bottom)}</Text>
              {item?.bottom_color?.hex && (
                <View style={{ flexDirection: "row", alignItems: "center", marginTop: 3 }}>
                  <View style={[styles.colorSwatch, { backgroundColor: item.bottom_color.hex }]} />
                  {hasValidColorName(item.bottom_color) && (
                    <Text style={[styles.value, { marginLeft: 4, fontSize: 8 }]}>{item.bottom_color.name}</Text>
                  )}
                </View>
              )}
            </View>
          )}

          {/* Extras - only if present */}
          {hasExtras && (
            <View style={[styles.productField, { width: "30%" }]}>
              <Text style={styles.label}>Extras</Text>
              {item.extras.map((extra, idx) => (
                <View key={idx} style={{ marginBottom: 2 }}>
                  <Text style={styles.value}>{safeString(extra.name)}</Text>
                  {extra.color?.hex && (
                    <View style={{ flexDirection: "row", alignItems: "center", marginTop: 2 }}>
                      <View style={[styles.colorSwatch, { backgroundColor: extra.color.hex }]} />
                      {hasValidColorName(extra.color) && (
                        <Text style={[styles.value, { marginLeft: 4, fontSize: 8 }]}>{extra.color.name}</Text>
                      )}
                    </View>
                  )}
                </View>
              ))}
            </View>
          )}

          {/* Category */}
          <View style={[styles.productField, { width: "20%" }]}>
            <Text style={styles.label}>Category</Text>
            <Text style={styles.value}>{safeString(category)}</Text>
          </View>
        </View>

        {/* Second Row: Size and Additionals */}
        <View style={styles.productGrid}>
          {/* Size */}
          {item?.size && item.size.trim() !== "" && (
            <View style={[styles.productField, { width: "20%" }]}>
              <Text style={styles.label}>Size</Text>
              <Text style={styles.value}>{safeString(item.size)}</Text>
            </View>
          )}

          {/* Additionals - only if present */}
          {hasAdditionals && (
            <View style={[styles.productField, { width: "50%" }]}>
              <Text style={styles.label}>Additionals</Text>
              {item.additionals.filter(a => a.name && a.name.trim() !== "").map((additional, idx) => (
                <View key={idx} style={{ marginBottom: 2 }}>
                  <Text style={[styles.value, pdfStyles.inrText]}>
                    {safeString(additional.name)} - ₹ {Number(additional.price || 0).toLocaleString("en-IN")}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* Pricing Row */}
        {showPricing && (
          <View style={styles.pricingRow}>
            <View style={styles.pricingField}>
              <Text style={styles.label}>Product Value</Text>
              <Text style={[styles.value, { fontFamily: "NotoSans", fontWeight: 700 }]}>{formatINR(item?.price)}</Text>
            </View>
          </View>
        )}
      </View>
    </View>
  );
};

// Payment Row Component
const PaymentRow = ({ label, value, isTotal = false, prefix = "+" }) => (
  <View style={isTotal ? styles.paymentTotal : styles.paymentRow}>
    <Text style={isTotal ? styles.paymentTotalLabel : styles.paymentLabel}>
      {label}
    </Text>
    <Text style={[isTotal ? styles.paymentTotalValue : styles.paymentValue, pdfStyles.inrText]}>
      {isTotal ? " " : prefix + " "}{formatINR(value)}
    </Text>
  </View>
);

// Watermark Component - uses logoUrl (same image as header logo)
const WatermarkRight = ({ logoUrl }) => {
  if (!logoUrl) return null;
  return <Image src={logoUrl} style={pdfStyles.watermarkRight} />;
};

const WatermarkLeft = ({ logoUrl }) => {
  if (!logoUrl) return null;
  return <Image src={logoUrl} style={pdfStyles.watermarkLeft} />;
};

// Page Footer Component
const PageFooter = () => (
  <View style={pdfStyles.pageFooter} fixed>
    <View style={pdfStyles.footerDivider} />
    <Text style={pdfStyles.footerText}>
      Incase of any issues or escalations, please email us at: foundersoffice@sheetalbatra.com
    </Text>
  </View>
);

// Safe JSON parse for payment mode
const parsePaymentMode = (paymentMode) => {
  if (!paymentMode) return null;
  try {
    const parsed = JSON.parse(paymentMode);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
    return null;
  } catch (e) {
    return null;
  }
};

// Main Customer PDF Document
const CustomerOrderPdf = ({ order, logoUrl }) => {
  if (!order) {
    console.error("CustomerOrderPdf received an undefined or null order prop.");
    return <Document><Page size="A4" style={styles.page}><Text>Error: Order data is missing.</Text></Page></Document>;
  }

  const grandTotal = Number(order.grand_total) || 0;
  const discountAmount = Number(order.discount_amount) || 0;
  const advancePayment = Number(order.advance_payment) || 0;
  const collectorsCode = Number(order.collectors_code) || 0;
  const storeCreditUsed = Number(order.store_credit_used) || 0;
  const netTotal = grandTotal - discountAmount - collectorsCode;
  const remaining = netTotal - advancePayment - storeCreditUsed;

  // GST Calculation (flat 18% deduction)
  const gstAmount = Math.round(grandTotal * 0.18);
  const baseAmount = grandTotal - gstAmount;

  // Helper to get billing address
  const getBillingAddress = () => {
    if (order.billing_same) {
      const addr = [
        order.delivery_address,
        order.delivery_city,
        order.delivery_state,
        order.delivery_pincode,
      ].filter(v => v && String(v).trim() !== "").join(", ");
      return addr || "—";
    }
    const addr = [
      order.billing_address,
      order.billing_city,
      order.billing_state,
      order.billing_pincode,
    ].filter(v => v && String(v).trim() !== "").join(", ");
    return addr || "—";
  };

  // Helper to get delivery address
  const getDeliveryAddress = () => {
    if (order.delivery_address) {
      const addr = [
        order.delivery_address,
        order.delivery_city,
        order.delivery_state,
        order.delivery_pincode,
      ].filter(v => v && String(v).trim() !== "").join(", ");
      if (addr) return addr;
    }

    if (order.mode_of_delivery === "Delhi Store") {
      return "S-208, Greater Kailash II, Basement, New Delhi, Delhi 110048";
    }
    if (order.mode_of_delivery === "Ludhiana Store") {
      return "S.C.O no. 22, Sun View Plaza Ludhiana, Punjab 142027";
    }
    return "—";
  };

  return (
    <Document>
      {/* PAGE 1 - Personal Details, Product Details, Sales Associate */}
      <Page size="A4" style={[styles.page, { paddingBottom: 140 }]}>
        {/* Watermark - Right side (half visible) */}
        <WatermarkRight logoUrl={logoUrl} />

        {/* Header with Logo */}
        <View style={styles.header}>
          {logoUrl && <Image src={logoUrl} style={styles.logo} />}
        </View>

        {/* Title Section */}
        <View style={styles.titleSection}>
          <Text style={styles.title}>Order Copy</Text>
          <View style={styles.orderInfo}>
            <Text style={styles.orderId}>Order ID: {safeString(order.order_no || order.order_id)}</Text>
            <Text style={styles.orderDate}>{formatDateTime(order.created_at)}</Text>
          </View>
        </View>

        {/* Personal Details */}
        <SectionBar title="Personal Details" />
        <View style={styles.rowSpaceBetween}>
          <Text style={styles.value}>{safeString(order.delivery_name)}</Text>
          {order.delivery_email?.trim() && (
            <Text style={styles.value}>{order.delivery_email}</Text>
          )}
        </View>
        <View style={styles.fieldBlock}>
          <Text style={[styles.label, { marginTop: 10 }]}>Delivery Address:</Text>
          <Text style={styles.value}>{getDeliveryAddress()}</Text>
        </View>
        {order.delivery_phone?.trim() && (
          <View style={{ alignItems: "flex-end", marginTop: -30 }}>
            <Text style={styles.value}>{order.delivery_phone}</Text>
          </View>
        )}

        {/* Product Details */}
        <SectionBar title="Product Details" />
        <View wrap>
          {(order.items || []).map((item, index) => (
            <ProductItem
              key={index}
              item={item}
              order={order}
              showPricing={true}
            />
          ))}
        </View>

        {/* Sales Associate Details - Fixed at bottom */}
        <View style={pdfStyles.salesAssociateSection}>
          <SectionBar title="Sales Associate Details" />
          <View style={pdfStyles.salesAssociateRow}>
            {/* Name - Left */}
            <View style={pdfStyles.salesNameSection}>
              {order.salesperson?.trim() && (
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <Text style={styles.Namelabel}>Name: </Text>
                  <Text style={styles.value}>{order.salesperson}</Text>
                </View>
              )}
            </View>

            {/* Team - Center/Right */}
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <Text style={pdfStyles.salesTeamText}>In-Store Client Relations Team: </Text>
              {/* Phone - Right */}
              {order.salesperson_phone?.trim() && (
                <Text style={pdfStyles.salesPhoneText}>{formatPhone(order.salesperson_phone)}</Text>
              )}
            </View>
          </View>

          {/* Contact Section */}
          <View style={pdfStyles.contactSection}>
            <Text style={pdfStyles.contactText}>
              Kindly allow our customer care team up to 8 hours to thoughtfully
              assist you with your query.
            </Text>
          </View>
        </View>

        {/* Page Footer */}
        <PageFooter />
      </Page>

      {/* PAGE 2 - Billing, Payment, Signature, Notes, Policy */}
      <Page size="A4" style={styles.page}>
        {/* Watermark - Left side (half visible) */}
        <WatermarkLeft logoUrl={logoUrl} />

        {/* Header with Logo */}
        <View style={styles.header}>
          {logoUrl && <Image src={logoUrl} style={styles.logo} />}
        </View>

        {/* Title Section */}
        <View style={styles.titleSection}>
          <Text style={styles.title}>Order Copy</Text>
          <View style={styles.orderInfo}>
            <Text style={styles.orderId}>Order ID: {safeString(order.order_no || order.order_id)}</Text>
            <Text style={styles.orderDate}>{formatDateTime(order.created_at)}</Text>
          </View>
        </View>

        {/* Billing Details */}
        <SectionBar title="Billing Details" />
        <View style={styles.twoColumn}>
          <View style={styles.column}>
            {(order.billing_company || order.delivery_name) && (
              <Field
                label="Company / Individual Name:"
                value={order.billing_company || order.delivery_name}
              />
            )}
            {order.billing_gstin?.trim() && (
              <Field label="GSTIN:" value={order.billing_gstin} />
            )}
            <View style={styles.fieldBlock}>
              <Text style={styles.label}>Billing Address</Text>
              <Text style={styles.value}>{getBillingAddress()}</Text>
            </View>
          </View>
          <View style={styles.column}>
            {order.payment_mode?.trim() && (
              <View style={styles.fieldBlock}>
                <Text style={styles.label}>Mode of Payment:</Text>
                {order.is_split_payment && parsePaymentMode(order.payment_mode) ? (
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 2 }}>
                    {parsePaymentMode(order.payment_mode).map((sp, idx) => (
                      <Text key={idx} style={[styles.value, pdfStyles.inrText, {
                        backgroundColor: "#e3f2fd",
                        padding: "3px 8px",
                        borderRadius: 4,
                        marginRight: 6,
                        marginBottom: 4,
                        fontSize: 9,
                      }]}>
                        {safeString(sp.mode, "Payment")}: ₹ {Number(sp.amount || 0).toLocaleString("en-IN")}
                      </Text>
                    ))}
                  </View>
                ) : (
                  <Text style={styles.value}>{safeString(order.payment_mode)}</Text>
                )}
              </View>
            )}
            {advancePayment > 0 && (
              <Field label="Advance Amount Paid:" value={formatINR(advancePayment)} />
            )}
          </View>
        </View>

        {/* Payment Details */}
        <SectionBar title="Payment Details" />
        <View style={styles.twoColumn}>
          <View style={styles.column}>
            <PaymentRow label="Order Value (excl. GST):" value={baseAmount} prefix="+" />
            <PaymentRow label="GST (18%):" value={gstAmount} prefix="+" />
            {discountAmount > 0 && (
              <PaymentRow label="Discount:" value={discountAmount} prefix="-" />
            )}
            {collectorsCode > 0 && (
              <PaymentRow label="Collectors Code:" value={collectorsCode} prefix="-" />
            )}
            {storeCreditUsed > 0 && (
              <PaymentRow label="Store Credit Applied:" value={storeCreditUsed} prefix="-" />
            )}
            {advancePayment > 0 && (
              <PaymentRow label="Total Advance Paid:" value={advancePayment} prefix="-" />
            )}
            <PaymentRow
              label="Total Pending Amount:"
              value={remaining}
              isTotal={true}
            />
          </View>
          <View style={styles.column}>
            {/* Signature Section */}
            <View style={styles.signatureSection}>
              <Text style={styles.signatureLabel}>Customer Signature</Text>
              {order.signature_url && (
                <Image src={order.signature_url} style={styles.signatureImage} />
              )}
            </View>
          </View>
        </View>

        {/* A Note to You */}
        <View style={styles.noteSection}>
          <Text style={styles.noteTitle}>A Note to You</Text>
          <Text style={styles.noteText}>
            Our pieces are handcrafted with care and created exclusively for you. Each garment is made to order, honouring traditional techniques and thoughtful
            detailing. As with all bespoke creations, minor alterations and up to one trial fit may be part of the process to achieve the best possible fit - every
            body is beautifully unique.
          </Text>
          <Text style={[styles.noteText, { marginTop: 4 }]}>
            We believe true luxury lies in time, craftsmanship, and a fit made just for you.
          </Text>
        </View>

        {/* Policy Section */}
        <View style={[styles.policySection, { marginBottom: 60 }]}>
          <Text style={styles.policyItem}>
            • At Sheetal Batra, we take pride in crafting each piece with care and precision. As we work with a made-to-order and artisanal production timelines, we request you to kindly review the following policy.
          </Text>
          <Text style={styles.policyItem}>
            • You may cancel an order within 24 hours after placing it. No cancellations beyond 24 hours will be entertained barring extenuating circumstances. Any accepted cancellation beyond 24 hours will be exclusively at the discretion of Sheetal Batra Design House. A cancelled order will result in store credit only.
          </Text>
          <Text style={styles.policyItem}>
            • Articles on sale cannot be exchanged or returned.
          </Text>
          <Text style={styles.policyItem}>
            • Customisation requests can be accepted (such as bottom style change, color change, sleeve length change). These products are then on final sale and cannot be returned. Such requests must be pre-paid and COD cannot be accepted as a form of payment in that case.
          </Text>
          <Text style={styles.policyItem}>
            • The accessories including jewelry, potlis and jutties cannot be exchanged or returned.
          </Text>
          <Text style={styles.policyItem}>
            • Return & Exchange Window: You must raise a return or exchange request within 72 hours of receiving your order. We do not accept requests beyond this window. Valid reasons are subject to approval.
          </Text>
          <Text style={styles.policyItem}>
            • For a valid exchange: The products must be unused, and in perfect condition, with all original tags intact.
          </Text>
        </View>

        {/* Page Footer */}
        <PageFooter />
      </Page>
    </Document>
  );
};

export default CustomerOrderPdf;