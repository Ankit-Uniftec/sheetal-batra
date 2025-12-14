import React, { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";
import SignatureCanvas from "react-signature-canvas";
import Logo from "../images/logo.png";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import "./Screen7.css";

export default function Screen7() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const order = location.state?.orderPayload;

  const [loading, setLoading] = useState(false);
  const [showSignature, setShowSignature] = useState(false);
  const [sigPad, setSigPad] = useState(null);

  if (!order) return <div>No order found</div>;

  // ===============================
  // PROFILE
  // ===============================
  const profileFromOrder = (o) => ({
    full_name: o?.delivery_name || "",
    email: o?.delivery_email || "",
    phone: o?.delivery_phone || "",
  });

  // ===============================
  // SIGNATURE FLOW
  // ===============================
  const handlePlaceOrder = () => setShowSignature(true);

  const saveSignatureAndContinue = async () => {
    if (!sigPad || sigPad.isEmpty()) {
      alert("Please sign before continuing.");
      return;
    }

    try {
      setLoading(true);

      const blob = await (await fetch(sigPad.toDataURL("image/png"))).blob();
      const path = `${user.id}/signature_${Date.now()}.png`;

      const { error } = await supabase.storage
        .from("signature")
        .upload(path, blob, { upsert: true });

      if (error) throw error;

      const { data } = supabase.storage
        .from("signature")
        .getPublicUrl(path);

      await saveOrderToDB({
        ...order,
        signature_url: data.publicUrl,
      });
    } catch (e) {
      alert("Signature upload failed");
      console.error(e);
    } finally {
      setLoading(false);
      setShowSignature(false);
    }
  };

  // ===============================
  // PDF BUILDER (SAFE)
  // ===============================
  async function buildInvoicePdfBytes(order, logoUrl) {
    const A4 = { w: 595, h: 842 };
    const margin = 40;

    const pdf = await PDFDocument.create();
    pdf.registerFontkit(fontkit);

    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const fontB = await pdf.embedFont(StandardFonts.HelveticaBold);

    const page = pdf.addPage([A4.w, A4.h]);
    let y = A4.h - margin;

    const draw = (t, x, y, s = 11, b = false) =>
      page.drawText(String(t ?? "—"), {
        x,
        y,
        size: s,
        font: b ? fontB : font,
        color: rgb(0.1, 0.1, 0.1),
      });

    const embedImage = async (url) => {
      if (!url) return null;
      try {
        const r = await fetch(url);
        if (!r.ok) return null;
        const bytes = await r.arrayBuffer();
        try {
          return await pdf.embedPng(bytes);
        } catch {
          return await pdf.embedJpg(bytes);
        }
      } catch {
        return null;
      }
    };

    // LOGO
    const logo = await embedImage(logoUrl);
    if (logo) {
      const w = 120;
      const h = (logo.height / logo.width) * w;
      page.drawImage(logo, {
        x: A4.w / 2 - w / 2,
        y: y - h,
        width: w,
        height: h,
      });
      y -= h + 20;
    }

    draw("Review Your Order", margin, y, 18, true);
    y -= 22;
    draw(`Order ID: ${order.id}`, margin, y);
    draw(
      `Date: ${new Date(order.created_at || Date.now()).toLocaleString()}`,
      margin + 260,
      y
    );
    y -= 30;

    const section = (title) => {
      page.drawRectangle({
        x: margin,
        y: y - 26,
        width: A4.w - margin * 2,
        height: 26,
        color: rgb(0.95, 0.95, 0.97),
      });
      draw(title, margin + 10, y - 18, 12, true);
      y -= 36;
    };

    const field = (l, v, x, y) => {
      draw(l, x, y, 10, true);
      draw(v, x, y - 14, 10);
    };

    // PRODUCT DETAILS
    section("Product Details");
    for (const item of order.items || []) {
      const img = await embedImage(item.image_url);
      if (img) {
        page.drawImage(img, { x: margin, y: y - 80, width: 80, height: 80 });
      }

      const fx = margin + 100;
      field("Product Name", item.product_name, fx, y);
      field("Color", item.color, fx + 260, y);
      y -= 40;
      field("Top", item.top, fx, y);
      field("Bottom", item.bottom, fx + 160, y);
      field("Extras", item.extra || "—", fx + 320, y);
      y -= 70;
    }

    // DELIVERY
    if (order.mode_of_delivery === "Home Delivery") {
      section("Delivery Details");
      field("Name", order.delivery_name, margin, y);
      field("Email", order.delivery_email, margin + 180, y);
      field("Phone", order.delivery_phone, margin + 360, y);
      y -= 60;
    }

    // SALESPERSON
    section("Salesperson Details");
    field("Name", order.salesperson, margin, y);
    field("Email", order.salesperson_email, margin + 180, y);
    field("Phone", order.salesperson_phone, margin + 360, y);
    y -= 60;

    // PAYMENT
    section("Payment Details");
    draw("Total Amount:", margin, y, 12, true);
    draw(`INR ${order.grand_total}`, margin + 150, y, 12, true);


    // SIGNATURE
    const sig = await embedImage(order.signature_url);
    if (sig) {
      page.drawImage(sig, {
        x: A4.w - margin - 160,
        y: 90,
        width: 160,
        height: 60,
      });
      draw("Authorized Signature", A4.w - margin - 160, 160, 10, true);
    }

    return pdf.save();
  }

  // ===============================
  // SAVE ORDER
  // ===============================
  const saveOrderToDB = async (orderToSave) => {
    try {
      const { data, error } = await supabase
        .from("orders")
        .insert(orderToSave)
        .select()
        .single();

      if (error) throw error;

      const logoUrl = new URL(Logo, window.location.origin).href;
      const pdfBytes = await buildInvoicePdfBytes(data, logoUrl);

      await supabase.storage
        .from("invoices")
        .upload(`orders/${data.id}.pdf`, new Blob([pdfBytes]), {
          upsert: true,
          contentType: "application/pdf",
        });

      alert("Order saved & invoice sent!");
      navigate("/orderHistory");
    } catch (e) {
      alert("Failed to save order");
      console.error(e);
    }
  };

  // ==========================
  // JSX UI BELOW
  // ==========================

  return (
    <div className="screen7">
      {/* Header */}
      <div className="screen7-header">
        <button className="back-btn" onClick={() => navigate(-1)}>
          ←
        </button>
        <img src={Logo} className="sheetal-logo" alt="logo" />
      </div>

      <h2 className="title">Review Your Order</h2>

      <div className="screen7-container">
        {/* PRODUCT DETAILS */}
        <div className="section-box">
          <h3>Product Details</h3>

          {order.items?.map((item, i) => (
            <div key={i} className="product-box">
              <img src={item.image_url} className="prod-img" alt="" />
              <div className="product-fields">
                <div className="row-flex">
                  <div className="field field-wide">
                    <label>Product Name:</label>
                    <span>{item.product_name}</span>
                  </div>
                  <div className="field field-small">
                    <label>Color:</label>
                    <div
                      style={{
                        background: item.color,
                        height: "15px",
                        width: "30px",
                        borderRadius: "10px",
                      }}
                    ></div>
                    <span>{item.color}</span>
                  </div>
                </div>

                <div className="row3">
                  <div className="field">
                    <label>Top:</label>
                    <span>{item.top}</span>
                  </div>
                  <div className="field">
                    <label>Bottom:</label>
                    <span>{item.bottom}</span>
                  </div>
                  <div className="field">
                    <label>Extras:</label>
                    <span>{item.extra}</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Delivery */}
        {order.mode_of_delivery === "Home Delivery" && (
          <div className="section-box">
            <h3>Delivery Details</h3>
            <div className="row3">
              <div className="field">
                <label>Name:</label>
                <span>{order.delivery_name}</span>
              </div>
              <div className="field">
                <label>Email:</label>
                <span>{order.delivery_email}</span>
              </div>
              <div className="field">
                <label>Phone:</label>
                <span>{order.delivery_phone}</span>
              </div>
            </div>
          </div>
        )}

        {/* Salesperson */}
        <div className="section-box">
          <h3>Salesperson Details</h3>
          <div className="row3">
            <div className="field">
              <label>Name:</label>
              <span>{order.salesperson || "—"}</span>
            </div>
            <div className="field">
              <label>Email:</label>
              <span>{order.salesperson_email || "—"}</span>
            </div>
            <div className="field">
              <label>Phone:</label>
              <span>{order.salesperson_phone || "—"}</span>
            </div>
          </div>
        </div>

        {/* Payment */}
        <div className="section-box">
          <h3>Payment Details</h3>
          <div className="row3">
            <div className="field">
              <label>Total Amount:</label>
              <span>{order.grand_total}</span>
            </div>
          </div>
        </div>

        <button
          className="confirm-btn"
          disabled={loading}
          onClick={handlePlaceOrder}
        >
          {loading ? "Saving..." : "Place Order"}
        </button>
      </div>

      {/* SIGNATURE MODAL */}
      {showSignature && (
        <div className="signature-modal">
          <div className="signature-box">
            <h3>Sign Below</h3>
            <SignatureCanvas
              penColor="black"
              ref={setSigPad}
              canvasProps={{
                width: 500,
                height: 200,
                className: "sig-canvas",
              }}
            />
            <div className="sig-buttons">
              <button onClick={() => sigPad.clear()}>Clear</button>
              <button onClick={saveSignatureAndContinue}>
                Save & Continue
              </button>
            </div>
            <button
              className="close-modal"
              onClick={() => setShowSignature(false)}
            >
              ✖
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
