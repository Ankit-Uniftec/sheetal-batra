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
    // If PDF already exists, just open it
    if (order.customer_url) {
      window.open(order.customer_url, "_blank");
      return order.customer_url;
    }

    if (setLoading) setLoading(true);

    // Generate PDF
    const logoUrl = new URL(Logo, window.location.origin).href;
    const orderData = { ...order, items: order.items || [] };

    const pdfBlob = await pdf(
      <CustomerOrderPdf order={orderData} logoUrl={logoUrl} />
    ).toBlob();

    // Upload to storage
    const { error: uploadError } = await supabase.storage
      .from("invoices")
      .upload(`orders/${order.id}_customer.pdf`, pdfBlob, {
        upsert: true,
        contentType: "application/pdf",
      });

    if (uploadError) throw uploadError;

    // Get public URL
    const { data: urlData } = supabase.storage
      .from("invoices")
      .getPublicUrl(`orders/${order.id}_customer.pdf`);

    const pdfUrl = urlData?.publicUrl;

    // Update order with PDF URL
    await supabase
      .from("orders")
      .update({ customer_url: pdfUrl })
      .eq("id", order.id);

    // Open PDF in new tab
    window.open(pdfUrl, "_blank");

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
 */
export const downloadWarehousePdf = async (order, setLoading = null) => {
  try {
    const items = order.items || [];
    const totalItems = items.length;

    // If no items, show error
    if (totalItems === 0) {
      alert("No products in this order");
      return null;
    }

    // If warehouse PDFs already exist, open them
    if (order.warehouse_urls && order.warehouse_urls.length > 0) {
      // Open all warehouse PDFs
      order.warehouse_urls.forEach((url, index) => {
        setTimeout(() => {
          window.open(url, "_blank");
        }, index * 300); // Stagger opening to avoid popup blocker
      });
      return order.warehouse_urls;
    }

    // Legacy support: if single warehouse_url exists
    if (order.warehouse_url) {
      window.open(order.warehouse_url, "_blank");
      return order.warehouse_url;
    }

    if (setLoading) setLoading(true);

    const logoUrl = new URL(Logo, window.location.origin).href;
    const warehouseUrls = [];

    // Generate one PDF per product
    for (let i = 0; i < totalItems; i++) {
      const item = items[i];

      // Generate PDF for this item
      const pdfBlob = await pdf(
        <WarehouseOrderPdf
          order={order}
          item={item}
          itemIndex={i}
          totalItems={totalItems}
          logoUrl={logoUrl}
        />
      ).toBlob();

      // Upload to storage with unique filename per product
      const filename = `orders/${order.id}_warehouse_${i + 1}.pdf`;
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

      warehouseUrls.push(urlData?.publicUrl);
    }

    // Update order with all warehouse PDF URLs
    await supabase
      .from("orders")
      .update({ warehouse_urls: warehouseUrls })
      .eq("id", order.id);

    // Open all PDFs (staggered to avoid popup blocker)
    warehouseUrls.forEach((url, index) => {
      setTimeout(() => {
        window.open(url, "_blank");
      }, index * 300);
    });

    if (setLoading) setLoading(false);
    return warehouseUrls;

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
    const filename = `orders/${order.id}_warehouse_${productIndex + 1}.pdf`;
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
 */
export const generateAllPdfs = async (order, setLoading = null) => {
  try {
    if (setLoading) setLoading(true);

    const logoUrl = new URL(Logo, window.location.origin).href;
    const orderData = { ...order, items: order.items || [] };
    const items = orderData.items;
    const totalItems = items.length;

    // Generate Customer PDF
    const customerPdfBlob = await pdf(
      <CustomerOrderPdf order={orderData} logoUrl={logoUrl} />
    ).toBlob();

    // Upload Customer PDF
    await supabase.storage
      .from("invoices")
      .upload(`orders/${order.id}_customer.pdf`, customerPdfBlob, {
        upsert: true,
        contentType: "application/pdf",
      });

    const { data: customerUrlData } = supabase.storage
      .from("invoices")
      .getPublicUrl(`orders/${order.id}_customer.pdf`);

    const customerUrl = customerUrlData?.publicUrl;

    // Generate Warehouse PDFs - one per product
    const warehouseUrls = [];

    for (let i = 0; i < totalItems; i++) {
      const item = items[i];

      const pdfBlob = await pdf(
        <WarehouseOrderPdf
          order={orderData}
          item={item}
          itemIndex={i}
          totalItems={totalItems}
          logoUrl={logoUrl}
        />
      ).toBlob();

      const filename = `orders/${order.id}_warehouse_${i + 1}.pdf`;
      await supabase.storage
        .from("invoices")
        .upload(filename, pdfBlob, {
          upsert: true,
          contentType: "application/pdf",
        });

      const { data: urlData } = supabase.storage
        .from("invoices")
        .getPublicUrl(filename);

      warehouseUrls.push(urlData?.publicUrl);
    }

    // Update order with all PDF URLs
    await supabase
      .from("orders")
      .update({
        customer_url: customerUrl,
        warehouse_urls: warehouseUrls,
      })
      .eq("id", order.id);

    if (setLoading) setLoading(false);

    return {
      customer_url: customerUrl,
      warehouse_urls: warehouseUrls,
    };

  } catch (error) {
    console.error("PDF generation failed:", error);
    if (setLoading) setLoading(false);
    throw error;
  }
};