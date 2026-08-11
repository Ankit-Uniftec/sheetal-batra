import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "../lib/supabaseClient";
import { fetchAllRows } from "../utils/fetchAllRows";
import formatDate from "../utils/formatDate";
import {
    enrichComponentsWithMovements,
    getOrderProgressStatus,
    getOrderProgressStatusKey,
    getOrderChannelLabel,
    getOrderChannelKey,
    CHANNEL_KEY_LABELS,
    CHANNEL_SEGMENTS,
} from "../utils/barcodeService";
import ComponentStageBadge from "./ComponentStageBadge";
import ComponentJourneyModal from "./ComponentJourneyModal";
import QcReportModal from "./QcReportModal";
import Paginator from "./Paginator";
import { usePeriodFilter } from "./PeriodFilter";
import "./ScanStationOrders.css";

// ============================================================
// ScanStationOrders — the "All Orders" tab on the standalone Scan Station.
//
// Scan-station workers (QC in particular) could previously only see the QC
// checks they personally recorded. When a garment fails, or a piece turns up
// with unclear history, they had no way to look up an order and see what it
// had already been through — every other production surface (Production
// Manager, Warehouse PH, B2B) has an all-orders list with View Journey.
//
// This is the same lookup, READ-ONLY: no edit, re-prioritise, mark-complete or
// override actions. A scanning worker must not inherit Production Manager
// powers, so the card carries exactly two buttons — View Journey and QC Report.
//
// Both modals fetch their own data (ComponentJourneyModal pulls transitions +
// vendor movements per component; QcReportModal pulls qc_records by order), so
// this component only has to hand them an order and its component rows.
// ============================================================

const ORDERS_PER_PAGE = 20;

// The status ladder as filter pills. Values are getOrderProgressStatusKey
// outputs so the pill, the badge and its colour all agree — the status is
// DERIVED from the order's components, never read off a stage column.
const STATUS_TABS = [
    { key: "all", label: "All" },
    { key: "received", label: "Order Received" },
    { key: "inprod", label: "In Production" },
    { key: "completed", label: "Completed" },
    { key: "dispatched", label: "Dispatched" },
    { key: "delivered", label: "Delivered" },
];

// Only the columns this list renders. WarehouseDashboard does select("*") on
// the same table; on a shop-floor tablet that's a lot of unused payload per row.
// The customer is delivery_name/delivery_phone — there is no customer_name
// column on orders. B2B orders leave delivery_name empty, so vendor_id is
// selected too and the client name resolves via the vendors table (see
// getClientName), exactly as the Warehouse and PM dashboards do it.
//
// is_stock_order is required by getOrderChannelLabel: a stock order raised
// through a store keeps that store's prefix, so without the flag it would
// mislabel as "Delhi Store" rather than stock.
//
// salesperson_store + shopify_order_id feed getOrderChannelKey's FALLBACK,
// which handles order numbers whose prefix isn't in CHANNEL_BY_ORDER_PREFIX
// (legacy SB-GEN-/SB-LLC-/SB-PO- rows). Without them those orders would all
// classify as "offline" and land under Store in the channel filter.
const ORDER_COLUMNS =
    "id, order_no, delivery_name, delivery_phone, delivery_date, status, warehouse_stage, created_at, is_b2b, is_private_order, is_stock_order, vendor_id, salesperson_store, shopify_order_id, approval_status, refund_status, refund_reason, exchange_reason, return_reason, revoked_at";

// Matches WarehouseDashboard's component select (the fields ComponentStageBadge
// and ComponentJourneyModal need), plus order_id so one query can cover the
// whole visible page instead of one request per card.
const COMPONENT_COLUMNS =
    "id, order_id, barcode, component_type, component_label, current_stage, previous_stage, item_index, is_active, qc_status, is_delayed, re_journey_count, stage_pass_counts, is_outside_wh, vendor_name, vendor_location, vendor_exit_at";

