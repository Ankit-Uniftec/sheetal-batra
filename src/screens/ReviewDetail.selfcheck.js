/**
 * Self-check for the order-placed PDF/WhatsApp wiring in ReviewDetail.js.
 *
 * Regression guarded: the ORDER_PLACED WhatsApp used to read
 * `insertedOrder.customer_url` — a snapshot taken BEFORE generateAllPdfs wrote
 * that column — so pdfUrl was always null and the client got a message with a
 * dead PDF button (SB-DLC-0926-007853/54/55/60/67, all to +919971834249).
 *
 * Run: node src/screens/ReviewDetail.selfcheck.js
 */
const assert = require("assert");

// Mirrors the post-insert decision in handlePlaceOrder: what gets sent to the
// client, given the row as inserted (URLs still null) and what the PDF step
// returned.
function resolveOrderPlacedSend({ insertedOrder, pdfUrls, sendPdf }) {
  const attachments = [];
  if (pdfUrls?.customer_url) {
    attachments.push({ type: "order_pdf", url: pdfUrls.customer_url });
  }
  pdfUrls?.warehouse_urls?.forEach((url) => attachments.push({ type: "order_pdf", url }));

  const whatsapp = sendPdf && pdfUrls?.customer_url
    ? { pdfUrl: pdfUrls.customer_url }
    : null;

  return { attachments, whatsapp };
}

// The row as returned by .insert().select() — PDF columns are still null here,
// because generateAllPdfs only fills them in afterwards.
const insertedOrder = { id: 1, order_no: "SB-DLC-0926-007853", customer_url: null, warehouse_urls: null };
const CUST = "https://…/SB-DLC-0926-007853_customer.pdf";
const WH = "https://…/SB-DLC-0926-007853_warehouse_1.pdf";

// 1. The actual bug: PDFs generated fine, so the client must get the link even
//    though the inserted snapshot still says null.
{
  const { whatsapp, attachments } = resolveOrderPlacedSend({
    insertedOrder,
    pdfUrls: { customer_url: CUST, warehouse_urls: [WH] },
    sendPdf: true,
  });
  assert.strictEqual(whatsapp?.pdfUrl, CUST, "must send the freshly generated URL, not the stale snapshot");
  assert.deepStrictEqual(attachments.map((a) => a.url), [CUST, WH], "notification carries customer + warehouse PDFs");
}

// 2. PDF generation failed → no WhatsApp at all, rather than a dead button.
{
  const { whatsapp, attachments } = resolveOrderPlacedSend({ insertedOrder, pdfUrls: null, sendPdf: true });
  assert.strictEqual(whatsapp, null, "no PDF means no message (the template's only button is the link)");
  assert.deepStrictEqual(attachments, [], "no attachments when generation failed");
}

// 3. SA chose "No, Skip" (or a stock order) → stays silent even with a good PDF.
{
  const { whatsapp } = resolveOrderPlacedSend({
    insertedOrder,
    pdfUrls: { customer_url: CUST, warehouse_urls: [] },
    sendPdf: false,
  });
  assert.strictEqual(whatsapp, null, "opt-out must be honoured");
}

// 4. Customer PDF failed but a warehouse PDF succeeded → still no client message.
{
  const { whatsapp, attachments } = resolveOrderPlacedSend({
    insertedOrder,
    pdfUrls: { customer_url: null, warehouse_urls: [WH] },
    sendPdf: true,
  });
  assert.strictEqual(whatsapp, null, "warehouse PDF is not a substitute for the customer copy");
  assert.deepStrictEqual(attachments.map((a) => a.url), [WH], "warehouse PDF still reaches production");
}

console.log("✅ ReviewDetail order-placed PDF/WhatsApp self-check passed");
