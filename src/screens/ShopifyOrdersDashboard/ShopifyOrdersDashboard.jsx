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
import formatIndianNumber from "../../utils/formatIndianNumber";
import Logo from "../../images/logo.png";
import "./ShopifyOrdersDashboard.css";

/**
 * ShopifyOrdersDashboard — website orders placed on sheetalbatraindia.com.
 *
 * A Shopify order is an ORDINARY order that happens to arrive from the website:
 * once ingested it runs the same production flow, warehouse stages, dispatch
 * and delivery as a store / B2B / exhibition order. This screen is just the
 * window onto that channel — order history cards, a delivery calendar, order
 * detail and the two PDFs.
 *
 * Ingestion is done by the `shopify-order-sync` edge function (webhook + a
 * reconciliation poll); "Sync now" here triggers the same function manually.
 *
 * Orders are identified by their SB-SHOP- prefix — the order-number prefix is
 * the authoritative channel signal app-wide (see barcodeService.js).
 *
 * Layout mirrors CommsDashboard / StoreManagerDashboard: sticky header with the
 * notification bell, a sidebar nav, and the shared Badge / SearchByDropdown /
 * Paginator / PeriodFilter components.
 */

const ORDERS_PER_PAGE = 10;

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "orders", label: "Orders" },
  { key: "needs-review", label: "Needs Review" },
  { key: "calendar", label: "Calendar" },
];

const SEARCH_FIELDS = [
  { value: "order_no", label: "Order Number" },
  { value: "client_name", label: "Client Name" },
  { value: "phone", label: "Phone" },
  { value: "product", label: "Product" },
];

// Only the columns this screen reads. The PDF generators re-fetch the full row
// by id on click (pdfUtils.fetchFullOrder), so a trimmed list is correct here
// and keeps the payload small — same approach as AssociateDashboard.
const ORDER_LIST_COLUMNS = [
  "id", "order_no", "created_at", "delivery_date", "status",
  "delivery_name", "delivery_email", "delivery_phone", "delivery_city",
  "grand_total", "net_total", "grand_total_after_discount",
  "advance_payment", "remaining_payment", "payment_mode",
  "total_quantity", "items", "warehouse_stage",
  "customer_url", "warehouse_urls",
  "shopify_order_id", "shopify_synced_at", "web_order_status", "web_order_issues",
].join(", ");

