import config from "../config/config";

/**
 * Send a WhatsApp template message to a customer via Spur
 * 
 * @param {object} options
 * @param {string} options.customerName - Customer's name
 * @param {string} options.customerPhone - Customer's phone number
 * @param {string} options.customerCountry - Customer's country (default: "India")
 * @param {string} options.template - Spur template name
 * @param {string} options.pdfUrl - Optional PDF URL for button
 */
export const sendWhatsApp = async ({
  customerName,
  customerPhone,
  customerCountry = "India",
  template,
  pdfUrl = null,
}) => {
  if (!customerName || !customerPhone || !template) {
    console.warn("⚠️ WhatsApp skipped — missing customerName, customerPhone, or template");
    return null;
  }

  try {
    const response = await fetch(
      `${config.SUPABASE_URL}/functions/v1/spur-whatsapp`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": config.SUPABASE_KEY,
          "Authorization": `Bearer ${config.SUPABASE_KEY}`,
        },
        body: JSON.stringify({
          customerName,
          customerPhone,
          customerCountry,
          template,
          pdfUrl,
        }),
      }
    );

    const result = await response.json();

    if (!result.success) {
      console.error("❌ WhatsApp send failed:", result.error);
      return null;
    }

    console.log(`✅ WhatsApp sent: ${template} → ${customerPhone}`);
    return result;
  } catch (err) {
    console.error("❌ WhatsApp error:", err);
    return null;
  }
};

// Template constants
export const WA_TEMPLATES = {
  OORDER_PLACED: "store_orderplaced_dev",
  ALTERATION: "store_alteration",
  STORE_CREDIT: "store_credit_issued",
  ORDER_CANCELLED: "store_order_cancelled",
  ORDER_EDITED: "store_order_edited",
};