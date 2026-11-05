import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import Logo from "../../images/logo.png";
import LogoVideo from "../../images/logo.mp4";
import LogoVideoWebm from "../../images/logo.webm";
import NotificationBell from "../../components/NotificationBell";
import { fetchAllExhibitions, totalNetSbRevenue } from "../../utils/exhibitionService";
import useFilterParam from "../../hooks/useFilterParam";
import { buildAttention, buildBrief, buildHighlights, headline, itemShare, lapsedVips, revenueSeries } from "./ceoInsights";
import {
  biggestOrders, birthdaysSoon, briefItems, cashIn, cityBoard, clientConcentration, dateKey, dayHeat, deliveryPromise, dueSoonBoard, exhibitionBoard, healthBoard, monthlySeries, orderBook, priceBands, slowDesigns, stageBoard, targetCoach, todayPulse, vendorBoard, walkinFunnel,
} from "./ceoOwner";
import { clearSnapshots, closeAssignment, loadAssignments, loadCore, loadExtras, loadOrders, readSnapshot, saveAssignment, saveSnapshot } from "./ceoData";
import { NOTIFICATION_TYPES, sendNotification } from "../../utils/notificationService";
import { CalendarIcon, Chips, ClientsIcon, DateRange, Drawer, FilterGroup, GlobalSearch, Icon, MenuIcon, Select } from "./CeoUi";
import CeoDetail from "./CeoDetail";
import { B2bPage, ClientsPage, HomePage, OpsPage, ProductsPage, RevenuePage, StoresPage, TargetsPage, VendorsPage } from "./CeoPages";
import { AccountsPage, CashPage, ExhibitionsPage, LossesPage, OrdersPage, StockPage } from "./CeoWork";
import { isRevenueOrder, isSaleOrder } from "../../utils/revenue";
import "./CeoMakeover.css";
import { usePopup } from "../../components/Popup";
import useTabParam from "../../hooks/useTabParam";
import { getOrderChannelLabel } from "../../utils/barcodeService";
import { usePeriodFilterParam, comparisonPeriodRange, inRange, periodLabel, PERIOD_OPTIONS } from "../../components/PeriodFilter";
import { summariseQcFails, isOrderStillRunning, computeStatusStats } from "../../utils/productionMetrics";
import { cleanMerchandiserName } from "../../utils/merchandiserName";

// Comparison options (like Shopify)
const COMPARISON_OPTIONS = [
    { value: "none", label: "No comparison" },
    { value: "previous_period", label: "Previous period" },
    { value: "previous_year", label: "Previous year" },
];

const ITEMS_PER_PAGE = 15;

// ── The money rule for this dashboard ────────────────────────────────────────
// Most blocks below open-coded `net_total ?? grand_total_after_discount ??
// grand_total`, which is GROSS: an exhibition order's commission belongs to the
// partner, so SB only earned net_sb_revenue. dashboardStats already reported
// net while every other block reported gross, so the CEO's headline figure and
// the tabs underneath it disagreed. One helper, used everywhere money is summed.
const orderNetRevenue = (o) => totalNetSbRevenue([o]);
const periodRevenue = (orders) => totalNetSbRevenue(orders);

// Revenue-bearing orders only: drops cancelled/revoked/returned/refunded.
// Counting those in a denominator while excluding them from the sum is what
// made averages and growth arrows disagree with the revenue beside them.
const revenueOrdersIn = (orders, inWindow) =>
    orders.filter(o => inWindow(o.created_at) && isRevenueOrder(o));

// Sales in a window: revenue orders MINUS internal stock movements and
// alterations. Both are 0-value, so they never moved a revenue total, but they
// inflated every order count and deflated every average. Use for any block that
// counts orders or divides by a count.
const saleOrdersIn = (orders, inWindow) =>
    orders.filter(o => inWindow(o.created_at) && isSaleOrder(o));

// ── Day bucketing ────────────────────────────────────────────────────────────
// Keys carry the YEAR (buckets keyed on "D/M" merged Jan 2025 into Jan 2026 on
// one bar) and are built from LOCAL parts, not toISOString(), which is UTC and
// pushed late-evening IST orders onto the previous day.
const two = (n) => String(n).padStart(2, "0");
const dayKey = (ts) => {
    const d = new Date(ts);
    return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
};
const dayLabel = (ts) => {
    const d = new Date(ts);
    return `${d.getDate()}/${d.getMonth() + 1}`;
};









