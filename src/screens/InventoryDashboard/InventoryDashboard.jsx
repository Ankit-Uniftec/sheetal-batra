import React, { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import config from "../../config/config";
import "./InventoryDashboard.css";
import Logo from "../../images/logo.png";
import formatIndianNumber from "../../utils/formatIndianNumber";
import { usePopup } from "../../components/Popup";

const ITEMS_PER_PAGE = 15;
const SIZE_ORDER = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "2XL", "3XL", "4XL", "5XL", "6XL"];

export default function InventoryDashboard() {
  const { showPopup, PopupComponent } = usePopup();
  const navigate = useNavigate();

  // ==================== EXISTING STATES ====================
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  // ==================== NEW LXRTS STATES ====================
  const [variantInventory, setVariantInventory] = useState({}); // { productId: { S: 4, M: 2, ... } }
  const [expandedProducts, setExpandedProducts] = useState({}); // { productId: true/false }
  const [lxrtsSyncLoading, setLxrtsSyncLoading] = useState(false);
  const [editingVariant, setEditingVariant] = useState(null); // { productId, size }
  const [editVariantValue, setEditVariantValue] = useState("");
  const [savingVariant, setSavingVariant] = useState(false);

  // ==================== FETCH PRODUCTS ====================
  useEffect(() => {
    const checkAuthAndFetch = async () => {
      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        navigate("/login", { replace: true });
        return;
      }

      fetchProducts();
    };

    checkAuthAndFetch();
  }, [navigate]);

  const fetchProducts = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("products")
      .select("*")
      .order("name", { ascending: true });

    if (error) {
      console.error("Error fetching products:", error);
    } else {
      setProducts(data || []);
    }
    setLoading(false);

    // After products load, sync LXRTS inventory from Shopify
    const lxrtsProducts = (data || []).filter((p) => p.sync_enabled);
    if (lxrtsProducts.length > 0) {
      fetchAllLxrtsInventory(lxrtsProducts);
    }
  };

  // ==================== LXRTS SHOPIFY SYNC ON LOAD ====================
  const fetchAllLxrtsInventory = async (lxrtsProducts) => {
    setLxrtsSyncLoading(true);
    const inventoryMap = {};

    // Fetch all LXRTS products in parallel
    const results = await Promise.allSettled(
      lxrtsProducts.map(async (product) => {
        try {
          const response = await fetch(
            `${config.SUPABASE_URL}/functions/v1/shopify-inventory`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                apikey: config.SUPABASE_KEY,
                Authorization: `Bearer ${config.SUPABASE_KEY}`,
              },
              body: JSON.stringify({
                action: "fetch",
                product_id: product.id,
              }),
            }
          );

          const result = await response.json();

          if (result.success && result.inventory) {
            inventoryMap[product.id] = result.inventory;

            // Update product_variants in Supabase with fresh Shopify data
            const { data: existingVariants } = await supabase
              .from("product_variants")
              .select("id, size, inventory")
              .eq("product_id", product.id);

            for (const variant of existingVariants || []) {
              const shopifyQty = result.inventory[variant.size];
              if (shopifyQty !== undefined && shopifyQty !== variant.inventory) {
                await supabase
                  .from("product_variants")
                  .update({ inventory: shopifyQty })
                  .eq("id", variant.id);
              }
            }
          } else {
            // Fallback: read from product_variants if Shopify fails
            console.warn(`Shopify sync failed for ${product.name}, using database fallback`);
            const { data: variants } = await supabase
              .from("product_variants")
              .select("size, inventory")
              .eq("product_id", product.id);

            if (variants) {
              const map = {};
              variants.forEach((v) => {
                map[v.size] = v.inventory || 0;
              });
              inventoryMap[product.id] = map;
            }
          }
        } catch (err) {
          console.error(`Error syncing ${product.name}:`, err);
          // Fallback to database
          const { data: variants } = await supabase
            .from("product_variants")
            .select("size, inventory")
            .eq("product_id", product.id);

          if (variants) {
            const map = {};
            variants.forEach((v) => {
              map[v.size] = v.inventory || 0;
            });
            inventoryMap[product.id] = map;
          }
        }
      })
    );

    setVariantInventory(inventoryMap);
    setLxrtsSyncLoading(false);
  };

  // ==================== MANUAL REFRESH LXRTS ====================
  const handleRefreshLxrts = () => {
    const lxrtsProducts = products.filter((p) => p.sync_enabled);
    if (lxrtsProducts.length > 0) {
      setVariantInventory({});
      fetchAllLxrtsInventory(lxrtsProducts);
    } else {
      showPopup({
        title: "No LXRTS Products",
        message: "No sync-enabled products found.",
        type: "warning",
        confirmText: "Ok",
      });
    }
  };

  // ==================== HELPERS ====================

  // Get total inventory for an LXRTS product from variants
  const getLxrtsTotalInventory = (productId) => {
    const variants = variantInventory[productId];
    if (!variants) return 0;
    return Object.values(variants).reduce((sum, qty) => sum + (qty || 0), 0);
  };

  // Get sorted sizes that have data for a product
  const getProductSizes = (productId) => {
    const variants = variantInventory[productId];
    if (!variants) return [];
    // Return all sizes from SIZE_ORDER that exist in variants, plus any extra sizes
    const knownSizes = SIZE_ORDER.filter((s) => variants[s] !== undefined);
    const extraSizes = Object.keys(variants)
      .filter((s) => !SIZE_ORDER.includes(s))
      .sort();
    return [...knownSizes, ...extraSizes];
  };

  // Toggle expand/collapse for LXRTS product
  const toggleExpand = (productId) => {
    setExpandedProducts((prev) => ({
      ...prev,
      [productId]: !prev[productId],
    }));
    // Close any open variant edit when collapsing
    if (expandedProducts[productId]) {
      setEditingVariant(null);
      setEditVariantValue("");
    }
  };

  // ==================== REGULAR PRODUCT INVENTORY UPDATE (unchanged) ====================
  const handleInventoryUpdate = async (productId) => {
    if (editValue === "" || isNaN(Number(editValue))) {
      showPopup({
        title: "Invalid number",
        message: "Please enter a valid number.",
        type: "warning",
        confirmText: "Ok",
      });
      return;
    }

    setSaving(true);
    const { error } = await supabase
      .from("products")
      .update({ inventory: Number(editValue) })
      .eq("id", productId);

    if (error) {
      console.error("Error updating inventory:", error);
      showPopup({
        title: "Failed!",
        message: "Failed to update inventory.",
        type: "error",
        confirmText: "Ok",
      });
    } else {
      setProducts((prev) =>
        prev.map((p) =>
          p.id === productId ? { ...p, inventory: Number(editValue) } : p
        )
      );
    }

    setEditingId(null);
    setEditValue("");
    setSaving(false);
  };

  // ==================== LXRTS VARIANT INVENTORY UPDATE (NEW) ====================
  // Dual update: Supabase product_variants + Shopify (absolute set)
  const handleVariantInventoryUpdate = async (productId, size) => {
    const newQty = Number(editVariantValue);
    if (editVariantValue === "" || isNaN(newQty) || newQty < 0) {
      showPopup({
        title: "Invalid number",
        message: "Please enter a valid number (0 or more).",
        type: "warning",
        confirmText: "Ok",
      });
      return;
    }

    setSavingVariant(true);

    try {
      // 1. Update product_variants in Supabase
      const { data: variant, error: fetchError } = await supabase
        .from("product_variants")
        .select("id, inventory")
        .eq("product_id", productId)
        .eq("size", size)
        .limit(1)
        .maybeSingle();

      if (fetchError) {
        throw new Error(`Failed to find variant: ${fetchError.message}`);
      }

      if (!variant) {
        throw new Error(`No variant found for size ${size}`);
      }

      const { error: updateError } = await supabase
        .from("product_variants")
        .update({ inventory: newQty })
        .eq("id", variant.id);

      if (updateError) {
        throw new Error(`Failed to update Supabase: ${updateError.message}`);
      }

      // 2. Sync to Shopify — use "reduce" with delta (negative qty = increase)
      const oldQty = variant.inventory || 0;
      const delta = oldQty - newQty; // positive = reduce, negative = increase on Shopify

      if (delta !== 0) {
        try {
          const response = await fetch(
            `${config.SUPABASE_URL}/functions/v1/shopify-inventory`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                apikey: config.SUPABASE_KEY,
                Authorization: `Bearer ${config.SUPABASE_KEY}`,
              },
              body: JSON.stringify({
                action: "reduce",
                product_id: productId,
                size: size,
                quantity: delta,
              }),
            }
          );

          const result = await response.json();
          if (!result.success) {
            console.error("Shopify sync failed:", result.error);
            showPopup({
              title: "Partial Update",
              message: "Supabase updated but Shopify sync failed. Inventory may be out of sync.",
              type: "warning",
              confirmText: "Ok",
            });
          }
        } catch (shopifyErr) {
          console.error("Shopify sync error:", shopifyErr);
          showPopup({
            title: "Partial Update",
            message: "Supabase updated but Shopify sync failed. Inventory may be out of sync.",
            type: "warning",
            confirmText: "Ok",
          });
        }
      }

      // 3. Update local state
      setVariantInventory((prev) => ({
        ...prev,
        [productId]: {
          ...prev[productId],
          [size]: newQty,
        },
      }));

      showPopup({
        title: "Updated!",
        message: `Size ${size} inventory updated to ${newQty}.`,
        type: "success",
        confirmText: "Ok",
      });
    } catch (err) {
      console.error("Variant update error:", err);
      showPopup({
        title: "Failed!",
        message: err.message || "Failed to update variant inventory.",
        type: "error",
        confirmText: "Ok",
      });
    }

    setEditingVariant(null);
    setEditVariantValue("");
    setSavingVariant(false);
  };

  // ==================== SYNC TOGGLE (unchanged) ====================
  const handleSyncToggle = async (productId, currentValue) => {
    const { error } = await supabase
      .from("products")
      .update({ sync_enabled: !currentValue })
      .eq("id", productId);

    if (error) {
      console.error("Error toggling sync:", error);
    } else {
      setProducts((prev) =>
        prev.map((p) =>
          p.id === productId ? { ...p, sync_enabled: !currentValue } : p
        )
      );
    }
  };

  // ==================== FILTER & PAGINATION ====================
  const filteredProducts = useMemo(() => {
    return products.filter(
      (p) =>
        p.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.sku_id?.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [products, searchTerm]);

  const totalPages = Math.ceil(filteredProducts.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const currentProducts = filteredProducts.slice(startIndex, endIndex);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm]);

  // ==================== STATS (UPDATED — includes LXRTS variants) ====================
  const stats = useMemo(() => {
    const total = products.length;
    const onShopify = products.filter((p) => p.shopify_product_id).length;

    let lowStock = 0;
    let outOfStock = 0;

    products.forEach((p) => {
      if (p.sync_enabled) {
        // LXRTS: use variant totals
        const totalQty = getLxrtsTotalInventory(p.id);
        if (totalQty === 0) {
          outOfStock++;
        } else if (totalQty < 5) {
          lowStock++;
        }
      } else {
        // Regular: use products.inventory
        const qty = p.inventory || 0;
        if (qty === 0) {
          outOfStock++;
        } else if (qty < 5) {
          lowStock++;
        }
      }
    });

    return { total, onShopify, lowStock, outOfStock };
  }, [products, variantInventory]);

  // ==================== NAVIGATION & PAGINATION ====================
  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/login", { replace: true });
  };

  const goToPage = (page) => {
    setCurrentPage(page);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const goToPrevious = () => {
    if (currentPage > 1) goToPage(currentPage - 1);
  };

  const goToNext = () => {
    if (currentPage < totalPages) goToPage(currentPage + 1);
  };

  const getPageNumbers = () => {
    const pages = [];
    const maxVisible = 5;

    if (totalPages <= maxVisible) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      if (currentPage <= 3) {
        for (let i = 1; i <= 4; i++) pages.push(i);
        pages.push("...");
        pages.push(totalPages);
      } else if (currentPage >= totalPages - 2) {
        pages.push(1);
        pages.push("...");
        for (let i = totalPages - 3; i <= totalPages; i++) pages.push(i);
      } else {
        pages.push(1);
        pages.push("...");
        for (let i = currentPage - 1; i <= currentPage + 1; i++) pages.push(i);
        pages.push("...");
        pages.push(totalPages);
      }
    }
    return pages;
  };

  const getInventoryClass = (count) => {
    if (count === 0) return "inv-stock-out";
    if (count < 5) return "inv-stock-low";
    return "inv-stock-ok";
  };

  // ==================== LOADING STATE ====================
  if (loading) {
    return (
      <div className="inv-page">
        <div className="inv-loading">
          <div className="inv-spinner"></div>
          <p>Loading products...</p>
        </div>
      </div>
    );
  }

  // ==================== RENDER ====================
  return (
    <div className="inv-page">
      {PopupComponent}

      {/* Header */}
      <header className="inv-header">
        <div className="inv-header-left">
          <img
            src={Logo}
            alt="logo"
            className="inv-logo"
            onClick={() => navigate("/login")}
          />
        </div>
        <h1 className="inv-title">Inventory Dashboard</h1>
        <div className="inv-header-right">
          <button className="inv-logout-btn" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </header>

      {/* Main Content */}
      <div className="inv-content">
        {/* LXRTS Sync Banner */}
        {lxrtsSyncLoading && (
          <div className="inv-sync-banner">
            <span className="inv-refresh-spinner"></span>
            Syncing LXRTS inventory from Shopify...
          </div>
        )}

        {/* Stats Cards */}
        <div className="inv-stats-grid">
          <div className="inv-stat-card">
            <div className="inv-stat-icon">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v6" /><path d="M16.76 3a2 2 0 0 1 1.8 1.1l2.23 4.479a2 2 0 0 1 .21.891V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9.472a2 2 0 0 1 .211-.894L5.45 4.1A2 2 0 0 1 7.24 3z" /><path d="M3.054 9.013h17.893" /></svg>
            </div>
            <div className="inv-stat-info">
              <span className="inv-stat-value">{stats.total}</span>
              <span className="inv-stat-label">Total Products</span>
            </div>
          </div>
          <div className="inv-stat-card shopify">
            <div className="inv-stat-icon">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>
            </div>
            <div className="inv-stat-info">
              <span className="inv-stat-value">{stats.onShopify}</span>
              <span className="inv-stat-label">On Shopify</span>
            </div>
          </div>
          <div className="inv-stat-card warning">
            <div className="inv-stat-icon">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /><path d="M12 9v4" /><path d="M12 17h.01" /></svg>
            </div>
            <div className="inv-stat-info">
              <span className="inv-stat-value">{stats.lowStock}</span>
              <span className="inv-stat-label">Low Stock (&lt;5)</span>
            </div>
          </div>
          <div className="inv-stat-card danger">
            <div className="inv-stat-icon">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4.929 4.929 19.07 19.071" /><circle cx="12" cy="12" r="10" /></svg>
            </div>
            <div className="inv-stat-info">
              <span className="inv-stat-value">{stats.outOfStock}</span>
              <span className="inv-stat-label">Out of Stock</span>
            </div>
          </div>
        </div>

        {/* Search & Info Bar */}
        <div className="inv-toolbar">
          <div className="inv-search-wrapper">
            <span className="inv-search-icon">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21 21-4.34-4.34" /><circle cx="11" cy="11" r="8" /></svg>
            </span>
            <input
              type="text"
              placeholder="Search by name or SKU..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="inv-search-input"
            />
            {searchTerm && (
              <button
                className="inv-search-clear"
                onClick={() => setSearchTerm("")}
              >
                ✕
              </button>
            )}
          </div>
          <div className="inv-toolbar-right">
            <div className="inv-showing-info">
              Showing {filteredProducts.length > 0 ? startIndex + 1 : 0}-
              {Math.min(endIndex, filteredProducts.length)} of{" "}
              {filteredProducts.length} products
            </div>
            <button
              className="inv-refresh-btn"
              onClick={handleRefreshLxrts}
              disabled={lxrtsSyncLoading}
              title="Refresh LXRTS inventory from Shopify"
            >
              {lxrtsSyncLoading ? (
                <>
                  <span className="inv-refresh-spinner"></span>
                  Syncing...
                </>
              ) : (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" /></svg>
                  Sync LXRTS
                </>
              )}
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="inv-table-container">
          <table className="inv-table">
            <thead>
              <tr>
                <th className="inv-th-expand"></th>
                <th>SKU Code</th>
                <th>Name</th>
                <th>Top</th>
                <th>Top Color</th>
                <th>Bottom</th>
                <th>Bottom Color</th>
                <th>Base Price</th>
                <th>Inventory</th>
                {/* <th>Sync</th> */}
              </tr>
            </thead>
            <tbody>
              {currentProducts.length === 0 ? (
                <tr>
                  <td colSpan="10" className="inv-no-data">
                    {searchTerm
                      ? "No products match your search"
                      : "No products found"}
                  </td>
                </tr>
              ) : (
                currentProducts.map((product) => {
                  const isShopifyProduct = !!product.shopify_product_id;
                  const isSyncEnabled = product.sync_enabled || false;
                  const isExpanded = expandedProducts[product.id] || false;

                  // Inventory: use variants for LXRTS, products table for regular
                  const inventoryCount = isSyncEnabled
                    ? getLxrtsTotalInventory(product.id)
                    : product.inventory || 0;

                  const sizes = isSyncEnabled ? getProductSizes(product.id) : [];

                  return (
                    <React.Fragment key={product.id}>
                      {/* Main Product Row */}
                      <tr className={`${isShopifyProduct ? "inv-shopify-row" : ""} ${isSyncEnabled && isExpanded ? "inv-row-expanded" : ""}`}>
                        {/* Expand Arrow (only for LXRTS) */}
                        <td className="inv-expand-cell">
                          {isSyncEnabled ? (
                            <button
                              className={`inv-expand-btn ${isExpanded ? "expanded" : ""}`}
                              onClick={() => toggleExpand(product.id)}
                              title={isExpanded ? "Collapse variants" : "Show variants"}
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="m9 18 6-6-6-6" />
                              </svg>
                            </button>
                          ) : null}
                        </td>

                        <td>
                          <span className="inv-sku">{product.sku_id || "—"}</span>
                        </td>
                        <td className="inv-name-cell">
                          <span
                            className={`inv-name ${isSyncEnabled ? "inv-name-clickable" : ""}`}
                            onClick={() => isSyncEnabled && toggleExpand(product.id)}
                          >
                            {product.name || "—"}
                          </span>
                          {isSyncEnabled && (
                            <span className="inv-lxrts-badge" title="LXRTS - Shopify Synced">
                              LXRTS
                            </span>
                          )}
                          {isShopifyProduct && !isSyncEnabled && (
                            <span className="inv-shopify-badge" title="Available on Shopify">
                              🔗
                            </span>
                          )}
                        </td>
                        <td>{product.default_top || "—"}</td>
                        <td>
                          {product.default_color ? (
                            <span className="inv-color-tag">
                              {product.default_color}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td>{product.default_bottom || "—"}</td>
                        <td>
                          {product.default_color ? (
                            <span className="inv-color-tag">
                              {product.default_color}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="inv-price">
                          ₹{formatIndianNumber(product.base_price || 0)}
                        </td>

                        {/* Inventory Cell */}
                        <td className="inv-inventory-cell">
                          {isSyncEnabled ? (
                            /* LXRTS: Show total (not editable at row level, click to expand) */
                            <span
                              className={`inv-inventory-value inv-lxrts-total ${getInventoryClass(inventoryCount)}`}
                              onClick={() => toggleExpand(product.id)}
                              title="Click to view/edit variants"
                            >
                              {lxrtsSyncLoading && !variantInventory[product.id]
                                ? "..."
                                : inventoryCount}
                              <span className="inv-expand-hint">
                                {isExpanded ? "▲" : "▼"}
                              </span>
                            </span>
                          ) : (
                            /* Regular: Editable inline (unchanged) */
                            <>
                              {editingId === product.id ? (
                                <div className="inv-edit-wrapper">
                                  <input
                                    type="number"
                                    className="inv-edit-input"
                                    value={editValue}
                                    onChange={(e) => setEditValue(e.target.value)}
                                    autoFocus
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") {
                                        handleInventoryUpdate(product.id);
                                      } else if (e.key === "Escape") {
                                        setEditingId(null);
                                        setEditValue("");
                                      }
                                    }}
                                  />
                                  <button
                                    className="inv-save-btn"
                                    onClick={() => handleInventoryUpdate(product.id)}
                                    disabled={saving}
                                  >
                                    {saving ? "..." : "✔"}
                                  </button>
                                  <button
                                    className="inv-cancel-btn"
                                    onClick={() => {
                                      setEditingId(null);
                                      setEditValue("");
                                    }}
                                  >
                                    ✕
                                  </button>
                                </div>
                              ) : (
                                <span
                                  className={`inv-inventory-value ${getInventoryClass(inventoryCount)}`}
                                  onClick={() => {
                                    setEditingId(product.id);
                                    setEditValue(inventoryCount);
                                  }}
                                >
                                  {inventoryCount}
                                  <span className="inv-edit-icon">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" /><path d="m15 5 4 4" /></svg>
                                  </span>
                                </span>
                              )}
                            </>
                          )}
                        </td>

                        {/* Sync Toggle */}
                        {/* <td className="inv-sync-cell">
                          {isShopifyProduct ? (
                            <label className="inv-toggle">
                              <input
                                type="checkbox"
                                checked={product.sync_enabled || false}
                                onChange={() =>
                                  handleSyncToggle(product.id, product.sync_enabled)
                                }
                              />
                              <span className="inv-toggle-slider"></span>
                            </label>
                          ) : (
                            <span className="inv-na-badge">N/A</span>
                          )}
                        </td> */}
                      </tr>

                      {/* ==================== EXPANDED VARIANT ROW (LXRTS ONLY) ==================== */}
                      {isSyncEnabled && isExpanded && (
                        <tr className="inv-variant-row">
                          <td colSpan="10">
                            <div className="inv-variant-container">
                              <div className="inv-variant-header">
                                <span className="inv-variant-title">Size Variants — {product.name}</span>
                                <span className="inv-variant-total">
                                  Total: <strong>{inventoryCount}</strong>
                                </span>
                              </div>
                              <div className="inv-variant-grid">
                                {sizes.length === 0 ? (
                                  <div className="inv-variant-empty">
                                    {lxrtsSyncLoading
                                      ? "Loading variants..."
                                      : "No variant data available"}
                                  </div>
                                ) : (
                                  sizes.map((size) => {
                                    const qty = variantInventory[product.id]?.[size] || 0;
                                    const isEditingThis =
                                      editingVariant?.productId === product.id &&
                                      editingVariant?.size === size;

                                    return (
                                      <div
                                        key={size}
                                        className={`inv-variant-card ${getInventoryClass(qty)}`}
                                      >
                                        <span className="inv-variant-size">{size}</span>
                                        {isEditingThis ? (
                                          <div className="inv-variant-edit">
                                            <input
                                              type="number"
                                              className="inv-variant-input"
                                              value={editVariantValue}
                                              onChange={(e) => setEditVariantValue(e.target.value)}
                                              autoFocus
                                              min="0"
                                              onKeyDown={(e) => {
                                                if (e.key === "Enter") {
                                                  handleVariantInventoryUpdate(product.id, size);
                                                } else if (e.key === "Escape") {
                                                  setEditingVariant(null);
                                                  setEditVariantValue("");
                                                }
                                              }}
                                            />
                                            <div className="inv-variant-edit-actions">
                                              <button
                                                className="inv-variant-save"
                                                onClick={() => handleVariantInventoryUpdate(product.id, size)}
                                                disabled={savingVariant}
                                              >
                                                {savingVariant ? "..." : "✔"}
                                              </button>
                                              <button
                                                className="inv-variant-cancel"
                                                onClick={() => {
                                                  setEditingVariant(null);
                                                  setEditVariantValue("");
                                                }}
                                              >
                                                ✕
                                              </button>
                                            </div>
                                          </div>
                                        ) : (
                                          <span
                                            className="inv-variant-qty"
                                            onClick={() => {
                                              setEditingVariant({ productId: product.id, size });
                                              setEditVariantValue(qty);
                                            }}
                                            title={`Click to edit ${size} inventory`}
                                          >
                                            {qty}
                                            <span className="inv-variant-edit-icon">✎</span>
                                          </span>
                                        )}
                                      </div>
                                    );
                                  })
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="inv-pagination">
            <button
              className="inv-page-btn nav"
              onClick={goToPrevious}
              disabled={currentPage === 1}
            >
              ← Prev
            </button>

            <div className="inv-page-numbers">
              {getPageNumbers().map((page, index) =>
                page === "..." ? (
                  <span key={`dots-${index}`} className="inv-page-dots">
                    ...
                  </span>
                ) : (
                  <button
                    key={page}
                    className={`inv-page-btn ${currentPage === page ? "active" : ""
                      }`}
                    onClick={() => goToPage(page)}
                  >
                    {page}
                  </button>
                )
              )}
            </div>

            <button
              className="inv-page-btn nav"
              onClick={goToNext}
              disabled={currentPage === totalPages}
            >
              Next →
            </button>
          </div>
        )}
      </div>

      {/* Back Button */}
      <button className="inv-back-btn" onClick={() => navigate("/login")}>
        ←
      </button>
    </div>
  );
}