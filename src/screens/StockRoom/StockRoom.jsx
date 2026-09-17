import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Logo from "../../images/logo.png";
import useTabParam from "../../hooks/useTabParam";
import { isProdEnvironment } from "../../utils/appEnvironment";
import {
  loadStockRoomUser, loadStockRoomCatalogue, loadStockOrders, loadSales, loadLedger, signOutOfStockRoom,
} from "./stockRoomData";
import { WRITES_ON, SHOPIFY_SYNC_ON, COUNT_CHANGES_ON, PRODUCT_WRITES_ON, COUNT_CHANGING_ACTIONS } from "./stockRoomShopify";
import useStockRoomView from "./useStockRoomView";
import { Icon, Toast } from "./StockRoomUi";
import { formatUnits, timeAgo } from "./stockRoomModel";
import OverviewScreen from "./OverviewScreen";
import StockScreen from "./StockScreen";
import LocationsScreen, { LocationForm } from "./LocationsScreen";
import StockOrdersScreen from "./StockOrdersScreen";
import ProductsScreen from "./ProductsScreen";
import IntegrityScreen from "./IntegrityScreen";
import MovementsScreen, { TransfersScreen, ReceiveTransferForm } from "./MovementsScreen";
import NoticeBoard, { NoticeRail, useNotices } from "./NoticeBoard";
import ProductDetail from "./ProductDetail";
import StockActionForm from "./StockActionForm";
import ProductEditor from "./ProductEditor";
import ProductImport from "./ProductImport";
import "./StockRoom.css";

// ============================================================
// STOCK ROOM — the new inventory screen, at /stock-room.
//
// Runs beside /inventoryDashboard, which is untouched and stays the default.
//
// Reads existing tables for every total (stockRoomData.js). Where units are
// comes from the Stock Room's own tables (db/stock_room/*.sql); on a database
// where that SQL has not been run, the screen simply shows totals, read-only.
//
// Changes: stock actions go through database functions; product add/edit
// writes products the way AddProduct.jsx does. On production nothing can be
// changed unless REACT_APP_STOCK_ROOM_LIVE_WRITES=on, and Shopify is never
// updated unless REACT_APP_STOCK_ROOM_SHOPIFY_SYNC=on (stockRoomShopify.js).
//
// Access matches the current inventory dashboard exactly: a session, then a
// salesperson row whose role is in STOCK_ROOM_ROLES, else sign out → /login.
// The screen lives in the URL (?view=stock) so Back and refresh keep the place.
// ============================================================

const NAV = [
  { group: "Inventory", items: [
    { id: "overview", label: "Overview", icon: "overview" },
    { id: "stock", label: "Stock", icon: "stock", tag: (v) => formatUnits(v.totals.trackedUnits) },
    { id: "locations", label: "Locations", icon: "warehouse", tag: (v) => (v.ledger?.installed && v.ledger.toAssign.length ? v.ledger.toAssign.length : null), alert: true },
    { id: "stockorders", label: "Stock orders", icon: "orders", tag: (v, d) => (d.ordersReady ? v.openStockOrders.length : null), alert: true },
    { id: "movements", label: "Movements", icon: "movements", needsLedger: true },
    { id: "transfers", label: "Transfers", icon: "transfer", needsLedger: true },
  ] },
  { group: "Catalogue", items: [
    { id: "products", label: "Products", icon: "products", tag: (v) => formatUnits(v.totals.designs) },
    { id: "integrity", label: "Integrity", icon: "integrity", tag: (v) => v.integrityTotal + (v.ledger?.shopifyUnsent?.length ? 1 : 0), alert: true },
  ] },
];
const SCREENS = NAV.flatMap((g) => g.items.map((i) => i.id));
// Links saved before Warehouses became Locations still work.
const SCREEN_ALIASES = { warehouses: "locations" };

