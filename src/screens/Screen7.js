import React, { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";
import SignatureCanvas from "react-signature-canvas";
import Logo from "../images/logo.png";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import formatIndianNumber from "../utils/formatIndianNumber";
import "./Screen7.css";

export default function Screen7() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const order = location.state?.orderPayload;

  const [loading, setLoading] = useState(false);
  const [showSignature, setShowSignature] = useState(false);
  const [sigPad, setSigPad] = useState(null);

  const totalAmount = Number(order.grand_total) || 0;
  const advancePayment = Number(order.advance_payment) || 0;
  const discountPercent = Number(order.discount_percent) || 0;
  const discountAmount = Number(order.discount_amount) || 0;
  const netPayable = Number(order.net_total) || 0;
  const remaining = Number(order.remaining_payment) || 0;

  const pricing = {
    discountPercent,
    discountAmount,
    netPayable,
    remaining,
  };

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
  const handlePlaceOrder = () => {
    setShowSignature(true);
  };

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

      const orderWithPricing = {
        ...order,
        discount_percent: pricing.discountPercent,
        discount_amount: pricing.discountAmount,
        grand_total_after_discount: pricing.netPayable,
        net_total: pricing.netPayable,
        remaining_payment: pricing.remaining,
        signature_url: data.publicUrl,
      };

      await saveOrderToDB(orderWithPricing);
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

    let page = pdf.addPage([A4.w, A4.h]);

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

    const COLOR_MAP = {
      pink: "#FFC0CB",
      orange: "#FFA500",
      ivory: "#FFFFF0",
      blue: "#0000FF",
      purple: "#800080",
      red: "#FF0000",
      gold: "#C9A24D",
      green: "#008000",
      mustard: "#FFDB58",
      "off rose": "#F4C2C2",
    };

    //function to draw the color dot:
    const drawColorDot = (colorValue, x, y, size = 6) => {
      try {
        if (!colorValue) return;

        let hex = null;

        // Already hex
        if (colorValue.startsWith("#")) {
          hex = colorValue;
        } else {
          // Named color → map
          hex = COLOR_MAP[colorValue.toLowerCase()];
        }

        // Fallback if unknown
        if (!hex || hex.length !== 7) hex = "#000000";

        const r = parseInt(hex.slice(1, 3), 16) / 255;
        const g = parseInt(hex.slice(3, 5), 16) / 255;
        const b = parseInt(hex.slice(5, 7), 16) / 255;

        page.drawCircle({
          x,
          y,
          size,
          color: rgb(r, g, b),
        });
      } catch {
        // silent fail
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

    const wrapText = (text, maxWidth, fontSize = 10) => {
      const words = String(text || "").split(" ");
      const lines = [];
      let line = "";

      for (const word of words) {
        const testLine = line ? `${line} ${word}` : word;
        const width = font.widthOfTextAtSize(testLine, fontSize);

        if (width > maxWidth) {
          if (line) lines.push(line);
          line = word;
        } else {
          line = testLine;
        }
      }

      if (line) lines.push(line);
      return lines;
    };


    draw("Order Invoice", margin, y, 18, true);
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
      // COLOR LABEL
      draw("Color", fx + 260, y, 10, true);

      // Color dot
      drawColorDot(item.color, fx + 270, y - 18, 5);

      // Color name
      draw(item.color || "—", fx + 285, y - 22, 10);

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
      y -= 40;

      // ✅ DELIVERY ADDRESS
      const fullAddress = [
        order.delivery_address,
        order.delivery_city,
        order.delivery_state,
        order.delivery_pincode,
      ]
        .filter(Boolean)
        .join(", ");

      draw("Delivery Address", margin, y, 10, true);
      y -= 14;

      const addrLines = wrapText(fullAddress, A4.w - margin * 2, 10);
      addrLines.forEach((line) => {
        draw(line, margin, y, 10);
        y -= 14;
      });

      y -= 20;
    }
    // =====================
    // BILLING DETAILS
    // =====================
    section("Billing Details");

    if (order.billing_same) {
      draw("Billing Address", margin, y, 10, true);
      y -= 14;
      draw("Same as delivery address", margin, y, 10);
      y -= 24;
    } else {
      if (order.billing_company) {
        field("Company", order.billing_company, margin, y);
        y -= 30;
      }

      if (order.billing_gstin) {
        field("GSTIN", order.billing_gstin, margin, y);
        y -= 30;
      }

      const billingAddress = [
        order.billing_address,
        order.billing_city,
        order.billing_state,
        order.billing_pincode,
      ]
        .filter(Boolean)
        .join(", ");

      if (billingAddress) {
        draw("Billing Address", margin, y, 10, true);
        y -= 14;

        const billLines = wrapText(
          billingAddress,
          A4.w - margin * 2,
          10
        );

        billLines.forEach((line) => {
          draw(line, margin, y, 10);
          y -= 14;
        });

        y -= 20;
      }
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
    draw(`INR ${formatIndianNumber(totalAmount)}`, margin + 150, y, 12, true);
    y -= 20;

    draw("Discount (%):", margin, y, 10, true);
    draw(`${pricing.discountPercent}%`, margin + 150, y, 10);
    y -= 16;

    draw("Discount Amount:", margin, y, 10, true);
    draw(`INR ${formatIndianNumber(pricing.discountAmount)}`, margin + 150, y, 10);
    y -= 16;

    draw("Net Payable:", margin, y, 10, true);
    draw(`INR ${formatIndianNumber(pricing.netPayable)}`, margin + 150, y, 10);
    y -= 16;

    draw("Advance Payment:", margin, y, 10, true);
    draw(`INR ${formatIndianNumber(order.advance_payment ?? 0)}`, margin + 150, y, 10);
    y -= 16;

    draw("Remaining Payment:", margin, y, 10, true);
    draw(`INR ${formatIndianNumber(pricing.remaining)}`, margin + 150, y, 10);
    y -= 30;


    // =====================
    // SIGNATURE (AUTO POSITIONED)
    // =====================
    // =====================
    // SIGNATURE (AUTO POSITIONED – SAFE)
    // =====================
    const sig = await embedImage(order.signature_url);

    if (sig) {
      const sigWidth = 160;
      const sigHeight = 60;
      const labelHeight = 14;
      const spacing = 30;

      // If not enough space → new page
      if (y < sigHeight + labelHeight + margin + spacing) {
        page = pdf.addPage([A4.w, A4.h]);
        y = A4.h - margin;
      }

      // Move cursor down
      y -= spacing;

      const sigX = A4.w - margin - sigWidth;
      const sigY = y - sigHeight;

      // Draw signature
      page.drawImage(sig, {
        x: sigX,
        y: sigY,
        width: sigWidth,
        height: sigHeight,
      });

      // Label
      draw(
        "Authorized Signature",
        sigX,
        sigY - labelHeight,
        10,
        true
      );

      // Update cursor
      y = sigY - labelHeight - 20;
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


  //logo click logout
  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();

      const raw = sessionStorage.getItem("associateSession");
      const saved = raw ? JSON.parse(raw) : null;

      if (saved?.access_token && saved?.refresh_token) {
        const { error } = await supabase.auth.setSession({
          access_token: saved.access_token,
          refresh_token: saved.refresh_token,
        });

        if (!error) {
          sessionStorage.removeItem("associateSession");
          sessionStorage.removeItem("returnToAssociate");
          navigate("/AssociateDashboard", { replace: true });
          return;
        }
      }
      navigate("/login", { replace: true });
    } catch (e) {
      console.error("Logout restore error", e);
      navigate("/login", { replace: true });
    }
  };
  // ==========================
  // JSX UI BELOW
  // ==========================

  if (!order) {
    return <div>No order found</div>;
  }

  return (
    <div className="screen7">
      {/* HEADER */}
      <div className="screen6-header">
        
        <img src={Logo} className="sheetal-logo" alt="logo" onClick={handleLogout} />
        <h2 className="title">Review Detail</h2>
      </div>



      <div className="screen6-container">
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
                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
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
                  <div className="field">
                    <label>Size:</label>
                    <span>{item.size}</span>
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

            {/* ✅ DELIVERY ADDRESS */}
            <div className="field field-wide" style={{ marginTop: "12px" }}>
              <label>Delivery Address:</label>
              <span>
                {[
                  order.delivery_address,
                  order.delivery_city,
                  order.delivery_state,
                  order.delivery_pincode,
                ]
                  .filter(Boolean)
                  .join(", ")}
              </span>
            </div>
          </div>
        )}

        {/* Billing Details */}
        <div className="section-box">
          <h3>Billing Details</h3>

          {order.billing_same ? (
            <div className="field field-wide">
              <label>Billing Address:</label>
              <span>Same as delivery address</span>
            </div>
          ) : (
            <>
              {/* Company + GSTIN (same row like other sections) */}
              {(order.billing_company || order.billing_gstin) && (
                <div className="row3">
                  <div className="field">
                    <label>Company Name:</label>
                    <span>{order.billing_company || "—"}</span>
                  </div>

                  <div className="field">
                    <label>GSTIN:</label>
                    <span>{order.billing_gstin || "—"}</span>
                  </div>
                </div>
              )}

              {/* Billing Address */}
              <div className="field field-wide" style={{ marginTop: "12px" }}>
                <label>Billing Address:</label>
                <span>
                  {[
                    order.billing_address,
                    order.billing_city,
                    order.billing_state,
                    order.billing_pincode,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                </span>
              </div>
            </>
          )}
        </div>



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
              <span>₹{formatIndianNumber(totalAmount)}</span>
            </div>
            <div className="field">
              <label>Advance Payment:</label>
              <span>₹{formatIndianNumber(advancePayment)}</span>
            </div>
            <div className="field">
              <label>Remaining Payment:</label>
              <span>₹{formatIndianNumber(pricing.remaining)}</span>
            </div>

          </div>
          <div className="row3">
            {/* <div className="field">
              <label>Net Payable:</label>
              <span>₹{formatIndianNumber(pricing.netPayable)}</span>
            </div> */}

            <div className="field">
              <label>Discount %:</label>
              <span>{pricing.discountPercent}%</span>
            </div>
            <div className="field">
              <label>Discount Amount:</label>
              <span>₹{formatIndianNumber(pricing.discountAmount)}</span>
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
        <button className="back-btn" onClick={() => navigate(-1)}>
          ←
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
            <div className="sig-buttons" >
              <button style={{color:"white"}} onClick={() => sigPad.clear()}>Clear </button>
              <button  style={{color:"white !important"}}  onClick={saveSignatureAndContinue}>
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