export default function ScanStationOrders() {
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState("");

    // Components are loaded lazily, only for the page of orders on screen.
    // The Production Manager pulls the entire order_components table up front;
    // that's tens of thousands of rows and far too heavy here.
    const [orderComponentsMap, setOrderComponentsMap] = useState({});
    const loadingPageRef = useRef(new Set());

    // B2B client names live on the vendor, not the order (delivery_name is
    // empty for B2B). Keyed by vendor_id.
    const [vendorMap, setVendorMap] = useState({});

    const [search, setSearch] = useState("");
    const [statusTab, setStatusTab] = useState("all");
    const [channel, setChannel] = useState("");
    const [page, setPage] = useState(1);
    const listRef = useRef(null);

    // Order date scope — the shared PeriodFilter, as every other list uses.
    // label:"" deliberately: every other control in this bar is a self-describing
    // "All X" select, so a lone "Date:" caption reads as clutter and knocks the
    // row out of alignment (see the note in PeriodFilter's select variant).
    const { control: periodControl, inPeriod, range: periodRange, timeline } =
        usePeriodFilter("all", { variant: "select", label: "" });

    // Journey / QC report modals.
    const [journeyOrder, setJourneyOrder] = useState(null); // { order_no, components }
    const [qcReportOrder, setQcReportOrder] = useState(null); // { id, order_no }

    // ---------- load orders (once) ----------
    useEffect(() => {
        let cancelled = false;
        (async () => {
            setLoading(true);
            const { data, error } = await fetchAllRows("orders", (q) =>
                q.select(ORDER_COLUMNS).order("created_at", { ascending: false })
            );
            if (cancelled) return;
            if (error) {
                console.error("Failed to load orders:", error);
                setLoadError("Couldn't load orders. Check your connection and try again.");
                setOrders([]);
            } else {
                // A B2B order isn't real production work until it's approved —
                // the same rule the Production Manager list applies. Private
                // orders never run the warehouse pipeline, so they're out too
                // (matching WarehouseDashboard's filter).
                const visible = (data || []).filter((o) => {
                    if (o.is_private_order) return false;
                    if (o.is_b2b) return o.approval_status === "approved";
                    return true;
                });
                setOrders(visible);
                setLoadError("");
                // Show the list now; the vendor lookup below only fills in B2B
                // client names and must not hold the whole tab on a spinner.
                setLoading(false);

                // Resolve B2B client names from the vendors they belong to.
                const vendorIds = [...new Set(
                    visible.filter((o) => o.is_b2b && o.vendor_id).map((o) => o.vendor_id)
                )];
                if (vendorIds.length > 0) {
                    const { data: vData } = await supabase
                        .from("vendors")
                        .select("id, store_brand_name, vendor_code")
                        .in("id", vendorIds);
                    if (!cancelled && vData) {
                        const vMap = {};
                        vData.forEach((v) => { vMap[v.id] = v; });
                        setVendorMap(vMap);
                    }
                }
                return;
            }
            setLoading(false);
        })();
        return () => { cancelled = true; };
    }, []);

    // Client-facing name: B2B uses the vendor's store_brand_name, retail uses
    // delivery_name. Same rule as the Warehouse and PM dashboards.
    const getClientName = useCallback((order) => {
        if (order?.is_b2b) {
            const v = order.vendor_id ? vendorMap[order.vendor_id] : null;
            return v?.store_brand_name || order.delivery_name || "";
        }
        return order?.delivery_name || "";
    }, [vendorMap]);

    // The filter key for an order. getOrderChannelKey collapses BOTH physical
    // stores into one "offline" key, but getOrderChannelLabel (what the card
    // badge shows) splits them into "Delhi Store" / "Ludhiana Store". Filtering
    // on the raw key alone would offer a single "Store" option covering ~half
    // the orders while every card under it read Delhi or Ludhiana. So offline is
    // re-split here using the same label the badge uses, and every other channel
    // passes through unchanged.
    const channelKeyOf = useCallback((order) => {
        const key = getOrderChannelKey(order);
        if (key !== "offline") return key;
        const label = getOrderChannelLabel(order);
        if (label === "Delhi Store") return "delhi";
        if (label === "Ludhiana Store") return "ludhiana";
        return "store";
    }, []);

    // Options are the channels actually PRESENT in the loaded orders, so nothing
    // in the dropdown can select to an empty list. Ordered by the shared
    // CHANNEL_SEGMENTS display order, matching every other channel control.
    //
    // Derived per order rather than read from a stored channel_key column:
    // orders don't carry one — only qc_records and order_components do.
    const channelOptions = useMemo(() => {
        const present = new Set();
        orders.forEach((o) => {
            const k = channelKeyOf(o);
            if (k) present.add(k);
        });
        const order = CHANNEL_SEGMENTS.map((seg) => seg.label);
        return [...present]
            .map((key) => ({ key, label: CHANNEL_KEY_LABELS[key] || key }))
            .sort((a, b) => {
                const ia = order.indexOf(a.label), ib = order.indexOf(b.label);
                if (ia !== -1 && ib !== -1) return ia - ib;
                if (ia !== -1) return -1;
                if (ib !== -1) return 1;
                return a.label.localeCompare(b.label);
            });
    }, [orders, channelKeyOf]);

    // ---------- filtering ----------
    const periodOrders = useMemo(
        () => (periodRange ? orders.filter((o) => inPeriod(o.created_at)) : orders),
        [orders, periodRange, inPeriod]
    );

    const filteredOrders = useMemo(() => {
        const q = search.trim().toLowerCase();
        return periodOrders.filter((o) => {
            if (channel && channelKeyOf(o) !== channel) return false;
            if (statusTab !== "all") {
                // Status is derived from the order's components; without them
                // loaded the helper falls back to order-level signals, which is
                // the correct coarser answer rather than a wrong one.
                const key = getOrderProgressStatusKey(
                    getOrderProgressStatus(o, orderComponentsMap[o.id])
                );
                if (key !== statusTab) return false;
            }
            if (!q) return true;
            const hay = `${o.order_no || ""} ${getClientName(o)} ${o.delivery_phone || ""}`.toLowerCase();
            return hay.includes(q);
        });
    }, [periodOrders, search, statusTab, channel, orderComponentsMap, getClientName, channelKeyOf]);

    // Any filter change returns to page 1, or the user can land on an empty page.
    useEffect(() => { setPage(1); }, [search, statusTab, channel, periodRange]);

    const totalPages = Math.ceil(filteredOrders.length / ORDERS_PER_PAGE);
    const currentOrders = useMemo(
        () => filteredOrders.slice((page - 1) * ORDERS_PER_PAGE, page * ORDERS_PER_PAGE),
        [filteredOrders, page]
    );

    // ---------- lazy components for the visible page ----------
    // One `.in(order_id, …)` for the whole page rather than a request per card.
    // loadingPageRef guards against re-requesting ids already in flight (the
    // effect re-runs whenever the page slice changes identity).
    const pageIds = useMemo(() => currentOrders.map((o) => o.id), [currentOrders]);

    // Deliberately NOT cancelled on cleanup. This effect re-runs whenever
    // orderComponentsMap changes — including from its own setState — so an
    // abort-on-cleanup would kill an in-flight fetch whose ids are already
    // marked in loadingPageRef, leaving those cards stuck on "Loading stages…"
    // forever. The write is an idempotent merge keyed by order id, so letting a
    // late response land is harmless; only the unmount case needs guarding.
    const mountedRef = useRef(true);
    useEffect(() => () => { mountedRef.current = false; }, []);

    useEffect(() => {
        const missing = pageIds.filter(
            (id) => !orderComponentsMap[id] && !loadingPageRef.current.has(id)
        );
        if (missing.length === 0) return;

        missing.forEach((id) => loadingPageRef.current.add(id));
        (async () => {
            try {
                const { data, error } = await supabase
                    .from("order_components")
                    .select(COMPONENT_COLUMNS)
                    .in("order_id", missing)
                    .order("component_type", { ascending: true });
                if (error) throw error;

                // Attach stages_outside so a piece out at a vendor badges as
                // "Out to Vendor (Embroidery)" (shared helper, one impl app-wide).
                const enriched = await enrichComponentsWithMovements(data || []);
                if (!mountedRef.current) return;

                const grouped = {};
                // Seed every requested id so an order with no components caches
                // as [] instead of being re-fetched on every render.
                missing.forEach((id) => { grouped[id] = []; });
                enriched.forEach((c) => {
                    (grouped[c.order_id] || (grouped[c.order_id] = [])).push(c);
                });
                setOrderComponentsMap((prev) => ({ ...prev, ...grouped }));
            } catch (err) {
                console.error("Failed to load components for orders:", err);
                // Let these ids be retried on a later pass rather than caching a failure.
                missing.forEach((id) => loadingPageRef.current.delete(id));
            }
        })();
    }, [pageIds, orderComponentsMap]);

    const openJourney = useCallback((order) => {
        setJourneyOrder({
            order_no: order.order_no,
            components: orderComponentsMap[order.id] || [],
        });
    }, [orderComponentsMap]);

    const openQcReport = useCallback((order) => {
        setQcReportOrder({ id: order.id, order_no: order.order_no });
    }, []);

    const hasFilters = search.trim() !== "" || statusTab !== "all" || channel !== "" || timeline !== "all";

    return (
        <div className="sso-panel">
            <div className="sso-filters">
                <input
                    className="sso-input sso-search"
                    type="text"
                    placeholder="Search order # or customer…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                />
                <select
                    className="sso-input"
                    value={channel}
                    onChange={(e) => setChannel(e.target.value)}
                    aria-label="Filter by channel"
                >
                    <option value="">All channels</option>
                    {channelOptions.map((c) => (
                        <option key={c.key} value={c.key}>{c.label}</option>
                    ))}
                </select>
                {periodControl}
            </div>

            <div className="sso-status-tabs">
                {STATUS_TABS.map((t) => (
                    <button
                        key={t.key}
                        className={`sso-status-tab ${statusTab === t.key ? "active" : ""}`}
                        onClick={() => setStatusTab(t.key)}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            <div className="sso-count">
                {loading
                    ? "Loading orders…"
                    : `${filteredOrders.length} order${filteredOrders.length === 1 ? "" : "s"}`}
            </div>

            <div className="sso-list" ref={listRef}>
                {loadError && <p className="sso-empty sso-error">{loadError}</p>}
                {!loadError && loading && <p className="sso-empty">Loading orders…</p>}
                {!loadError && !loading && currentOrders.length === 0 && (
                    <p className="sso-empty">
                        {hasFilters ? "No orders match these filters." : "No orders yet."}
                    </p>
                )}

                {!loading && currentOrders.map((order) => {
                    const comps = orderComponentsMap[order.id];
                    const status = getOrderProgressStatus(order, comps);
                    const statusKey = getOrderProgressStatusKey(status);
                    return (
                        <div className="sso-card" key={order.id}>
                            <div className="sso-card-head">
                                <span className="sso-order-no">{order.order_no}</span>
                                <span className="sso-channel">{getOrderChannelLabel(order)}</span>
                                <span className={`sso-status sso-status-${statusKey}`}>{status}</span>
                            </div>

                            <div className="sso-card-meta">
                                {getClientName(order) && (
                                    <span className="sso-meta-item">{getClientName(order)}</span>
                                )}
                                {order.delivery_date && (
                                    <span className="sso-meta-item">
                                        Delivery: {formatDate(order.delivery_date)}
                                    </span>
                                )}
                            </div>

                            {/* Piece badges — what the floor actually wants to see at a
                                glance before opening the full journey. */}
                            {comps === undefined ? (
                                <div className="sso-stages sso-stages-loading">Loading stages…</div>
                            ) : comps.length > 0 ? (
                                <div className="sso-stages">
                                    {comps.map((c) => (
                                        <span className="sso-stage-item" key={c.id}>
                                            <span className="sso-comp-label">
                                                {c.component_label || c.component_type}
                                            </span>
                                            <ComponentStageBadge comp={c} />
                                        </span>
                                    ))}
                                </div>
                            ) : (
                                <div className="sso-stages sso-stages-none">
                                    No pieces minted for this order yet.
                                </div>
                            )}

                            <div className="sso-card-actions">
                                {(comps || []).length > 0 && (
                                    <button className="sso-btn sso-journey-btn" onClick={() => openJourney(order)}>
                                        View Journey
                                    </button>
                                )}
                                <button className="sso-btn sso-qc-btn" onClick={() => openQcReport(order)}>
                                    QC Report
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>

            <Paginator page={page} totalPages={totalPages} onChange={setPage} scrollTo={listRef} />

            {/* Portalled to <body>: .sso-panel (and the ssp- page chrome) use
                backdrop-filter, which makes them the containing block for any
                position:fixed descendant. Rendered inline, the shared modals'
                overlay covered the panel but the centred white card was clipped
                inside it — the dark-screen-with-no-modal symptom. Same escape
                hatch NotificationBell uses for its drawer. */}
            {journeyOrder && createPortal(
                <ComponentJourneyModal
                    orderNo={journeyOrder.order_no}
                    components={journeyOrder.components}
                    onClose={() => setJourneyOrder(null)}
                />,
                document.body
            )}
            {qcReportOrder && createPortal(
                <QcReportModal
                    orderId={qcReportOrder.id}
                    orderNo={qcReportOrder.order_no}
                    onClose={() => setQcReportOrder(null)}
                />,
                document.body
            )}
        </div>
    );
}
