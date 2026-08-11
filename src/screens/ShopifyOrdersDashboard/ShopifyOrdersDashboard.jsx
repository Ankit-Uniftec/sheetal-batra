import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import config from "../../config/config";
import { fetchAllRows } from "../../utils/fetchAllRows";
// This screen is warehouse-facing, so the date shown is the T-2 production
// deadline, not the customer promise — same rule and same helper as the
// Warehouse and Production Manager dashboards. See utils/warehouseDate.js.
import { getWarehouseDate } from "../../utils/warehouseDate";
import { usePopup } from "../../components/Popup";
import Paginator from "../../components/Paginator";
import Badge from "../../components/Badge";
import NotificationBell from "../../components/NotificationBell";
import SearchByDropdown from "../../components/SearchByDropdown";
import ComponentStageBadge from "../../components/ComponentStageBadge";
import ComponentJourneyModal from "../../components/ComponentJourneyModal";
import ProductionOverview from "../../components/ProductionOverview";
import StageCountCards from "../../components/StageCountCards";
import ProductionHeadVendors from "../../components/ProductionHeadVendors";
import "../../components/ProductionHeadVendors.css";
import QcHistoryTable from "../../components/QcHistoryTable";
import QcHistoryPanel from "../../components/QcHistoryPanel";
import ReJourneyPanel from "../../components/ReJourneyPanel";
import CompletePicker from "../../components/CompletePicker";
import { fetchQcRecords } from "../../utils/qcHistory";
import { fetchReJourneys } from "../../utils/reJourneys";
import { runManualCompleteWithOverride } from "../../utils/manualComplete";
import useTabParam from "../../hooks/useTabParam";
import { usePeriodFilter } from "../../components/PeriodFilter";
import StoreCalendarTab from "../StoreManagerDashboard/StoreCalendarTab";
import { downloadWarehousePdf } from "../../utils/pdfLazy";
import { downloadCsv } from "../../utils/downloadCsv";
import {
  enrichComponentsWithMovements,
  getOrderStatusLabel,
  normalizeOrderStatus,
  classifyComponentForStageCard,
  STAGE_GROUPS,
  PRODUCTION_STAGES,
} from "../../utils/barcodeService";
import formatDate from "../../utils/formatDate";
import Logo from "../../images/logo.png";
import "./ShopifyOrdersDashboard.css";

/**
 * ShopifyOrdersDashboard — Shopify orders placed on sheetalbatraindia.com.
 *
 * A Shopify order is an ORDINARY order that happens to arrive from the website:
 * once ingested it runs the same production flow, warehouse stages, dispatch
 * and delivery as a store / B2B / exhibition order. Ingestion is done by the
 * `shopify-order-sync` edge function (webhook + a reconciliation poll); "Sync
 * now" here triggers the same function manually.
 *
 * ═══ THIS IS A WAREHOUSE-FACING SCREEN ═══════════════════════════════════
 * Its readers are production staff. They need the order number, the garment
 * breakdown and the state of each physical piece — NOT who bought it or what
 * they paid. So, deliberately:
 *
 *   • NO client identity — no name, phone, email or address. Not rendered, and
 *     not even SELECTED (see ORDER_LIST_COLUMNS): data that never reaches the
 *     browser cannot leak through devtools or a later well-meaning edit.
 *   • NO money — no amount, no COD balance, no revenue stat.
 *   • NO order-detail navigation — cards are inert. /order/:id shows the full
 *     customer-facing record, so this screen must not link to it.
 *   • The Calendar passes showClient={false} / showSalesperson={false} to the
 *     shared StoreCalendarTab, whose Client column would otherwise leak a name.
 *
 * If you are about to add an Amount or Client row here, that is the thing this
 * screen exists to not have. Same convention as RetailManagerDashboard's
 * "no PII" orders tab.
 *
 * ═══ IT IS ALSO A PRODUCTION-HEAD SCREEN ════════════════════════════════
 * The Shopify role owns the website channel end-to-end, exactly as the Offline
 * Production Head owns retail on WarehouseDashboard.jsx. So it carries the same
 * production toolset, scoped to Shopify orders: the component/stage Production
 * Overview, per-order QC Report, Mark as Completed, Vendor / External, QC
 * History and Re-journeys. Those surfaces are shared components — do not fork
 * them here; a rule change must land in the shared component so every channel
 * moves together.
 *
 * Layout/naming follow the retail order card (AssociateDashboard) — uppercase
 * header strip, Title-case "Label:" detail rows — minus those two fields.
 * Orders are identified by their order-number prefix, which is the
 * authoritative channel signal app-wide (see barcodeService.js).
 */

const ORDERS_PER_PAGE = 10;

// Shopify orders now mint SB-SHOPIFY-; they used to mint SB-SHOP-, and orders
// already SCANNED under the old prefix deliberately keep it (renaming a scanned
// barcode orphans its history and voids printed labels — see
// db/barcode_system/v2/56_rename_shop_orders.sql). So both must be matched, or
// those orders silently vanish from this screen.
const ORDER_NO_PREFIX_FILTER =
  "order_no.like.SB-SHOPIFY-%,order_no.like.SB-SHOP-%";

// Tab order mirrors the retail order dashboard's sidebar (Overview → orders →
// calendar → vendor/QC tools) so someone who works both screens finds the same
// things in the same place.
const TABS = [
  { key: "overview", label: "Overview" },
  { key: "orders", label: "Orders" },
  { key: "needs-review", label: "Needs Review" },
  { key: "calendar", label: "Calendar" },
  { key: "vendors", label: "Vendor / External" },
  { key: "qc-history", label: "QC History" },
  { key: "rejourneys", label: "Re-journeys" },
];

// Warehouse-relevant lookups only. Client Name and Phone are deliberately NOT
// offered: finding an order by customer is exactly the lookup this screen must
// not provide. Barcode is here because matching a physical tag to an order is
// the floor's real need.
const SEARCH_FIELDS = [
  { value: "order_no", label: "Order Number" },
  { value: "shopify_order_name", label: "Shopify Order No" },
  { value: "product", label: "Product" },
  { value: "barcode", label: "Barcode" },
];

// Only the columns this screen reads.
//
// Every customer-identity and money column is deliberately absent —
// delivery_name/email/phone/city, grand_total, net_total,
// grand_total_after_discount, advance_payment, remaining_payment, payment_mode.
// This is the substantive half of "hide the client details": not selecting them
// means they never reach the client at all.
//
// (The warehouse PDF re-fetches the full row by id on click via
// pdfUtils.fetchFullOrder, so it still gets everything IT needs — the PDF is a
// production document and prints no money.)
// shopify_financial_status / shopify_tags are the ONE payment-related pair this
// screen fetches, and they are deliberately not money: they are the words
// Shopify itself used ("PAID"/"PENDING", "COD"/"COD Confirmed"). Dispatch needs
// to know a parcel is collect-on-delivery; it must still not learn the amount.
// Adding any *_total / *_payment column here would undo the note above.
const ORDER_LIST_COLUMNS = [
  "id", "order_no", "created_at", "delivery_date", "status",
  "total_quantity", "items", "warehouse_stage",
  "warehouse_urls",
  "shopify_order_id", "shopify_order_name", "shopify_synced_at",
  "shopify_financial_status", "shopify_tags",
  "web_order_status", "web_order_issues",
].join(", ");

// ─── Orders tab sorting ────────────────────────────────────────────────────
// "High to low / low to high" is by QUANTITY, not price. This screen does not
// fetch money at all (see the header note), so an amount sort is not something
// it can honestly offer — units are the magnitude the warehouse actually reads.
const SORT_OPTIONS = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "qty_desc", label: "Quantity: high to low" },
  { value: "qty_asc", label: "Quantity: low to high" },
  { value: "delivery_asc", label: "Delivery date: soonest" },
  { value: "delivery_desc", label: "Delivery date: latest" },
];

// Sort comparators. Orders with no delivery date sort LAST in both delivery
// directions — an undated order is not "soonest", and letting an empty value
// win the top of the list is how a dateless order gets mistaken for urgent.
const SORTERS = {
  newest: (a, b) => new Date(b.created_at) - new Date(a.created_at),
  oldest: (a, b) => new Date(a.created_at) - new Date(b.created_at),
  qty_desc: (a, b) => (b.total_quantity || 0) - (a.total_quantity || 0),
  qty_asc: (a, b) => (a.total_quantity || 0) - (b.total_quantity || 0),
  delivery_asc: (a, b) => {
    if (!a.delivery_date) return 1;
    if (!b.delivery_date) return -1;
    return new Date(a.delivery_date) - new Date(b.delivery_date);
  },
  delivery_desc: (a, b) => {
    if (!a.delivery_date) return 1;
    if (!b.delivery_date) return -1;
    return new Date(b.delivery_date) - new Date(a.delivery_date);
  },
};

