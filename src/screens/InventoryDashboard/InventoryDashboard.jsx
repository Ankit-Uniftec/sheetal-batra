import React, { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import "./InventoryDashboard.css";
import Logo from "../../images/logo.png";
import formatIndianNumber from "../../utils/formatIndianNumber";
import { usePopup } from "../../components/Popup";

const ITEMS_PER_PAGE = 15;

export default function InventoryDashboard() {
  const { showPopup, PopupComponent } = usePopup();
  const navigate = useNavigate();

  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  // Fetch products
  useEffect(() => {
    fetchProducts();
  }, []);

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
  };

  // Filter products
  const filteredProducts = useMemo(() => {
    return products.filter(
      (p) =>
        p.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.sku_id?.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [products, searchTerm]);

  // Pagination calculations
  const totalPages = Math.ceil(filteredProducts.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const currentProducts = filteredProducts.slice(startIndex, endIndex);

  // Reset to page 1 when search changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm]);

  // Stats
  const stats = useMemo(() => {
    const total = products.length;
    const onShopify = products.filter((p) => p.shopify_product_id).length;
    const lowStock = products.filter((p) => (p.inventory || 0) < 5).length;
    const outOfStock = products.filter((p) => (p.inventory || 0) === 0).length;
    return { total, onShopify, lowStock, outOfStock };
  }, [products]);

  // Update inventory count
  const handleInventoryUpdate = async (productId) => {
    if (editValue === "" || isNaN(Number(editValue))) {
      showPopup({
        title: "Invalid number",
        message: "Please enter a valid number.",
        type: "warning",
        confirmText: "Ok",
      })
      // alert("Please enter a valid number");
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
      })
      // alert("Failed to update inventory");
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

  // Toggle sync
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

  // Logout
  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/login", { replace: true });
  };

  // Pagination handlers
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

  // Generate page numbers
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

  // Get inventory status class
  const getInventoryClass = (count) => {
    if (count === 0) return "inv-stock-out";
    if (count < 5) return "inv-stock-low";
    return "inv-stock-ok";
  };

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

  return (
    <div className="inv-page">
      {/* Popup Component */}
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
        {/* Stats Cards */}
        <div className="inv-stats-grid">
          <div className="inv-stat-card">
            <div className="inv-stat-icon">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" class="lucide lucide-package2-icon lucide-package-2"><path d="M12 3v6" /><path d="M16.76 3a2 2 0 0 1 1.8 1.1l2.23 4.479a2 2 0 0 1 .21.891V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9.472a2 2 0 0 1 .211-.894L5.45 4.1A2 2 0 0 1 7.24 3z" /><path d="M3.054 9.013h17.893" /></svg>
            </div>
            <div className="inv-stat-info">
              <span className="inv-stat-value">{stats.total}</span>
              <span className="inv-stat-label">Total Products</span>
            </div>
          </div>
          <div className="inv-stat-card shopify">
            <div className="inv-stat-icon">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" class="lucide lucide-link-icon lucide-link"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>
            </div>
            <div className="inv-stat-info">
              <span className="inv-stat-value">{stats.onShopify}</span>
              <span className="inv-stat-label">On Shopify</span>
            </div>
          </div>
          <div className="inv-stat-card warning">
            <div className="inv-stat-icon">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" class="lucide lucide-triangle-alert-icon lucide-triangle-alert"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /><path d="M12 9v4" /><path d="M12 17h.01" /></svg>
            </div>
            <div className="inv-stat-info">
              <span className="inv-stat-value">{stats.lowStock}</span>
              <span className="inv-stat-label">Low Stock (&lt;5)</span>
            </div>
          </div>
          <div className="inv-stat-card danger">
            <div className="inv-stat-icon">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" class="lucide lucide-ban-icon lucide-ban"><path d="M4.929 4.929 19.07 19.071" /><circle cx="12" cy="12" r="10" /></svg>
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
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" class="lucide lucide-search-icon lucide-search"><path d="m21 21-4.34-4.34" /><circle cx="11" cy="11" r="8" /></svg>
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
          <div className="inv-showing-info">
            Showing {filteredProducts.length > 0 ? startIndex + 1 : 0}-
            {Math.min(endIndex, filteredProducts.length)} of{" "}
            {filteredProducts.length} products
          </div>
        </div>

        {/* Table */}
        <div className="inv-table-container">
          <table className="inv-table">
            <thead>
              <tr>
                <th>SKU Code</th>
                <th>Name</th>
                <th>Top</th>
                <th>Top Color</th>
                <th>Bottom</th>
                <th>Bottom Color</th>
                <th>Base Price</th>
                <th>Inventory</th>
                <th>Sync</th>
              </tr>
            </thead>
            <tbody>
              {currentProducts.length === 0 ? (
                <tr>
                  <td colSpan="9" className="inv-no-data">
                    {searchTerm
                      ? "No products match your search"
                      : "No products found"}
                  </td>
                </tr>
              ) : (
                currentProducts.map((product) => {
                  const isShopifyProduct = !!product.shopify_product_id;
                  const inventoryCount = product.inventory || 0;

                  return (
                    <tr
                      key={product.id}
                      className={isShopifyProduct ? "inv-shopify-row" : ""}
                    >
                      <td>
                        <span className="inv-sku">{product.sku_id || "—"}</span>
                      </td>
                      <td className="inv-name-cell">
                        <span className="inv-name">{product.name || "—"}</span>
                        {isShopifyProduct && (
                          <span
                            className="inv-shopify-badge"
                            title="Available on Shopify"
                          >
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
                      <td className="inv-inventory-cell">
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
                              {saving ? "..." : "✓"}
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
                            className={`inv-inventory-value ${getInventoryClass(
                              inventoryCount
                            )}`}
                            onClick={() => {
                              setEditingId(product.id);
                              setEditValue(inventoryCount);
                            }}
                          >
                            {inventoryCount}
                            <span className="inv-edit-icon">
                              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" class="lucide lucide-pencil-icon lucide-pencil"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" /><path d="m15 5 4 4" /></svg>
                            </span>
                          </span>
                        )}
                      </td>
                      <td className="inv-sync-cell">
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
                      </td>
                    </tr>
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