import React, { useState, useEffect } from "react";
import { supabase } from "../../lib/supabaseClient";
import { usePopup } from "../../components/Popup";

export default function WarehouseTab() {
  const { showPopup, PopupComponent } = usePopup();
  const [warehouses, setWarehouses] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);
  const [stockData, setStockData] = useState({});
  const [stockLoading, setStockLoading] = useState(null);

  // Form state (shared between create and edit)
  const [showForm, setShowForm] = useState(false);
  const [editingWarehouse, setEditingWarehouse] = useState(null); // null = create mode
  const [formData, setFormData] = useState({ name: "", location: "", items: [] });
  const [originalItemIds, setOriginalItemIds] = useState([]); // for edit diff
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchInitial();
  }, []);

  const fetchInitial = async () => {
    setLoading(true);
    const [whRes, prodRes] = await Promise.all([
      supabase.from("warehouses").select("*").eq("is_active", true).order("created_at", { ascending: false }),
      supabase.from("products").select("id, name, sku_id").order("name"),
    ]);

    if (whRes.error) console.error("Error fetching warehouses:", whRes.error);
    else setWarehouses(whRes.data || []);

    if (prodRes.data) setProducts(prodRes.data);
    setLoading(false);
  };

  const openCreateForm = () => {
    setEditingWarehouse(null);
    setFormData({ name: "", location: "", items: [{ product_id: "", quantity: "" }] });
    setOriginalItemIds([]);
    setShowForm(true);
  };

  const openEditForm = async (warehouse) => {
    setEditingWarehouse(warehouse);
    setFormData({ name: warehouse.name, location: warehouse.location || "", items: [] });

    // Fetch existing stock
    const { data } = await supabase
      .from("warehouse_stock")
      .select("id, product_id, quantity")
      .eq("warehouse_id", warehouse.id);

    const items = (data || []).map((s) => ({
      _id: s.id,
      product_id: s.product_id,
      quantity: String(s.quantity),
    }));

    setFormData((prev) => ({ ...prev, items: items.length > 0 ? items : [{ product_id: "", quantity: "" }] }));
    setOriginalItemIds((data || []).map((s) => s.id));
    setShowForm(true);
  };

  const addItemRow = () => {
    setFormData((prev) => ({ ...prev, items: [...prev.items, { product_id: "", quantity: "" }] }));
  };

  const removeItemRow = (index) => {
    setFormData((prev) => ({ ...prev, items: prev.items.filter((_, i) => i !== index) }));
  };

  const updateItemRow = (index, field, value) => {
    setFormData((prev) => ({
      ...prev,
      items: prev.items.map((item, i) => (i === index ? { ...item, [field]: value } : item)),
    }));
  };

  const handleSubmit = async () => {
    if (!formData.name.trim()) {
      showPopup({ title: "Name Required", message: "Please enter a warehouse name.", type: "warning", confirmText: "Ok" });
      return;
    }

    // Validate items — allow 0 items, but filter out empty rows
    const validItems = formData.items.filter((item) => item.product_id && Number(item.quantity) >= 0 && item.quantity !== "");

    // Check for duplicate products
    const productIds = validItems.map((i) => i.product_id);
    if (new Set(productIds).size !== productIds.length) {
      showPopup({ title: "Duplicate Products", message: "You have the same product added twice. Please combine them.", type: "warning", confirmText: "Ok" });
      return;
    }

    setSubmitting(true);

    try {
      let warehouseId;

      if (editingWarehouse) {
        // Update warehouse
        const { error: whError } = await supabase
          .from("warehouses")
          .update({ name: formData.name.trim(), location: formData.location.trim() })
          .eq("id", editingWarehouse.id);
        if (whError) throw whError;
        warehouseId = editingWarehouse.id;

        // Diff stock: figure out which to insert, update, delete
        const currentItemIds = validItems.filter((i) => i._id).map((i) => i._id);
        const toDelete = originalItemIds.filter((id) => !currentItemIds.includes(id));

        if (toDelete.length > 0) {
          const { error: delErr } = await supabase.from("warehouse_stock").delete().in("id", toDelete);
          if (delErr) throw delErr;
        }

        // Update existing + insert new
        for (const item of validItems) {
          if (item._id) {
            await supabase
              .from("warehouse_stock")
              .update({ quantity: Number(item.quantity), updated_at: new Date().toISOString() })
              .eq("id", item._id);
          } else {
            await supabase.from("warehouse_stock").insert({
              warehouse_id: warehouseId,
              product_id: item.product_id,
              quantity: Number(item.quantity),
            });
          }
        }

        // Update local state
        setWarehouses((prev) =>
          prev.map((w) => (w.id === warehouseId ? { ...w, name: formData.name.trim(), location: formData.location.trim() } : w))
        );

        // Clear expanded stock cache for this warehouse so it refetches
        setStockData((prev) => {
          const copy = { ...prev };
          delete copy[warehouseId];
          return copy;
        });
        if (expandedId === warehouseId) setExpandedId(null);

        showPopup({ title: "Updated!", message: `Warehouse "${formData.name}" updated.`, type: "success", confirmText: "Ok" });
      } else {
        // Create warehouse
        const { data: newWh, error: whError } = await supabase
          .from("warehouses")
          .insert({ name: formData.name.trim(), location: formData.location.trim() })
          .select()
          .single();
        if (whError) throw whError;
        warehouseId = newWh.id;

        // Insert stock items
        if (validItems.length > 0) {
          const stockRows = validItems.map((item) => ({
            warehouse_id: warehouseId,
            product_id: item.product_id,
            quantity: Number(item.quantity),
          }));
          const { error: stockErr } = await supabase.from("warehouse_stock").insert(stockRows);
          if (stockErr) throw stockErr;
        }

        setWarehouses((prev) => [newWh, ...prev]);
        showPopup({ title: "Created!", message: `Warehouse "${newWh.name}" created with ${validItems.length} product(s).`, type: "success", confirmText: "Ok" });
      }

      setShowForm(false);
    } catch (err) {
      console.error("Warehouse save error:", err);
      showPopup({ title: "Failed", message: err.message || "Could not save warehouse.", type: "error", confirmText: "Ok" });
    }

    setSubmitting(false);
  };

  const fetchStockForWarehouse = async (warehouseId) => {
    if (expandedId === warehouseId) {
      setExpandedId(null);
      return;
    }

    setStockLoading(warehouseId);
    const { data, error } = await supabase
      .from("warehouse_stock")
      .select("*, products(name, sku_id)")
      .eq("warehouse_id", warehouseId)
      .order("quantity", { ascending: false });

    if (!error) {
      setStockData((prev) => ({ ...prev, [warehouseId]: data || [] }));
    }
    setExpandedId(warehouseId);
    setStockLoading(null);
  };

  const getTotalStock = (warehouseId) => {
    const items = stockData[warehouseId];
    if (!items) return "—";
    return items.reduce((sum, s) => sum + (s.quantity || 0), 0);
  };

  // Filter products already selected in other rows (for each row, exclude others' selections)
  const getAvailableProducts = (currentIndex) => {
    const selectedIds = formData.items
      .map((item, i) => (i !== currentIndex ? item.product_id : null))
      .filter(Boolean);
    return products.filter((p) => !selectedIds.includes(p.id));
  };

  if (loading) {
    return (
      <div className="inv-tab-loading">
        <div className="inv-spinner"></div>
        <p>Loading warehouses...</p>
      </div>
    );
  }

  return (
    <div className="inv-warehouse-tab">
      {PopupComponent}

      {/* Header */}
      <div className="inv-tab-header">
        <h2 className="inv-tab-title">Warehouses ({warehouses.length})</h2>
        <button className="inv-create-btn" onClick={openCreateForm}>
          + Create Warehouse
        </button>
      </div>

      {/* Warehouse Cards */}
      {warehouses.length === 0 ? (
        <div className="inv-empty-state">
          <p>No warehouses created yet.</p>
          <button className="inv-create-btn" onClick={openCreateForm}>
            + Create Your First Warehouse
          </button>
        </div>
      ) : (
        <div className="inv-warehouse-list">
          {warehouses.map((wh) => (
            <div key={wh.id} className={`inv-warehouse-card ${expandedId === wh.id ? "expanded" : ""}`}>
              <div className="inv-warehouse-card-header">
                <div className="inv-warehouse-info" onClick={() => fetchStockForWarehouse(wh.id)}>
                  <h3 className="inv-warehouse-name">{wh.name}</h3>
                  {wh.location && <span className="inv-warehouse-location">{wh.location}</span>}
                </div>
                <div className="inv-warehouse-meta">
                  {stockData[wh.id] && (
                    <span className="inv-warehouse-stock-badge">
                      {stockData[wh.id].length} products · {getTotalStock(wh.id)} units
                    </span>
                  )}
                  <button className="inv-edit-btn" onClick={() => openEditForm(wh)}>
                    Edit
                  </button>
                  <span className="inv-warehouse-arrow" onClick={() => fetchStockForWarehouse(wh.id)}>
                    {stockLoading === wh.id ? "..." : expandedId === wh.id ? "▲" : "▼"}
                  </span>
                </div>
              </div>

              {/* Expanded Stock Table */}
              {expandedId === wh.id && stockData[wh.id] && (
                <div className="inv-warehouse-stock">
                  {stockData[wh.id].length === 0 ? (
                    <p className="inv-stock-empty">No stock in this warehouse yet. Click Edit to add products.</p>
                  ) : (
                    <table className="inv-stock-table">
                      <thead>
                        <tr>
                          <th>SKU</th>
                          <th>Product</th>
                          <th>Quantity</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stockData[wh.id].map((item) => (
                          <tr key={item.id}>
                            <td><span className="inv-sku">{item.products?.sku_id || "—"}</span></td>
                            <td>{item.products?.name || "Unknown"}</td>
                            <td><strong>{item.quantity}</strong></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit Modal */}
      {showForm && (
        <div className="inv-modal-overlay" onClick={() => !submitting && setShowForm(false)}>
          <div className="inv-modal inv-modal-lg" onClick={(e) => e.stopPropagation()}>
            <h3 className="inv-modal-title">{editingWarehouse ? "Edit Warehouse" : "Create Warehouse"}</h3>

            <div className="inv-modal-field">
              <label>Warehouse Name *</label>
              <input
                type="text"
                placeholder="e.g. Delhi Warehouse"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                autoFocus
              />
            </div>

            <div className="inv-modal-field">
              <label>Location</label>
              <input
                type="text"
                placeholder="e.g. New Delhi, India"
                value={formData.location}
                onChange={(e) => setFormData({ ...formData, location: e.target.value })}
              />
            </div>

            {/* Product Inventory Section */}
            <div className="inv-transfer-products">
              <label>Products & Inventory</label>
              {formData.items.length === 0 ? (
                <p className="inv-form-empty-items">No products added yet.</p>
              ) : (
                formData.items.map((item, index) => (
                  <div key={index} className="inv-transfer-row">
                    <select
                      className="inv-transfer-product-select"
                      value={item.product_id}
                      onChange={(e) => updateItemRow(index, "product_id", e.target.value)}
                    >
                      <option value="">Select product...</option>
                      {getAvailableProducts(index).map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} {p.sku_id ? `(${p.sku_id})` : ""}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      className="inv-transfer-qty"
                      placeholder="Qty"
                      min="0"
                      value={item.quantity}
                      onChange={(e) => updateItemRow(index, "quantity", e.target.value)}
                    />
                    <button className="inv-transfer-remove" onClick={() => removeItemRow(index)}>✕</button>
                  </div>
                ))
              )}
              <button className="inv-transfer-add" onClick={addItemRow}>+ Add Product</button>
            </div>

            <div className="inv-modal-actions">
              <button className="inv-modal-cancel" onClick={() => setShowForm(false)} disabled={submitting}>Cancel</button>
              <button className="inv-modal-submit" onClick={handleSubmit} disabled={submitting}>
                {submitting ? (editingWarehouse ? "Updating..." : "Creating...") : (editingWarehouse ? "Update Warehouse" : "Create Warehouse")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
