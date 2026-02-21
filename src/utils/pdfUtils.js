import { pdf } from "@react-pdf/renderer";
import { supabase } from "../lib/supabaseClient";
import CustomerOrderPdf from "../pdf/CustomerOrderPdf";
import WarehouseOrderPdf from "../pdf/WarehouseOrderPdf";
import Logo from "../images/logo.png";

/**
 * Generate and download Customer PDF
 * If PDF URL exists in order, opens it directly
 * Otherwise generates PDF on-demand, uploads to storage, and opens it
 */
export const downloadCustomerPdf = async (order, setLoading = null) => {
  try {
    // If PDF already exists in DB, just open it (skip for gifting orders to ensure latest data)
    if (order.customer_url && !order._forceRegenerate) {
      // Add cache buster to avoid browser cache
      const urlWithCacheBust = `${order.customer_url}?t=${Date.now()}`;
      window.open(urlWithCacheBust, "_blank");
      return order.customer_url;
    }

    if (setLoading) setLoading(true);

    const filename = `orders/${order.order_no}_customer.pdf`;

    // ✅ SKIP storage check - always regenerate if URL was null
    // (The old code checked storage even when URL was null, returning old file)

    // Generate fresh PDF
    const logoUrl = new URL(Logo, window.location.origin).href;
    const orderData = { ...order, items: order.items || [] };

    const pdfBlob = await pdf(
      <CustomerOrderPdf order={orderData} logoUrl={logoUrl} />
    ).toBlob();

    // Upload to storage (upsert overwrites existing)
    const { error: uploadError } = await supabase.storage
      .from("invoices")
      .upload(filename, pdfBlob, {
        upsert: true,
        contentType: "application/pdf",
      });

    if (uploadError && !uploadError.message?.includes("already exists")) {
      throw uploadError;
    }

    // Get public URL with cache buster
    const { data: urlData } = supabase.storage
      .from("invoices")
      .getPublicUrl(filename);

    const pdfUrl = urlData?.publicUrl;
    const urlWithCacheBust = `${pdfUrl}?t=${Date.now()}`;

    // Update order with PDF URL (clean, without cache buster)
    await supabase
      .from("orders")
      .update({ customer_url: pdfUrl })
      .eq("id", order.id);

    window.open(urlWithCacheBust, "_blank");
    if (setLoading) setLoading(false);
    return pdfUrl;

  } catch (error) {
    console.error("Customer PDF generation failed:", error);
    if (setLoading) setLoading(false);
    alert("Failed to generate PDF. Please try again.");
    return null;
  }
};

/**
 * Generate and download Warehouse PDFs - ONE PDF PER PRODUCT
 * If PDF URLs exist in order, opens them directly
 * Otherwise generates PDFs on-demand, uploads to storage, and opens them
 * 
 * @param {object} order - Order object
 * @param {function} setLoading - Optional loading state setter
 * @param {boolean} forceRegenerate - If true, regenerates PDF even if cached
 */

