import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { fetchAllRows } from "../../utils/fetchAllRows";
import { usePopup } from "../../components/Popup";
import { downloadCustomerPdf, downloadWarehousePdf } from "../../utils/pdfUtils";
import formatIndianNumber from "../../utils/formatIndianNumber";
import "../AssociateDashboard.css";
import "./StockOrdersTab.css";

// Both edit and cancel windows are 36h for stock orders.
const STOCK_WINDOW_HOURS = 36;

const hoursSince = (createdAt) => {
  if (!createdAt) return Infinity;
  return (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60);
};

const isOpenStatus = (s) => {
  const st = (s || "").toLowerCase();
  return st === "order_received" || st === "pending";
};

const formatDate = (dateStr) => {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }).replace(/\//g, ".");
};

const getStatusBadgeClass = (status) => {
  switch (status?.toLowerCase()) {
    case "delivered": return "ad-status-delivered";
    case "cancelled": return "ad-status-cancelled";
    case "exchange_return": return "ad-status-exchange";
    case "processing": return "ad-status-processing";
    case "completed": return "ad-status-delivered";
    default: return "ad-status-active";
  }
};

const statusLabel = (status) => {
  const s = status?.toLowerCase();
  if (!s || s === "pending") return "Order Received";
  if (s === "order_received") return "Order Received";
  if (s === "completed") return "Completed & Dispatched";
  if (s === "delivered") return "Delivered";
  if (s === "cancelled") return "Cancelled";
  if (s === "exchange_return") return "Exchange/Return";
  return status;
};