const initials = (name) => String(name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");

export default function StockRoom() {
  const navigate = useNavigate();
  const [screenParam, setScreen] = useTabParam("overview", "view");
  const requested = SCREEN_ALIASES[screenParam] || screenParam;

  const [user, setUser] = useState(null);
  const [catalogue, setCatalogue] = useState(null);
  const [ledger, setLedger] = useState(null);
  const [stockOrders, setStockOrders] = useState(null);
  const [sales, setSales] = useState(null); // { days, rows }
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [salesDays, setSalesDays] = useState(90);
  const [productId, setProductId] = useState(null);
  // Collapsed on every visit; the rail shows how many alerts wait inside.
  const [boardOpen, setBoardOpen] = useState(false);
  // Options passed when jumping between screens. `nonce` remounts the target so it picks them up.
  const [screenOpts, setScreenOpts] = useState({ nonce: 0 });
  // One dialog at a time: { kind: "action" | "product" | "import" | "location", ... }
  const [dialog, setDialog] = useState(null);
  const [toast, setToast] = useState(null);
  // Signed in, but not a role the Stock Room serves: say so, keep the session.
  const [denied, setDenied] = useState(false);

  const fail = useCallback((err) => {
    console.error("Stock Room load failed:", err);
    setError(err.message || "Could not load stock.");
  }, []);

  // Stock first, orders after. The catalogue and locations are what every
  // stock number needs; a year of orders can take several seconds more, so the
  // screens render as soon as those land and sales fill in when they arrive.
  const load = useCallback(async (days) => {
    setError(null);
    const orders = loadStockOrders().then(setStockOrders).catch(fail);
    const recent = loadSales(days).then((rows) => setSales({ days, rows })).catch(fail);
    const places = loadLedger().then(setLedger).catch((err) => { setLedger({ installed: false }); fail(err); });
    try {
      setCatalogue(await loadStockRoomCatalogue());
    } catch (err) {
      fail(err);
    }
    await Promise.all([orders, recent, places]);
  }, [fail]);

  // After a change: stock totals and locations, not a year of orders.
  const reloadStock = useCallback(async () => {
    try {
      const [cat, led] = await Promise.all([loadStockRoomCatalogue(), loadLedger()]);
      setCatalogue(cat);
      setLedger(led);
    } catch (err) {
      fail(err);
    }
  }, [fail]);

  // A longer period than what is loaded fetches the extra history once.
  useEffect(() => {
    if (!user || !sales || salesDays <= sales.days) return undefined;
    let cancelled = false;
    loadSales(salesDays)
      .then((rows) => { if (!cancelled) setSales({ days: salesDays, rows }); })
      .catch((err) => { if (!cancelled) setError(err.message || "Could not load sales."); });
    return () => { cancelled = true; };
  }, [user, sales, salesDays]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { user: u, reason } = await loadStockRoomUser();
      if (cancelled) return;
      if (!u) {
        if (reason === "no-session") navigate("/login", { replace: true });
        else setDenied(true);
        return;
      }
      setUser(u);
      load(90);
    })();
    return () => { cancelled = true; };
  }, [navigate, load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load(Math.max(90, salesDays));
    setRefreshing(false);
  }, [load, salesDays]);

  // One object for the screens. Orders and sales are empty lists until they
  // arrive; ordersReady / salesReady let a screen say "loading" instead of 0.
  const data = useMemo(() => (catalogue ? {
    ...catalogue,
    stockOrders: stockOrders || [],
    recentOrders: sales ? sales.rows : [],
    ordersReady: !!stockOrders,
    salesReady: !!sales && sales.days >= salesDays,
  } : null), [catalogue, stockOrders, sales, salesDays]);

  const view = useStockRoomView(data, salesDays, ledger);
  const ledgerInstalled = !!view?.ledger?.installed;
  const canWriteStock = WRITES_ON && ledgerInstalled;
  const canEditProducts = PRODUCT_WRITES_ON;

  const screen = SCREENS.includes(requested)
    && !(NAV.flatMap((g) => g.items).find((i) => i.id === requested)?.needsLedger && !ledgerInstalled)
    ? requested : "overview";

  const go = useCallback((id, opts = {}) => {
    setProductId(null);
    setScreenOpts((prev) => ({ ...opts, nonce: prev.nonce + 1 }));
    setScreen(id);
  }, [setScreen]);

  const openProduct = useCallback((id) => setProductId(id), []);
  // One gate for every Sell / Receive / Recount button on every screen.
  const openAction = useCallback((mode, initial = {}) => {
    if (!COUNT_CHANGES_ON && COUNT_CHANGING_ACTIONS.includes(mode)) {
      setToast({ text: "Mark sold, Receive and Recount are switched off on live data until stock counts and Shopify are linked. Placing stock and transfers still work.", tone: "warn" });
      return;
    }
    setDialog({ kind: "action", mode, initial });
  }, []);
  const openEditor = useCallback((id) => { setProductId(null); setDialog({ kind: "product", productId: id }); }, []);
  const openImport = useCallback((mode = "products") => setDialog({ kind: "import", mode }), []);
  const editLocation = useCallback((location) => setDialog({ kind: "location", location }), []);
  const openReceiveTransfer = useCallback((transfer) => { setProductId(null); setDialog({ kind: "receiveTransfer", transfer }); }, []);

  // Every dialog reports back the same way: say what happened, close, reload stock.
  const finishDialog = useCallback(async (result) => {
    setDialog(null);
    if (result?.text) setToast(result);
    await reloadStock();
  }, [reloadStock]);

  const notices = useNotices({ view, data, go, openProduct });
  // Stable, so the toast's timer is not restarted by every re-render.
  const dismissToast = useCallback(() => setToast(null), []);

  // Escape closes the board — unless a dialog is open, which Escape closes first.
  useEffect(() => {
    if (!boardOpen) return undefined;
    const onKey = (e) => { if (e.key === "Escape" && !productId && !dialog) setBoardOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [boardOpen, productId, dialog]);

  const boardOverlays = useCallback(() => window.matchMedia("(max-width: 1279px)").matches, []);

  const warehousesById = useMemo(() => {
    const map = {};
    (data?.warehouses || []).forEach((w) => { map[w.id] = w; });
    return map;
  }, [data]);

  const logout = async () => {
    await signOutOfStockRoom();
    navigate("/login", { replace: true });
  };

  const visibleNav = NAV.map((g) => ({ ...g, items: g.items.filter((i) => !i.needsLedger || ledgerInstalled) }));

  // Alert-style tags (red) only appear when there is something to act on.
  const navItem = (item, withTag) => {
    const tag = withTag && item.tag ? item.tag(view, data) : null;
    const showTag = tag !== null && tag !== undefined && !(item.alert && Number(tag) === 0);
    return (
      <button key={item.id} type="button" className="sr-nav-item" aria-current={screen === item.id ? "page" : undefined}
        onClick={() => go(item.id)}>
        <Icon name={item.icon} />{item.label}
        {showTag && <span className={`sr-nav-tag${item.alert ? " is-alert" : ""}`}>{tag}</span>}
      </button>
    );
  };

  if (denied) {
    return (
      <div className="sr">
        <div className="sr-state">
          <div className="sr-state-box">
            <h2>No access to the Stock Room</h2>
            <p className="sr-muted">Your role can't open this page. You are still signed in.</p>
            <button type="button" className="sr-btn sr-btn-primary" onClick={() => navigate(-1)}>Go back</button>
          </div>
        </div>
      </div>
    );
  }

  if (!user || (!data && !error)) {
    return (
      <div className="sr">
        <div className="sr-state"><div className="sr-state-box"><span className="sr-spinner" /><span className="sr-muted">Loading stock…</span></div></div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="sr">
        <div className="sr-state">
          <div className="sr-state-box">
            <h2>Stock could not be loaded</h2>
            <p className="sr-error">{error}</p>
            <button type="button" className="sr-btn sr-btn-primary" onClick={refresh} disabled={refreshing}>
              <Icon name="refresh" width={1.8} />{refreshing ? "Trying again…" : "Try again"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const productRow = productId ? view.rowsById[productId] : null;
  const screenProps = {
    view, openProduct, go, salesReady: data.salesReady,
    openAction, canWrite: canWriteStock, canEditProducts, openEditor, openImport, openReceiveTransfer, user,
  };

  return (
    <div className={`sr${boardOpen ? " is-board-open" : ""}`}>
      <div className="sr-status" role="status">
        {/* Which database this is, stated up front: the same screen runs
            against live and test data, and they must never be confused. */}
        <span className={isProdEnvironment ? "is-live" : undefined}>{isProdEnvironment ? "Live data" : "Test data"}</span>
        {!WRITES_ON && <span className="is-live">Read-only</span>}
        {WRITES_ON && ledgerInstalled && !COUNT_CHANGES_ON && <span className="is-live">Stock counts locked</span>}
        {WRITES_ON && ledgerInstalled && COUNT_CHANGES_ON && !SHOPIFY_SYNC_ON && <span className="is-extra">Shopify not updated from here</span>}
        <span>{formatUnits(view.totals.trackedUnits)} units</span>
        <span className="is-extra">{formatUnits(view.tracked.length)} tracked designs</span>
        <span>Updated {timeAgo(data.loadedAt)}</span>
      </div>

      <nav className="sr-nav" aria-label="Stock Room">
        <button type="button" className="sr-logo-wrap" onClick={() => go("overview")} aria-label="Stock Room overview">
          <img src={Logo} alt="Sheetal Batra" className="sr-logo" />
        </button>
        {visibleNav.map((g) => (
          <div className="sr-nav-group" key={g.group}>
            <span className="sr-label sr-nav-title">{g.group}</span>
            {g.items.map((item) => navItem(item, true))}
          </div>
        ))}
        <div className="sr-nav-foot">
          <div className="sr-who">
            <span className="sr-avatar">{initials(user.saleperson)}</span>
            <span className="sr-who-text"><b title={user.saleperson}>{user.saleperson || user.email}</b><span>{String(user.role || "").replace(/_/g, " ")}</span></span>
          </div>
          <div className="sr-foot-meta">
            Stock read <b>{timeAgo(data.loadedAt)}</b>
          </div>
          <div className="sr-foot-actions">
            <button type="button" className="sr-btn" onClick={refresh} disabled={refreshing}><Icon name="refresh" width={1.8} />{refreshing ? "Refreshing…" : "Refresh"}</button>
            <button type="button" className="sr-btn" onClick={logout}><Icon name="logout" width={1.8} />Log out</button>
          </div>
          <div className="sr-foot-meta">
            <button type="button" className="sr-linkbtn" onClick={() => navigate("/inventoryDashboard")}>Open the old inventory dashboard</button>
          </div>
        </div>
      </nav>

      <main className="sr-main">
        <div className="sr-mnav">
          {visibleNav.flatMap((g) => g.items).map((item) => navItem(item, false))}
          <button type="button" className="sr-nav-item" aria-expanded={boardOpen} onClick={() => setBoardOpen(true)}>
            <Icon name="bell" />Notices
            {notices.alertCount > 0 && <span className="sr-count is-inline">{notices.alertCount}</span>}
          </button>
          <button type="button" className="sr-nav-item" onClick={() => navigate("/inventoryDashboard")}>
            <Icon name="stock" />Old inventory dashboard
          </button>
        </div>
        {error && (
          <div style={{ padding: "12px 26px 0" }}>
            <p className="sr-error">Refresh failed, showing stock read {timeAgo(data.loadedAt)}. {error}</p>
          </div>
        )}
        {screen === "overview" && <OverviewScreen {...screenProps} days={salesDays} setDays={setSalesDays} />}
        {screen === "stock" && (
          <StockScreen key={screenOpts.nonce} {...screenProps} warehousesById={warehousesById} initialStatus={screenOpts.status} />
        )}
        {screen === "locations" && (
          <LocationsScreen {...screenProps} warehouses={data.warehouses} onEditLocation={editLocation} />
        )}
        {screen === "stockorders" && (
          <StockOrdersScreen orders={data.stockOrders} ready={data.ordersReady} view={view} openAction={openAction} canWrite={canWriteStock}
            user={user} canStartOrders={PRODUCT_WRITES_ON} />
        )}
        {screen === "movements" && <MovementsScreen {...screenProps} />}
        {screen === "transfers" && <TransfersScreen key={screenOpts.nonce} {...screenProps} initialStatus={screenOpts.status} />}
        {screen === "products" && <ProductsScreen {...screenProps} />}
        {screen === "integrity" && <IntegrityScreen {...screenProps} onShopifyRetried={finishDialog} />}
      </main>

      {!boardOpen && <NoticeRail count={notices.alertCount} onOpen={() => setBoardOpen(true)} />}
      <NoticeBoard notices={notices} data={data} open={boardOpen} onClose={() => setBoardOpen(false)}
        onRefresh={refresh} refreshing={refreshing} closeOnAct={boardOverlays} />

      {productRow && (
        <ProductDetail row={productRow} view={view} warehousesById={warehousesById} salesDays={salesDays} onClose={() => setProductId(null)}
          openAction={(mode, initial) => { setProductId(null); openAction(mode, initial); }}
          canWrite={canWriteStock} canEditProducts={canEditProducts} openEditor={openEditor} />
      )}

      {dialog?.kind === "action" && (
        <StockActionForm mode={dialog.mode} initial={dialog.initial} view={view} onClose={() => setDialog(null)} onDone={finishDialog} />
      )}
      {dialog?.kind === "product" && (
        <ProductEditor productId={dialog.productId} view={view} onClose={() => setDialog(null)} onDone={finishDialog} />
      )}
      {dialog?.kind === "import" && (
        <ProductImport mode={dialog.mode} view={view} onClose={() => setDialog(null)} onDone={finishDialog} />
      )}
      {dialog?.kind === "receiveTransfer" && (
        <ReceiveTransferForm transfer={dialog.transfer} view={view} onClose={() => setDialog(null)} onDone={finishDialog} />
      )}
      {dialog?.kind === "location" && (
        <LocationForm location={dialog.location} onClose={() => setDialog(null)} onDone={finishDialog} />
      )}

      <Toast toast={toast} onDone={dismissToast} />
    </div>
  );
}