// Raw production_stage enum value -> human label, for the CSV's per-piece
// stage column. PRODUCTION_STAGES includes the legacy entries, so an in-flight
// piece on a removed stage still exports a readable label instead of a raw enum.
const STAGE_LABEL_BY_VALUE = PRODUCTION_STAGES.reduce((m, s) => {
  m[s.value] = s.label;
  return m;
}, {});

// A colour swatch + name, matching OrderDetailPage.jsx:33 and the B2B/Comms
// cards. Colours are stored as { hex, name } objects; tolerate a bare string
// (legacy rows) and a missing hex (a Shopify colour absent from the `colors`
// table still has a real NAME worth showing — just no swatch).
function ColorDot({ color }) {
  if (!color) return null;
  let hex = "";
  let name = "";
  if (typeof color === "string") {
    // Legacy rows store a bare string — either a hex or a name.
    if (color.startsWith("#")) hex = color;
    else name = color;
  } else if (typeof color === "object") {
    name = color.name || "";
    hex = color.hex || "";
  }
  if (!name && !hex) return null;
  return (
    <span className="sho-color">
      {/* Only draw a swatch when the hex is KNOWN. Falling back to grey made a
          "Happy Mustard" garment look grey — a wrong colour on a production
          screen is worse than no colour. The name always shows. */}
      {hex && <span className="sho-color-dot" style={{ backgroundColor: hex }} />}
      {name && <span className="sho-color-name">{name}</span>}
    </span>
  );
}

// Map an order status onto one of Badge's semantic variants.
const statusVariant = (status) => {
  const s = normalizeOrderStatus(status);
  if (s === "delivered" || s === "completed") return "success";
  if (s === "cancelled") return "danger";
  return "info";
};

// ─── Shopify payment state ─────────────────────────────────────────────────
// Shown VERBATIM, never inferred. Whatever word Shopify used is the word on the
// badge, so this screen can't disagree with Shopify admin. (The mapper's older
// isCod derivation treats every PENDING order as COD, which over-matches —
// nothing here depends on it.) Colour-only mapping; unknown states fall through
// to neutral rather than being guessed at.
const paymentVariant = (financialStatus) => {
  const s = String(financialStatus || "").toUpperCase();
  if (s === "PAID") return "success";
  if (s === "PENDING" || s === "PARTIALLY_PAID" || s === "AUTHORIZED") return "warning";
  if (s === "REFUNDED" || s === "VOIDED" || s === "PARTIALLY_REFUNDED") return "danger";
  return "neutral";
};

// The COD-related tags on an order, from the stored array.
//
// `shopify_tags` is a SHARED field: alongside the payment tags it carries
// gateway names (GoKwik, UPI, Cards, Wallets), GoKwik risk scores (Low/Medium/
// High Risk), campaign codes (SB-lxrts_delhi_mumbai_…), call-attempt notes and
// marketing-automation tags. Only the payment ones belong on a warehouse card.
//
// Anchored, NOT a bare /cod/ substring. Live PROD tags include
//   "SW-WhatsApp COD Confirmation & COD to pr"
// — a truncated marketing-automation tag that a substring match would render as
// a COD chip and count as a COD order in the filter. Requiring the tag to START
// with COD keeps the real ones ("COD", "COD Confirmed") and drops that.
//
// Still a pattern rather than a fixed list, so a new payment tag in the same
// shape ("COD Cancelled", …) works with no code change.
const COD_TAG_RE = /^cod\b/i;

const codTags = (order) =>
  (order?.shopify_tags || []).filter((t) => COD_TAG_RE.test(String(t).trim()));

// Does this order carry any COD tag at all? Used by the filter.
const isCodTagged = (order) => codTags(order).length > 0;

// Has a COD order been CONFIRMED? GoKwik adds "COD Confirmed" alongside the
// plain "COD" tag once the customer verifies the order by call or WhatsApp.
// Matched on the whole tag so a bare "COD" can never satisfy it.
const isCodConfirmed = (order) =>
  codTags(order).some((t) => /^cod\s+confirmed\b/i.test(String(t).trim()));

// ─── Payment hold: is this order cleared to be worked on? ──────────────────
//
// The Orders tab is the WORK QUEUE — everything on it is cleared to cut. An
// order whose money is not settled sits in Needs Review until it is, because
// the one irreversible thing here is cutting cloth for an order that is never
// paid for.
//
// Two ways to clear, matching how the business actually takes money:
//   • Prepaid  — Shopify says PAID.
//   • COD      — Shopify says PENDING and stays that way (it collects on
//                delivery, so it never flips to PAID). The confirmation call is
//                what makes it real, so "COD Confirmed" clears it.
//
// Anything else — PENDING with no confirmation, a bare "COD" tag still awaiting
// the call, AUTHORIZED, PARTIALLY_PAID — is held.
//
// REFUNDED / VOIDED / CANCELLED are deliberately NOT holds. Those are
// end-states, not "waiting for money", and an order cancelled mid-production is
// its own operational decision — sweeping it in here would misrepresent it as a
// payment problem.
//
// Reads ONLY Shopify's own words. Nothing here uses the mapper's isCod
// derivation, which treats every PENDING order as COD and over-matches.
const PAYMENT_END_STATES = new Set([
  "REFUNDED", "VOIDED", "PARTIALLY_REFUNDED", "CANCELLED",
]);

const isPaymentHeld = (order) => {
  const s = String(order?.shopify_financial_status || "").toUpperCase();
  // No status at all: nothing to judge. Don't invent a hold — a missing value
  // is a sync gap, not evidence the order is unpaid.
  if (!s) return false;
  if (s === "PAID" || PAYMENT_END_STATES.has(s)) return false;
  // Everything below is money-not-settled. A confirmed COD is the one case the
  // business treats as good to work on despite that.
  return !isCodConfirmed(order);
};

// The single routing rule for the two order tabs. An order is held back from
// the work queue either because it could not be MAPPED (mapper blockers) or
// because its PAYMENT is unsettled. Both land in Needs Review; the card says
// which applies. Every count, filter and tab split reads this one predicate, so
// they can never disagree.
const needsReviewOrder = (order) =>
  order?.web_order_status === "needs_review" || isPaymentHeld(order);

const COD_FILTER_OPTIONS = [
  { value: "all", label: "All orders" },
  { value: "cod", label: "COD only" },
  { value: "non_cod", label: "Non-COD only" },
];

// ─── Needs Review: a SHORT label per mapper blocker code ───────────────────
// One line each, deliberately. An earlier version explained what each code
// blocked and who fixes it in full prose; nobody reads a wall of text on a
// production screen. The mapper's own `detail` already names the offending
// product, so the label only has to say what is missing.
// Informational, not a blocker: every cleanly-mapped order carries it. Shown
// inside the modal as provenance for the delivery date, never as a problem.
const DERIVED_CODE = "DELIVERY_DATE_DERIVED";

const ISSUE_LABELS = {
  DUPATTA_UNKNOWN: "Dupatta unknown — needs custom.has_dupatta in Shopify",
  PRODUCT_STYLE_MISSING: "Garment breakdown missing — needs custom.top_style / bottom_style",
  DELIVERY_DATE_UNRESOLVED: "No delivery date — needs custom.shipping_timeline",
  NO_LINE_ITEMS: "No products on the order",
  CUSTOMER_UNRESOLVED: "No contact details on the order",
  PAYMENT_NOT_CONFIRMED: "Payment not confirmed — do not start production",
};

// A SYNTHETIC issue code. Every other code above is a mapper blocker stored on
// the row in web_order_issues; this one is derived live from Shopify's payment
// state, because payment changes after ingest and must never be frozen into the
// row. Expressing it as an issue lets the hold flow through the existing list,
// filter dropdown and export instead of needing a parallel path of its own.
const PAYMENT_CODE = "PAYMENT_NOT_CONFIRMED";

// The full issue list for an order: the stored mapper blockers PLUS the live
// payment hold. One function so the inline list, the filter dropdown and the
// CSV export all show the same reasons.
const reviewIssues = (order) => {
  const stored = (order?.web_order_issues || []).filter((i) => i.code !== DERIVED_CODE);
  if (!isPaymentHeld(order)) return stored;
  const state = String(order?.shopify_financial_status || "").toUpperCase();
  // Say what Shopify actually reports, so the reason is checkable against
  // Shopify admin rather than being a bare "unpaid".
  const detail = isCodTagged(order)
    ? `COD awaiting confirmation (Shopify: ${state})`
    : `Shopify payment status: ${state}`;
  return [{ code: PAYMENT_CODE, detail }, ...stored];
};

