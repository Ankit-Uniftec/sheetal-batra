import React, { useState, useEffect, useMemo } from "react";
import { supabase } from "../../lib/supabaseClient";
import { usePopup } from "../../components/Popup";

export default function StockExchangeTab() {
  const { showPopup, PopupComponent } = usePopup();
  const [exchanges, setExchanges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [itemsData, setItemsData] = useState({});

  // Form state
  const [warehouses, setWarehouses] = useState([]);
  const [products, setProducts] = useState([]);
  const [fromWarehouse, setFromWarehouse] = useState("");
  const [toWarehouse, setToWarehouse] = useState("");
  const [selectedItems, setSelectedItems] = useState([{ product_id: "", quantity: "" }]);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [fromStock, setFromStock] = useState([]);

  useEffect(() => {
    fetchExchanges();
  }, []);

  const fetchExchanges = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("stock_exchanges")
      .select("*, from_wh:warehouses!from_warehouse_id(name), to_wh:warehouses!to_warehouse_id(name)")
      .order("created_at", { ascending: false });

    if (!error) {
      setExchanges(data || []);
    }
    setLoading(false);
  };

  const openForm = async () => {
    // Fetch warehouses and products for the form
    const [whRes, prodRes] = await Promise.all([
      supabase.from("warehouses").select("id, name").eq("is_active", true).order("name"),
      supabase.from("products").select("id, name, sku_id").order("name"),
    ]);

    setWarehouses(whRes.data || []);
    setProducts(prodRes.data || []);
    setFromWarehouse("");
    setToWarehouse("");
    setSelectedItems([{ product_id: "", quantity: "" }]);
    setNotes("");
    setFromStock([]);
    setShowForm(true);
  };

  // When "from warehouse" changes, fetch its stock
  const handleFromWarehouseChange = async (warehouseId) => {
    setFromWarehouse(warehouseId);
    setSelectedItems([{ product_id: "", quantity: "" }]);

    if (!warehouseId) {
      setFromStock([]);
      return;
    }

    const { data } = await supabase
      .from("warehouse_stock")
      .select("product_id, quantity, products(name, sku_id)")
      .eq("warehouse_id", warehouseId)
      .gt("quantity", 0);

    setFromStock(data || []);
  };

  const availableProducts = useMemo(() => {
    if (fromStock.length === 0) return products;
    // Show products that have stock in source warehouse, plus all products
    return products.map((p) => {
      const stockItem = fromStock.find((s) => s.product_id === p.id);
      return { ...p, available: stockItem?.quantity || 0 };
    });
  }, [products, fromStock]);

  const addItem = () => {
    setSelectedItems((prev) => [...prev, { product_id: "", quantity: "" }]);
  };

  const removeItem = (index) => {
    setSelectedItems((prev) => prev.filter((_, i) => i !== index));
  };

  const updateItem = (index, field, value) => {
    setSelectedItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [field]: value } : item))
    );
  };

  const handleSubmit = async () => {
    if (!fromWarehouse || !toWarehouse) {
      showPopup({ title: "Select Warehouses", message: "Please select both source and destination warehouses.", type: "warning", confirmText: "Ok" });
      return;
    }

    if (fromWarehouse === toWarehouse) {
      showPopup({ title: "Invalid", message: "Source and destination cannot be the same.", type: "warning", confirmText: "Ok" });
      return;
    }

    const validItems = selectedItems.filter((item) => item.product_id && Number(item.quantity) > 0);
    if (validItems.length === 0) {
      showPopup({ title: "Add Products", message: "Please add at least one product with quantity.", type: "warning", confirmText: "Ok" });
      return;
    }

    // Check stock availability
    for (const item of validItems) {
      const stockItem = fromStock.find((s) => s.product_id === item.product_id);
      const available = stockItem?.quantity || 0;
      if (Number(item.quantity) > available) {
        const productName = products.find((p) => p.id === item.product_id)?.name || "Product";
        showPopup({ title: "Insufficient Stock", message: `"${productName}" only has ${available} units available.`, type: "error", confirmText: "Ok" });
        return;
      }
    }

    setSubmitting(true);

    try {
      // Get current user email
      const { data: { user } } = await supabase.auth.getUser();

      // 1. Create exchange record
      const { data: exchange, error: exchangeError } = await supabase
        .from("stock_exchanges")
        .insert({
          from_warehouse_id: fromWarehouse,
          to_warehouse_id: toWarehouse,
          created_by: user?.email || "unknown",
          notes: notes.trim() || null,
          status: "completed",
        })
        .select()
        .single();

      if (exchangeError) throw exchangeError;

      // 2. Insert exchange items
      const itemsToInsert = validItems.map((item) => ({
        exchange_id: exchange.id,
        product_id: item.product_id,
        quantity: Number(item.quantity),
      }));

      const { error: itemsError } = await supabase
        .from("stock_exchange_items")
        .insert(itemsToInsert);

      if (itemsError) throw itemsError;

      // 3. Update warehouse stock — deduct from source, add to destination
      for (const item of validItems) {
        const qty = Number(item.quantity);

        // Deduct from source
        const { data: sourceStock } = await supabase
          .from("warehouse_stock")
          .select("id, quantity")
          .eq("warehouse_id", fromWarehouse)
          .eq("product_id", item.product_id)
          .single();

        if (sourceStock) {
          await supabase
            .from("warehouse_stock")
            .update({ quantity: sourceStock.quantity - qty, updated_at: new Date().toISOString() })
            .eq("id", sourceStock.id);
        }

        // Add to destination (upsert)
        const { data: destStock } = await supabase
          .from("warehouse_stock")
          .select("id, quantity")
          .eq("warehouse_id", toWarehouse)
          .eq("product_id", item.product_id)
          .maybeSingle();

        if (destStock) {
          await supabase
            .from("warehouse_stock")
            .update({ quantity: destStock.quantity + qty, updated_at: new Date().toISOString() })
            .eq("id", destStock.id);
        } else {
          await supabase
            .from("warehouse_stock")
            .insert({ warehouse_id: toWarehouse, product_id: item.product_id, quantity: qty });
        }
      }

      showPopup({ title: "Transfer Complete", message: `${validItems.length} product(s) transferred successfully.`, type: "success", confirmText: "Ok" });
      setShowForm(false);
      fetchExchanges();
    } catch (err) {
      console.error("Stock exchange error:", err);
      showPopup({ title: "Failed", message: "Could not complete the transfer. Please try again.", type: "error", confirmText: "Ok" });
    }

    setSubmitting(false);
  };

  const fetchExchangeItems = async (exchangeId) => {
    if (expandedId === exchangeId) {
      setExpandedId(null);
      return;
    }

    const { data } = await supabase
      .from("stock_exchange_items")
      .select("*, products(name, sku_id)")
      .eq("exchange_id", exchangeId);

    setItemsData((prev) => ({ ...prev, [exchangeId]: data || [] }));
    setExpandedId(exchangeId);
  };

  const formatDate = (dateStr) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  if (loading) {
    return (
      <div className="inv-tab-loading">
        <div className="inv-spinner"></div>
        <p>Loading stock exchanges...</p>
      </div>
    );
  }

  return (
    <div className="inv-exchange-tab">
      {PopupComponent}

      {/* Header */}
      <div className="inv-tab-header">
        <h2 className="inv-tab-title">Stock Exchanges ({exchanges.length})</h2>
        <button className="inv-create-btn" onClick={openForm}>
          + New Transfer
        </button>
      </div>

      {/* Exchange List */}
      {exchanges.length === 0 ? (
        <div className="inv-empty-state">
          <p>No stock exchanges yet.</p>
          <button className="inv-create-btn" onClick={openForm}>
            + Create First Transfer
          </button>
        </div>
      ) : (
        <div className="inv-exchange-list">
          {exchanges.map((ex) => (
            <div key={ex.id} className={`inv-exchange-card ${expandedId === ex.id ? "expanded" : ""}`}>
              <div className="inv-exchange-card-header" onClick={() => fetchExchangeItems(ex.id)}>
                <div className="inv-exchange-flow">
                  <span className="inv-exchange-wh">{ex.from_wh?.name || "—"}</span>
                  <span className="inv-exchange-arrow-icon">→</span>
                  <span className="inv-exchange-wh">{ex.to_wh?.name || "—"}</span>
                </div>
                <div className="inv-exchange-meta">
                  <span className={`inv-exchange-status ${ex.status}`}>{ex.status}</span>
                  <span className="inv-exchange-date">{formatDate(ex.created_at)}</span>
                  <span className="inv-exchange-by">{ex.created_by}</span>
                  <span className="inv-warehouse-arrow">{expandedId === ex.id ? "▲" : "▼"}</span>
                </div>
              </div>

              {ex.notes && <p className="inv-exchange-notes">{ex.notes}</p>}

              {expandedId === ex.id && itemsData[ex.id] && (
                <div className="inv-exchange-items">
                  <table className="inv-stock-table">
                    <thead>
                      <tr>
                        <th>SKU</th>
                        <th>Product</th>
                        <th>Quantity</th>
                      </tr>
                    </thead>
                    <tbody>
                      {itemsData[ex.id].map((item) => (
                        <tr key={item.id}>
                          <td><span className="inv-sku">{item.products?.sku_id || "—"}</span></td>
                          <td>{item.products?.name || "Unknown"}</td>
                          <td><strong>{item.quantity}</strong></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Transfer Form Modal */}
      {showForm && (
        <div className="inv-modal-overlay" onClick={() => setShowForm(false)}>
          <div className="inv-modal inv-modal-lg" onClick={(e) => e.stopPropagation()}>
            <h3 className="inv-modal-title">New Stock Transfer</h3>

            {/* Warehouse Selection */}
            <div className="inv-transfer-warehouses">
              <div className="inv-modal-field">
                <label>From Warehouse *</label>
                <select value={fromWarehouse} onChange={(e) => handleFromWarehouseChange(e.target.value)}>
                  <option value="">Select source...</option>
                  {warehouses.map((wh) => (
                    <option key={wh.id} value={wh.id}>{wh.name}</option>
                  ))}
                </select>
              </div>

              <span className="inv-transfer-arrow">→</span>

              <div className="inv-modal-field">
                <label>To Warehouse *</label>
                <select value={toWarehouse} onChange={(e) => setToWarehouse(e.target.value)}>
                  <option value="">Select destination...</option>
                  {warehouses.filter((wh) => wh.id !== fromWarehouse).map((wh) => (
                    <option key={wh.id} value={wh.id}>{wh.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Products */}
            <div className="inv-transfer-products">
              <label>Products to Transfer</label>
              {selectedItems.map((item, index) => (
                <div key={index} className="inv-transfer-row">
                  <select
                    className="inv-transfer-product-select"
                    value={item.product_id}
                    onChange={(e) => updateItem(index, "product_id", e.target.value)}
                  >
                    <option value="">Select product...</option>
                    {availableProducts.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} {p.sku_id ? `(${p.sku_id})` : ""} {p.available !== undefined ? `— ${p.available} available` : ""}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    className="inv-transfer-qty"
                    placeholder="Qty"
                    min="1"
                    value={item.quantity}
                    onChange={(e) => updateItem(index, "quantity", e.target.value)}
                  />
                  {selectedItems.length > 1 && (
                    <button className="inv-transfer-remove" onClick={() => removeItem(index)}>✕</button>
                  )}
                </div>
              ))}
              <button className="inv-transfer-add" onClick={addItem}>+ Add Product</button>
            </div>

            {/* Notes */}
            <div className="inv-modal-field">
              <label>Notes (optional)</label>
              <textarea
                placeholder="Any notes about this transfer..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
              />
            </div>

            <div className="inv-modal-actions">
              <button className="inv-modal-cancel" onClick={() => setShowForm(false)}>Cancel</button>
              <button className="inv-modal-submit" onClick={handleSubmit} disabled={submitting}>
                {submitting ? "Transferring..." : "Complete Transfer"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
