import React from 'react';
import { Buffer } from 'buffer';
import { pdf } from "@react-pdf/renderer";
import { supabase } from "../lib/supabaseClient";
import CustomerOrderPdf from "../pdf/CustomerOrderPdf";
import WarehouseOrderPdf from "../pdf/WarehouseOrderPdf";
import Logo from "../images/logo.png";

// Buffer polyfill for browser compatibility
if (typeof window !== 'undefined') {
  window.Buffer = window.Buffer || Buffer;
}

/**
 * Generate and download Customer PDF
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
    alert("Failed to generate PDF: " + error.message);
    throw error;
  }
};

/**
 * Generate and download Warehouse PDF
 */
export const downloadWarehousePdf = async (order, setLoading = null) => {
  try {
    // If PDF already exists, just open it
    if (order.warehouse_url) {
      window.open(order.warehouse_url, "_blank");
      return order.warehouse_url;
    }

    if (setLoading) setLoading(true);

    // Generate PDF
    const logoUrl = new URL(Logo, window.location.origin).href;
    const orderData = { ...order, items: order.items || [] };
    
    const pdfBlob = await pdf(
      <WarehouseOrderPdf order={orderData} logoUrl={logoUrl} />
    ).toBlob();

    // Upload to storage
    const { error: uploadError } = await supabase.storage
      .from("invoices")
      .upload(`orders/${order.id}_warehouse.pdf`, pdfBlob, {
        upsert: true,
        contentType: "application/pdf",
      });

    if (uploadError) throw uploadError;

    // Get public URL
    const { data: urlData } = supabase.storage
      .from("invoices")
      .getPublicUrl(`orders/${order.id}_warehouse.pdf`);

    const pdfUrl = urlData?.publicUrl;

    // Update order with PDF URL
    await supabase
      .from("orders")
      .update({ warehouse_url: pdfUrl })
      .eq("id", order.id);

    // Open PDF in new tab
    window.open(pdfUrl, "_blank");

    if (setLoading) setLoading(false);
    return pdfUrl;

  } catch (error) {
    console.error("Warehouse PDF generation failed:", error);
    if (setLoading) setLoading(false);
    alert("Failed to generate PDF: " + error.message);
    throw error;
  }
};

/**
 * Generate both PDFs for an order
 */
export const generateBothPdfs = async (order, setLoading = null) => {
  try {
    if (setLoading) setLoading(true);

    const logoUrl = new URL(Logo, window.location.origin).href;
    const orderData = { ...order, items: order.items || [] };

    // Generate both PDFs in parallel
    const [customerPdfBlob, warehousePdfBlob] = await Promise.all([
      pdf(<CustomerOrderPdf order={orderData} logoUrl={logoUrl} />).toBlob(),
      pdf(<WarehouseOrderPdf order={orderData} logoUrl={logoUrl} />).toBlob(),
    ]);

    // Upload both PDFs in parallel
    await Promise.all([
      supabase.storage
        .from("invoices")
        .upload(`orders/${order.id}_customer.pdf`, customerPdfBlob, {
          upsert: true,
          contentType: "application/pdf",
        }),
      supabase.storage
        .from("invoices")
        .upload(`orders/${order.id}_warehouse.pdf`, warehousePdfBlob, {
          upsert: true,
          contentType: "application/pdf",
        }),
    ]);

    // Get public URLs
    const { data: customerUrlData } = supabase.storage
      .from("invoices")
      .getPublicUrl(`orders/${order.id}_customer.pdf`);

    const { data: warehouseUrlData } = supabase.storage
      .from("invoices")
      .getPublicUrl(`orders/${order.id}_warehouse.pdf`);

    // Update order with both PDF URLs
    await supabase
      .from("orders")
      .update({
        customer_url: customerUrlData?.publicUrl,
        warehouse_url: warehouseUrlData?.publicUrl,
      })
      .eq("id", order.id);

    if (setLoading) setLoading(false);

    return {
      customerUrl: customerUrlData?.publicUrl,
      warehouseUrl: warehouseUrlData?.publicUrl,
    };

  } catch (error) {
    console.error("PDF generation failed:", error);
    if (setLoading) setLoading(false);
    throw error;
  }
};