import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import config from "../../config/config";
import { fetchAllRows } from "../../utils/fetchAllRows";
import { usePopup } from "../../components/Popup";
import Paginator from "../../components/Paginator";
import Badge from "../../components/Badge";
import NotificationBell from "../../components/NotificationBell";
import SearchByDropdown from "../../components/SearchByDropdown";
import ComponentStageBadge from "../../components/ComponentStageBadge";
import ComponentJourneyModal from "../../components/ComponentJourneyModal";
import useTabParam from "../../hooks/useTabParam";
import { usePeriodFilter } from "../../components/PeriodFilter";
import StoreCalendarTab from "../StoreManagerDashboard/StoreCalendarTab";
import { downloadWarehousePdf } from "../../utils/pdfLazy";
import { downloadCsv } from "../../utils/downloadCsv";
import {
  enrichComponentsWithMovements,
  getOrderStatusLabel,
  normalizeOrderStatus,
  getStageGroupKey,
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

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "orders", label: "Orders" },
  { key: "needs-review", label: "Needs Review" },
  { key: "calendar", label: "Calendar" },
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
const ORDER_LIST_COLUMNS = [
  "id", "order_no", "created_at", "delivery_date", "status",
  "total_quantity", "items", "warehouse_stage",
  "warehouse_urls",
  "shopify_order_id", "shopify_order_name", "shopify_synced_at",
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

// ─── Needs Review: a SHORT label per mapper blocker code ───────────────────
// One line each, deliberately. An earlier version explained what each code
// blocked and who fixes it in full prose; nobody reads a wall of text on a
// production screen. The mapper's own `detail` already names the offending
// product, so the label only has to say what is missing.
const ISSUE_LABELS = {
  DUPATTA_UNKNOWN: "Dupatta unknown — needs custom.has_dupatta in Shopify",
  PRODUCT_STYLE_MISSING: "Garment breakdown missing — needs custom.top_style / bottom_style",
  DELIVERY_DATE_UNRESOLVED: "No delivery date — needs custom.shipping_timeline",
  NO_LINE_ITEMS: "No products on the order",
  CUSTOMER_UNRESOLVED: "No contact details on the order",
};

// Informational, not a blocker: every cleanly-mapped order carries it. Shown
// inside the modal as provenance for the delivery date, never as a problem.
const DERIVED_CODE = "DELIVERY_DATE_DERIVED";

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
            .select("id, order_id, order_no, barcode, component_type, component_label, current_stage, previous_stage, item_index, is_outside_wh, stage_updated_at, re_journey_count, stage_pass_counts")
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
        "Order No", "Shopify Order No", "Order Date", "Delivery Date",
        "Status", "Qty", "Products", "Size", "Top", "Bottom", "Dupatta",
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
          o.delivery_date ? formatDate(o.delivery_date) : "",
          getOrderStatusLabel(o.status),
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
            (o.web_order_issues || [])
              .filter((i) => i.code !== DERIVED_CODE)
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
  const readyOrders = useMemo(
    () => orders.filter((o) => o.web_order_status !== "needs_review"),
    [orders]
  );
  const needsReview = useMemo(
    () => orders.filter((o) => o.web_order_status === "needs_review"),
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
        // getStageGroupKey returns null for order_received (deliberate, for
        // order-level logic), so map that bucket explicitly — "not started yet"
        // is a filter the floor wants.
        const key = c.current_stage === "order_received"
          ? "order_received"
          : getStageGroupKey(c.current_stage);
        if (key) keys.add(key);
      });
      map[orderId] = keys;
    });
    return map;
  }, [componentsByOrder]);

  // All 10 logical stages, always. Unlike the Needs Review issue filter (whose
  // codes are unbounded), the stage list is a fixed, ordered pipeline — showing
  // it whole lets someone read off where work ISN'T, and a checkbox that
  // returns nothing is honest information here, not a dead option.
  const stageOptions = STAGE_GROUPS;

  const toggleStage = (key) =>
    setStageFilter((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );

  const filteredOrders = useMemo(() => {
    const rows = orders.filter((o) => {
      if (!matchesSearch(o, searchField, search)) return false;
      if (!inOrdersPeriod(o.created_at)) return false;
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
    // Copy before sorting — .sort mutates, and `orders` is state.
    return rows.sort(SORTERS[sortBy] || SORTERS.newest);
  }, [orders, search, searchField, matchesSearch, inOrdersPeriod, stageFilter, stageKeysByOrder, sortBy]);

  const totalPages = Math.ceil(filteredOrders.length / ORDERS_PER_PAGE);
  const paginated = useMemo(
    () => filteredOrders.slice((page - 1) * ORDERS_PER_PAGE, page * ORDERS_PER_PAGE),
    [filteredOrders, page]
  );

  // inOrdersPeriod (not `ordersTimeline`) is the dep: it is a fresh callback per
  // RANGE, so editing a custom From/To resets the page too — with the timeline
  // alone the selection stays "custom" and page 4 of a now-shorter list is empty.
  useEffect(() => { setPage(1); }, [search, searchField, stageFilter, sortBy, inOrdersPeriod]);

  // ── Needs Review tab: search + filter by which blocker the order has.
  // Only codes actually PRESENT in the current data become options, so the
  // dropdown never offers a filter that returns nothing.
  const issueCodeOptions = useMemo(() => {
    const codes = new Set();
    needsReview.forEach((o) =>
      (o.web_order_issues || []).forEach((i) => {
        if (i.code !== DERIVED_CODE) codes.add(i.code);
      })
    );
    return [...codes].sort();
  }, [needsReview]);

  const filteredReview = useMemo(
    () => needsReview.filter((o) => {
      if (!matchesSearch(o, reviewSearchField, reviewSearch)) return false;
      if (issueFilter === "all") return true;
      return (o.web_order_issues || []).some((i) => i.code === issueFilter);
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
    const flagged = order.web_order_status === "needs_review";
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
              <span className="sho-header-value">
                {order.delivery_date ? formatDate(order.delivery_date) : "—"}
              </span>
            </div>
          </div>
          {/* No Customer PDF for website orders: Shopify already sends the
              customer their own order confirmation, so a second invoice from
              us would be a duplicate (and could disagree with theirs). Only the
              Warehouse work order is ours to produce.
              NO COD badge and NO amount here either — this is a warehouse
              screen; payment is not its business. */}
          <div className="sho-header-actions">
            <Badge variant={statusVariant(order.status)}>
              {getOrderStatusLabel(order.status)}
            </Badge>
            {flagged && <Badge variant="warning">Needs Review</Badge>}
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
                <span className="sho-order-label">Size:</span>
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
            </div>
          </>
        )}

        {/* On the Needs Review tab, list what is missing right under the card —
            one line per blocker. No modal: this is the whole point of the tab,
            so it should be readable without another click. */}
        {onReviewTab && (
          <ul className="sho-issues">
            {(order.web_order_issues || [])
              .filter((i) => i.code !== DERIVED_CODE)
              .map((i, n) => (
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
                    {(search || stageFilter.length > 0 || sortBy !== "newest") && (
                      <button
                        className="sho-ghost-btn"
                        onClick={() => { setSearch(""); setStageFilter([]); setSortBy("newest"); }}
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
                      Nothing needs review — every order mapped cleanly.
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