export default function ShopifyOrdersDashboard() {
  const navigate = useNavigate();
  const { showPopup, PopupComponent } = usePopup();

  const [authChecked, setAuthChecked] = useState(false);
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [orders, setOrders] = useState([]);
  const [componentsByOrder, setComponentsByOrder] = useState({});
  const [journeyOrder, setJourneyOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [warehousePdfLoading, setWarehousePdfLoading] = useState(null);
  const [activeTab, setActiveTab] = useTabParam("overview");
  const [showSidebar, setShowSidebar] = useState(false);
  const [searchField, setSearchField] = useState("order_no");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  // Orders-tab filters. Stage is a LIST of STAGE_GROUPS keys (the 10 logical
  // stages), not a raw enum — the floor thinks in "Embroidery", not
  // "embroidery_in_progress"/"embroidery_completed". Multi-select, because
  // "show me everything at Stitching OR Hemming" is the real question; empty =
  // no stage filter.
  const [stageFilter, setStageFilter] = useState([]);
  // Shopify payment state, e.g. ["PAID"] — multi-select like the stage filter.
  const [paymentFilter, setPaymentFilter] = useState([]);
  // "all" | "cod" | "non_cod" — one choice, so a plain string not an array.
  const [codFilter, setCodFilter] = useState("all");
  const [sortBy, setSortBy] = useState("newest");
  const [exporting, setExporting] = useState(false);
  // Which filter popover is open ("stage" | "sort" | null). One at a time, so
  // opening a second closes the first.
  const [openDropdown, setOpenDropdown] = useState(null);

  // Needs Review has its OWN search + issue filter + paging, kept separate from
  // the Orders tab's. Sharing them meant switching tabs silently carried a
  // search across and showed an unexplained empty list.
  const [reviewSearchField, setReviewSearchField] = useState("order_no");
  const [reviewSearch, setReviewSearch] = useState("");
  const [issueFilter, setIssueFilter] = useState("all");
  const [reviewPage, setReviewPage] = useState(1);

  const { control: periodControl, inPeriod } = usePeriodFilter("month", { variant: "pills" });

  // The Orders tab gets its OWN period selection, defaulting to All time. It is
  // a lookup list, not an overview: inheriting the Overview's "This month"
  // would hide older in-production orders the warehouse is still working on.
  // Compact "select" variant so it sits inline in the toolbar with the other
  // dropdowns, and no caption (every neighbouring control is self-describing).
  const { control: ordersPeriodControl, inPeriod: inOrdersPeriod } =
    usePeriodFilter("all", { variant: "select", label: "" });

  // QC report modal — the order whose report is open, plus its qc_records.
  const [qcReportOrder, setQcReportOrder] = useState(null); // { id, order_no }
  const [qcReportRecords, setQcReportRecords] = useState([]);
  const [qcReportLoading, setQcReportLoading] = useState(false);

  // QC History / Re-journeys tabs, both scoped to this screen's Shopify orders.
  const [qcHistory, setQcHistory] = useState([]);
  const [qcHistoryLoading, setQcHistoryLoading] = useState(false);
  const [reJourneys, setReJourneys] = useState([]);
  const [reJourneysLoading, setReJourneysLoading] = useState(false);

  // Mark as Completed — multi-product orders open the picker first.
  const [completePicker, setCompletePicker] = useState(null); // { order, productIdxs }
  const [completing, setCompleting] = useState(null);

  // ── Role guard. PrivateRoute only checks authentication, so every dashboard
  // self-guards on its role (the app's documented two-place convention).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser?.email) { navigate("/login", { replace: true }); return; }
      const { data: sp } = await supabase
        .from("salesperson")
        // NOTE: `saleperson` (one "s") is the real column name — a schema typo.
        .select("role, saleperson")
        .eq("email", authUser.email.toLowerCase())
        .maybeSingle();
      if (cancelled) return;
      if (!sp || sp.role !== "shopify_orders") {
        await supabase.auth.signOut();
        navigate("/login", { replace: true });
        return;
      }
      setUser(authUser);
      setProfile(sp);
      setAuthChecked(true);
    })();
    return () => { cancelled = true; };
  }, [navigate]);

  // NOTE: `showPopup` from usePopup() is NOT memoized — it is a fresh function
  // on every render. Depending on it here would give loadOrders a new identity
  // each render, which the effect below would then re-run, looping forever and
  // hammering Supabase until fetch fails. Keep this callback dependency-free
  // and surface load errors through state instead.
  const loadOrders = useCallback(async () => {
    setLoading(true);
    try {
      // The order-number prefix is the authoritative channel signal.
      const { data, error } = await fetchAllRows("orders", (q) =>
        q.select(ORDER_LIST_COLUMNS)
          .or(ORDER_NO_PREFIX_FILTER)
          .order("created_at", { ascending: false })
      );
      if (error) throw error;
      setOrders(data || []);
      setLoadError(null);

      // Components for those orders — the scannable pieces, one barcode each.
      // Chunked .in() because a single huge id list can silently 400 on URL
      // length (same reason the other dashboards chunk).
      const ids = (data || []).map((o) => o.id);
      if (ids.length) {
        let comps = [];
        for (let i = 0; i < ids.length; i += 100) {
          const { data: chunk, error: compErr } = await supabase
            .from("order_components")
            .select("id, order_id, order_no, barcode, component_type, component_label, current_stage, previous_stage, item_index, is_active, is_rework, is_delayed, qc_status, is_outside_wh, vendor_name, vendor_location, vendor_exit_at, stage_updated_at, re_journey_count, stage_pass_counts")
            .in("order_id", ids.slice(i, i + 100));
          if (compErr) { console.error("Shopify component fetch failed:", compErr); break; }
          comps = comps.concat(chunk || []);
        }
        // Attach stages_outside so the stage badge can read "Out to Vendor (…)"
        // — the one shared helper every dashboard uses for that.
        const enriched = await enrichComponentsWithMovements(comps);
        setComponentsByOrder(
          enriched.reduce((acc, c) => {
            (acc[c.order_id] ||= []).push(c);
            return acc;
          }, {})
        );
      } else {
        setComponentsByOrder({});
      }
    } catch (e) {
      console.error("ShopifyOrdersDashboard: order load failed", e);
      setLoadError(e?.message || "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authChecked) return;
    loadOrders();
  }, [authChecked, loadOrders]);

  // Close an open filter popover on a click outside it. Without this the panel
  // stays open behind whatever you click next, over the order list.
  useEffect(() => {
    if (!openDropdown) return;
    const onDocClick = (e) => {
      // `closest` exists on Elements only — a click landing on a text node (or
      // the document itself) has no closest() and would throw here.
      if (typeof e.target?.closest !== "function") { setOpenDropdown(null); return; }
      if (!e.target.closest(".sho-filter-dropdown")) setOpenDropdown(null);
    };
    // `true` = capture phase, so this runs before a card's own click handler.
    document.addEventListener("click", onDocClick, true);
    return () => document.removeEventListener("click", onDocClick, true);
  }, [openDropdown]);

  // ── Manual pull. Same edge function the webhook and cron poll use, so a
  // duplicate is a harmless no-op (idempotent on shopify_order_id).
  const handleSyncNow = async () => {
    setSyncing(true);
    try {
      const res = await fetch(`${config.SUPABASE_URL}/functions/v1/shopify-order-sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: config.SUPABASE_KEY,
          Authorization: `Bearer ${config.SUPABASE_KEY}`,
        },
        body: JSON.stringify({ mode: "sync-now", first: 25 }),
      });
      const result = await res.json();
      if (!result?.success) throw new Error(result?.error || "Sync failed");
      const parts = Object.entries(result.summary || {})
        .map(([k, v]) => `${v} ${k.replace(/_/g, " ")}`);
      showPopup({
        title: "Sync complete",
        message: parts.length ? parts.join(", ") : "No new orders.",
        type: "success",
      });
      await loadOrders();
    } catch (e) {
      showPopup({ title: "Sync failed", message: e.message, type: "error" });
    } finally {
      setSyncing(false);
    }
  };

  const handleWarehousePdf = async (e, order) => {
    e.stopPropagation();
    setWarehousePdfLoading(order.id);
    try { await downloadWarehousePdf(order, null, true); }
    catch (err) { showPopup({ title: "PDF failed", message: err.message, type: "error" }); }
    finally { setWarehousePdfLoading(null); }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/login");
  };

  // ── QC Report: every QC check (QC 1 + Final QC) recorded against this order's
  // pieces, oldest first so the report reads as the order's QC story. Same query
  // and modal as the retail order dashboard (WarehouseDashboard.jsx:533).
  const openQcReport = async (e, order) => {
    e.stopPropagation();
    setQcReportOrder({ id: order.id, order_no: order.order_no });
    setQcReportLoading(true);
    setQcReportRecords([]);
    try {
      const { data, error } = await supabase
        .from("qc_records")
        .select("id, barcode, component_id, result, which_qc, fail_reason, outcome, rejourney_number, scrap_loss_amount, scrap_location, inspected_by, created_at")
        .eq("order_id", order.id)
        .order("created_at", { ascending: true });
      if (error) throw error;
      setQcReportRecords(data || []);
    } catch (err) {
      console.error("Failed to load QC report:", err);
      setQcReportRecords([]);
    }
    setQcReportLoading(false);
  };

  // ── Mark as Completed.
  //
  // Identical rule to the retail order dashboard: production is finished, the
  // pieces become ready for Packaging & Dispatch. Final QC is MANDATORY and this
  // screen cannot override it — allowOverride stays false (its default), which
  // is the Production Manager's privilege alone (see manualComplete.js). A piece
  // short of Final QC therefore surfaces the RPC's own refusal as an error,
  // rather than an override prompt.
  const runManualComplete = async (order, picked) => {
    setCompleting(order.id);
    try {
      const res = await runManualCompleteWithOverride({
        orderId: order.id,
        by: user?.email || "",
        picked,
      });
      if (res.cancelled) return false;
    } catch (err) {
      showPopup({
        title: "Could not complete",
        message: err.message || "Could not complete the order.",
        type: "error",
      });
      return false;
    } finally {
      setCompleting(null);
    }
    // Reload so the order's status and every piece's stage reflect the change.
    await loadOrders();
    return true;
  };

  const markManualComplete = async (e, order) => {
    e.stopPropagation();
    const components = componentsByOrder[order.id] || [];
    const productIdxs = [...new Set(components.map((c) => c.item_index ?? 0))]
      .sort((a, b) => a - b);

    // Multi-product order → pick which product is finished; one finished product
    // can complete while the others are still in production.
    if (productIdxs.length > 1) {
      setCompletePicker({ order, productIdxs });
      return;
    }
    const ok = await new Promise((resolve) => {
      showPopup({
        type: "confirm",
        title: "Mark as Completed",
        message: `Mark order ${order.order_no} as completed? Its pieces become ready for Packaging & Dispatch. Final QC must have passed on every piece.`,
        confirmText: "Yes, complete it",
        cancelText: "Cancel",
        onConfirm: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });
    if (!ok) return;
    await runManualComplete(order, null);
  };

  // ── CSV export.
  //
  // Exports every order matching the CURRENT filters and search — the whole
  // filtered set, not just the visible page. Exporting page 1 of 30 is the kind
  // of silent truncation someone builds a report on without noticing.
  //
  // NO client and NO money columns, for the same reason the screen doesn't
  // render them: this file leaves the building, so it is the last place to
  // start leaking a customer name or an order value. It carries what the
  // warehouse needs — the two order numbers, dates, quantity, status, the
  // garment breakdown and the state of each physical piece.
  //
  // `rows` is passed in so both tabs share one implementation; the Needs Review
  // export adds an Issues column and drops the pieces (a flagged order's whole
  // point is that its breakdown is incomplete).
  const exportOrdersCsv = (rows, { filename, withIssues = false }) => {
    if (!rows.length) {
      showPopup({ title: "Nothing to export", message: "No orders match the current filters.", type: "info" });
      return;
    }
    setExporting(true);
    try {
      const headers = [
        "Order No", "Shopify Order No", "Order Date", "Warehouse Date (T-2)", "Customer Delivery Date",
        "Status", "Payment", "Tags", "Qty", "Products",
        "Size", "Top", "Bottom", "Dupatta",
        ...(withIssues ? ["Issues"] : ["Pieces", "Piece Stages"]),
      ];

      const colorText = (c) => {
        if (!c) return "";
        if (typeof c === "string") return c.startsWith("#") ? "" : c;
        return c.name || "";
      };
      // "Top" etc. describe the FIRST item; a multi-item order names all its
      // products in Products and carries its full piece list, which is what the
      // floor matches against. Joined with " | " because a comma would read as a
      // column break to anyone eyeballing the raw file.
      const join = (parts) => parts.filter(Boolean).join(" ");

      const dataRows = rows.map((o) => {
        const item = o.items?.[0] || {};
        const comps = componentsByOrder[o.id] || [];
        const base = [
          o.order_no || "",
          o.shopify_order_name || "",
          formatDate(o.created_at) || "",
          getWarehouseDate(o.delivery_date, o.created_at, ""),
          o.delivery_date ? formatDate(o.delivery_date) : "",
          getOrderStatusLabel(o.status),
          // Payment STATE only — Shopify's own word, no amounts. Lets the floor
          // pull a COD dispatch run without money ever entering this screen.
          o.shopify_financial_status || "",
          (o.shopify_tags || []).join(" | "),
          o.total_quantity || 0,
          (o.items || []).map((i) => i.product_name).filter(Boolean).join(" | "),
          item.size || "",
          join([item.top, colorText(item.top_color)]),
          join([item.bottom, colorText(item.bottom_color)]),
          item.includes_dupatta ? join(["Yes", colorText(item.dupatta_color)]) : "No",
        ];
        if (withIssues) {
          return [
            ...base,
            reviewIssues(o)
              .map((i) => `${ISSUE_LABELS[i.code] || i.code}${i.detail ? `: ${i.detail}` : ""}`)
              .join(" | "),
          ];
        }
        return [
          ...base,
          comps.map((c) => c.barcode).filter(Boolean).join(" | "),
          comps
            .map((c) => `${c.component_label || c.component_type}: ${STAGE_LABEL_BY_VALUE[c.current_stage] || c.current_stage || "—"}`)
            .join(" | "),
        ];
      });

      downloadCsv({ filename, headers, rows: dataRows });
    } catch (e) {
      showPopup({ title: "Export failed", message: e.message, type: "error" });
    } finally {
      setExporting(false);
    }
  };

  // ── Derived data
  // The work queue and the review queue are strict complements of ONE
  // predicate, so an order can never appear on both tabs or fall through the
  // gap between them.
  const readyOrders = useMemo(
    () => orders.filter((o) => !needsReviewOrder(o)),
    [orders]
  );
  const needsReview = useMemo(
    () => orders.filter((o) => needsReviewOrder(o)),
    [orders]
  );

  const periodOrders = useMemo(
    () => orders.filter((o) => inPeriod(o.created_at)),
    [orders, inPeriod]
  );

  // Production-shaped stats only. No revenue, no COD — see the header note.
  const stats = useMemo(() => {
    // "In production" = at least one piece has moved past order_received. That
    // is the honest signal on this screen: components are minted inactive and a
    // Production Head activates them, so an order can sit ready for a while.
    const inProduction = periodOrders.filter((o) =>
      (componentsByOrder[o.id] || []).some(
        (c) => c.current_stage && c.current_stage !== "order_received"
      )
    ).length;
    return {
      count: periodOrders.length,
      units: periodOrders.reduce((s, o) => s + (o.total_quantity || 0), 0),
      inProduction,
    };
  }, [periodOrders, componentsByOrder]);

  const lastSynced = useMemo(() => {
    const ts = orders.map((o) => o.shopify_synced_at).filter(Boolean).sort();
    return ts.length ? ts[ts.length - 1] : null;
  }, [orders]);

  // ── Production Overview tab -------------------------------------------------
  // Every Shopify order id — the scope for QC History, Re-journeys and Movement
  // History. This screen only ever loads Shopify orders, so its whole order set
  // IS the channel scope (no scopeOrdersToDesignation needed as on the shared
  // warehouse dashboard, which loads every channel and narrows afterwards).
  const orderIds = useMemo(() => orders.map((o) => o.id), [orders]);

  // Flat piece list, and the same list narrowed to the Overview period. Stage
  // cards read the NARROWED set, filtered by the PIECE's own scan time
  // (stage_updated_at) rather than its order's placement date — so a scan made
  // today on an old order shows under "Today", which is what the floor means by
  // the question. `allComponents` is kept whole so order-level lookups still see
  // pieces scanned outside the window.
  const allComponents = useMemo(
    () => Object.values(componentsByOrder).flat(),
    [componentsByOrder]
  );
  const productionComponents = useMemo(
    () => allComponents.filter((c) => inPeriod(c.stage_updated_at || c.created_at)),
    [allComponents, inPeriod]
  );
  // The order-level half of the production block shares the Overview's own
  // period-scoped order set (periodOrders) — same filter, so no second memo.
  const productionOrders = periodOrders;

  // order_id -> status, for classifyComponentForStageCard: a bypass-completed
  // order's pieces belong under Packaging & Dispatch. Built from ALL orders (not
  // the period-narrowed set) so an old order's piece scanned today still
  // resolves its status.
  const orderStatusById = useMemo(() => {
    const m = {};
    orders.forEach((o) => { m[o.id] = o.status; });
    return m;
  }, [orders]);

  // Clicking a stage card filters the Orders tab to that stage and jumps there —
  // same drill-through as the retail order dashboard. The Orders tab's own
  // stageKeysByOrder is built with the same classifier, so the list it lands on
  // matches the number on the card.
  const handleStageCardClick = (stageKey) => {
    setStageFilter([stageKey]);
    setActiveTab("orders");
  };

  // ── QC History tab. Loaded on open (not with the orders) so the screen's first
  // paint isn't waiting on a query most sessions never look at.
  useEffect(() => {
    if (activeTab !== "qc-history" || !orderIds.length) return;
    let cancelled = false;
    (async () => {
      setQcHistoryLoading(true);
      const recs = await fetchQcRecords({ orderIds });
      if (!cancelled) { setQcHistory(recs); setQcHistoryLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [activeTab, orderIds]);

  // ── Re-journeys tab — the pieces currently back in rework after a QC fail.
  useEffect(() => {
    if (activeTab !== "rejourneys" || !orderIds.length) return;
    let cancelled = false;
    (async () => {
      setReJourneysLoading(true);
      const rows = await fetchReJourneys({ orderIds });
      if (!cancelled) { setReJourneys(rows); setReJourneysLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [activeTab, orderIds]);

  // One search predicate, used by both the Orders and Needs Review tabs.
  const matchesSearch = useCallback((o, field, query) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    switch (field) {
      case "shopify_order_name":
        // Tolerate the "#" being typed or not.
        return (o.shopify_order_name || "").toLowerCase().replace("#", "")
          .includes(q.replace("#", ""));
      case "product":
        return (o.items || []).some((i) =>
          (i.product_name || "").toLowerCase().includes(q));
      case "barcode":
        return (componentsByOrder[o.id] || []).some((c) =>
          (c.barcode || "").toLowerCase().includes(q));
      default: return (o.order_no || "").toLowerCase().includes(q);
    }
  }, [componentsByOrder]);

  // order_id -> Set of stage-group keys its pieces are currently at. An order
  // is "at" a stage if ANY of its components is — a multi-piece order legitimately
  // straddles two stages, and filtering on the order's single warehouse_stage
  // would drop it from the stage its other pieces are actually sitting at.
  const stageKeysByOrder = useMemo(() => {
    const map = {};
    Object.entries(componentsByOrder).forEach(([orderId, comps]) => {
      const keys = new Set();
      comps.forEach((c) => {
        // Same classifier the Production Overview stage cards use, so clicking a
        // card lands on exactly the orders it counted. It matters for a piece
        // out at a vendor: the cards bucket it by the stage it went OUT for,
        // while its current_stage is still the one it left at — reading
        // current_stage here would send the drill-through to a different list
        // than the card's own number. It also buckets order_received, which
        // getStageGroupKey deliberately maps to null for order-level logic.
        const key = classifyComponentForStageCard(c, orderStatusById[orderId])?.key;
        if (key) keys.add(key);
      });
      map[orderId] = keys;
    });
    return map;
  }, [componentsByOrder, orderStatusById]);

  // All 10 logical stages, always. Unlike the Needs Review issue filter (whose
  // codes are unbounded), the stage list is a fixed, ordered pipeline — showing
  // it whole lets someone read off where work ISN'T, and a checkbox that
  // returns nothing is honest information here, not a dead option.
  const stageOptions = STAGE_GROUPS;

  const toggleStage = (key) =>
    setStageFilter((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );

  // Payment states actually PRESENT on this tab, so the dropdown never offers a
  // filter that returns nothing — same rule as issueCodeOptions below. Built off
  // every order ON THE TAB (not the filtered set) so ticking one option doesn't
  // make the others vanish from the list.
  //
  // Scoped to readyOrders, not all orders: unsettled states (PENDING, AUTHORIZED)
  // now live on Needs Review, so offering them here would be a filter that can
  // only ever return nothing.
  const paymentOptions = useMemo(() => {
    const states = new Set();
    readyOrders.forEach((o) => {
      const s = String(o.shopify_financial_status || "").toUpperCase();
      if (s) states.add(s);
    });
    return [...states].sort();
  }, [readyOrders]);

  // Filters run over readyOrders, NOT the full set: an order held back from the
  // work queue (unmapped, or payment unsettled) must not reappear here just
  // because it matches a search or a stage tick.
  const filteredOrders = useMemo(() => {
    const rows = readyOrders.filter((o) => {
      if (!matchesSearch(o, searchField, search)) return false;
      if (!inOrdersPeriod(o.created_at)) return false;
      // Payment filters run BEFORE the stage early-return below — putting them
      // after it would silently skip them whenever no stage was ticked.
      if (paymentFilter.length > 0) {
        const s = String(o.shopify_financial_status || "").toUpperCase();
        if (!paymentFilter.includes(s)) return false;
      }
      if (codFilter === "cod" && !isCodTagged(o)) return false;
      if (codFilter === "non_cod" && isCodTagged(o)) return false;
      if (stageFilter.length === 0) return true;
      // OR across the ticked stages: an order matches if ANY piece is at ANY of
      // them. Ticking more stages widens the list, which is what a checkbox
      // group is expected to do.
      const keys = stageKeysByOrder[o.id];
      // An order with no components yet (freshly ingested, or flagged before
      // barcodes were minted) counts as Order Received — that IS its state, and
      // dropping it from the list would hide the newest orders on the screen.
      if (!keys || keys.size === 0) return stageFilter.includes("order_received");
      return stageFilter.some((k) => keys.has(k));
    });
    // `rows` is already a fresh array from .filter, so sorting it in place is
    // safe — it never touches the `orders` state array.
    return rows.sort(SORTERS[sortBy] || SORTERS.newest);
  }, [readyOrders, search, searchField, matchesSearch, inOrdersPeriod, stageFilter,
      stageKeysByOrder, sortBy, paymentFilter, codFilter]);

  const totalPages = Math.ceil(filteredOrders.length / ORDERS_PER_PAGE);
  const paginated = useMemo(
    () => filteredOrders.slice((page - 1) * ORDERS_PER_PAGE, page * ORDERS_PER_PAGE),
    [filteredOrders, page]
  );

  // inOrdersPeriod (not `ordersTimeline`) is the dep: it is a fresh callback per
  // RANGE, so editing a custom From/To resets the page too — with the timeline
  // alone the selection stays "custom" and page 4 of a now-shorter list is empty.
  useEffect(() => { setPage(1); }, [search, searchField, stageFilter, sortBy,
    inOrdersPeriod, paymentFilter, codFilter]);

  // ── Needs Review tab: search + filter by which blocker the order has.
  // Only codes actually PRESENT in the current data become options, so the
  // dropdown never offers a filter that returns nothing.
  const issueCodeOptions = useMemo(() => {
    const codes = new Set();
    needsReview.forEach((o) =>
      reviewIssues(o).forEach((i) => codes.add(i.code))
    );
    return [...codes].sort();
  }, [needsReview]);

  const filteredReview = useMemo(
    () => needsReview.filter((o) => {
      if (!matchesSearch(o, reviewSearchField, reviewSearch)) return false;
      if (issueFilter === "all") return true;
      return reviewIssues(o).some((i) => i.code === issueFilter);
    }),
    [needsReview, reviewSearch, reviewSearchField, issueFilter, matchesSearch]
  );

  const reviewTotalPages = Math.ceil(filteredReview.length / ORDERS_PER_PAGE);
  const paginatedReview = useMemo(
    () => filteredReview.slice((reviewPage - 1) * ORDERS_PER_PAGE, reviewPage * ORDERS_PER_PAGE),
    [filteredReview, reviewPage]
  );

  useEffect(() => { setReviewPage(1); }, [reviewSearch, reviewSearchField, issueFilter]);

  // Jump from a flagged card on the Orders tab to that order on the Needs
  // Review tab. Searching by its order number is what actually isolates it —
  // switching tabs alone would just show the whole list.
  const goToReview = (order) => {
    setReviewSearchField("order_no");
    setReviewSearch(order.order_no || "");
    setIssueFilter("all");
    setActiveTab("needs-review");
  };

  if (!authChecked) return null;

  const tabLabel = (tab) => {
    if (tab.key === "orders") return `${tab.label} (${orders.length})`;
    if (tab.key === "needs-review") return `${tab.label} (${needsReview.length})`;
    return tab.label;
  };

  // ── The order card.
  //
  // Structure and field naming follow the retail order card
  // (AssociateDashboard.js:1584) — an uppercase header strip over Title-case
  // "Label:" detail rows — with its Client Name and Amount rows removed, and
  // the production pieces appended. NOT clickable: see the header note.
  //
  // `context` is "orders" or "needs-review". On the Orders tab a flagged card is
  // clickable and jumps to the Needs Review tab; on that tab itself it is not
  // (it would link to where you already are) and instead lists its issues
  // inline underneath.
  const renderCard = (order, context = "orders") => {
    const item = order.items?.[0] || {};
    const extra = (order.items?.length || 0) - 1;
    // Two distinct reasons an order is flagged, kept apart on the card: the
    // mapper could not map it, or its payment is not settled. Same tab, but a
    // warehouse manager needs to know which — one is a data fix, the other is
    // a wait.
    const mappingFlagged = order.web_order_status === "needs_review";
    const paymentFlagged = isPaymentHeld(order);
    const flagged = mappingFlagged || paymentFlagged;
    const components = componentsByOrder[order.id] || [];
    const imgSrc = item.image_url || "";
    const onReviewTab = context === "needs-review";
    const linkToReview = flagged && !onReviewTab;

    return (
      <div
        key={order.id}
        className={`sho-order-card ${flagged ? "flagged" : ""} ${linkToReview ? "sho-clickable" : ""}`}
        onClick={linkToReview ? () => goToReview(order) : undefined}
        title={linkToReview ? "Open in Needs Review" : undefined}
      >
        <div className="sho-order-header">
          <div className="sho-header-info">
            <div className="sho-header-item">
              <span className="sho-header-label">ORDER NO:</span>
              <span className="sho-header-value">{order.order_no || "—"}</span>
            </div>
            {/* Shopify's own number. The warehouse and the catalogue team refer
                to these by this number, so it sits beside ours on the card and
                on the warehouse PDF. */}
            <div className="sho-header-item">
              <span className="sho-header-label">SHOPIFY ORDER NO:</span>
              <span className="sho-header-value">{order.shopify_order_name || "—"}</span>
            </div>
            <div className="sho-header-item">
              <span className="sho-header-label">ORDER DATE:</span>
              <span className="sho-header-value">{formatDate(order.created_at) || "—"}</span>
            </div>
            <div className="sho-header-item">
              <span className="sho-header-label">DELIVERY:</span>
              <span
                className="sho-header-value"
                title={
                  order.delivery_date
                    ? `Warehouse deadline (T-2). Customer date: ${formatDate(order.delivery_date)}`
                    : undefined
                }
              >
                {getWarehouseDate(order.delivery_date, order.created_at)}
              </span>
            </div>
          </div>
          {/* No Customer PDF for website orders: Shopify already sends the
              customer their own order confirmation, so a second invoice from
              us would be a duplicate (and could disagree with theirs). Only the
              Warehouse work order is ours to produce.

              STILL NO AMOUNT here. The payment badges below are payment STATE
              (Shopify's own words), which dispatch needs to know before handing
              a parcel over — never a figure. */}
          <div className="sho-header-actions">
            <Badge variant={statusVariant(order.status)}>
              {getOrderStatusLabel(order.status)}
            </Badge>
            {/* Shopify's displayFinancialStatus, verbatim and un-inferred. */}
            {order.shopify_financial_status && (
              <Badge variant={paymentVariant(order.shopify_financial_status)}>
                {order.shopify_financial_status}
              </Badge>
            )}
            {/* COD tags, one chip each. Driven off the stored array so a new
                tag the business starts using shows up with no code change. */}
            {codTags(order).map((tag) => (
              <Badge key={tag} variant="info">{tag}</Badge>
            ))}
            {paymentFlagged && (
              <Badge variant="warning">Awaiting Payment</Badge>
            )}
            {mappingFlagged && <Badge variant="warning">Needs Review</Badge>}
            <button
              className="sho-ghost-btn"
              onClick={(e) => handleWarehousePdf(e, order)}
              disabled={warehousePdfLoading === order.id}
            >
              {warehousePdfLoading === order.id ? "…" : "Warehouse PDF"}
            </button>
          </div>
        </div>

        <div className="sho-order-content">
          {/* Render a real placeholder tile when there is no image rather than
              pointing <img> at a file that may not exist: a BROKEN image shows
              its alt text, and a long product name then stretched the thumb to
              full width and wrecked the card layout. alt="" because the product
              name is already the next thing on the card. */}
          <div className="sho-product-thumb">
            {imgSrc ? (
              <img src={imgSrc} alt="" />
            ) : (
              <div className="sho-thumb-empty">SB</div>
            )}
          </div>
          <div className="sho-product-details">
            <div className="sho-product-row">
              <span className="sho-order-label">Product Name:</span>
              <span className="sho-value">
                {item.product_name || "—"}
                {extra > 0 && <span className="sho-more"> +{extra} more</span>}
              </span>
            </div>
            <div className="sho-product-row">
              <span className="sho-order-label">Category:</span>
              <span className="sho-value">{item.isKids ? "Kids" : "Women"}</span>
            </div>
            <div className="sho-details-grid">
              <div className="sho-detail-item">
                <span className="sho-order-label">Qty:</span>
                <span className="sho-value">{order.total_quantity || 1}</span>
              </div>
              <div className="sho-detail-item">
                {/* Label follows the option the size came from: a kids line
                    carries an Age value ("5-6 YEARS"), which must not read
                    "Size:". Falls back for orders ingested before the mapper
                    started sending size_label. */}
                <span className="sho-order-label">
                  {item.size_label || (item.isKids ? "Age" : "Size")}:
                </span>
                <span className="sho-value">{item.size || "—"}</span>
              </div>
              <div className="sho-detail-item">
                <span className="sho-order-label">Top:</span>
                <span className="sho-value">
                  {item.top || "—"}<ColorDot color={item.top_color} />
                </span>
              </div>
              <div className="sho-detail-item">
                <span className="sho-order-label">Bottom:</span>
                <span className="sho-value">
                  {item.bottom || "—"}<ColorDot color={item.bottom_color} />
                </span>
              </div>
              <div className="sho-detail-item">
                <span className="sho-order-label">Dupatta:</span>
                <span className="sho-value">
                  {item.includes_dupatta ? "Yes" : "No"}
                  {/* Heavy / Light — the warehouse pulls a different piece for
                      each, so the qualifier matters as much as the yes/no. */}
                  {item.includes_dupatta && item.dupatta_weight && (
                    <span className="sho-qualifier"> ({item.dupatta_weight})</span>
                  )}
                  {item.includes_dupatta && <ColorDot color={item.dupatta_color} />}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Production pieces — one barcode per physical component. These run
            the same stage pipeline as every other channel.
            Hidden on the Needs Review tab: that tab is about what is MISSING,
            and the pieces (plus a View Journey button) are noise there. Note a
            flagged order can still HAVE components — one minted while it mapped
            cleanly, then re-flagged by a later remap-items — so this is a
            display choice, not an assumption that the list is empty. */}
        {!onReviewTab && components.length > 0 && (
          <>
            <div className="sho-comp-journey">
              {components.map((comp) => (
                <div key={comp.id} className="sho-comp-card">
                  <div className="sho-comp-info">
                    <span className="sho-comp-barcode">{comp.barcode}</span>
                    <span className="sho-comp-label">
                      {comp.component_label || comp.component_type}
                    </span>
                  </div>
                  <div className="sho-comp-right">
                    {comp.re_journey_count > 0 && (
                      <span className="sho-comp-rework-tag">
                        Rework {comp.re_journey_count}
                      </span>
                    )}
                    <ComponentStageBadge comp={comp} />
                  </div>
                </div>
              ))}
            </div>
            <div className="sho-comp-actions">
              <button
                className="sho-ghost-btn"
                onClick={(e) => {
                  // The card itself may be a link to Needs Review — don't let a
                  // button click bubble up and navigate away.
                  e.stopPropagation();
                  setJourneyOrder({ order_no: order.order_no, components });
                }}
              >
                View Journey
              </button>
              {/* QC 1 + Final QC results for this order. Always offered, even
                  before any QC has happened — the modal says so, and "has this
                  been checked yet?" is itself the question being asked. */}
              <button className="sho-ghost-btn" onClick={(e) => openQcReport(e, order)}>
                QC Report
              </button>
              {/* Production-finished bypass, for an order that can't complete
                  through the normal scan flow. Hidden once the order is already
                  finished or cancelled — same condition as the retail dashboard. */}
              {!["completed", "delivered", "cancelled"].includes(
                normalizeOrderStatus(order.status)
              ) && (
                  <button
                    className="sho-complete-btn"
                    onClick={(e) => markManualComplete(e, order)}
                    disabled={completing === order.id}
                  >
                    {completing === order.id ? "Completing…" : "Mark as Completed"}
                  </button>
                )}
            </div>
          </>
        )}

        {/* On the Needs Review tab, list what is missing right under the card —
            one line per blocker. No modal: this is the whole point of the tab,
            so it should be readable without another click. */}
        {onReviewTab && (
          <ul className="sho-issues">
            {reviewIssues(order).map((i, n) => (
              <li key={n}>
                <strong>{ISSUE_LABELS[i.code] || i.code}</strong>
                {i.detail ? <span className="sho-issue-detail"> — {i.detail}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  };

  return (
    <div className="sho-page">
      {PopupComponent}

      {journeyOrder && (
        <ComponentJourneyModal
          orderNo={journeyOrder.order_no}
          components={journeyOrder.components}
          onClose={() => setJourneyOrder(null)}
        />
      )}

      {/* Which product of a multi-product order is finished. */}
      {completePicker && (
        <CompletePicker
          order={completePicker.order}
          components={componentsByOrder[completePicker.order.id] || []}
          productIdxs={completePicker.productIdxs}
          onConfirm={(picked) => runManualComplete(completePicker.order, picked)}
          onClose={() => setCompletePicker(null)}
        />
      )}

      {/* QC REPORT MODAL — same shape as the retail order dashboard's. */}
      {qcReportOrder && (
        <div className="sho-modal-overlay" onClick={() => setQcReportOrder(null)}>
          <div className="sho-modal" onClick={(e) => e.stopPropagation()}>
            <div className="sho-modal-head">
              <h3 className="sho-modal-title">QC Report — {qcReportOrder.order_no}</h3>
              <button
                className="sho-modal-close"
                onClick={() => setQcReportOrder(null)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="sho-modal-body">
              <QcHistoryTable
                records={qcReportRecords}
                loading={qcReportLoading}
                emptyText="No QC checks recorded for this order yet."
              />
            </div>
          </div>
        </div>
      )}

      {/* HEADER */}
      <header className="sho-header">
        <div className="sho-header-left">
          <button
            className="sho-hamburger"
            onClick={() => setShowSidebar((s) => !s)}
            aria-label="Toggle menu"
          >
            <span /><span /><span />
          </button>
          <img src={Logo} alt="Sheetal Batra" className="sho-logo" />
        </div>
        <h1 className="sho-title">Shopify Orders</h1>
        <div className="sho-header-right">
          <button className="sho-primary-btn" onClick={handleSyncNow} disabled={syncing}>
            {syncing ? "Syncing…" : "Sync now"}
          </button>
          <NotificationBell userEmail={user?.email} onOrderClick={() => { }} />
          <span className="sho-user-name">{profile?.saleperson || "—"}</span>
        </div>
      </header>

      <div className="sho-layout">
        {/* SIDEBAR */}
        <aside className={`sho-sidebar ${showSidebar ? "open" : ""}`}>
          <nav className="sho-nav">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                className={`sho-nav-item ${activeTab === tab.key ? "active" : ""}`}
                onClick={() => { setActiveTab(tab.key); setShowSidebar(false); }}
              >
                {tabLabel(tab)}
              </button>
            ))}
            <button className="sho-nav-item sho-nav-logout" onClick={handleLogout}>
              Logout
            </button>
          </nav>
        </aside>

        {/* MAIN */}
        <main className="sho-content">
          {loading ? (
            <div className="sho-loading"><div className="sho-spinner" /><p>Loading orders...</p></div>
          ) : loadError ? (
            <div className="sho-error">
              <p><strong>Could not load orders</strong></p>
              <p>{loadError}</p>
              <button className="sho-primary-btn" onClick={loadOrders}>Retry</button>
            </div>
          ) : (
            <>
              {/* ═══ OVERVIEW ══════════════════════════════════════════════
                  Order counts first, then production: how many orders came in,
                  then where their physical pieces actually are. One period
                  control governs both — they answer the same question ("how did
                  this window go?") at two levels of detail, so splitting them
                  across two tabs, each with its own timeline, only invited the
                  two halves to disagree about which window you were looking at. */}
              {activeTab === "overview" && (
                <>
                  <h2 className="sho-section-title">Overview</h2>
                  {periodControl}
                  {/* NO Revenue card, NO COD card — production counts only. */}
                  <div className="sho-cards-row">
                    <StatCard title="Orders" value={stats.count} />
                    <StatCard title="Units" value={stats.units} />
                    <StatCard title="In Production" value={stats.inProduction} />
                    <StatCard
                      title="Needs Review"
                      value={needsReview.length}
                      highlight={needsReview.length > 0}
                    />
                  </div>
                  <p className="sho-synced">
                    {lastSynced ? `Last synced ${formatDate(lastSynced)}` : "Not synced yet"}
                    {" · "}{orders.length} Shopify orders in total
                  </p>

                  {/* ─── Production — component tracking. The same pair the
                      retail order dashboard shows: piece counts per stage
                      (in-house vs out at a vendor), then the shared operational
                      metric cards. */}
                  <h3 className="sho-subsection-title">Production</h3>
                  {/* A plain caption, not .sho-hint — that yellow callout box is
                      for the Needs Review warning, and reusing it here would
                      flag a normal section as something needing attention. */}
                  <p className="sho-caption">
                    Every physical piece of every Shopify order, by the stage it
                    is at right now. Click a stage to see those orders.
                  </p>
                  {/* Stage cards filter by each piece's own scan time, so a scan
                      made today on an older order still counts under "Today" —
                      while the cards above count orders by placement date. Both
                      read the one period selected at the top of the tab. */}
                  <StageCountCards
                    components={productionComponents}
                    orderStatusById={orderStatusById}
                    onStageClick={handleStageCardClick}
                  />
                  <ProductionOverview
                    orders={productionOrders}
                    components={productionComponents}
                    allComponents={allComponents}
                    totalLabel="Total Shopify Orders"
                  />
                </>
              )}

              {activeTab === "orders" && (
                <>
                  <h2 className="sho-section-title">Orders</h2>
                  <div className="sho-toolbar">
                    <SearchByDropdown
                      fields={SEARCH_FIELDS}
                      selectedField={searchField}
                      onFieldChange={setSearchField}
                      query={search}
                      onQueryChange={setSearch}
                      placeholder="Type to search..."
                    />
                    {/* Period — the app-standard control, never a hand-rolled
                        From/To pair. */}
                    {ordersPeriodControl}
                    {/* Stage — multi-select checkboxes in a popover, the same
                        pattern as the Warehouse dashboard's Stage filter
                        (WarehouseDashboard.jsx:1530). A single-select dropdown
                        can't express "Stitching or Hemming", which is how the
                        floor actually asks the question. */}
                    <div className="sho-filter-dropdown">
                      <button
                        className={`sho-filter-btn ${stageFilter.length > 0 ? "active" : ""}`}
                        onClick={() => setOpenDropdown(openDropdown === "stage" ? null : "stage")}
                      >
                        Stage{stageFilter.length > 0 ? ` (${stageFilter.length})` : ""}
                        <span className="sho-dropdown-arrow">&#9662;</span>
                      </button>
                      {openDropdown === "stage" && (
                        <div className="sho-dropdown-panel">
                          <div className="sho-dropdown-title">Production Stage</div>
                          {stageOptions.map((g) => (
                            <label key={g.key} className="sho-checkbox-label">
                              <input
                                type="checkbox"
                                checked={stageFilter.includes(g.key)}
                                onChange={() => toggleStage(g.key)}
                              />
                              <span>{g.label}</span>
                            </label>
                          ))}
                          <button
                            className="sho-dropdown-apply"
                            onClick={() => setOpenDropdown(null)}
                          >
                            Apply
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Payment — Shopify's own states, multi-select like Stage.
                        Options come from the DATA, not a hardcoded list, so a
                        state we haven't seen (REFUNDED, AUTHORIZED…) becomes
                        filterable the moment one appears. */}
                    {paymentOptions.length > 0 && (
                      <div className="sho-filter-dropdown">
                        <button
                          className={`sho-filter-btn ${paymentFilter.length > 0 ? "active" : ""}`}
                          onClick={() => setOpenDropdown(openDropdown === "payment" ? null : "payment")}
                        >
                          Payment{paymentFilter.length > 0 ? ` (${paymentFilter.length})` : ""}
                          <span className="sho-dropdown-arrow">&#9662;</span>
                        </button>
                        {openDropdown === "payment" && (
                          <div className="sho-dropdown-panel">
                            <div className="sho-dropdown-title">Payment Status</div>
                            {paymentOptions.map((p) => (
                              <label key={p} className="sho-checkbox-label">
                                <input
                                  type="checkbox"
                                  checked={paymentFilter.includes(p)}
                                  onChange={() =>
                                    setPaymentFilter((prev) =>
                                      prev.includes(p)
                                        ? prev.filter((x) => x !== p)
                                        : [...prev, p]
                                    )
                                  }
                                />
                                <span>{p}</span>
                              </label>
                            ))}
                            <div className="sho-dropdown-title">COD</div>
                            {COD_FILTER_OPTIONS.map((c) => (
                              <label key={c.value} className="sho-checkbox-label">
                                <input
                                  type="radio"
                                  name="sho-cod"
                                  checked={codFilter === c.value}
                                  onChange={() => setCodFilter(c.value)}
                                />
                                <span>{c.label}</span>
                              </label>
                            ))}
                            <button
                              className="sho-dropdown-apply"
                              onClick={() => setOpenDropdown(null)}
                            >
                              Apply
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Sort — single choice, so radios rather than checkboxes:
                        the control must show that picking one drops the other. */}
                    <div className="sho-filter-dropdown">
                      <button
                        className={`sho-filter-btn ${sortBy !== "newest" ? "active" : ""}`}
                        onClick={() => setOpenDropdown(openDropdown === "sort" ? null : "sort")}
                      >
                        Sort
                        <span className="sho-dropdown-arrow">&#9662;</span>
                      </button>
                      {openDropdown === "sort" && (
                        <div className="sho-dropdown-panel">
                          <div className="sho-dropdown-title">Sort By</div>
                          {SORT_OPTIONS.map((s) => (
                            <label key={s.value} className="sho-checkbox-label">
                              <input
                                type="radio"
                                name="sho-sort"
                                checked={sortBy === s.value}
                                onChange={() => setSortBy(s.value)}
                              />
                              <span>{s.label}</span>
                            </label>
                          ))}
                          <button
                            className="sho-dropdown-apply"
                            onClick={() => setOpenDropdown(null)}
                          >
                            Apply
                          </button>
                        </div>
                      )}
                    </div>

                    <span className="sho-count">{filteredOrders.length} orders</span>
                    {(search || stageFilter.length > 0 || sortBy !== "newest" ||
                      paymentFilter.length > 0 || codFilter !== "all") && (
                      <button
                        className="sho-ghost-btn"
                        onClick={() => {
                          setSearch("");
                          setStageFilter([]);
                          setSortBy("newest");
                          // Clear must clear EVERYTHING — a payment filter left
                          // behind would keep hiding orders with no visible cause.
                          setPaymentFilter([]);
                          setCodFilter("all");
                        }}
                      >
                        Clear
                      </button>
                    )}
                    <button
                      className="sho-ghost-btn"
                      disabled={exporting || filteredOrders.length === 0}
                      onClick={() =>
                        exportOrdersCsv(filteredOrders, { filename: "shopify_orders" })
                      }
                    >
                      {exporting ? "Exporting…" : "Export CSV"}
                    </button>
                  </div>
                  {paginated.length === 0 ? (
                    <div className="sho-empty">No orders match this search.</div>
                  ) : (
                    <>
                      {/* Arrow fn, not a bare reference: .map passes the INDEX
                          as the second arg, which would land in `context`. */}
                      <div className="sho-order-cards">
                        {paginated.map((o) => renderCard(o, "orders"))}
                      </div>
                      <Paginator page={page} totalPages={totalPages} onChange={setPage} />
                    </>
                  )}
                </>
              )}

              {activeTab === "needs-review" && (
                <>
                  <h2 className="sho-section-title">Needs Review</h2>
                  {needsReview.length === 0 ? (
                    <div className="sho-empty">
                      Nothing needs review — every order mapped cleanly and its payment is confirmed.
                    </div>
                  ) : (
                    <>
                      <p className="sho-hint">
                        These orders are missing something production needs, so
                        nothing was guessed and no barcodes were minted. What's
                        missing is listed under each order.
                      </p>
                      <div className="sho-toolbar">
                        <SearchByDropdown
                          fields={SEARCH_FIELDS}
                          selectedField={reviewSearchField}
                          onFieldChange={setReviewSearchField}
                          query={reviewSearch}
                          onQueryChange={setReviewSearch}
                          placeholder="Type to search..."
                        />
                        {/* Only codes present in the current data are offered.
                            Wider than the Orders-tab dropdowns: these labels are
                            full sentences ("Garment breakdown missing — needs
                            custom.top_style"), not one-word stage names. */}
                        <select
                          className="sho-select sho-select-wide"
                          value={issueFilter}
                          onChange={(e) => setIssueFilter(e.target.value)}
                        >
                          <option value="all">All issues</option>
                          {issueCodeOptions.map((code) => (
                            <option key={code} value={code}>
                              {ISSUE_LABELS[code] || code}
                            </option>
                          ))}
                        </select>
                        <span className="sho-count">{filteredReview.length} orders</span>
                        {(reviewSearch || issueFilter !== "all") && (
                          <button
                            className="sho-ghost-btn"
                            onClick={() => { setReviewSearch(""); setIssueFilter("all"); }}
                          >
                            Clear
                          </button>
                        )}
                        {/* Issues column instead of the piece list — the whole
                            point of this export is what has to be fixed in
                            Shopify, and it is the list the catalogue team works
                            through off-screen. */}
                        <button
                          className="sho-ghost-btn"
                          disabled={exporting || filteredReview.length === 0}
                          onClick={() =>
                            exportOrdersCsv(filteredReview, {
                              filename: "shopify_needs_review",
                              withIssues: true,
                            })
                          }
                        >
                          {exporting ? "Exporting…" : "Export CSV"}
                        </button>
                      </div>
                      {paginatedReview.length === 0 ? (
                        <div className="sho-empty">No orders match this search.</div>
                      ) : (
                        <>
                          <div className="sho-order-cards">
                            {paginatedReview.map((o) => renderCard(o, "needs-review"))}
                          </div>
                          <Paginator
                            page={reviewPage}
                            totalPages={reviewTotalPages}
                            onChange={setReviewPage}
                          />
                        </>
                      )}
                    </>
                  )}
                </>
              )}

              {activeTab === "calendar" && (
                <>
                  <h2 className="sho-section-title">Delivery Calendar</h2>
                  {/* showClient/showSalesperson off: this shared component's
                      day-detail table renders delivery_name, which this screen
                      must not show. The SA on a website order is always the
                      constant "Website", so that column carries nothing either.
                      No onOpenOrder — cards and rows open nothing here. */}
                  <StoreCalendarTab
                    orders={readyOrders}
                    storeLabel="Shopify"
                    showClient={false}
                    showSalesperson={false}
                  />
                </>
              )}

              {/* ═══ VENDOR / EXTERNAL ═══════════════════════════════════════
                  Configure External Movement, Report Vendor Failure, Vendors and
                  Movement History — the shared Production-Head panel, unchanged.
                  Scoped by orderIds rather than channel: Shopify orders are
                  non-B2B, so channel="retail" alone would also surface every
                  store and exhibition trip, which is not this screen's channel. */}
              {activeTab === "vendors" && (
                <ProductionHeadVendors
                  currentUserEmail={user?.email || ""}
                  orderIds={orderIds}
                />
              )}

              {/* ═══ QC HISTORY ══════════════════════════════════════════════
                  Channel filter hidden: every record here is already Shopify, so
                  the control would be a dropdown with one option. */}
              {activeTab === "qc-history" && (
                <>
                  <h2 className="sho-section-title">QC History</h2>
                  <QcHistoryPanel
                    records={qcHistory}
                    loading={qcHistoryLoading}
                    showChannelFilter={false}
                  />
                </>
              )}

              {/* ═══ RE-JOURNEYS — pieces sent back for rework after a QC fail ═══ */}
              {activeTab === "rejourneys" && (
                <>
                  <h2 className="sho-section-title">Re-journeys</h2>
                  <p className="sho-caption">
                    Shopify pieces currently back in rework after failing QC.
                  </p>
                  <ReJourneyPanel
                    rows={reJourneys}
                    loading={reJourneysLoading}
                    showChannelFilter={false}
                  />
                </>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}

// Local StatCard. There is no shared StatCard component — the app re-declares
// one per dashboard; this mirrors the canonical shape from
// CeoAssistantDashboard.jsx:46 ({ title, value, subtitle, highlight }).
function StatCard({ title, value, subtitle, highlight }) {
  return (
    <div className={`sho-stat-card ${highlight ? "sho-highlight" : ""}`}>
      <p className="sho-stat-title">{title}</p>
      <p className="sho-stat-value">{value}</p>
      {subtitle && <p className="sho-stat-subtitle">{subtitle}</p>}
    </div>
  );
}