export const downloadWarehousePdf = async (order, setLoading = null, forceRegenerate = false) => {
  try {
    const items = order.items || [];
    const totalItems = items.length;

    if (totalItems === 0) {
      alert("No products in this order");
      return null;
    }

    // If warehouse PDFs already exist AND not forcing regeneration, open them
    if (!forceRegenerate && order.warehouse_urls && order.warehouse_urls.length > 0) {
      order.warehouse_urls.forEach((url, index) => {
        setTimeout(() => {
          window.open(`${url}?t=${Date.now()}`, "_blank"); // Cache bust
        }, index * 300);
      });
      return order.warehouse_urls;
    }

    // Legacy support
    if (!forceRegenerate && order.warehouse_url) {
      window.open(`${order.warehouse_url}?t=${Date.now()}`, "_blank");
      return order.warehouse_url;
    }

    if (setLoading) setLoading(true);

    const logoUrl = new URL(Logo, window.location.origin).href;
    const warehouseUrls = [];

    // Generate one PDF per product
    for (let i = 0; i < totalItems; i++) {
      const item = items[i];
      const filename = `orders/${order.order_no}_warehouse_${i + 1}.pdf`;

      // ✅ SKIP storage check - always regenerate when URLs were null
      // This ensures we use the latest order data

      // Generate fresh PDF for this item
      const pdfBlob = await pdf(
        <WarehouseOrderPdf
          order={order}
          item={item}
          itemIndex={i}
          totalItems={totalItems}
          logoUrl={logoUrl}
        />
      ).toBlob();

      // Upload with upsert to overwrite existing
      const { error: uploadError } = await supabase.storage
        .from("invoices")
        .upload(filename, pdfBlob, {
          upsert: true,
          contentType: "application/pdf",
        });

      if (uploadError && !uploadError.message?.includes("already exists")) {
        console.error(`Upload error for PDF ${i + 1}:`, uploadError);
      }

      // Get public URL with cache buster
      const { data: urlData } = supabase.storage
        .from("invoices")
        .getPublicUrl(filename);

      const freshUrl = `${urlData?.publicUrl}?t=${Date.now()}`;
      warehouseUrls.push(freshUrl);
      console.log(`✅ Warehouse PDF ${i + 1} generated fresh`);
    }

    // Update order with PDF URLs (clean, without cache buster)
    const cleanUrls = warehouseUrls.map(url => url.split('?')[0]);
    await supabase
      .from("orders")
      .update({ warehouse_urls: cleanUrls })
      .eq("id", order.id);

    // Open all PDFs
    warehouseUrls.forEach((url, index) => {
      setTimeout(() => {
        window.open(url, "_blank");
      }, index * 300);
    });

    if (setLoading) setLoading(false);
    return cleanUrls;

  } catch (error) {
    console.error("Warehouse PDF generation failed:", error);
    if (setLoading) setLoading(false);
    alert("Failed to generate warehouse PDFs. Please try again.");
    return null;
  }
};

/**
 * Download a single warehouse PDF for a specific product
 * @param {object} order - Full order object
 * @param {number} productIndex - Index of the product (0-based)
 * @param {function} setLoading - Optional loading state setter
 */
