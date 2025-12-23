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

// Helper to format Indian numbers
const formatINR = (num) => {
  if (!num) return "INR 0";
  return `INR ${Number(num).toLocaleString("en-IN")}`;
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
  const date = d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).replace(/\//g, ".");
  const time = d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  return `${date}  ${time}`;
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
    <Text style={styles.value}>{value || "—"}</Text>
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
const ProductItem = ({ item, showPricing = true }) => (
  <View style={styles.productRow}>
    {item.image_url && (
      <Image src={item.image_url} style={styles.productImage} />
    )}
    <View style={styles.productDetails}>
      <View style={styles.rowSpaceBetween}>
        <Text style={styles.productName}>{item?.product_name || "—"}</Text>
        {item?.delivery_date && (
          <View>
            <Text style={styles.label}>Estimated Delivery Date:</Text>
            <Text style={styles.deliveryDateHighlight}>
              {formatDate(item.delivery_date)}
            </Text>
          </View>
        )}
      </View>

      <View style={styles.productGrid}>
        <View style={styles.productField}>
          <Text style={styles.label}>Top</Text>
          <Text style={styles.value}>{item?.top || "—"}</Text>
        </View>
        <View style={styles.productField}>
          <Text style={styles.label}>Bottom</Text>
          <Text style={styles.value}>{item?.bottom || "—"}</Text>
        </View>
        <View style={styles.productField}>
          <Text style={styles.label}>Additionals</Text>
          <Text style={styles.value}>
            {item?.extras?.map((e) => e?.name).filter(Boolean).join(", ") || "—"}
          </Text>
        </View>
        {/* <View style={styles.productField}>
          <Text style={styles.label}>Color</Text>
          <View style={styles.colorRow}>
            <View
              style={[
                styles.colorSwatch,
                { backgroundColor: getColorHex(item.color) },
              ]}
            />
            <Text style={styles.value}>{getColorName(item.color)}</Text>
          </View>
        </View> */}
        <View style={styles.productField}>
          <Text style={styles.label}>Size</Text>
          <Text style={styles.value}>{item?.size || "—"}</Text>
        </View>
      </View>

      {showPricing && (
        <View style={styles.pricingRow}>
          <View style={styles.pricingField}>
            <Text style={styles.label}>Product Value</Text>
            <Text style={styles.value}>{formatINR(item?.price)}</Text>
          </View>
          <View style={styles.pricingField}>
            <Text style={styles.label}>Discount Value</Text>
            <Text style={styles.value}>{formatINR(item?.discount || 0)}</Text>
          </View>
          <View style={styles.pricingField}>
            <Text style={styles.label}>Final Value</Text>
            <Text style={styles.value}>
              {formatINR((item?.price || 0) - (item?.discount || 0))}
            </Text>
          </View>
        </View>
      )}
    </View>
  </View>
);

// Payment Row Component
const PaymentRow = ({ label, value, isTotal = false, prefix = "+" }) => (
  <View style={isTotal ? styles.paymentTotal : styles.paymentRow}>
    <Text style={isTotal ? styles.paymentTotalLabel : styles.paymentLabel}>
      {label}
    </Text>
    <Text style={isTotal ? styles.paymentTotalValue : styles.paymentValue}>
      {isTotal ? "" : prefix + "  "}{formatINR(value)}
    </Text>
  </View>
);

// Main Customer PDF Document
const CustomerOrderPdf = ({ order, logoUrl }) => {
  if (!order) {
    console.error("CustomerOrderPdf received an undefined or null order prop.");
    return <Document><Page size="A4" style={styles.page}><Text>Error: Order data is missing.</Text></Page></Document>;
  }

  const items = order.items || [];
  const grandTotal = Number(order.grand_total) || 0;
  const discountAmount = Number(order.discount_amount) || 0;
  const advancePayment = Number(order.advance_payment) || 0;
  const netTotal = Number(order.net_total) || grandTotal;
  const remaining = Number(order.remaining_payment) || 0;

  return (
    <Document>
      {/* PAGE 1 - Personal Details, Product Details, Sales Associate */}
      <Page size="A4" style={styles.page}>
        {/* Header with Logo */}
        <View style={styles.header}>
          {logoUrl && <Image src={logoUrl} style={styles.logo} />}
          {/* <Text style={styles.brandName}>S H E E T A L   B A T R A</Text> */}
        </View>

        {/* Title Section */}
        <View style={styles.titleSection}>
          <Text style={styles.title}>Order Copy</Text>
          <View style={styles.orderInfo}>
            <Text style={styles.orderId}>Order ID: {order.id || order.order_id || "—"}</Text>
            <Text style={styles.orderDate}>{formatDateTime(order.created_at)}</Text>
          </View>
        </View>

        {/* Personal Details */}
        <SectionBar title="Personal Details" />
        <View style={styles.rowSpaceBetween}>
          <Text style={styles.value}>{order.delivery_name || "—"}</Text>
          <Text style={styles.value}>{order.delivery_email || "—"}</Text>
        </View>
        <View style={styles.fieldBlock}>
          <Text style={[styles.label, { marginTop: 10 }]}>Delivery Address:</Text>
          <Text style={styles.value}>
            {[
              order.delivery_address,
              order.delivery_city,
              order.delivery_state,
              order.delivery_pincode,
            ]
              .filter(Boolean)
              .join(", ") || "—"}
          </Text>
        </View>
        <View style={{ alignItems: "flex-end", marginTop: -30 }}>
          <Text style={styles.value}>{order.delivery_phone || "—"}</Text>
        </View>

        {/* Product Details */}
        <SectionBar title="Product Details" />
        {items.map((item, index) => (
          <ProductItem key={index} item={item} showPricing={true} />
        ))}

        {/* Sales Associate Details */}
        <SectionBar title="Sales Associate Details" />
        <View style={styles.rowSpaceBetween}>
          <View style={styles.row}>
            <Text style={styles.label}>Name: </Text>
            <Text style={styles.value}>{order.salesperson || "—"}</Text>
          </View>
          <Text style={styles.value}>In-Store Client Relations Team</Text>
          <Text style={styles.value}>{order.salesperson_phone || "—"}</Text>
        </View>

        {/* Contact Footer */}
        <View style={styles.contactFooter}>
          <Text style={styles.contactText}>
            Kindly allow our customer care team up to 8 hours to thoughtfully
            assist you with your query.
          </Text>
          <Text style={styles.contactEmail}>
            Incase of any issues or escalations, please email us at: foundersoffice@sheetalbatra.com
          </Text>
        </View>
      </Page>

      {/* PAGE 2 - Billing, Payment, Signature, Notes, Policy */}
      <Page size="A4" style={styles.page}>
        {/* Header with Logo */}
        <View style={styles.header}>
          {logoUrl && <Image src={logoUrl} style={styles.logo} />}
          {/* <Text style={styles.brandName}>S H E E T A L   B A T R A</Text> */}
        </View>

        {/* Title Section */}
        <View style={styles.titleSection}>
          <Text style={styles.title}>Order Copy</Text>
          <View style={styles.orderInfo}>
            <Text style={styles.orderId}>Order ID: {order.id || order.order_id || "—"}</Text>
            <Text style={styles.orderDate}>{formatDateTime(order.created_at)}</Text>
          </View>
        </View>

        {/* Billing Details */}
        <SectionBar title="Billing Details" />
        <View style={styles.twoColumn}>
          <View style={styles.column}>
            <Field
              label="Company / Individual Name:"
              value={order.billing_company || order.delivery_name}
            />
            <Field label="GSTIN:" value={order.billing_gstin || "—"} />
            <View style={styles.fieldBlock}>
              <Text style={styles.label}>Billing Address</Text>
              <Text style={styles.value}>
                {order.billing_same
                  ? [
                      order.delivery_address,
                      order.delivery_city,
                      order.delivery_state,
                      order.delivery_pincode,
                    ]
                      .filter(Boolean)
                      .join(", ")
                  : [
                      order.billing_address,
                      order.billing_city,
                      order.billing_state,
                      order.billing_pincode,
                    ]
                      .filter(Boolean)
                      .join(", ") || "—"}
              </Text>
            </View>
          </View>
          <View style={styles.column}>
            <Field
              label="Mode of Payment:"
              value={order.payment_mode || "Card/ Cash/ UPI/ Other"}
            />
            <Field label="Advance Amount Paid:" value={formatINR(advancePayment)} />
          </View>
        </View>

        {/* Payment Details */}
        <SectionBar title="Payment Details" />
        <View style={styles.twoColumn}>
          <View style={styles.column}>
            <PaymentRow label="Total Order Value:" value={grandTotal} prefix="+" />
            <PaymentRow
              label="Taxes (18% GST):"
              value={order.tax_amount || 0}
              prefix="+"
            />
            <PaymentRow label="Discount:" value={discountAmount} prefix="-" />
            <PaymentRow
              label="Collectors Code:"
              value={order.collectors_code || 0}
              prefix="-"
            />
            <PaymentRow label="Total Advance Paid:" value={advancePayment} prefix="-" />
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
            Our pieces are handcrafted with care and created exclusively for you.
            Each garment is made to order, honouring traditional techniques and
            thoughtful detailing. As with all bespoke creations, minor alterations
            and up to one trial fit may be part of the process to achieve the best
            possible fit - every body is beautifully unique.
          </Text>
          <Text style={[styles.noteText, { marginTop: 4 }]}>
            We believe true luxury lies in time, craftsmanship, and a fit made
            just for you.
          </Text>
        </View>

        {/* Policy Section */}
        <View style={styles.policySection}>
          <Text style={styles.policyItem}>
            • At Sheetal Batra, we take pride in crafting each piece with care and
            precision. As we work with a made-to-order and artisanal production
            timelines, we request you to kindly review the following policy.
          </Text>
          <Text style={styles.policyItem}>
            • You may cancel an order within 24 hours after placing it. No
            cancellations beyond 24 hours will be entertained barring extenuating
            circumstances. Any accepted cancellation beyond 24 hours will be
            exclusively at the discretion of Sheetal Batra Design House. A
            cancelled order will result in store credit.
          </Text>
          <Text style={styles.policyItem}>
            • Articles on sale cannot be exchanged or returned.
          </Text>
          <Text style={styles.policyItem}>
            • Customization requests can be accepted (such as bottom style change,
            color change, sleeve length change) but products are then on final sale
            and cannot be returned. Such requests must be pre-paid and COD cannot
            be accepted as a form of payment in that case.
          </Text>
          <Text style={styles.policyItem}>
            • The accessories including jewelry, potlis and jutties cannot be
            exchanged or returned.
          </Text>
          <Text style={styles.policyItem}>
            • We do not accept returns or exchange gift certificates and jewelry,
            once dispatched unless it is a manufacturing defect.
          </Text>
          <Text style={styles.policyItem}>
            • Return & Exchange Window: You must raise a return or exchange request
            within 72 hours of receiving your order. We do not accept requests
            beyond this window.
          </Text>
        </View>
      </Page>
    </Document>
  );
};

export default CustomerOrderPdf;
