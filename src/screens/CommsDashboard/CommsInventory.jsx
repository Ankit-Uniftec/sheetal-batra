import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import formatIndianNumber from "../../utils/formatIndianNumber";
import formatDate from "../../utils/formatDate";

/**
 * CommsInventory — read-only inventory view + temp-block management.
 *
 * Two responsibilities:
 *
 * 1) Inventory listing. Reads `products` (basic info + inventory for non-LXRTS)
 *    and `product_variants` (per-size stock for LXRTS-synced products).
 *    Filters: search by name/SKU, category. CSV export of the filtered view.
 *
 * 2) Temp-blocks. Nazreen reserves a product (or LXRTS variant) for a shoot
 *    window. Active blocks render a "Reserved" badge next to the row and
 *    appear in the "Active Blocks" panel.
 *    A block is "active" when its end_date >= today AND status = 'active'.
 *    SAs trying to add a blocked product hit a hard stop in ProductForm.js.
 */

const csvEscape = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;

const downloadCsv = (filename, headers, rows) => {
  const csv = [headers.join(","), ...rows.map((r) => r.map(csvEscape).join(","))].join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

// Today as YYYY-MM-DD (local timezone) — used for date input bounds + block
// status calc.
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export default function CommsInventory({ profile, showPopup }) {
  // Data
  const [products, setProducts] = useState([]);
  const [variants, setVariants] = useState([]);    // only LXRTS variants
  const [blocks, setBlocks] = useState([]);        // active comms_inventory_blocks rows
  const [loading, setLoading] = useState(true);

  // Filter state
  const [search, setSearch] = useState("");
  const [showOutOfStock, setShowOutOfStock] = useState(true);

  // Block modal
  const [blockModal, setBlockModal] = useState(null); // { product, variant? }
  const [blockStart, setBlockStart] = useState(todayISO());
  const [blockEnd, setBlockEnd] = useState("");
  const [blockPurpose, setBlockPurpose] = useState("");
  const [blockSaving, setBlockSaving] = useState(false);

  // Initial load
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [{ data: prods }, { data: vars }, { data: blks }] = await Promise.all([
        supabase.from("products").select("id, name, sku_id, image_url, inventory, default_top, default_bottom, default_color, base_price, sync_enabled").order("name", { ascending: true }),
        supabase.from("product_variants").select("id, product_id, size, color, inventory"),
        supabase.from("comms_inventory_blocks").select("*").eq("status", "active"),
      ]);
      if (cancelled) return;
      setProducts(prods || []);
      setVariants(vars || []);
      setBlocks(blks || []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  // Helper: total inventory for a product (LXRTS sums its variants).
  const totalInventoryFor = (product) => {
    if (!product.sync_enabled) return product.inventory || 0;
    return variants
      .filter((v) => v.product_id === product.id)
      .reduce((sum, v) => sum + (v.inventory || 0), 0);
  };

  // Helper: is this product (or variant) currently blocked?
  // For non-LXRTS, only product-level block. For LXRTS, both product-level
  // and variant-level blocks count.
  const today = todayISO();
  const blocksByProduct = useMemo(() => {
    const map = {};
    blocks.forEach((b) => {
      if (b.end_date < today) return; // expired but not yet cleaned up
      if (b.product_id) {
        (map[b.product_id] ||= []).push(b);
      }
    });
    return map;
  }, [blocks, today]);

  const blocksByVariant = useMemo(() => {
    const map = {};
    blocks.forEach((b) => {
      if (b.end_date < today) return;
      if (b.variant_id) {
        (map[b.variant_id] ||= []).push(b);
      }
    });
    return map;
  }, [blocks, today]);

  // Filter products by search and stock toggle
  const visibleProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (!showOutOfStock && totalInventoryFor(p) <= 0) return false;
      if (q) {
        const hay = `${p.name || ""} ${p.sku_id || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, variants, search, showOutOfStock]);

  // Open / close the block modal. We can pass a variant for LXRTS rows or
  // skip it (defaults to product-level block) for non-LXRTS.
  const openBlockModal = (product, variant = null) => {
    setBlockStart(todayISO());
    setBlockEnd("");
    setBlockPurpose("");
    setBlockModal({ product, variant });
  };
  const closeBlockModal = () => { if (!blockSaving) setBlockModal(null); };

  const handleSaveBlock = async () => {
    if (!blockModal) return;
    if (!blockEnd) { showPopup({ title: "Required", message: "Please pick an end date.", type: "warning" }); return; }
    if (!blockPurpose.trim()) { showPopup({ title: "Required", message: "Please describe the purpose (shoot, event, etc.).", type: "warning" }); return; }
    setBlockSaving(true);
    try {
      const payload = {
        product_id: blockModal.variant ? null : blockModal.product.id,
        variant_id: blockModal.variant ? blockModal.variant.id : null,
        start_date: blockStart,
        end_date: blockEnd,
        purpose: blockPurpose.trim(),
        created_by: profile?.email || "comms",
        status: "active",
      };
      const { data, error } = await supabase
        .from("comms_inventory_blocks")
        .insert(payload)
        .select()
        .single();
      if (error) throw error;
      setBlocks((prev) => [...prev, data]);
      setBlockModal(null);
      showPopup({
        title: "Block created",
        message: `${blockModal.product.name}${blockModal.variant ? ` (size ${blockModal.variant.size})` : ""} reserved until ${formatDate(blockEnd)}.`,
        type: "success",
        confirmText: "OK",
      });
    } catch (err) {
      console.error("Create block failed:", err);
      showPopup({ title: "Failed", message: err.message || "Could not create block.", type: "error" });
    } finally {
      setBlockSaving(false);
    }
  };

  // Release an existing block (sets status='released' so it stops enforcing).
  const releaseBlock = async (block) => {
    try {
      const { error } = await supabase
        .from("comms_inventory_blocks")
        .update({ status: "released", released_at: new Date().toISOString() })
        .eq("id", block.id);
      if (error) throw error;
      setBlocks((prev) => prev.filter((b) => b.id !== block.id));
    } catch (err) {
      console.error("Release block failed:", err);
      showPopup({ title: "Failed", message: err.message || "Could not release block.", type: "error" });
    }
  };

  // CSV export
  const handleExport = () => {
    if (visibleProducts.length === 0) {
      showPopup({ title: "Nothing to export", message: "No products match the current filters.", type: "warning" });
      return;
    }
    const rows = visibleProducts.map((p) => [
      p.sku_id || "",
      p.name || "",
      p.default_top || "",
      p.default_bottom || "",
      p.default_color || "",
      p.sync_enabled ? "LXRTS" : "Standard",
      p.base_price || 0,
      totalInventoryFor(p),
      (blocksByProduct[p.id] || []).length > 0 ? "Yes" : "No",
    ]);
    downloadCsv(
      `comms_inventory_${todayISO()}.csv`,
      ["SKU", "Name", "Top", "Bottom", "Color", "Type", "Base Price", "Total Inventory", "Blocked"],
      rows
    );
  };

  if (loading) {
    return <div className="comms-card"><p className="comms-muted">Loading inventory…</p></div>;
  }

  return (
    <>
      {/* Active blocks panel (only if there are any) */}
      {blocks.length > 0 && (
        <div className="comms-card">
          <h3 className="comms-card-title">Active Blocks ({blocks.length})</h3>
          <table className="comms-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Reserved For</th>
                <th>From</th>
                <th>Until</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {blocks.map((b) => {
                const product = products.find((p) => p.id === (b.product_id || (b.variant_id && variants.find((v) => v.id === b.variant_id)?.product_id)));
                const variant = b.variant_id ? variants.find((v) => v.id === b.variant_id) : null;
                return (
                  <tr key={b.id}>
                    <td>
                      {product?.name || "—"}
                      {variant && <span className="comms-muted" style={{ marginLeft: 8, fontSize: 12 }}>· size {variant.size}</span>}
                    </td>
                    <td>{b.purpose}</td>
                    <td>{formatDate(b.start_date)}</td>
                    <td>{formatDate(b.end_date)}</td>
                    <td>
                      <button
                        onClick={() => releaseBlock(b)}
                        style={{
                          background: "#fff", color: "#c62828",
                          border: "1px solid #ef9a9a", borderRadius: 6,
                          padding: "4px 10px", fontSize: 12, fontWeight: 500,
                          cursor: "pointer", fontFamily: "inherit",
                        }}
                      >Release</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Filters */}
      <div className="comms-filters-card">
        <div className="comms-filters-search">
          <span className="comms-filters-search-icon" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </span>
          <input
            type="text"
            placeholder="Search by product name or SKU…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="comms-filters-row">
          <span className="comms-filters-row-label">Stock</span>
          <div className="comms-filters-row-controls">
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "#555", cursor: "pointer" }}>
              <input type="checkbox" checked={showOutOfStock} onChange={(e) => setShowOutOfStock(e.target.checked)} />
              Show out-of-stock products
            </label>
          </div>
        </div>

        <div className="comms-filters-row">
          <span className="comms-filters-row-label">Export</span>
          <div className="comms-filters-row-controls">
            <button className="comms-primary-btn" onClick={handleExport}>Download CSV</button>
            <span className="comms-muted" style={{ fontSize: 12 }}>
              {visibleProducts.length} of {products.length} products
            </span>
          </div>
        </div>
      </div>

      {/* Inventory table */}
      <div className="comms-card">
        {visibleProducts.length === 0 ? (
          <p className="comms-muted">No products match the filters.</p>
        ) : (
          <table className="comms-table">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Name</th>
                <th>Top / Bottom</th>
                <th>Color</th>
                <th>Type</th>
                <th className="comms-amount">Price</th>
                <th className="comms-amount">Stock</th>
                <th>Block</th>
              </tr>
            </thead>
            <tbody>
              {visibleProducts.map((p) => {
                const total = totalInventoryFor(p);
                const hasBlock = (blocksByProduct[p.id] || []).length > 0;
                const isLxrts = !!p.sync_enabled;
                return (
                  <tr key={p.id}>
                    <td><span className="comms-mono">{p.sku_id || "—"}</span></td>
                    <td>
                      {p.name || "—"}
                      {hasBlock && (
                        <span style={{
                          marginLeft: 8, padding: "1px 8px", borderRadius: 10,
                          background: "rgba(198,40,40,0.12)", color: "#c62828",
                          fontSize: 11, fontWeight: 600,
                        }}>Reserved</span>
                      )}
                    </td>
                    <td>{[p.default_top, p.default_bottom].filter(Boolean).join(" / ") || "—"}</td>
                    <td>{p.default_color || "—"}</td>
                    <td>{isLxrts ? "LXRTS" : "Standard"}</td>
                    <td className="comms-amount">₹{formatIndianNumber(p.base_price || 0)}</td>
                    <td className="comms-amount" style={{ color: total <= 0 ? "#c62828" : "#333", fontWeight: total <= 0 ? 600 : 400 }}>{total}</td>
                    <td>
                      <button
                        onClick={() => openBlockModal(p)}
                        disabled={total <= 0}
                        style={{
                          background: hasBlock ? "#f5ecd0" : "#fff",
                          color: hasBlock ? "#8B7355" : "#555",
                          border: "1px solid #d5b85a",
                          borderRadius: 6,
                          padding: "4px 10px",
                          fontSize: 12,
                          fontWeight: 500,
                          cursor: total <= 0 ? "not-allowed" : "pointer",
                          opacity: total <= 0 ? 0.4 : 1,
                          fontFamily: "inherit",
                        }}
                        title={total <= 0 ? "Out of stock" : "Reserve for shoot"}
                      >
                        {hasBlock ? "+ Add block" : "Block"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Block modal */}
      {blockModal && (
        <div
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
            display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
          }}
          onClick={closeBlockModal}
        >
          <div
            style={{
              background: "#fff", borderRadius: 12, padding: 24,
              width: "92%", maxWidth: 460,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ marginTop: 0, color: "#d5b85a" }}>Reserve Product</h3>
            <p style={{ fontSize: 13, color: "#555" }}>
              <strong>Product:</strong> {blockModal.product.name}
              {blockModal.variant && <> · size {blockModal.variant.size}</>}<br />
              <strong>Current Stock:</strong> {totalInventoryFor(blockModal.product)}
            </p>

            <div style={{ marginTop: 14 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: "#555", display: "block", marginBottom: 5 }}>
                From <span style={{ color: "#c62828" }}>*</span>
              </label>
              <input
                type="date"
                value={blockStart}
                min={todayISO()}
                onChange={(e) => setBlockStart(e.target.value)}
                style={{ width: "100%", padding: "8px 10px", border: "1px solid #d4d4d4", borderRadius: 6, fontSize: 13, fontFamily: "inherit" }}
              />
            </div>

            <div style={{ marginTop: 12 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: "#555", display: "block", marginBottom: 5 }}>
                Until <span style={{ color: "#c62828" }}>*</span>
              </label>
              <input
                type="date"
                value={blockEnd}
                min={blockStart || todayISO()}
                onChange={(e) => setBlockEnd(e.target.value)}
                style={{ width: "100%", padding: "8px 10px", border: "1px solid #d4d4d4", borderRadius: 6, fontSize: 13, fontFamily: "inherit" }}
              />
            </div>

            <div style={{ marginTop: 12 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: "#555", display: "block", marginBottom: 5 }}>
                Purpose <span style={{ color: "#c62828" }}>*</span>
              </label>
              <input
                type="text"
                placeholder="e.g. Diwali shoot for Kareena"
                value={blockPurpose}
                onChange={(e) => setBlockPurpose(e.target.value)}
                style={{ width: "100%", padding: "8px 10px", border: "1px solid #d4d4d4", borderRadius: 6, fontSize: 13, fontFamily: "inherit" }}
              />
            </div>

            <p style={{ fontSize: 11, color: "#888", marginTop: 12, lineHeight: 1.5 }}>
              While reserved, SAs trying to add this product to a customer order will be hard-blocked. You can release the block early from the Active Blocks panel above.
            </p>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
              <button
                disabled={blockSaving}
                onClick={closeBlockModal}
                style={{ padding: "8px 16px", border: "1px solid #d4d4d4", borderRadius: 6, background: "#fff", cursor: "pointer", fontSize: 13 }}
              >Cancel</button>
              <button
                disabled={blockSaving}
                onClick={handleSaveBlock}
                style={{
                  padding: "8px 16px", border: "none", borderRadius: 6,
                  background: "#d5b85a", color: "#fff",
                  cursor: blockSaving ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 600,
                  opacity: blockSaving ? 0.6 : 1,
                }}
              >{blockSaving ? "Saving…" : "Reserve"}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
