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
import {
  enrichComponentsWithMovements,
  getOrderStatusLabel,
  normalizeOrderStatus,
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

// ─── Needs Review: the mapper's blocker codes in plain language ────────────
// The mapper refuses to guess when Shopify doesn't tell us something, and
// records a {code, detail} blocker instead. Raw codes are meaningless to the
// person reading this screen, so each is explained here: what it means, what it
// blocks, and who can fix it. `detail` from the mapper is shown underneath as
// the specific instance.
const ISSUE_GUIDE = {
  DUPATTA_UNKNOWN: {
    title: "We can't tell if this product includes a dupatta",
    blocks: "No dupatta barcode was minted, so a dupatta that does exist would go untracked through production.",
    fix: "The catalogue team needs to set custom.has_dupatta on this product in Shopify, or add a With/Without Dupatta option to it. Once set, a re-sync clears this on its own.",
  },
  PRODUCT_STYLE_MISSING: {
    title: "The garment breakdown is missing",
    blocks: "Without a top/bottom we cannot mint the right pieces, so no barcodes were created for this order.",
    fix: "The catalogue team needs to set custom.top_style and custom.bottom_style on this product in Shopify.",
  },
  DELIVERY_DATE_UNRESOLVED: {
    title: "No delivery date could be worked out",
    blocks: "The production deadline, the delivery calendar and delay escalation all key off this date. Rather than invent one, the order is held here.",
    fix: "The catalogue team needs to set custom.shipping_timeline on the product in Shopify.",
  },
  NO_LINE_ITEMS: {
    title: "The order has no products on it",
    blocks: "There is nothing to make.",
    fix: "Check the order in the Shopify admin — this usually means it was cancelled or edited to empty.",
  },
  CUSTOMER_UNRESOLVED: {
    title: "The order has no contact details",
    blocks: "An order cannot be filed without a customer record.",
    fix: "Check the order in the Shopify admin. (This blocker normally prevents the order being written at all, so it should not appear here.)",
  },
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
  const [reviewOrder, setReviewOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [warehousePdfLoading, setWarehousePdfLoading] = useState(null);
  const [activeTab, setActiveTab] = useTabParam("overview");
  const [showSidebar, setShowSidebar] = useState(false);
  const [searchField, setSearchField] = useState("order_no");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const { control: periodControl, inPeriod } = usePeriodFilter("month", { variant: "pills" });

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

  const filteredOrders = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter((o) => {
      switch (searchField) {
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
    });
  }, [orders, search, searchField, componentsByOrder]);

  const totalPages = Math.ceil(filteredOrders.length / ORDERS_PER_PAGE);
  const paginated = useMemo(
    () => filteredOrders.slice((page - 1) * ORDERS_PER_PAGE, page * ORDERS_PER_PAGE),
    [filteredOrders, page]
  );

  useEffect(() => { setPage(1); }, [search, searchField]);

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
  const renderCard = (order) => {
    const item = order.items?.[0] || {};
    const extra = (order.items?.length || 0) - 1;
    const flagged = order.web_order_status === "needs_review";
    const components = componentsByOrder[order.id] || [];
    const imgSrc = item.image_url || "/placeholder.png";

    return (
      <div key={order.id} className={`sho-order-card ${flagged ? "flagged" : ""}`}>
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
            {flagged && (
              <button className="sho-ghost-btn" onClick={() => setReviewOrder(order)}>
                Review
              </button>
            )}
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
          <div className="sho-product-thumb">
            <img src={imgSrc} alt={item.product_name || "Product"} />
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
            the same stage pipeline as every other channel. */}
        {components.length > 0 && (
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
                onClick={() => setJourneyOrder({ order_no: order.order_no, components })}
              >
                View Journey
              </button>
            </div>
          </>
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

      {reviewOrder && (
        <ReviewIssuesModal order={reviewOrder} onClose={() => setReviewOrder(null)} />
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
                    <span className="sho-count">{filteredOrders.length} orders</span>
                  </div>
                  {paginated.length === 0 ? (
                    <div className="sho-empty">No orders match this search.</div>
                  ) : (
                    <>
                      <div className="sho-order-cards">{paginated.map(renderCard)}</div>
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
                        nothing was guessed and no barcodes were minted. Open
                        <strong> Review</strong> on a card to see what's missing
                        and who can fix it.
                      </p>
                      <div className="sho-order-cards">
                        {needsReview.map(renderCard)}
                      </div>
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

// ─── Needs Review modal ───────────────────────────────────────────────────
// Explains, in plain language, what the mapper could not determine. Read-only:
// it says what is missing and who fixes it, rather than offering to guess here.
// Most of these clear themselves once the catalogue data lands and the order is
// re-synced, so there is nothing to "resolve" on this screen.
function ReviewIssuesModal({ order, onClose }) {
  const issues = order.web_order_issues || [];
  const blockers = issues.filter((i) => i.code !== DERIVED_CODE);
  const derived = issues.find((i) => i.code === DERIVED_CODE);

  return (
    <div className="sho-modal-overlay" onClick={onClose}>
      <div className="sho-modal" onClick={(e) => e.stopPropagation()}>
        <div className="sho-modal-head">
          <div>
            <h3 className="sho-modal-title">Needs Review</h3>
            <p className="sho-modal-sub">
              {order.order_no}
              {order.shopify_order_name ? ` · ${order.shopify_order_name}` : ""}
            </p>
          </div>
          <button className="sho-modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="sho-modal-body">
          <p className="sho-modal-lead">
            Shopify didn't tell us everything production needs for this order.
            Nothing was guessed, and no barcodes were minted — so the order is
            held here rather than entering production on data we don't trust.
          </p>

          {blockers.length === 0 ? (
            <p className="sho-modal-lead">
              No outstanding blockers are recorded. It may already have been
              fixed at the catalogue end — run <strong>Sync now</strong> to
              re-check.
            </p>
          ) : (
            <ul className="sho-issue-list">
              {blockers.map((issue, n) => {
                const guide = ISSUE_GUIDE[issue.code];
                return (
                  <li key={n} className="sho-issue">
                    <p className="sho-issue-title">
                      {guide?.title || issue.code}
                    </p>
                    {guide?.blocks && (
                      <p className="sho-issue-line">
                        <span className="sho-issue-tag">What it blocks</span>
                        {guide.blocks}
                      </p>
                    )}
                    {guide?.fix && (
                      <p className="sho-issue-line">
                        <span className="sho-issue-tag">How to fix</span>
                        {guide.fix}
                      </p>
                    )}
                    {issue.detail && (
                      <p className="sho-issue-detail">{issue.detail}</p>
                    )}
                    <p className="sho-issue-code">{issue.code}</p>
                  </li>
                );
              })}
            </ul>
          )}

          {derived && (
            <p className="sho-modal-note">
              <strong>Delivery date:</strong> {derived.detail}
              <br />
              Shopify carries no delivery date on an order, so it is worked out
              from the slowest item's shipping timeline.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
