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
    // If PDF already exists in DB, just open it
    if (order.customer_url) {
      window.open(order.customer_url, "_blank");
      return order.customer_url;
    }

    if (setLoading) setLoading(true);

    const filename = `orders/${order.order_no}_customer.pdf`;

    // Check if file already exists in storage
    const { data: existingFiles } = await supabase.storage
      .from("invoices")
      .list("orders", {
        search: `${order.order_no}_customer.pdf`,
      });

    if (existingFiles && existingFiles.length > 0) {
      // File exists, just get URL and update DB
      const { data: urlData } = supabase.storage
        .from("invoices")
        .getPublicUrl(filename);

      const pdfUrl = urlData?.publicUrl;

      // Update order with PDF URL
      await supabase
        .from("orders")
        .update({ customer_url: pdfUrl })
        .eq("id", order.id);

      window.open(pdfUrl, "_blank");
      if (setLoading) setLoading(false);
      return pdfUrl;
    }

    // Generate PDF
    const logoUrl = new URL(Logo, window.location.origin).href;
    const orderData = { ...order, items: order.items || [] };

    const pdfBlob = await pdf(
      <CustomerOrderPdf order={orderData} logoUrl={logoUrl} />
    ).toBlob();

    // Upload to storage
    const { error: uploadError } = await supabase.storage
      .from("invoices")
      .upload(filename, pdfBlob, {
        upsert: true,
        contentType: "application/pdf",
      });

    if (uploadError) {
      // If already exists, just get URL
      if (uploadError.message?.includes("already exists") || uploadError.statusCode === 409) {
        const { data: urlData } = supabase.storage
          .from("invoices")
          .getPublicUrl(filename);

        const pdfUrl = urlData?.publicUrl;
        await supabase.from("orders").update({ customer_url: pdfUrl }).eq("id", order.id);
        window.open(pdfUrl, "_blank");
        if (setLoading) setLoading(false);
        return pdfUrl;
      }
      throw uploadError;
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from("invoices")
      .getPublicUrl(filename);

    const pdfUrl = urlData?.publicUrl;

    // Update order with PDF URL
    await supabase
      .from("orders")
      .update({ customer_url: pdfUrl })
      .eq("id", order.id);

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
      order.warehouse_urls.forEach((url, index) => {
        setTimeout(() => {
          window.open(url, "_blank");
        }, index * 300);
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
      const filename = `orders/${order.order_no}_warehouse_${i + 1}.pdf`;

      // Check if file already exists
      const { data: existingFiles } = await supabase.storage
        .from("invoices")
        .list("orders", {
          search: `${order.order_no}_warehouse_${i + 1}.pdf`,
        });

      if (existingFiles && existingFiles.length > 0) {
        // File exists, just get the URL
        const { data: urlData } = supabase.storage
          .from("invoices")
          .getPublicUrl(filename);

        warehouseUrls.push(urlData?.publicUrl);
        console.log(`✅ Warehouse PDF ${i + 1} already exists, using existing URL`);
        continue;
      }

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

      // Try to upload, handle if already exists
      const { error: uploadError } = await supabase.storage
        .from("invoices")
        .upload(filename, pdfBlob, {
          upsert: true,
          contentType: "application/pdf",
        });

      if (uploadError) {
        // If file already exists error, just get the URL
        if (uploadError.message?.includes("already exists") || uploadError.statusCode === 409) {
          console.log(`File ${filename} already exists, getting URL`);
          const { data: urlData } = supabase.storage
            .from("invoices")
            .getPublicUrl(filename);
          warehouseUrls.push(urlData?.publicUrl);
          continue;
        }
        throw uploadError;
      }

      // Get public URL
      const { data: urlData } = supabase.storage
        .from("invoices")
        .getPublicUrl(filename);

      warehouseUrls.push(urlData?.publicUrl);
      console.log(`✅ Warehouse PDF ${i + 1} uploaded successfully`);
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