const money = (o) =>
  Number(o?.net_total ?? o?.grand_total_after_discount ?? o?.grand_total ?? 0);

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
      // The SB-SHOP- prefix is the authoritative channel signal.
      const { data, error } = await fetchAllRows("orders", (q) =>
        q.select(ORDER_LIST_COLUMNS)
          .like("order_no", "SB-SHOP-%")
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

  const stats = useMemo(() => {
    const cod = periodOrders.filter((o) => (o.payment_mode || "").toUpperCase() === "COD");
    return {
      count: periodOrders.length,
      revenue: periodOrders.reduce((s, o) => s + money(o), 0),
      units: periodOrders.reduce((s, o) => s + (o.total_quantity || 0), 0),
      codCount: cod.length,
      codOutstanding: cod.reduce((s, o) => s + Number(o.remaining_payment || 0), 0),
    };
  }, [periodOrders]);

  const lastSynced = useMemo(() => {
    const ts = orders.map((o) => o.shopify_synced_at).filter(Boolean).sort();
    return ts.length ? ts[ts.length - 1] : null;
  }, [orders]);

  const filteredOrders = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter((o) => {
      switch (searchField) {
        case "client_name": return (o.delivery_name || "").toLowerCase().includes(q);
        case "phone": return (o.delivery_phone || "").toLowerCase().includes(q);
        case "product":
          return (o.items || []).some((i) =>
            (i.product_name || "").toLowerCase().includes(q));
        default: return (o.order_no || "").toLowerCase().includes(q);
      }
    });
  }, [orders, search, searchField]);

  const totalPages = Math.ceil(filteredOrders.length / ORDERS_PER_PAGE);
  const paginated = useMemo(
    () => filteredOrders.slice((page - 1) * ORDERS_PER_PAGE, page * ORDERS_PER_PAGE),
    [filteredOrders, page]
  );

  useEffect(() => { setPage(1); }, [search, searchField]);

  const openOrder = (order) => navigate(`/order/${order.id}`);

  if (!authChecked) return null;

  const tabLabel = (tab) => {
    if (tab.key === "orders") return `${tab.label} (${orders.length})`;
    if (tab.key === "needs-review") return `${tab.label} (${needsReview.length})`;
    return tab.label;
  };

  const renderCard = (order) => {
    const item = order.items?.[0] || {};
    const extra = (order.items?.length || 0) - 1;
    const isCod = (order.payment_mode || "").toUpperCase() === "COD";
    const flagged = order.web_order_status === "needs_review";
    const components = componentsByOrder[order.id] || [];

    return (
      <div
        key={order.id}
        className={`sho-order-card ${flagged ? "flagged" : ""}`}
        onClick={() => openOrder(order)}
      >
        <div className="sho-order-header">
          <div className="sho-order-headline">
            <span className="sho-order-no">{order.order_no}</span>
            <Badge variant={statusVariant(order.status)}>
              {getOrderStatusLabel(order.status)}
            </Badge>
            {isCod && <Badge variant="info">COD</Badge>}
            {flagged && <Badge variant="warning">Needs Review</Badge>}
          </div>
          {/* No Customer PDF for website orders: Shopify already sends the
              customer their own order confirmation, so a second invoice from
              us would be a duplicate (and could disagree with theirs). Only the
              Warehouse work order is ours to produce. */}
          <div className="sho-order-actions">
            <button
              className="sho-ghost-btn"
              onClick={(e) => handleWarehousePdf(e, order)}
              disabled={warehousePdfLoading === order.id}
            >
              {warehousePdfLoading === order.id ? "…" : "Warehouse PDF"}
            </button>
          </div>
        </div>

        <div className="sho-order-body">
          {item.image_url ? (
            <img className="sho-thumb" src={item.image_url} alt="" />
          ) : (
            <div className="sho-thumb sho-thumb-empty">SB</div>
          )}
          <div className="sho-order-main">
            <div className="sho-product">
              {item.product_name || "—"}
              {extra > 0 && <span className="sho-more"> +{extra} more</span>}
            </div>
            <div className="sho-meta">
              <span><label>Client</label>{order.delivery_name || "—"}</span>
              <span><label>Ordered</label>{formatDate(order.created_at)}</span>
              <span><label>Delivery</label>{order.delivery_date ? formatDate(order.delivery_date) : "—"}</span>
            </div>
            <div className="sho-detail-grid">
              <div><label>Amount</label><span>₹{formatIndianNumber(money(order))}</span></div>
              <div><label>Qty</label><span>{order.total_quantity || 0}</span></div>
              <div><label>Size</label><span>{item.size || "—"}</span></div>
              <div>
                <label>Top</label>
                <span>{item.top || "—"}<ColorDot color={item.top_color} /></span>
              </div>
              <div>
                <label>Bottom</label>
                <span>{item.bottom || "—"}<ColorDot color={item.bottom_color} /></span>
              </div>
              <div>
                <label>Dupatta</label>
                <span>
                  {item.includes_dupatta ? "Yes" : "No"}
                  {item.includes_dupatta && <ColorDot color={item.dupatta_color} />}
                </span>
              </div>
            </div>
            {isCod && Number(order.remaining_payment) > 0 && (
              <div className="sho-cod-line">
                To collect on delivery: <strong>₹{formatIndianNumber(order.remaining_payment)}</strong>
              </div>
            )}
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
                  <ComponentStageBadge comp={comp} />
                </div>
              ))}
            </div>
            <div className="sho-comp-actions">
              <button
                className="sho-ghost-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  setJourneyOrder({ order_no: order.order_no, components });
                }}
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
                  <div className="sho-cards-row">
                    <StatCard title="Orders" value={stats.count} />
                    <StatCard title="Revenue" value={`₹${formatIndianNumber(stats.revenue)}`} />
                    <StatCard title="Units" value={stats.units} />
                    <StatCard
                      title="COD Orders"
                      value={stats.codCount}
                      subtitle={stats.codOutstanding > 0
                        ? `₹${formatIndianNumber(stats.codOutstanding)} to collect`
                        : null}
                    />
                    <StatCard
                      title="Needs Review"
                      value={needsReview.length}
                      highlight={needsReview.length > 0}
                    />
                  </div>
                  <p className="sho-synced">
                    {lastSynced ? `Last synced ${formatDate(lastSynced)}` : "Not synced yet"}
                    {" · "}{orders.length} website orders in total
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
                        These orders are missing something production needs, so nothing
                        was guessed. Open an order to fill in the details.
                      </p>
                      <div className="sho-order-cards">
                        {needsReview.map((o) => (
                          <div key={o.id}>
                            {renderCard(o)}
                            <ul className="sho-issues">
                              {(o.web_order_issues || [])
                                .filter((i) => i.code !== "DELIVERY_DATE_DERIVED")
                                .map((i, n) => (
                                  <li key={n}><strong>{i.code}</strong> — {i.detail}</li>
                                ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </>
              )}

              {activeTab === "calendar" && (
                <>
                  <h2 className="sho-section-title">Delivery Calendar</h2>
                  <StoreCalendarTab
                    orders={readyOrders}
                    storeLabel="Shopify"
                    onOpenOrder={(orderNo) => {
                      const match = orders.find((o) => o.order_no === orderNo);
                      if (match) openOrder(match);
                    }}
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
