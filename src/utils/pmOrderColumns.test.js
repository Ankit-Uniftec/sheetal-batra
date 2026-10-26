import { PM_ORDER_COLUMNS } from "./pmOrderColumns";

const fs = require("fs");
const path = require("path");

// Every column of `orders` (live, 26 Oct 2026).
const ALL_ORDER_COLUMNS = `id user_id items status comments admin_notes created_at updated_at mode_of_delivery order_flag delivery_date billing_same billing_address billing_company billing_gstin salesperson salesperson_phone salesperson_email delivery_name delivery_email delivery_phone delivery_address delivery_city delivery_state delivery_pincode subtotal taxes grand_total total_quantity attachments signature_url advance_payment discount_amount discount_percent grand_total_after_discount net_total remaining_payment urgent_reason billing_country cod_charge delivery_country payment_mode shipping_charge delivery_notes billing_date expected_delivery join_date customer_url warehouse_url order_no order_type cancellation_reason cancelled_at exchange_reason exchange_requested_at delivered_at is_split_payment warehouse_urls revoked_at return_reason refund_reason refund_status store_credit_used is_gift_certificate parent_order_id parent_item_index is_alteration alteration_number alteration_type alteration_location alteration_notes alteration_attachments salesperson_store payment_order_type is_b2b vendor_id po_number b2b_order_type approval_status approved_by approved_at rejection_reason submitted_for_approval_at markdown_percent markdown_amount merchandiser_name credit_limit_exceeded credit_approval_required production_status production_notes is_gifting gift_recipient_name gift_recipient_contact exchange_new_value exchange_value_difference exchange_credit_issued returned_items loyalty_points_earned loyalty_points_redeemed loyalty_discount credit_exceeded in_production_at in_production_by ready_for_dispatch_at ready_for_dispatch_by dispatched_at dispatched_by priority notes warehouse_stage rejourney_count warehouse_stage_updated_at qc_fail_reason qc_fail_outcome is_rework order_notes discount_code is_private_order is_stock_order exb_name sb_representative_name is_comms comms_request_source comms_profile_type comms_agency_name comms_engagement_type comms_purpose comms_poc_name comms_outfit_return_date comms_order_assign comms_existing_product_location comms_challan_no comms_return_status comms_return_condition comms_return_new_location comms_return_damage_notes delivered_address exhibition_id net_sb_revenue delivered_mode_of_delivery shopify_order_id shopify_synced_at shopify_raw web_order_status web_order_issues shopify_order_name shopify_financial_status shopify_tags total_paid manual_line_breakdown manual_line_breakdown_by manual_line_breakdown_at production_head_designation dupatta_credit_issued review_cleared_at shopify_store shopify_created_at_local shopify_timezone`.split(/\s+/);

// The PM screen and every module it hands orders to (the PDF / Edit / Cancel
// paths load the full row instead, so they are not listed).
const SCANNED_FILES = [
  "src/components/B2B/ProductionManagerDashboard/ProductionManagerDashboard.jsx",
  "src/utils/productionMetrics.js", "src/utils/revenue.js", "src/utils/barcodeService.js",
  "src/utils/warehouseDate.js", "src/utils/manualComplete.js", "src/hooks/useHalfMadeSuggestions.js",
  "src/utils/halfMade.js", "src/components/HalfMadeSuggestion.jsx", "src/components/CompletePicker.jsx",
  "src/components/StageCountCards.jsx", "src/components/VendorDelays/VendorDelaysTab.jsx",
  "src/utils/vendorDelays.js", "src/components/ComponentJourneyModal.jsx",
  "src/components/stock/StockPanel.jsx", "src/utils/stockVisibility.js",
  "src/components/ProductionOverrides.jsx", "src/utils/itemCategory.js", "src/utils/scanReport.js",
];

// Named in those files but deliberately NOT loaded (only mentioned in comments
// explaining why it is skipped).
const NEVER_LOADED = new Set(["shopify_raw"]);

test("every order column the PM screen reads is loaded", () => {
  const words = new Set();
  SCANNED_FILES.forEach((f) => {
    const src = fs.readFileSync(path.join(process.cwd(), f), "utf8");
    (src.match(/\b[a-z][a-z0-9_]*\b/g) || []).forEach((w) => words.add(w));
  });
  const referenced = ALL_ORDER_COLUMNS.filter((c) => words.has(c) && !NEVER_LOADED.has(c));
  const missing = referenced.filter((c) => !PM_ORDER_COLUMNS.includes(c));
  expect(missing).toEqual([]);
});

test("only real order columns are listed, once each", () => {
  expect(PM_ORDER_COLUMNS.filter((c) => !ALL_ORDER_COLUMNS.includes(c))).toEqual([]);
  expect(new Set(PM_ORDER_COLUMNS).size).toBe(PM_ORDER_COLUMNS.length);
  expect(PM_ORDER_COLUMNS).not.toContain("shopify_raw");
});