export default function StockOrdersTab({ highlightOrderId, onHighlightShown }) {
  const { showPopup, PopupComponent } = usePopup();

  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [actionLoadingId, setActionLoadingId] = useState(null);
  const [pdfLoading, setPdfLoading] = useState(null);
  const [warehousePdfLoading, setWarehousePdfLoading] = useState(null);

  // Edit modal state
  const [editing, setEditing] = useState(null);
  const [editDate, setEditDate] = useState("");

  // Refs for scroll-to-highlight
  const cardRefs = useRef({});

  const fetchStockOrders = async () => {
    setLoading(true);
    const { data, error } = await fetchAllRows("orders", (q) =>
      q.select("*").eq("is_stock_order", true).order("created_at", { ascending: false })
    );
    if (error) {
      console.error("Stock order fetch error:", error);
      setOrders([]);
    } else {
      setOrders(data || []);
    }
    setLoading(false);
  };

  useEffect(() => { fetchStockOrders(); }, []);

  // Scroll to and briefly highlight the order if requested by the calendar tab
  useEffect(() => {
    if (!highlightOrderId || loading) return;
    const el = cardRefs.current[highlightOrderId];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("ad-order-card-flash");
      const t = setTimeout(() => {
        el.classList.remove("ad-order-card-flash");
        if (onHighlightShown) onHighlightShown();
      }, 2200);
      return () => clearTimeout(t);
    }
  }, [highlightOrderId, loading, orders, onHighlightShown]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter((o) =>
      [o.order_no, o.salesperson, o.salesperson_email, o.delivery_date]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    );
  }, [orders, search]);

  const canEdit = (o) => hoursSince(o.created_at) <= STOCK_WINDOW_HOURS && isOpenStatus(o.status);
  const canCancel = (o) => hoursSince(o.created_at) <= STOCK_WINDOW_HOURS && isOpenStatus(o.status);

  const handleCancel = (e, order) => {
    e.stopPropagation();
    showPopup({
      type: "confirm",
      title: "Cancel Stock Order",
      message: `Cancel ${order.order_no}? This cannot be undone.`,
      confirmText: "Yes, Cancel",
      cancelText: "Keep",
      onConfirm: async () => {
        setActionLoadingId(order.id);
        try {
          const { error } = await supabase
            .from("orders")
            .update({
              status: "cancelled",
              cancellation_reason: "stock_cancellation",
              cancelled_at: new Date().toISOString(),
            })
            .eq("id", order.id);
          if (error) throw error;
          setOrders((prev) =>
            prev.map((o) => (o.id === order.id ? { ...o, status: "cancelled" } : o))
          );
          showPopup({ type: "success", title: "Cancelled", message: "Stock order cancelled.", confirmText: "OK" });
        } catch (err) {
          showPopup({ type: "error", title: "Error", message: err.message || "Failed to cancel.", confirmText: "OK" });
        } finally {
          setActionLoadingId(null);
        }
      },
    });
  };

  const openEditModal = (e, order) => {
    e.stopPropagation();
    setEditing(order);
    setEditDate(order.delivery_date || "");
  };

  const saveEdit = async () => {
    if (!editing) return;
    setActionLoadingId(editing.id);
    try {
      const { error } = await supabase
        .from("orders")
        .update({ delivery_date: editDate, updated_at: new Date().toISOString() })
        .eq("id", editing.id);
      if (error) throw error;
      setOrders((prev) =>
        prev.map((o) => (o.id === editing.id ? { ...o, delivery_date: editDate } : o))
      );
      setEditing(null);
      showPopup({ type: "success", title: "Updated", message: "Stock order updated.", confirmText: "OK" });
    } catch (err) {
      showPopup({ type: "error", title: "Error", message: err.message || "Failed to update.", confirmText: "OK" });
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleCustomerPdf = async (e, order) => {
    e.stopPropagation();
    setPdfLoading(order.id);
    try { await downloadCustomerPdf(order); }
    catch (err) { console.error("PDF error:", err); }
    finally { setPdfLoading(null); }
  };

  const handleWarehousePdf = async (e, order) => {
    e.stopPropagation();
    setWarehousePdfLoading(order.id);
    try { await downloadWarehousePdf(order, null, true); }
    catch (err) { console.error("PDF error:", err); }
    finally { setWarehousePdfLoading(null); }
  };

  if (loading) return <p className="loading-text">Loading stock orders…</p>;

  return (
    <div className="stock-orders-tab">
      {PopupComponent}

      <div className="stock-toolbar">
        <input
          className="stock-search"
          placeholder="Search by order no, salesperson…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button className="stock-refresh" onClick={fetchStockOrders}>Refresh</button>
      </div>

      {filtered.length === 0 ? (
        <div className="stock-empty">No stock orders yet.</div>
      ) : (
        <div className="ad-orders-grid">
          {filtered.map((order) => {
            const item = (order.items && order.items[0]) || {};
            const imgSrc = item.image_url || "/placeholder.png";
            const editable = canEdit(order);
            const cancellable = canCancel(order);
            const remainingH = Math.max(0, Math.floor(STOCK_WINDOW_HOURS - hoursSince(order.created_at)));

            return (
              <div
                key={order.id}
                ref={(el) => { if (el) cardRefs.current[order.id] = el; }}
                data-order-id={order.id}
                className="ad-order-card"
              >
                <div className="ad-order-header">
                  <div className="ad-header-info">
                    <div className="ad-header-item">
                      <span className="ad-header-label">ORDER NO:</span>
                      <span className="ad-header-value">{order.order_no || "—"}</span>
                    </div>
                    <div className="ad-header-item">
                      <span className="ad-header-label">ORDER DATE:</span>
                      <span className="ad-header-value">{formatDate(order.created_at) || "—"}</span>
                    </div>
                    <div className="ad-header-item">
                      <span className="ad-header-label">DELIVERY:</span>
                      <span className="ad-header-value">{formatDate(order.delivery_date) || "—"}</span>
                    </div>
                    <div className="ad-header-item">
                      <span className="ad-header-label">SA:</span>
                      <span className="ad-header-value">{order.salesperson || "—"}</span>
                    </div>
                  </div>
                  <div className="ad-header-actions">
                    <div className={`ad-order-status-badge ${getStatusBadgeClass(order.status)}`}>
                      {statusLabel(order.status)}
                    </div>
                    {editable && (
                      <div className="ad-editable-badge">
                        Editable ({remainingH}h)
                      </div>
                    )}
                    <button
                      className="ad-print-pdf-btn"
                      onClick={(e) => handleCustomerPdf(e, order)}
                      disabled={pdfLoading === order.id}
                    >
                      {pdfLoading === order.id ? "..." : "📄 Customer PDF"}
                    </button>
                    <button
                      className="ad-print-pdf-btn"
                      onClick={(e) => handleWarehousePdf(e, order)}
                      disabled={warehousePdfLoading === order.id}
                    >
                      {warehousePdfLoading === order.id ? "..." : "📄 Warehouse PDF"}
                    </button>
                  </div>
                </div>

                <div className="ad-order-content">
                  <div className="ad-product-thumb">
                    <img src={imgSrc} alt={item.product_name || "Product"} />
                  </div>
                  <div className="ad-product-details">
                    <div className="ad-product-name">
                      <span className="ad-order-label">Product Name:</span>
                      <span className="ad-value">{item.product_name || "—"}</span>
                    </div>
                    <div className="ad-product-name">
                      <span className="ad-order-label">Category:</span>
                      <span className="ad-value">{item.isKids ? "Kids" : "Women"}</span>
                    </div>
                    <div className="ad-product-name">
                      <span className="ad-order-label">Location:</span>
                      <span className="ad-value">{order.mode_of_delivery || "—"}</span>
                    </div>
                    <div className="ad-details-grid">
                      <div className="ad-detail-item">
                        <span className="ad-order-label">Items:</span>
                        <span className="ad-value">{(order.items?.length || 0)}</span>
                      </div>
                      <div className="ad-detail-item">
                        <span className="ad-order-label">Qty:</span>
                        <span className="ad-value">{order.total_quantity || 1}</span>
                      </div>
                      <div className="ad-detail-item">
                        <span className="ad-order-label">Top:</span>
                        <span className="ad-value">
                          {item.top || "—"}
                          {item.top_color?.hex && (
                            <>
                              <span style={{ display: 'inline-block', width: 12, height: 12, backgroundColor: item.top_color.hex, borderRadius: '50%', marginLeft: 6, border: '1px solid #ccc', verticalAlign: 'middle' }} />
                              <span style={{ marginLeft: 4 }}>{item.top_color.name}</span>
                            </>
                          )}
                        </span>
                      </div>
                      <div className="ad-detail-item">
                        <span className="ad-order-label">Bottom:</span>
                        <span className="ad-value">
                          {item.bottom || "—"}
                          {item.bottom_color?.hex && (
                            <>
                              <span style={{ display: 'inline-block', width: 12, height: 12, backgroundColor: item.bottom_color.hex, borderRadius: '50%', marginLeft: 6, border: '1px solid #ccc', verticalAlign: 'middle' }} />
                              <span style={{ marginLeft: 4 }}>{item.bottom_color.name}</span>
                            </>
                          )}
                        </span>
                      </div>
                      <div className="ad-detail-item">
                        <span className="ad-order-label">Size:</span>
                        <span className="ad-value">{item.size || "—"}</span>
                      </div>
                      <div className="ad-detail-item">
                        <span className="ad-order-label">Type:</span>
                        <span className="ad-value">Stock</span>
                      </div>
                      {item.extras && item.extras.length > 0 && (
                        <div className="ad-detail-item" style={{ gridColumn: 'span 2' }}>
                          <span className="ad-order-label">Extras:</span>
                          <span className="ad-value">
                            {item.extras.map((extra, idx) => (
                              <span key={idx}>
                                {extra.name}
                                {extra.color?.hex && (
                                  <>
                                    <span style={{ display: 'inline-block', width: 12, height: 12, backgroundColor: extra.color.hex, borderRadius: '50%', marginLeft: 6, border: '1px solid #ccc', verticalAlign: 'middle' }} />
                                    <span style={{ marginLeft: 4 }}>{extra.color.name}</span>
                                  </>
                                )}
                                {idx < item.extras.length - 1 && <span style={{ margin: '0 8px' }}>|</span>}
                              </span>
                            ))}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Edit + Cancel actions, only when within the 36h window and order is still open */}
                {(editable || cancellable) && (
                  <div className="ad-order-actions">
                    {editable && (
                      <button
                        className="ad-action-btn ad-edit-btn"
                        onClick={(e) => openEditModal(e, order)}
                        disabled={actionLoadingId === order.id}
                      >
                        Edit
                      </button>
                    )}
                    {cancellable && (
                      <button
                        className="ad-action-btn ad-cancel-btn"
                        onClick={(e) => handleCancel(e, order)}
                        disabled={actionLoadingId === order.id}
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ─── Edit Modal ─── */}
      {editing && (
        <div className="stock-modal-overlay" onClick={() => setEditing(null)}>
          <div className="stock-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Edit {editing.order_no}</h3>
            <label className="stock-modal-field">
              <span>Delivery Date</span>
              <input
                type="date"
                value={editDate}
                onChange={(e) => setEditDate(e.target.value)}
                min={new Date().toISOString().split("T")[0]}
              />
            </label>
            <div className="stock-modal-actions">
              <button className="stock-btn" onClick={() => setEditing(null)}>Cancel</button>
              <button
                className="stock-btn stock-btn-primary"
                onClick={saveEdit}
                disabled={actionLoadingId === editing.id}
              >Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