export const downloadSingleWarehousePdf = async (order, productIndex, setLoading = null) => {
  try {
    const items = order.items || [];
    const totalItems = items.length;

    if (productIndex < 0 || productIndex >= totalItems) {
      alert("Invalid product index");
      return null;
    }

    // Check if this specific PDF exists
    if (order.warehouse_urls && order.warehouse_urls[productIndex]) {
      window.open(order.warehouse_urls[productIndex], "_blank");
      return order.warehouse_urls[productIndex];
    }

    if (setLoading) setLoading(true);

    const logoUrl = new URL(Logo, window.location.origin).href;
    const item = items[productIndex];

    // Generate PDF for this item
    const pdfBlob = await pdf(
      <WarehouseOrderPdf
        order={order}
        item={item}
        itemIndex={productIndex}
        totalItems={totalItems}
        logoUrl={logoUrl}
      />
    ).toBlob();

    // Upload to storage
    const filename = `orders/${order.order_no}_warehouse_${productIndex + 1}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from("invoices")
      .upload(filename, pdfBlob, {
        upsert: true,
        contentType: "application/pdf",
      });

    if (uploadError) throw uploadError;

    // Get public URL
    const { data: urlData } = supabase.storage
      .from("invoices")
      .getPublicUrl(filename);

    const pdfUrl = urlData?.publicUrl;

    // Update warehouse_urls array in order
    const currentUrls = order.warehouse_urls || [];
    const updatedUrls = [...currentUrls];
    updatedUrls[productIndex] = pdfUrl;

    await supabase
      .from("orders")
      .update({ warehouse_urls: updatedUrls })
      .eq("id", order.id);

    // Open PDF
    window.open(pdfUrl, "_blank");

    if (setLoading) setLoading(false);
    return pdfUrl;

  } catch (error) {
    console.error("Single warehouse PDF generation failed:", error);
    if (setLoading) setLoading(false);
    alert("Failed to generate warehouse PDF. Please try again.");
    return null;
  }
};

/**
 * Generate both Customer and Warehouse PDFs at order placement
 * Called from Screen7/ConfirmDetail after order is created
 * 
 * IMPORTANT: Each PDF generation is in its own try-catch so that
 * if one fails, the others can still succeed
 */
export const generateAllPdfs = async (order, setLoading = null) => {
  if (setLoading) setLoading(true);

  const logoUrl = new URL(Logo, window.location.origin).href;
  const orderData = { ...order, items: order.items || [] };
  const items = orderData.items;
  const totalItems = items.length;

  let customerUrl = null;
  let warehouseUrls = [];

  // ========== CUSTOMER PDF ==========
  try {
    console.log("📄 Generating Customer PDF for order:", order.order_no);

    const customerPdfBlob = await pdf(
      <CustomerOrderPdf order={orderData} logoUrl={logoUrl} />
    ).toBlob();

    console.log("📤 Uploading Customer PDF...");

    const { error: uploadError } = await supabase.storage
      .from("invoices")
      .upload(`orders/${order.order_no}_customer.pdf`, customerPdfBlob, {
        upsert: true,
        contentType: "application/pdf",
      });

    if (uploadError) {
      console.error("Customer PDF upload error:", uploadError);
    } else {
      const { data: customerUrlData } = supabase.storage
        .from("invoices")
        .getPublicUrl(`orders/${order.order_no}_customer.pdf`);

      customerUrl = customerUrlData?.publicUrl;
      console.log("✅ Customer PDF uploaded:", customerUrl);
    }
  } catch (customerError) {
    console.error("❌ Customer PDF generation failed:", customerError);
  }

  // ========== WAREHOUSE PDFs ==========
  for (let i = 0; i < totalItems; i++) {
    try {
      const item = items[i];
      console.log(`📄 Generating Warehouse PDF ${i + 1} for:`, item.product_name);

      const pdfBlob = await pdf(
        <WarehouseOrderPdf
          order={orderData}
          item={item}
          itemIndex={i}
          totalItems={totalItems}
          logoUrl={logoUrl}
        />
      ).toBlob();

      console.log(`📤 Uploading Warehouse PDF ${i + 1}...`);

      const filename = `orders/${order.order_no}_warehouse_${i + 1}.pdf`;

      const { error: uploadError } = await supabase.storage
        .from("invoices")
        .upload(filename, pdfBlob, {
          upsert: true,
          contentType: "application/pdf",
        });

      if (uploadError) {
        console.error(`Warehouse PDF ${i + 1} upload error:`, uploadError);
        warehouseUrls.push(null);
      } else {
        const { data: urlData } = supabase.storage
          .from("invoices")
          .getPublicUrl(filename);

        warehouseUrls.push(urlData?.publicUrl);
        console.log(`✅ Warehouse PDF ${i + 1} uploaded`);
      }
    } catch (warehouseError) {
      console.error(`❌ Warehouse PDF ${i + 1} generation failed:`, warehouseError);
      warehouseUrls.push(null);
    }
  }

  // ========== UPDATE DATABASE ==========
  try {
    const updateData = {};

    if (customerUrl) {
      updateData.customer_url = customerUrl;
    }

    // Filter out null values from warehouse URLs
    const validWarehouseUrls = warehouseUrls.filter(Boolean);
    if (validWarehouseUrls.length > 0) {
      updateData.warehouse_urls = validWarehouseUrls;
    }

    if (Object.keys(updateData).length > 0) {
      console.log("📝 Updating order with URLs:", updateData);

      const { error: updateError } = await supabase
        .from("orders")
        .update(updateData)
        .eq("id", order.id);

      if (updateError) {
        console.error("❌ Database update failed:", updateError);
      } else {
        console.log("✅ Order updated with PDF URLs");
      }
    } else {
      console.log("⚠️ No PDF URLs to update in database");
    }
  } catch (dbError) {
    console.error("❌ Database update error:", dbError);
  }

  if (setLoading) setLoading(false);

  return {
    customer_url: customerUrl,
    warehouse_urls: warehouseUrls.filter(Boolean),
  };
};

/**
 * Clear PDF URLs from order - call this when measurements are updated
 * This forces PDF regeneration on next "Generate PDF" click
 */
export const clearPdfUrls = async (orderId) => {
  try {
    const { error } = await supabase
      .from("orders")
      .update({
        warehouse_urls: null,
        customer_url: null
      })
      .eq("id", orderId);

    if (error) {
      console.error("Failed to clear PDF URLs:", error);
      return false;
    }

    console.log("✅ PDF URLs cleared for order:", orderId);
    return true;
  } catch (err) {
    console.error("Error clearing PDF URLs:", err);
    return false;
  }
};