export default function CEODashboard() {
    const { showPopup, PopupComponent } = usePopup();
    const navigate = useNavigate();

    // Tab lives in the URL (?tab=...) — Back returns to the tab the user was on.
    const [tabParam, setActiveTab] = useTabParam("home");
    // Old links keep working: each older tab name opens the page that replaced it.
    const OLD_TABS = { brand_performance: "home", cancellations: "cost_expenditure" };
    const activeTab = OLD_TABS[tabParam] || tabParam;
    const [allOrders, setOrders] = useState([]);
    const [products, setProducts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [salespersonTable, setSalespersonTable] = useState([]);
    const [vendors, setVendors] = useState([]);
    const [consignmentInventory, setConsignmentInventory] = useState([]);
    // qc_records: the only real QC-failure signal.
    const [qcRecords, setQcRecords] = useState([]);
    const [qcLoaded, setQcLoaded] = useState(false);
    const [payments, setPayments] = useState([]);
    const [walkins, setWalkins] = useState([]);
    const [exhibitions, setExhibitions] = useState([]);
    const [profiles, setProfiles] = useState([]);
    const [movements, setMovements] = useState([]);
    const [assignments, setAssignments] = useState({ available: false, rows: [] });
    const [variants, setVariants] = useState({});
    const [historyLoading, setHistoryLoading] = useState(false);
    const [syncedAt, setSyncedAt] = useState(null);
    const [navOpen, setNavOpen] = useState(false);
    const [viewOpen, setViewOpen] = useState(false);
    const [stack, setStack] = useState([]);
    // The welcome shows once per browser session, then gets out of the way.
    const [welcome, setWelcome] = useState(() => {
        try { return sessionStorage.getItem("sb-ceo-welcomed") ? "off" : "on"; } catch { return "on"; }
    });

    // One period for the whole dashboard, so every page answers for the same dates.
    const { inPeriod, range: periodRangeValue, props: periodProps, timeline: periodTimeline } = usePeriodFilterParam("month", { variant: "pills" });
    const [comparison, setComparison] = useFilterParam("compare", "previous_period");
    const [channelFilter, setChannelFilter] = useFilterParam("channel", "");
    const [, setSearchParams] = useSearchParams();
    // Several values at once must go in one update, or each would undo the last.
    const setParams = useCallback((entries) => {
        setSearchParams((prev) => {
            const p = new URLSearchParams(prev);
            Object.entries(entries).forEach(([k, v]) => { if (v) p.set(k, v); else p.delete(k); });
            return p;
        }, { replace: true });
    }, [setSearchParams]);
    const scrollerRef = useRef(null);
    // Every figure follows the chosen channel.
    const orders = useMemo(() => (channelFilter ? allOrders.filter((o) => getOrderChannelLabel(o) === channelFilter) : allOrders), [allOrders, channelFilter]);
    const channelList = useMemo(() => [...new Set(allOrders.map(getOrderChannelLabel).filter(Boolean))].sort(), [allOrders]);

    // Clients tab states
    const [clientsSearch, setClientsSearch] = useState("");
    const [clientsPage, setClientsPage] = useState(1);
    const [clientsSortBy, setClientsSortBy] = useState("totalSpend");
    const [clientsStoreFilter, setClientsStoreFilter] = useState("");

    // B2B tab states
    const [b2bSearch, setB2bSearch] = useState("");
    const [b2bPage, setB2bPage] = useState(1);
    const [b2bMerchandiserFilter, setB2bMerchandiserFilter] = useState("");


    const inAnalyticsPeriod = inPeriod;
    const [currentUserEmail, setCurrentUserEmail] = useState("");
    const [userName, setUserName] = useState("");
    const [pendingExhibitions, setPendingExhibitions] = useState(0);
    const [monthlyTargets, setMonthlyTargets] = useState([]);
    const [refreshing, setRefreshing] = useState(false);

    const applyExtras = useCallback((x) => {
        setQcRecords(x.qc || []);
        setQcLoaded(true);
        setPayments(x.payments || []);
        setWalkins(x.walkins || []);
        setExhibitions(x.exhibitions || []);
        setPendingExhibitions((x.exhibitions || []).filter((e) => e.status === "pending_approval").length);
        setMonthlyTargets(x.targets || []);
        setConsignmentInventory(x.consignment || []);
        setProfiles(x.profiles || []);
        setMovements(x.movements || []);
    }, []);

    // Show the saved copy at once if there is one, then bring in fresh data behind
    // the page. With no copy, the page opens as soon as the newest orders are here.
    const refresh = useCallback(async (email, hasCopy) => {
        setRefreshing(true);
        try {
            const corePromise = loadCore();
            if (!hasCopy) {
                setHistoryLoading(true);
                const core = await corePromise;
                setProducts(core.products);
                setSalespersonTable(core.people);
                setVendors(core.vendors);
            }
            const coreDone = await corePromise;
            const extrasPromise = loadExtras();
            const clean = (rows) => rows.filter((o) => !o.is_comms);
            const allRows = await loadOrders((rows, done) => {
                if (hasCopy) return;
                setOrders(clean(rows));
                setLoading(false);
                if (done) setHistoryLoading(false);
            });
            const extras = await extrasPromise;
            const finalOrders = clean(allRows);
            setOrders(finalOrders);
            setProducts(coreDone.products);
            setSalespersonTable(coreDone.people);
            setVendors(coreDone.vendors);
            applyExtras(extras);
            setHistoryLoading(false);
            setLoading(false);
            setSyncedAt(new Date());
            saveSnapshot(email, { orders: finalOrders, ...coreDone, extras });
        } catch (err) {
            console.error("Error fetching data:", err);
            setHistoryLoading(false);
            setLoading(false);
        } finally {
            setRefreshing(false);
        }
    }, [applyExtras]);

    useEffect(() => {
        const start = async () => {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) { navigate("/login", { replace: true }); return; }
            const email = session.user.email?.toLowerCase() || "";

            // Only the CEO may be here.
            const { data: userRecord } = await supabase
                .from("salesperson")
                .select("role, saleperson")
                .eq("email", email)
                .single();
            if (!userRecord || userRecord.role !== "ceo") {
                await supabase.auth.signOut();
                navigate("/login", { replace: true });
                return;
            }
            setCurrentUserEmail(email);
            setUserName(userRecord.saleperson || "");
            loadAssignments().then(setAssignments);

            const snap = await readSnapshot(email);
            if (snap?.orders?.length) {
                setOrders(snap.orders);
                setProducts(snap.products || []);
                setSalespersonTable(snap.people || []);
                setVendors(snap.vendors || []);
                if (snap.extras) applyExtras(snap.extras);
                setSyncedAt(new Date(snap.savedAt));
                setLoading(false);
            }
            refresh(email, !!snap?.orders?.length);
        };
        start();
    }, [navigate, refresh, applyExtras]);

    // Let the tree finish a moment of its story, but never hold the page back.
    const firstPaintDone = !loading;
    useEffect(() => {
        if (welcome !== "on" || !firstPaintDone) return undefined;
        const timer = setTimeout(() => {
            setWelcome("fading");
            try { sessionStorage.setItem("sb-ceo-welcomed", "1"); } catch { /* private window */ }
            setTimeout(() => setWelcome("off"), 600);
        }, 3200);
        return () => clearTimeout(timer);
    }, [welcome, firstPaintDone]);

    const handleLogout = async () => { await clearSnapshots(); await supabase.auth.signOut(); navigate("/login"); };

    // Helper functions
    const isLxrtsOrder = (order) => order.items?.[0]?.sync_enabled === true;

    // Channel classifier: LXRTS → Website, B2B → B2B, store → store name
    // Channel = the shared prefix-based classifier (LXRTS is a TYPE, not a
    // channel — such orders report under the channel they were placed in).
    const getOrderChannel = getOrderChannelLabel;

    // Get actual person name (not store name) for salesperson fields
    const getOrderSalesperson = (order) => {
        // For B2B orders, use merchandiser_name or approved_by as the person
        if (order.is_b2b || (order.salesperson_store || "").toLowerCase() === "b2b") {
            return cleanMerchandiserName(order.merchandiser_name || order.salesperson) || null;
        }
        return order.salesperson || null;
    };

    // Known store names to exclude from salesperson lists
    const knownStoreNames = useMemo(() => {
        const stores = new Set();
        orders.forEach(o => {
            const s = (o.salesperson_store || "").trim();
            if (s) stores.add(s);
        });
        return stores;
    }, [orders]);

    const isPersonName = (name) => {
        if (!name || name === "-" || name === "Unknown") return false;
        return !knownStoreNames.has(name);
    };

    const calculateGrowth = (current, previous) => {
        if (previous === 0) return current > 0 ? 100 : 0;
        return ((current - previous) / previous) * 100;
    };

    // Dashboard Stats (ALL orders: store + website/LXRTS + B2B)
    const dashboardStats = useMemo(() => {
        const comparisonRange = comparisonPeriodRange(periodRangeValue, comparison);
        const allCurrent = orders.filter(o => inPeriod(o.created_at));
        const allPrevious = comparisonRange ? orders.filter(o => inRange(comparisonRange, o.created_at)) : [];
        // Sales slice drives every money/volume figure: revenue orders minus
        // internal stock movements and alterations, which are 0-value and so
        // only ever distorted the counts and AOV. The full slice is kept only to
        // count cancellations, which are by definition excluded from it.
        const currentOrders = allCurrent.filter(isSaleOrder);
        const previousOrders = allPrevious.filter(isSaleOrder);

        // This pair is deliberately gross-vs-net and must stay distinct: the
        // "Total Revenue" card is what was billed, "Net SB Revenue" is what SB
        // kept after exhibition partners took their commission.
        const totalRevenue = currentOrders.reduce(
            (sum, o) => sum + Number(o.net_total ?? o.grand_total_after_discount ?? o.grand_total ?? 0), 0);
        const netSbRev = periodRevenue(currentOrders);
        const totalOrders = currentOrders.length;
        const pendingOrders = currentOrders.filter(o => o.status !== "completed" && o.status !== "delivered").length;
        const preparedOrders = currentOrders.filter(o => o.status === "completed").length;
        const deliveredOrders = currentOrders.filter(o => o.status === "delivered").length;
        // Cancelled REAL orders: a cancelled internal stock movement is not a
        // lost sale, so it is excluded here the same way it is from the counts.
        const isCancelledSale = (o) => !isRevenueOrder(o) && !o.is_stock_order && !o.is_alteration;
        const cancelledOrders = allCurrent.filter(isCancelledSale).length;

        // Same gross basis as totalRevenue — the growth arrow sits on the Total
        // Revenue card, so comparing a net figure against it would invent drift.
        const prevRevenue = previousOrders.reduce(
            (sum, o) => sum + Number(o.net_total ?? o.grand_total_after_discount ?? o.grand_total ?? 0), 0);
        const prevTotalOrders = previousOrders.length;
        const prevPendingOrders = previousOrders.filter(o => o.status !== "completed" && o.status !== "delivered").length;
        const prevPreparedOrders = previousOrders.filter(o => o.status === "completed").length;
        const prevDeliveredOrders = previousOrders.filter(o => o.status === "delivered").length;
        const prevCancelledOrders = allPrevious.filter(isCancelledSale).length;

        return {
            totalRevenue, netSbRev, totalOrders, pendingOrders, preparedOrders, deliveredOrders, cancelledOrders,
            revenueGrowth: calculateGrowth(totalRevenue, prevRevenue),
            ordersGrowth: calculateGrowth(totalOrders, prevTotalOrders),
            pendingGrowth: calculateGrowth(pendingOrders, prevPendingOrders),
            preparedGrowth: calculateGrowth(preparedOrders, prevPreparedOrders),
            deliveredGrowth: calculateGrowth(deliveredOrders, prevDeliveredOrders),
            cancelledGrowth: calculateGrowth(cancelledOrders, prevCancelledOrders),
            showComparison: comparison !== "none" && !!periodRangeValue,
        };
    }, [orders, inPeriod, periodRangeValue, comparison]);

    const analyticsData = useMemo(() => {
        // Sales only: the store and salesperson blocks below carry per-row
        // counts alongside their sales figures.
        const validOrders = orders.filter(o => isSaleOrder(o) && inAnalyticsPeriod(o.created_at));

        // 1. Sales by Top 10 Products (net of proportional order discount)
        const productSales = {};
        validOrders.forEach(order => {
            (order.items || []).forEach(item => {
                const name = item.product_name || "Unknown";
                if (!productSales[name]) productSales[name] = { name, sales: 0, count: 0 };
                productSales[name].sales += itemShare(order, item);
                productSales[name].count += Number(item.quantity || 1);
            });
        });
        const topProducts = Object.values(productSales)
            .sort((a, b) => b.sales - a.sales)
            .slice(0, 10);

        // 2. Sales by Top 10 Colors (net of proportional order discount)
        const colorSales = {};
        validOrders.forEach(order => {
            (order.items || []).forEach(item => {
                const topColor = item.top_color?.name || item.color?.name || "Unknown";
                const bottomColor = item.bottom_color?.name;
                const itemSales = itemShare(order, item);

                if (topColor && topColor !== "Unknown") {
                    if (!colorSales[topColor]) colorSales[topColor] = { name: topColor, sales: 0, count: 0 };
                    colorSales[topColor].sales += itemSales / (bottomColor ? 2 : 1);
                    colorSales[topColor].count += 1;
                }
                if (bottomColor) {
                    if (!colorSales[bottomColor]) colorSales[bottomColor] = { name: bottomColor, sales: 0, count: 0 };
                    colorSales[bottomColor].sales += itemSales / 2;
                    colorSales[bottomColor].count += 1;
                }
            });
        });
        const topColors = Object.values(colorSales)
            .sort((a, b) => b.sales - a.sales)
            .slice(0, 10);

        // 3. Sales by Store / Channel
        const storeSales = {};
        validOrders.forEach(order => {
            const store = getOrderChannel(order);
            if (!storeSales[store]) storeSales[store] = { name: store, sales: 0, count: 0 };
            storeSales[store].sales += orderNetRevenue(order);
            storeSales[store].count += 1;
        });
        const salesByStore = Object.values(storeSales).sort((a, b) => b.sales - a.sales);

        // 4. Sales and Discounts by Salesperson
        const salespersonData = {};
        validOrders.forEach(order => {
            const sp = getOrderSalesperson(order);
            if (!sp || !isPersonName(sp)) return;
            if (!salespersonData[sp]) salespersonData[sp] = { name: sp, sales: 0, discount: 0, count: 0 };
            salespersonData[sp].sales += orderNetRevenue(order);
            salespersonData[sp].discount += Number(order.discount_amount || 0);
            salespersonData[sp].count += 1;
        });
        const salesBySalesperson = Object.values(salespersonData)
            .sort((a, b) => b.sales - a.sales)
            .slice(0, 10);

        // 5. Alteration by Outfit (filter alteration orders)
        const alterationOrders = orders.filter(o => o.is_alteration && inAnalyticsPeriod(o.created_at));

        const outfitAlterations = {};
        alterationOrders.forEach(order => {
            (order.items || []).forEach(item => {
                const outfit = item.product_name || item.top || "Unknown";
                if (!outfitAlterations[outfit]) outfitAlterations[outfit] = { name: outfit, count: 0 };
                outfitAlterations[outfit].count += 1;
            });
        });
        const alterationsByOutfit = Object.values(outfitAlterations)
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);

        // 6. Alteration by Customers
        const customerAlterations = {};
        alterationOrders.forEach(order => {
            const customer = order.delivery_name || "Unknown";
            if (!customerAlterations[customer]) customerAlterations[customer] = { name: customer, count: 0 };
            customerAlterations[customer].count += 1;
        });
        const alterationsByCustomer = Object.values(customerAlterations)
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);

        return {
            topProducts,
            topColors,
            salesByStore,
            salesBySalesperson,
            alterationsByOutfit,
            alterationsByCustomer,
            totalAlterations: alterationOrders.length,
        };
    }, [orders, inAnalyticsPeriod]);


    // Inventory
    const orderValueTrend = useMemo(() => {
        // Sales only — this chart's whole point is the daily AOV line, which a
        // 0-value stock movement would drag down on whatever day it landed.
        const validOrders = saleOrdersIn(orders, inPeriod);
        const buckets = {};
        validOrders.forEach(o => {
            const key = dayKey(o.created_at);
            if (!buckets[key]) buckets[key] = { date: dayLabel(o.created_at), fullDate: key, revenue: 0, orders: 0 };
            buckets[key].revenue += orderNetRevenue(o);
            buckets[key].orders += 1;
        });
        return Object.values(buckets)
            .sort((a, b) => a.fullDate.localeCompare(b.fullDate))
            .map(b => ({ ...b, aov: b.orders > 0 ? Math.round(b.revenue / b.orders) : 0 }));
    }, [orders, inPeriod]);

    // ═══════════════════════════════════════════════════════════
    // NEW: ENHANCED ANALYTICS (bottom products, colors, flagged)
    // ═══════════════════════════════════════════════════════════
    const enhancedAnalytics = useMemo(() => {
        // Was a hand-rolled `status !== "cancelled"`, which let returned,
        // revoked and refunded orders through — the shared rule catches all of
        // them, so bottom products/colours no longer rank on undone sales.
        // (alterationOrders below keeps its own filter and is unaffected: the
        // alteration stats deliberately count the rows excluded here.)
        const validOrders = saleOrdersIn(orders, inAnalyticsPeriod);

        // Products (net of proportional order discount)
        const productSales = {};
        validOrders.forEach(order => {
            (order.items || []).forEach(item => {
                const name = item.product_name || "Unknown";
                if (!productSales[name]) productSales[name] = { name, sales: 0, count: 0 };
                productSales[name].sales += itemShare(order, item);
                productSales[name].count += Number(item.quantity || 1);
            });
        });
        const sortedProducts = Object.values(productSales).sort((a, b) => b.sales - a.sales);
        const bottomProducts = [...sortedProducts].sort((a, b) => a.sales - b.sales).slice(0, 10);

        // Colors (net of proportional order discount)
        const colorSales = {};
        validOrders.forEach(order => {
            (order.items || []).forEach(item => {
                const topColor = item.top_color?.name || item.color?.name;
                const bottomColor = item.bottom_color?.name;
                const itemSales = itemShare(order, item);
                if (topColor && topColor !== "Unknown") {
                    if (!colorSales[topColor]) colorSales[topColor] = { name: topColor, sales: 0, count: 0 };
                    colorSales[topColor].sales += bottomColor ? itemSales / 2 : itemSales;
                    colorSales[topColor].count += 1;
                }
                if (bottomColor) {
                    if (!colorSales[bottomColor]) colorSales[bottomColor] = { name: bottomColor, sales: 0, count: 0 };
                    colorSales[bottomColor].sales += itemSales / 2;
                    colorSales[bottomColor].count += 1;
                }
            });
        });
        const sortedColors = Object.values(colorSales).sort((a, b) => b.sales - a.sales);
        const bottomColors = [...sortedColors].sort((a, b) => a.sales - b.sales).slice(0, 5);

        // Alterations: flagged + avg per outfit
        const alterationOrders = orders.filter(o => o.is_alteration && inAnalyticsPeriod(o.created_at));

        const outfitAlterations = {};
        alterationOrders.forEach(order => {
            (order.items || []).forEach(item => {
                const outfit = item.product_name || "Unknown";
                if (!outfitAlterations[outfit]) outfitAlterations[outfit] = { name: outfit, count: 0 };
                outfitAlterations[outfit].count += 1;
            });
        });
        const totalAlterations = alterationOrders.length;
        const totalProductsSold = Object.values(productSales).reduce((s, p) => s + p.count, 0);
        const avgAlterationsPerOutfit = totalProductsSold > 0 ? (totalAlterations / totalProductsSold) : 0;
        const flaggedAlterations = Object.values(outfitAlterations).filter(a => a.count >= 3).sort((a, b) => b.count - a.count);

        return { bottomProducts, bottomColors, avgAlterationsPerOutfit, flaggedAlterations, totalAlterations };
    }, [orders, inAnalyticsPeriod]);

    // ═══════════════════════════════════════════════════════════
    // NEW: CLIENT ANALYTICS
    // ═══════════════════════════════════════════════════════════
    const clientAnalytics = useMemo(() => {
        // Client spend, order counts and segmentation must reflect sales that
        // stuck. Counting every row meant a cancelled order still promoted a
        // client into "Repeat (2-3)" and inflated their lifetime spend; an
        // alteration did the same, making a one-time buyer look like a repeat.
        const allOrders = orders.filter(isSaleOrder);
        const clientMap = {};
        const now = new Date();
        const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 12, now.getDate());

        allOrders.forEach(order => {
            const phone = order.delivery_phone || order.phone;
            const name = order.delivery_name || "Unknown";
            if (!phone) return;
            if (!clientMap[phone]) {
                clientMap[phone] = {
                    name, phone,
                    city: order.delivery_city || order.city || "-",
                    totalSpend: 0, spend12M: 0, orderCount: 0, items: 0,
                    firstOrder: order.created_at, lastOrder: order.created_at,
                    stores: new Set(),
                };
            }
            const c = clientMap[phone];
            const amount = orderNetRevenue(order);
            c.totalSpend += amount;
            c.orderCount += 1;
            c.items += (order.items?.reduce((q, it) => q + (it.quantity || 1), 0) || 0);
            const ch = getOrderChannel(order);
            if (ch) c.stores.add(ch);
            if (new Date(order.created_at) >= twelveMonthsAgo) c.spend12M += amount;
            if (new Date(order.created_at) < new Date(c.firstOrder)) c.firstOrder = order.created_at;
            if (new Date(order.created_at) > new Date(c.lastOrder)) c.lastOrder = order.created_at;
            if (c.name === "Unknown" && name !== "Unknown") c.name = name;
        });

        const clients = Object.values(clientMap).map(c => ({
            ...c, stores: Array.from(c.stores).join(", "),
            avgOrderValue: c.orderCount > 0 ? c.totalSpend / c.orderCount : 0,
        }));

        const totalClients = clients.length;
        const repeatClients = clients.filter(c => c.orderCount > 1);
        const repeatRate = totalClients > 0 ? ((repeatClients.length / totalClients) * 100) : 0;

        const newClients = clients.filter(c => inPeriod(c.firstOrder));

        // Apply store filter
        let sortedClients = [...clients];
        if (clientsStoreFilter) {
            sortedClients = sortedClients.filter(c => c.stores.includes(clientsStoreFilter));
        }

        // Sort
        if (clientsSortBy === "totalSpend") sortedClients.sort((a, b) => b.totalSpend - a.totalSpend);
        else if (clientsSortBy === "orderCount") sortedClients.sort((a, b) => b.orderCount - a.orderCount);
        else if (clientsSortBy === "recent") sortedClients.sort((a, b) => new Date(b.lastOrder) - new Date(a.lastOrder));

        // Search
        if (clientsSearch.trim()) {
            const q = clientsSearch.toLowerCase();
            sortedClients = sortedClients.filter(c =>
                c.name?.toLowerCase().includes(q) || c.phone?.includes(q) || c.city?.toLowerCase().includes(q)
            );
        }

        const clientsTotalPages = Math.ceil(sortedClients.length / ITEMS_PER_PAGE);
        const currentClients = sortedClients.slice((clientsPage - 1) * ITEMS_PER_PAGE, clientsPage * ITEMS_PER_PAGE);

        const segmentation = [
            { name: "New", value: newClients.length },
            { name: "One-time", value: clients.filter(c => c.orderCount === 1).length },
            { name: "Repeat (2-3)", value: clients.filter(c => c.orderCount >= 2 && c.orderCount <= 3).length },
            { name: "Loyal (4+)", value: clients.filter(c => c.orderCount >= 4).length },
        ];

        const storeClients = {};
        clients.forEach(c => {
            (c.stores || "").split(", ").filter(Boolean).forEach(store => {
                if (!storeClients[store]) storeClients[store] = { name: store, count: 0, spend: 0 };
                storeClients[store].count += 1;
                storeClients[store].spend += c.totalSpend;
            });
        });

        // Unique store list for filter dropdown
        const storeList = Object.keys(storeClients).sort();

        return {
            totalClients, repeatRate: repeatRate.toFixed(1), newClientsCount: newClients.length,
            currentClients, clientsTotalPages, sortedClients,
            segmentation, storeClients: Object.values(storeClients).sort((a, b) => b.spend - a.spend),
            topClients: [...clients].sort((a, b) => b.totalSpend - a.totalSpend).slice(0, 10),
            storeList,
        };
    }, [orders, inPeriod, clientsSearch, clientsPage, clientsSortBy, clientsStoreFilter]);

    // ═══════════════════════════════════════════════════════════
    // NEW: B2B STATS
    // ═══════════════════════════════════════════════════════════
    const b2bStats = useMemo(() => {
        // Real B2B sales only — a cancelled B2B order was counting toward
        // account sales, order-type values and the growth arrows, and a
        // B2BSTOCK movement was counting as a B2B order.
        const allB2bOrders = orders.filter(o => getOrderChannel(o) === "B2B" && isSaleOrder(o));
        let currentB2b = allB2bOrders.filter(o => inPeriod(o.created_at));

        // Merchandiser filter
        const merchandiserList = salespersonTable.filter(s => s.role === "merchandiser").map(s => cleanMerchandiserName(s.saleperson)).sort();
        if (b2bMerchandiserFilter) {
            currentB2b = currentB2b.filter(o =>
                getOrderSalesperson(o) === b2bMerchandiserFilter
            );
        }

        // Order type breakdown
        const buyoutOrders = currentB2b.filter(o => o.b2b_order_type === "Buyout");
        const consignmentOrders = currentB2b.filter(o => o.b2b_order_type === "Consignment");
        const clientOrderOrders = currentB2b.filter(o => o.b2b_order_type === "Client Order");
        const buyoutValue = periodRevenue(buyoutOrders);
        const consignmentValue = periodRevenue(consignmentOrders);
        const clientOrderValue = periodRevenue(clientOrderOrders);

        // Client sales map
        // Keyed on vendor_id FIRST: delivery_name is free text, so one account
        // spelled two ways ("Aza", "AZA Fashions") split into two rows and
        // neither showed the account's real volume. Matches how the B2B
        // merchandiser dashboard keys the same data.
        const b2bClientKey = (o) => {
            const vendorInfo = o.vendor_id ? vendors.find(v => v.id === o.vendor_id) : null;
            return {
                key: vendorInfo?.id || (o.delivery_name || "").trim().toLowerCase() || "unknown",
                name: vendorInfo?.store_brand_name || o.delivery_name || "Unknown",
            };
        };

        const clientSales = {};
        currentB2b.forEach(o => {
            const { key: client, name } = b2bClientKey(o);
            if (!clientSales[client]) clientSales[client] = { name, sales: 0, orders: 0, advance: 0, balance: 0, firstSeen: o.created_at };
            clientSales[client].sales += orderNetRevenue(o);
            clientSales[client].orders += 1;
            // Collections, not the order-time advance — read total_paid.
            clientSales[client].advance += Number(o.total_paid ?? o.advance_payment) || 0;
            clientSales[client].balance += Math.max(0, Number(o.net_total ?? o.grand_total_after_discount ?? o.grand_total ?? 0) - (Number(o.total_paid ?? o.advance_payment) || 0));
            if (o.created_at < clientSales[client].firstSeen) clientSales[client].firstSeen = o.created_at;
        });

        // MOM growth: compare current period vs previous same-length period
        // (no growth figure when the period is unbounded / "All time").
        const prevRange = comparisonPeriodRange(periodRangeValue, "previous_period");
        const prevB2b = prevRange ? allB2bOrders.filter(o => inRange(prevRange, o.created_at)) : [];
        const prevRevenue = periodRevenue(prevB2b);
        const totalB2bRevenue = periodRevenue(currentB2b);
        const revenueGrowth = prevRevenue > 0 ? ((totalB2bRevenue - prevRevenue) / prevRevenue * 100) : 0;
        const ordersGrowth = prevB2b.length > 0 ? ((currentB2b.length - prevB2b.length) / prevB2b.length * 100) : 0;

        // New clients this period (first order within date range)
        const allClientFirstOrders = {};
        allB2bOrders.forEach(o => {
            const { key: client } = b2bClientKey(o);
            if (!allClientFirstOrders[client] || o.created_at < allClientFirstOrders[client]) {
                allClientFirstOrders[client] = o.created_at;
            }
        });
        const newClientsCount = Object.entries(allClientFirstOrders).filter(([, firstOrder]) => inPeriod(firstOrder)).length;

        // Product analysis from B2B orders
        const productSales = {};
        currentB2b.forEach(o => {
            (o.items || []).forEach(item => {
                const name = item.product_name || "Unknown";
                if (!productSales[name]) productSales[name] = { name, qty: 0, revenue: 0 };
                productSales[name].qty += Number(item.quantity || 1);
                productSales[name].revenue += itemShare(o, item);
            });
        });
        const topB2bProducts = Object.values(productSales).sort((a, b) => b.revenue - a.revenue).slice(0, 10);

        const allClientSales = Object.values(clientSales).sort((a, b) => b.sales - a.sales);
        // Money actually collected (drives totalB2bBalance below), so total_paid.
        const totalB2bAdvance = currentB2b.reduce((s, o) => s + (Number(o.total_paid ?? o.advance_payment) || 0), 0);

        // Search filter
        let filteredB2b = allClientSales;
        if (b2bSearch.trim()) {
            const q = b2bSearch.toLowerCase();
            filteredB2b = filteredB2b.filter(c => c.name.toLowerCase().includes(q));
        }

        const b2bTotalPages = Math.ceil(filteredB2b.length / ITEMS_PER_PAGE);
        const currentB2bClients = filteredB2b.slice((b2bPage - 1) * ITEMS_PER_PAGE, b2bPage * ITEMS_PER_PAGE);

        return {
            totalB2bRevenue, totalB2bOrders: currentB2b.length, totalB2bAdvance,
            totalB2bBalance: totalB2bRevenue - totalB2bAdvance,
            revenueGrowth, ordersGrowth, newClientsCount,
            buyoutOrders: buyoutOrders.length, buyoutValue,
            consignmentOrders: consignmentOrders.length, consignmentValue,
            clientOrderOrders: clientOrderOrders.length, clientOrderValue,
            currentB2bClients, b2bTotalPages, allClientSales,
            advancePending: allClientSales.filter(c => c.balance > 0).sort((a, b) => b.balance - a.balance),
            merchandiserList, topB2bProducts,
        };
    }, [orders, inPeriod, periodRangeValue, b2bSearch, b2bPage, b2bMerchandiserFilter, salespersonTable, vendors]);

    // ═══════════════════════════════════════════════════════════
    // NEW: ENHANCED INVENTORY (Delayed deliveries)
    // ═══════════════════════════════════════════════════════════
    // ═══════════════════════════════════════════════════════════
    // NEW: FINANCIAL STATS (Discounts by channel, salesperson)
    // ═══════════════════════════════════════════════════════════
    const financialStats = useMemo(() => {
        // Discount given away on an order that was then cancelled was never a
        // real giveaway — including those overstated the discount rate.
        const validOrders = revenueOrdersIn(orders, inPeriod);

        const totalDiscount = validOrders.reduce((s, o) => s + Number(o.discount_amount || 0), 0);
        const totalRevenue = periodRevenue(validOrders);
        const grossRevenue = totalRevenue + totalDiscount;
        const discountPercent = grossRevenue > 0 ? ((totalDiscount / grossRevenue) * 100).toFixed(1) : 0;

        // By channel
        const channelDiscounts = {};
        validOrders.forEach(o => {
            const ch = getOrderChannel(o);
            if (!channelDiscounts[ch]) channelDiscounts[ch] = { name: ch, discount: 0, revenue: 0 };
            channelDiscounts[ch].discount += Number(o.discount_amount || 0);
            channelDiscounts[ch].revenue += orderNetRevenue(o);
        });

        return {
            totalDiscount, discountPercent,
            channelDiscounts: Object.values(channelDiscounts).sort((a, b) => b.discount - a.discount),
        };
    }, [orders, inPeriod]);

    // ═══════════════════════════════════════════════════════════
    // NEW: TARGETS PLACEHOLDER DATA
    // ═══════════════════════════════════════════════════════════
    const targetsData = useMemo(() => {
        // Placeholder: monthly targets will come from a targets table later
        const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const currentMonth = new Date().getMonth();

        // Calculate actual monthly revenue from orders
        // Achievement against target counts only revenue that stuck.
        const monthlyRevenue = {};
        const currentYear = new Date().getFullYear();
        orders
            .filter(o => isSaleOrder(o) && new Date(o.created_at).getFullYear() === currentYear)
            .forEach(o => {
                const m = new Date(o.created_at).getMonth();
                if (!monthlyRevenue[m]) monthlyRevenue[m] = 0;
                monthlyRevenue[m] += orderNetRevenue(o);
            });

        const monthlyData = months.map((m, i) => ({
            month: m,
            target: 0, // Placeholder — will be set from targets table
            achieved: monthlyRevenue[i] || 0,
            isFuture: i > currentMonth,
        }));

        // Store-wise growth (compare current period to previous; skipped on "All time")
        const prevRange = comparisonPeriodRange(periodRangeValue, "previous_period");
        const storeGrowth = {};
        orders.filter(isSaleOrder).forEach(o => {
            const store = getOrderChannel(o);
            if (!storeGrowth[store]) storeGrowth[store] = { name: store, current: 0, previous: 0 };
            if (inPeriod(o.created_at)) storeGrowth[store].current += orderNetRevenue(o);
            else if (prevRange && inRange(prevRange, o.created_at)) storeGrowth[store].previous += orderNetRevenue(o);
        });
        const storeGrowthList = Object.values(storeGrowth).map(s => ({
            ...s,
            growth: s.previous > 0 ? (((s.current - s.previous) / s.previous) * 100).toFixed(1) : (s.current > 0 ? 100 : 0),
        })).sort((a, b) => Number(b.growth) - Number(a.growth));

        return { monthlyData, storeGrowthList };
    }, [orders, inPeriod, periodRangeValue]);

    // ═══════════════════════════════════════════════════════════
    // CEO: STORE PERFORMANCE
    // ═══════════════════════════════════════════════════════════
    const storePerformanceStats = useMemo(() => {
        const storeOrders = orders.filter(o => !isLxrtsOrder(o) && !(o.is_b2b || (o.salesperson_store || "").toLowerCase() === "b2b"));
        // `current` drives the revenue/SA/day/daily-sales blocks, which all
        // count orders, so it is SALES only. The saIssues block below
        // deliberately uses currentAll — its whole job is to COUNT the
        // cancellations and returns that isSaleOrder excludes here.
        const currentAll = storeOrders.filter(o => inPeriod(o.created_at));
        const current = currentAll.filter(isSaleOrder);

        // Store-wise breakdown
        const storeMap = {};
        current.forEach(o => {
            const store = o.salesperson_store || "Other";
            if (!storeMap[store]) storeMap[store] = { name: store, revenue: 0, orders: 0, items: 0 };
            storeMap[store].revenue += orderNetRevenue(o);
            storeMap[store].orders += 1;
            storeMap[store].items += (o.items?.reduce((q, it) => q + (it.quantity || 1), 0) || 0);
        });
        const storeBreakdown = Object.values(storeMap).sort((a, b) => b.revenue - a.revenue);

        // SA-wise
        const saMap = {};
        current.forEach(o => {
            const sp = getOrderSalesperson(o);
            if (!sp || !isPersonName(sp)) return;
            const store = o.salesperson_store || "Other";
            if (!saMap[sp]) saMap[sp] = { name: sp, store, revenue: 0, orders: 0, items: 0, discount: 0, newClients: 0 };
            saMap[sp].revenue += orderNetRevenue(o);
            saMap[sp].orders += 1;
            saMap[sp].items += (o.items?.reduce((q, it) => q + (it.quantity || 1), 0) || 0);
            saMap[sp].discount += Number(o.discount_amount || 0);
        });
        const saBreakdown = Object.values(saMap).sort((a, b) => b.revenue - a.revenue);

        // Top-performing days
        const dayMap = {};
        current.forEach(o => {
            const d = new Date(o.created_at);
            const dayName = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][d.getDay()];
            if (!dayMap[dayName]) dayMap[dayName] = { name: dayName, revenue: 0, orders: 0 };
            dayMap[dayName].revenue += orderNetRevenue(o);
            dayMap[dayName].orders += 1;
        });
        const topDays = Object.values(dayMap).sort((a, b) => b.revenue - a.revenue);

        // SA-wise returns/refunds/exchanges/cancellations
        // currentAll, not current: these ARE the cancelled/returned rows, which
        // `current` excludes. Reading `current` here meant a cancelled order
        // could never be attributed to the SA who took it, so the whole panel
        // under-reported and "SA with most issues" was picked from a short list.
        const saIssues = {};
        currentAll.forEach(o => {
            const sp = getOrderSalesperson(o);
            if (!sp || !isPersonName(sp)) return;
            if (!saIssues[sp]) saIssues[sp] = { name: sp, refunds: 0, returns: 0, exchanges: 0, cancellations: 0, total: 0 };
            if (o.refund_reason) { saIssues[sp].refunds++; saIssues[sp].total += Number(o.net_total ?? o.grand_total_after_discount ?? o.grand_total ?? 0); }
            if (o.return_reason) { saIssues[sp].returns++; saIssues[sp].total += Number(o.net_total ?? o.grand_total_after_discount ?? o.grand_total ?? 0); }
            if (o.exchange_reason) { saIssues[sp].exchanges++; saIssues[sp].total += Number(o.net_total ?? o.grand_total_after_discount ?? o.grand_total ?? 0); }
            if (o.status === "cancelled") { saIssues[sp].cancellations++; saIssues[sp].total += Number(o.net_total ?? o.grand_total_after_discount ?? o.grand_total ?? 0); }
        });
        const saIssuesList = Object.values(saIssues).sort((a, b) => (b.refunds + b.returns + b.exchanges + b.cancellations) - (a.refunds + a.returns + a.exchanges + a.cancellations));
        const maxIssueSA = saIssuesList.length > 0 ? saIssuesList[0] : null;

        // Store-wise daily sales
        const dailySales = {};
        current.forEach(o => {
            const key = dayKey(o.created_at);
            const store = o.salesperson_store || "Other";
            const amount = orderNetRevenue(o);
            if (!dailySales[key]) dailySales[key] = { date: dayLabel(o.created_at), fullDate: key };
            if (!dailySales[key][store]) dailySales[key][store] = 0;
            dailySales[key][store] += amount;
            dailySales[key].total = (dailySales[key].total || 0) + amount;
        });
        const dailySalesData = Object.values(dailySales).sort((a, b) => a.fullDate.localeCompare(b.fullDate));

        return { storeBreakdown, saBreakdown, topDays, saIssuesList, maxIssueSA, dailySalesData, storeNames: storeBreakdown.map(s => s.name) };
    }, [orders, inPeriod]);


    // ═══════════════════════════════════════════════════════════
    // CEO: OPERATIONAL FLAGS
    // ═══════════════════════════════════════════════════════════
    const opsFlags = useMemo(() => {
        const now = new Date();
        // Delayed = still on the floor and past its delivery date. Uses the
        // shared isOrderStillRunning so dispatched-but-unstatused orders aren't
        // counted late (the plain status check missed warehouse_stage).
        const running = orders.filter(isOrderStillRunning);
        const delayed = running.filter(o => o.delivery_date && new Date(o.delivery_date) < now);

        // QC failures from qc_records, scoped to the orders this dashboard shows
        // (comms orders are filtered out of `orders`). null until loaded so the
        // card can show "—" rather than a green 0.
        const orderIds = new Set(orders.map(o => o.id));
        const qc = qcLoaded ? summariseQcFails(qcRecords.filter(r => orderIds.has(r.order_id) && inPeriod(r.created_at))) : null;

        // In Production / backlog from the real warehouse_stage signal.
        // orders.status "in_production" and production_status are dead — this
        // file's own ORDER_STATUS_OPTIONS comment already documents that ZERO
        // orders carry them, so both counts were permanently 0.
        const stats = computeStatusStats(orders);

        return {
            delayedCount: delayed.length,
            qcFailCount: qc ? qc.fail : null,
            qcFailRate: qc && qc.inspected > 0 ? qc.ratePct.toFixed(1) : null,
            qcInspected: qc ? qc.inspected : 0,
            backlogCount: stats.orderReceived,
            delayed: delayed.slice(0, 15),
            inProductionCount: stats.inProd,
        };
    }, [orders, qcRecords, qcLoaded, inPeriod]);

    // ═══════════════════════════════════════════════════════════
    // CEO: CONSIGNMENT OVERVIEW
    // ═══════════════════════════════════════════════════════════
    const consignmentStats = useMemo(() => {
        const totalSent = consignmentInventory.reduce((s, c) => s + (c.quantity_sent || 0), 0);
        const totalSold = consignmentInventory.reduce((s, c) => s + (c.quantity_sold || 0), 0);
        const totalRemaining = consignmentInventory.reduce((s, c) => s + (c.quantity_remaining || 0), 0);
        return { totalSent, totalSold, totalRemaining, consignmentValue: totalRemaining };
    }, [consignmentInventory]);

    // Reset pages
    useEffect(() => { setClientsPage(1); }, [clientsSearch, clientsSortBy, clientsStoreFilter]);
    useEffect(() => { setB2bPage(1); }, [b2bSearch]);



    // ═══ The dashboard's one brief for the chosen period ═══
    const comparisonRange = comparison === "none" ? null : comparisonPeriodRange(periodRangeValue, comparison);
    const brief = useMemo(() => buildBrief({
        orders, products, inPeriod, previousRange: comparisonRange, channelOf: getOrderChannelLabel,
    }), [orders, products, inPeriod, periodRangeValue, comparison]); // eslint-disable-line react-hooks/exhaustive-deps

    const allSales = useMemo(() => orders.filter(isSaleOrder), [orders]);
    const sparkline = useMemo(() => revenueSeries(brief.sales, brief.previous, periodRangeValue),
        [brief.sales, brief.previous, periodRangeValue]);

    const colourHex = useMemo(() => {
        const map = {};
        brief.sales.forEach((o) => (o.items || []).forEach((it) => {
            [it.top_color, it.bottom_color, it.color].forEach((c) => { if (c?.name && c?.hex) map[c.name] = c.hex; });
        }));
        return map;
    }, [brief.sales]);

    const lapsed = useMemo(() => lapsedVips(allSales), [allSales]);
    const pulse = useMemo(() => todayPulse(allSales), [allSales]);
    const book = useMemo(() => orderBook(orders), [orders]);
    const scopedPayments = useMemo(() => {
        if (!channelFilter) return payments;
        const ids = new Set(orders.map((o) => o.id));
        return payments.filter((p) => ids.has(p.order_id));
    }, [payments, orders, channelFilter]);
    const cash = useMemo(() => cashIn(allSales, scopedPayments, inPeriod), [allSales, scopedPayments, inPeriod]);
    const promise = useMemo(() => deliveryPromise(orders, inPeriod), [orders, inPeriod]);
    const bands = useMemo(() => priceBands(brief.sales), [brief.sales]);
    const big = useMemo(() => biggestOrders(brief.sales), [brief.sales]);
    const cities = useMemo(() => cityBoard(brief.sales), [brief.sales]);
    const months = useMemo(() => monthlySeries(allSales), [allSales]);
    const heat = useMemo(() => dayHeat(allSales), [allSales]);
    const slow = useMemo(() => slowDesigns(products, allSales), [products, allSales]);
    const stages = useMemo(() => stageBoard(orders), [orders]);
    const concentration = useMemo(() => clientConcentration(allSales), [allSales]);
    const birthdays = useMemo(() => birthdaysSoon(profiles, allSales), [profiles, allSales]);
    const exhibitionRows = useMemo(() => exhibitionBoard(exhibitions, allSales), [exhibitions, allSales]);
    const peopleByEmail = useMemo(() => Object.fromEntries(salespersonTable.map((s) => [String(s.email || "").toLowerCase(), s])), [salespersonTable]);
    const walkin = useMemo(() => walkinFunnel(walkins, inPeriod, peopleByEmail), [walkins, inPeriod, peopleByEmail]);
    const feed = useMemo(() => [...brief.sales.length ? allSales : []].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 7), [allSales, brief.sales.length]);

    const delayedRows = useMemo(() => {
        const now = Date.now();
        return orders.filter((o) => isSaleOrder(o) && isOrderStillRunning(o))
            .filter((o) => o.delivery_date && new Date(o.delivery_date).getTime() < now)
            .map((o) => ({
                ...o,
                channel: getOrderChannelLabel(o),
                daysLate: Math.floor((now - new Date(o.delivery_date).getTime()) / 864e5),
            }))
            .sort((a, b) => b.daysLate - a.daysLate);
    }, [orders]);
    const internalLate = useMemo(() => {
        const now = Date.now();
        return orders.filter((o) => !isSaleOrder(o) && isOrderStillRunning(o) && o.delivery_date && new Date(o.delivery_date).getTime() < now).length;
    }, [orders]);
    const delayedValue = useMemo(() => delayedRows.reduce((s, o) => s + Number(o.net_total ?? o.grand_total_after_discount ?? o.grand_total ?? 0), 0), [delayedRows]);

    // Each person's target: this month's row, or the most recent one before it.
    const saProgress = useMemo(() => {
        const now = new Date();
        const latest = {};
        monthlyTargets.forEach((r) => {
            const e = String(r.salesperson_email || "").toLowerCase();
            const stamp = r.year * 12 + r.month;
            if (!latest[e] || stamp > latest[e].stamp) latest[e] = { stamp, amount: Number(r.target_amount) || 0 };
        });
        const soldBy = {};
        allOrders.forEach((o) => {
            const d = new Date(o.created_at);
            if (!isSaleOrder(o) || d.getFullYear() !== now.getFullYear() || d.getMonth() !== now.getMonth()) return;
            const e = String(o.salesperson_email || "").toLowerCase();
            soldBy[e] = (soldBy[e] || 0) + orderNetRevenue(o);
        });
        return salespersonTable
            .filter((s) => ["salesperson", "sa_services"].includes(s.role))
            .map((s) => {
                const e = String(s.email || "").toLowerCase();
                return { email: e, name: String(s.saleperson || e).trim(), store: s.store_name || "", target: latest[e]?.amount || Number(s.sales_target) || 0, sold: soldBy[e] || 0 };
            })
            .filter((r) => r.target > 0)
            .sort((a, b) => (b.sold / b.target) - (a.sold / a.target));
    }, [monthlyTargets, salespersonTable, allOrders]);

    const attention = useMemo(() => buildAttention({
        pendingExhibitions,
        delayedCount: delayedRows.length,
        delayedValue,
        outstanding: brief.outstanding,
        qcFailRate: opsFlags.qcFailRate != null ? Number(opsFlags.qcFailRate) : null,
        qcFailCount: opsFlags.qcFailCount || 0,
        qcInspected: opsFlags.qcInspected || 0,
        cancellations: brief.aftercare.cancellations,
        previousCancellations: brief.previousAftercare?.cancellations || null,
        discountRate: brief.discount.rate,
        previousDiscountRate: comparisonRange ? brief.previousDiscount.rate : null,
        b2bBalance: b2bStats.totalB2bBalance,
        b2bPartnersOwing: b2bStats.advancePending.length,
    }), [pendingExhibitions, delayedRows, delayedValue, brief, opsFlags, b2bStats]); // eslint-disable-line react-hooks/exhaustive-deps

    // Against a period with almost no sales, "+90,000%" says nothing. Leave it out.
    const fairGrowth = comparison !== "none" && brief.previousRevenue > 0 && Math.abs(dashboardStats.revenueGrowth) < 1000 ? dashboardStats.revenueGrowth : null;
    const health = useMemo(() => healthBoard({
        growth: fairGrowth,
        cash: cash.total,
        revenue: dashboardStats.totalRevenue,
        onTimeRate: promise.rate,
        delivered: promise.delivered,
        qcRate: opsFlags.qcFailRate != null ? Number(opsFlags.qcFailRate) : null,
        qcInspected: opsFlags.qcInspected,
        returningShare: brief.mix.newRevenue + brief.mix.returningRevenue > 0 ? brief.mix.returningShare : null,
        discountRate: brief.count ? brief.discount.rate : null,
        walkinRate: walkin.rate,
        walkins: walkin.total,
    }), [fairGrowth, brief, dashboardStats, cash, promise, opsFlags, walkin]);

    // Vendor figures follow the chosen channel through each piece's order.
    const scopedMovements = useMemo(() => {
        if (!channelFilter) return movements;
        const ids = new Set(orders.map((o) => o.id));
        return movements.filter((m) => ids.has(m.order_id));
    }, [movements, orders, channelFilter]);
    const vendorStats = useMemo(() => vendorBoard(scopedMovements, inPeriod), [scopedMovements, inPeriod]);
    const dueSoon = useMemo(() => dueSoonBoard(book.dueWeek), [book]);
    const coach = useMemo(() => targetCoach(saProgress), [saProgress]);
    const peopleTotal = useMemo(() => salespersonTable.filter((s) => ["salesperson", "sa_services"].includes(s.role)).length, [salespersonTable]);
    const brief2 = useMemo(() => briefItems({
        attention,
        values: {
            delayed: delayedValue,
            outstanding: brief.outstanding.old?.value,
            cancellations: brief.aftercare.cancellations.value,
            discounts: brief.discount.value,
            b2b: b2bStats.totalB2bBalance,
        },
        dueSoon, vendors: vendorStats, coach, peopleWithTargets: saProgress.length, peopleTotal,
    }), [attention, delayedValue, brief, b2bStats, dueSoon, vendorStats, coach, saProgress, peopleTotal]);

    const assignItem = useCallback(async (item, person, note) => {
        const saved = await saveAssignment({
            item_key: item.key, title: item.title, detail: item.detail, amount: item.value, page: item.tab, note: note || null,
            assigned_to_email: person.email, assigned_to_name: person.saleperson, created_by: currentUserEmail,
        });
        setAssignments((a) => ({ ...a, rows: [saved, ...a.rows] }));
        // An in-app notice for the person. The assignment stands even if this fails.
        const sent = await sendNotification(NOTIFICATION_TYPES.CEO_ASSIGNMENT, {
            metadata: { assigned_by: (userName || "The CEO").replace(/(^|\s)[a-z]/g, (c) => c.toUpperCase()), item_title: item.title, note },
            extraRecipients: [{ email: person.email, role: person.role }],
        });
        return !!sent;
    }, [currentUserEmail, userName]);
    const finishAssignment = useCallback(async (row) => {
        await closeAssignment(row.id, currentUserEmail);
        setAssignments((a) => ({ ...a, rows: a.rows.filter((r) => r.id !== row.id) }));
    }, [currentUserEmail]);

    const open = useCallback((layer) => setStack((s) => [...s, layer]), []);
    const go = useCallback((tab) => {
        setActiveTab(tab);
        setStack([]);
        setNavOpen(false);
        scrollerRef.current?.scrollTo(0, 0);
    }, [setActiveTab]);
    const personOf = useCallback((o) => getOrderSalesperson(o), []); // eslint-disable-line react-hooks/exhaustive-deps
    const isPerson = useCallback((n) => isPersonName(n), [knownStoreNames]); // eslint-disable-line react-hooks/exhaustive-deps
    const showPeriodPicker = ["home", "revenue", "store_performance", "products_style", "client_insights", "b2b_vendor", "cost_expenditure", "targets_growth", "outstanding", "ops_flags", "vendors"].includes(activeTab);
    const reloadExhibitions = useCallback(async () => {
        const rows = await fetchAllExhibitions();
        setExhibitions(rows || []);
        setPendingExhibitions((rows || []).filter((e) => e.status === "pending_approval").length);
    }, []);

    const highlights = useMemo(() => buildHighlights({
        topChannel: brief.movers[0] || null,
        topProduct: brief.board.top[0] || null,
        risingProduct: brief.board.rising[0] || null,
        topSa: storePerformanceStats.saBreakdown[0] || null,
        clients: brief.mix,
        bestDay: brief.bestDay,
        topColour: analyticsData.topColors[0] || null,
    }).map((h) => ({
        ...h,
        open: {
            channel: () => open({ type: "channel", name: brief.movers[0]?.name }),
            product: () => open({ type: "design", name: brief.board.top[0]?.name }),
            rising: () => open({ type: "design", name: brief.board.rising[0]?.name }),
            sa: () => open({ type: "person", name: storePerformanceStats.saBreakdown[0]?.name }),
            clients: () => go("client_insights"),
            day: () => go("revenue"),
            colour: () => go("products_style"),
        }[h.id] || (() => go("revenue")),
    })), [brief, storePerformanceStats, analyticsData, open, go]);

    const periodName = periodLabel(periodTimeline);
    // Average Order Value is the Total Sales shown, divided by the orders shown.
    const averageOrder = brief.count ? dashboardStats.totalRevenue / brief.count : 0;
    const averageOrderGrowth = fairGrowth != null && brief.countGrowth != null && brief.countGrowth > -100
        ? (((1 + fairGrowth / 100) / (1 + brief.countGrowth / 100)) - 1) * 100 : null;
    const compareName = COMPARISON_OPTIONS.find((c) => c.value === comparison)?.label || "";

    const NAV = [
        { group: "", items: [{ id: "home", label: "Home", icon: "overview", tag: attention.filter((a) => a.tone === "crit").length }] },
        { group: "Money", items: [
            { id: "revenue", label: "Sales & Revenue", icon: "inr" },
            { id: "outstanding", label: "Cash & Collections", icon: "alert" },
            { id: "cost_expenditure", label: "Discounts & Returns", icon: "sale" },
            { id: "accounts", label: "Accounts", icon: "doc" },
        ] },
        { group: "Business", items: [
            { id: "store_performance", label: "Stores & Team", icon: "pin" },
            { id: "products_style", label: "Designs", icon: "products" },
            { id: "client_insights", label: "Clients", icon: "clients" },
            { id: "b2b_vendor", label: "B2B Partners", icon: "transfer" },
            { id: "exhibition_approvals", label: "Exhibitions", icon: "receive", tag: pendingExhibitions },
            { id: "targets_growth", label: "Targets & Growth", icon: "trend" },
        ] },
        { group: "Operations", items: [
            { id: "ops_flags", label: "Production", icon: "integrity" },
            { id: "vendors", label: "Vendors", icon: "warehouse" },
            { id: "orders", label: "Orders", icon: "orders" },
            { id: "inventory", label: "Stock", icon: "stock" },
        ] },
    ];
    const pages = NAV.flatMap((g) => g.items);

    const storesTarget = saProgress.reduce((s, r) => s + r.target, 0);
    const storesSold = saProgress.reduce((s, r) => s + r.sold, 0);

    const ctx = {
        vendors: vendorStats, dueSoon, coach, peopleTotal, briefList: brief2, assignments, assignItem, finishAssignment, people: salespersonTable,
        go, open, navigate, userName, startOnCancellations: tabParam === "cancellations", brief, attention, highlights, periodName, sparkline, inPeriod, periodRangeValue,
        isThisMonth: periodTimeline === "month",
        trendData: sparkline,
        sentence: headline({ revenue: dashboardStats.totalRevenue, growth: fairGrowth, periodName, topChannel: brief.movers[0], pace: brief.pace, isThisMonth: periodTimeline === "month" }),
        dash: dashboardStats,
        aovTrend: orderValueTrend,
        analytics: analyticsData,
        enhanced: enhancedAnalytics,
        colourHex,
        store: storePerformanceStats,
        targets: targetsData,
        fin: financialStats,
        ops: opsFlags,
        consignment: consignmentStats,
        clients: clientAnalytics,
        clientsUi: {
            search: clientsSearch, setSearch: setClientsSearch, page: clientsPage, setPage: setClientsPage,
            sort: clientsSortBy, setSort: setClientsSortBy, store: clientsStoreFilter, setStore: setClientsStoreFilter,
        },
        b2b: b2bStats,
        b2bUi: { search: b2bSearch, setSearch: setB2bSearch, page: b2bPage, setPage: setB2bPage, merchandiser: b2bMerchandiserFilter, setMerchandiser: setB2bMerchandiserFilter },
        lapsed, saProgress, delayedRows, delayedValue, internalLate, averageOrder, averageOrderGrowth, fairGrowth, pulse, book, cash, health, feed, birthdays, bands, big, months, heat, slow, stages, cities, concentration, promise, walkin,
        allOrders: orders, orders, allSales, products, setOrders, setProducts, variants, setVariants, showPopup,
        channelOf: getOrderChannelLabel, personOf, isPerson,
        partnerOf: (o) => vendors.find((v) => v.id === o.vendor_id)?.store_brand_name || o.delivery_name || "Unknown",
        storeOrders: (name) => brief.sales.filter((o) => (o.salesperson_store || "Other") === name),
        exhibitionRows, reloadExhibitions, currentUserEmail,
        targetProgress: storesTarget > 0 ? { target: storesTarget, stores: storesSold } : null,
        ago: (ts) => {
            const mins = Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 6e4));
            if (mins < 60) return `${mins || 1} min ago`;
            if (mins < 24 * 60) return `${Math.round(mins / 60)} hours ago`;
            const days = Math.round(mins / 1440);
            return days === 1 ? "Yesterday" : `${days} days ago`;
        },
        openDay: (key) => {
            const list = allSales.filter((o) => dateKey(o.created_at) === key);
            open({ type: "orders", title: new Date(`${key}T12:00:00`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" }), sub: "Sales on this day", orders: list });
        },
        openMonth: (m) => {
            if (!m?.start) return;
            const list = allSales.filter((o) => {
                const d = new Date(o.created_at);
                return d.getFullYear() === m.start.getFullYear() && d.getMonth() === m.start.getMonth();
            });
            open({ type: "orders", title: m.name, sub: "Sales in this month", orders: list });
        },
    };

    const navItem = (item) => (
        <button key={item.id} type="button" className="ceo-nav-item" aria-current={activeTab === item.id ? "page" : undefined} onClick={() => go(item.id)}>
            {item.icon === "clients" ? <ClientsIcon /> : <Icon name={item.icon} />}{item.label}
            {item.tag > 0 && <span className="ceo-nav-tag">{item.tag}</span>}
        </button>
    );
    const shortName = (userName || "Sheetal").trim().split(/\s+/)[0];
    const hour = new Date().getHours();
    const welcomeLine = hour < 5 ? "Burning the midnight oil. Your house, at a glance."
        : hour < 12 ? "Your house is awake. Here is how the day is shaping up."
        : hour < 17 ? "Here is how your house is doing today."
            : "Here is how your house did today.";

    return (
        <>
        {PopupComponent}
        <div className={`ceo${navOpen ? " is-nav-open" : ""}`}>
            {welcome !== "off" && (
                <div className={`ceo-welcome${welcome === "fading" ? " is-done" : ""}`} role="status">
                    <video autoPlay muted playsInline loop poster={Logo} aria-hidden="true">
                        <source src={LogoVideoWebm} type="video/webm" />
                        <source src={LogoVideo} type="video/mp4" />
                    </video>
                    <div className="ceo-welcome-hello">Welcome back, {shortName}</div>
                    <p className="ceo-welcome-line">{welcomeLine}</p>
                    {firstPaintDone && (
                        <button type="button" className="ceo-welcome-skip" onClick={() => { setWelcome("fading"); setTimeout(() => setWelcome("off"), 600); }}>Go to dashboard</button>
                    )}
                </div>
            )}
            {welcome === "off" && loading && (
                <div className="ceo-welcome" role="status">
                    <video autoPlay muted playsInline loop poster={Logo} aria-hidden="true">
                        <source src={LogoVideoWebm} type="video/webm" />
                        <source src={LogoVideo} type="video/mp4" />
                    </video>
                    <p className="ceo-welcome-state">Bringing your numbers together</p>
                </div>
            )}

            <button type="button" className="ceo-nav-veil" aria-label="Close menu" onClick={() => setNavOpen(false)} />
            <nav className="ceo-nav" aria-label="CEO dashboard">
                <button type="button" className="ceo-logo" onClick={() => go("home")} aria-label="Home">
                    <img src={Logo} alt="Sheetal Batra" />
                </button>
                {NAV.map((g) => (
                    <div className="ceo-nav-group" key={g.group || "home"}>
                        {g.group && <span className="ceo-label ceo-nav-title">{g.group}</span>}
                        {g.items.map(navItem)}
                    </div>
                ))}
                <div className="ceo-nav-foot">
                    <div className="ceo-who">
                        <span className="ceo-avatar">{(userName || "SB").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("")}</span>
                        <span><b title={userName}>{String(userName || currentUserEmail).replace(/(^|\s)[a-z]/g, (c) => c.toUpperCase())}</b><small>{syncedAt ? `Data updated ${syncedAt.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}` : "Founder"}</small></span>
                    </div>
                    <div className="ceo-foot-actions">
                        <button type="button" className="ceo-btn" onClick={() => refresh(currentUserEmail, true)} disabled={refreshing}><Icon name="refresh" />{refreshing ? "Updating" : "Refresh"}</button>
                        <button type="button" className="ceo-btn" onClick={handleLogout}><Icon name="logout" />Log out</button>
                    </div>
                </div>
            </nav>

            <main className="ceo-main">
                <div className="ceo-top">
                    <button type="button" className="ceo-icon-btn ceo-menu-btn" aria-label="Open menu" onClick={() => setNavOpen(true)}><MenuIcon /></button>
                    <GlobalSearch
                        pages={pages}
                        orders={allOrders}
                        products={products}
                        clients={clientAnalytics.sortedClients}
                        onPage={go}
                        onOrder={(o) => open({ type: "order", order: o })}
                        onClient={(c) => open({ type: "client", phone: c.phone })}
                        onDesign={(p) => open({ type: "design", name: p.name })}
                    />
                    {showPeriodPicker && (
                        <button type="button" className="ceo-view" onClick={() => setViewOpen(true)}>
                            <CalendarIcon />
                            <b>{periodName}</b>
                            <span>{channelFilter || "All channels"} · {comparison === "none" ? "No comparison" : `vs ${compareName.toLowerCase()}`}</span>
                        </button>
                    )}
                    <div className="ceo-top-end"><NotificationBell userEmail={currentUserEmail} /></div>
                </div>
                {historyLoading && !loading && <div className="ceo-history">Loading older orders. All-time figures will update in a moment.</div>}

                <div className="ceo-scroll" ref={scrollerRef}>
                    {!loading && (
                        <>
                            {activeTab === "home" && <HomePage ctx={ctx} />}
                            {activeTab === "revenue" && <RevenuePage ctx={ctx} />}
                            {activeTab === "outstanding" && <CashPage ctx={ctx} />}
                            {activeTab === "cost_expenditure" && <LossesPage ctx={ctx} />}
                            {activeTab === "accounts" && <AccountsPage ctx={ctx} />}
                            {activeTab === "store_performance" && <StoresPage ctx={ctx} />}
                            {activeTab === "products_style" && <ProductsPage ctx={ctx} />}
                            {activeTab === "client_insights" && <ClientsPage ctx={ctx} />}
                            {activeTab === "b2b_vendor" && <B2bPage ctx={ctx} />}
                            {activeTab === "exhibition_approvals" && <ExhibitionsPage ctx={ctx} />}
                            {activeTab === "targets_growth" && <TargetsPage ctx={ctx} />}
                            {activeTab === "ops_flags" && <OpsPage ctx={ctx} />}
                            {activeTab === "vendors" && <VendorsPage ctx={ctx} />}
                            {activeTab === "orders" && <OrdersPage ctx={ctx} />}
                            {activeTab === "inventory" && <StockPage ctx={ctx} />}
                        </>
                    )}
                </div>

                <div className="ceo-tabbar">
                    {[["home", "Home", "overview"], ["revenue", "Sales", "inr"], ["orders", "Orders", "orders"], ["client_insights", "Clients", "clients"]].map(([id, label, icon]) => (
                        <button key={id} type="button" aria-current={activeTab === id ? "page" : undefined} onClick={() => go(id)}>{icon === "clients" ? <ClientsIcon /> : <Icon name={icon} />}{label}</button>
                    ))}
                    <button type="button" onClick={() => setNavOpen(true)}><MenuIcon />More</button>
                </div>
            </main>

            {viewOpen && (
                <Drawer
                    title="Dashboard Filters"
                    sub="Pages that show a period or channel follow these choices"
                    onClose={() => setViewOpen(false)}
                    footer={(
                        <>
                            <button type="button" className="ceo-btn" onClick={() => setParams({ period: "", from: "", to: "", channel: "", compare: "" })}>Reset Filters</button>
                            <button type="button" className="ceo-btn is-primary" onClick={() => setViewOpen(false)}>Done</button>
                        </>
                    )}
                >
                    <FilterGroup label="Period">
                        <Chips
                            options={PERIOD_OPTIONS.map((o) => ({ value: o.value, label: o.value === "custom" ? "Choose dates" : o.label }))}
                            value={periodTimeline}
                            onChange={(v) => periodProps.setTimeline(v || "month")}
                        />
                        {periodTimeline === "custom" && (
                            <DateRange
                                from={periodProps.customFrom}
                                to={periodProps.customTo}
                                onChange={(a, b) => setParams({ from: a, to: b })}
                            />
                        )}
                    </FilterGroup>
                    <FilterGroup label="Compare With">
                        <Select label="Compare with" value={comparison} onChange={setComparison} options={COMPARISON_OPTIONS} search={false} />
                    </FilterGroup>
                    <FilterGroup label="Sales Channel">
                        <Chips options={channelList.map((c) => ({ value: c, label: c }))} value={channelFilter} onChange={setChannelFilter} />
                    </FilterGroup>
                </Drawer>
            )}

            <CeoDetail stack={stack} setStack={setStack} ctx={ctx} />
        </div>
        </>
    );
}
