// import React, { useMemo, useState } from "react";
// import { useLocation, useNavigate } from "react-router-dom";
// import { supabase } from "../lib/supabaseClient";
// import { useAuth } from "../context/AuthContext";
// import SignatureCanvas from "react-signature-canvas";
// import Logo from "../images/logo.png";
// import fontkit from "@pdf-lib/fontkit";
// import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
// import formatIndianNumber from "../utils/formatIndianNumber";
// import formatDate from "../utils/formatDate"; // Import formatDate
// import "./Screen7.css";

// function ColorDotDisplay({ colorValue }) {
//   if (!colorValue) return null;

//   return (
//     <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
//       <div
//         style={{
//           background: colorValue, // Directly use colorValue as background
//           height: "15px",
//           width: "30px",
//           borderRadius: "10px",
//           border: "1px solid #ccc", // Add a border for visibility on light colors
//         }}
//       ></div>
//       <span>{colorValue}</span>
//     </div>
//   );
// }

// // ===============================
// // DATE HELPERS (POSTGRES SAFE)
// // ===============================
// const toISODate = (value) => {
//   if (!value) return null;

//   // Already ISO
//   if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);

//   // Convert DD-MM-YYYY → YYYY-MM-DD
//   if (/^\d{2}-\d{2}-\d{4}$/.test(value)) {
//     const [dd, mm, yyyy] = value.split("-");
//     return `${yyyy}-${mm}-${dd}`;
//   }

//   // Fallback (Date object / timestamp)
//   try {
//     return new Date(value).toISOString().slice(0, 10);
//   } catch {
//     return null;
//   }
// };


// export default function Screen7() {
//   const navigate = useNavigate();
//   const location = useLocation();
//   const { user } = useAuth();
//   const order = location.state?.orderPayload;

//   const [loading, setLoading] = useState(false);
//   const [showSignature, setShowSignature] = useState(false);
//   const [sigPad, setSigPad] = useState(null);

//   const totalAmount = Number(order.grand_total) || 0;
//   const advancePayment = Number(order.advance_payment) || 0;
//   const discountPercent = Number(order.discount_percent) || 0;
//   const discountAmount = Number(order.discount_amount) || 0;
//   const netPayable = Number(order.net_total) || 0;
//   const remaining = Number(order.remaining_payment) || 0;

//   const pricing = {
//     discountPercent,
//     discountAmount,
//     netPayable,
//     remaining,
//   };

//   // ===============================
//   // PROFILE
//   // ===============================
//   const profileFromOrder = (o) => ({
//     full_name: o?.delivery_name || "",
//     email: o?.delivery_email || "",
//     phone: o?.delivery_phone || "",
//   });

//   // ===============================
//   // SIGNATURE FLOW
//   // ===============================
//   const handlePlaceOrder = () => {
//     setShowSignature(true);
//   };

//   const saveSignatureAndContinue = async () => {
//     if (!sigPad || sigPad.isEmpty()) {
//       alert("Please sign before continuing.");
//       return;
//     }

//     try {
//       setLoading(true);

//       const blob = await (await fetch(sigPad.toDataURL("image/png"))).blob();
//       const path = `${user.id}/signature_${Date.now()}.png`;

//       const { error } = await supabase.storage
//         .from("signature")
//         .upload(path, blob, { upsert: true });

//       if (error) throw error;

//       const { data } = supabase.storage
//         .from("signature")
//         .getPublicUrl(path);

//       const orderWithPricing = {
//         ...order,
//         discount_percent: pricing.discountPercent,
//         discount_amount: pricing.discountAmount,
//         grand_total_after_discount: pricing.netPayable,
//         net_total: pricing.netPayable,
//         remaining_payment: pricing.remaining,
//         signature_url: data.publicUrl,
//       };

//       await saveOrderToDB(orderWithPricing);
//     } catch (e) {
//       alert("Signature upload failed");
//       console.error(e);
//     } finally {
//       setLoading(false);
//       setShowSignature(false);
//     }
//   };

//   // ===============================
//   // PDF BUILDER (SAFE)
//   // ===============================
  // async function buildInvoicePdfBytes(order, logoUrl) {
  //   const A4 = { w: 595, h: 842 };
  //   const margin = 40;

  //   const pdf = await PDFDocument.create();
  //   pdf.registerFontkit(fontkit);

  //   const font = await pdf.embedFont(StandardFonts.Helvetica);
  //   const fontB = await pdf.embedFont(StandardFonts.HelveticaBold);

  //   let page = pdf.addPage([A4.w, A4.h]);

  //   let y = A4.h - margin;

  //   const draw = (t, x, y, s = 11, b = false) =>
  //     page.drawText(String(t ?? "—"), {
  //       x,
  //       y,
  //       size: s,
  //       font: b ? fontB : font,
  //       color: rgb(0.1, 0.1, 0.1),
  //     });

  //   const embedImage = async (url) => {
  //     if (!url) return null;
  //     try {
  //       const r = await fetch(url);
  //       if (!r.ok) return null;
  //       const bytes = await r.arrayBuffer();
  //       try {
  //         return await pdf.embedPng(bytes);
  //       } catch {
  //         return await pdf.embedJpg(bytes);
  //       }
  //     } catch {
  //       return null;
  //     }
  //   };

  //   const COLOR_MAP = {
  //     pink: "#FFC0CB",
  //     orange: "#FFA500",
  //     ivory: "#FFFFF0",
  //     blue: "#0000FF",
  //     purple: "#800080",
  //     red: "#FF0000",
  //     gold: "#C9A24D",
  //     green: "#008000",
  //     mustard: "#FFDB58",
  //     "off rose": "#F4C2C2",
  //   };

  //   //function to draw the color dot:
  //   const drawColorDot = (colorValue, x, y, size = 6) => {
  //     try {
  //       if (!colorValue) return;

  //       let hex = null;

  //       // Already hex
  //       if (colorValue.startsWith("#")) {
  //         hex = colorValue;
  //       } else {
  //         // Named color → map
  //         hex = COLOR_MAP[colorValue.toLowerCase()];
  //       }

  //       // Fallback if unknown
  //       if (!hex || hex.length !== 7) hex = "#000000";

  //       const r = parseInt(hex.slice(1, 3), 16) / 255;
  //       const g = parseInt(hex.slice(3, 5), 16) / 255;
  //       const b = parseInt(hex.slice(5, 7), 16) / 255;

  //       page.drawCircle({
  //         x,
  //         y,
  //         size,
  //         color: rgb(r, g, b),
  //       });
  //     } catch {
  //       // silent fail
  //     }
  //   };


  //   // LOGO
  //   const logo = await embedImage(logoUrl);
  //   if (logo) {
  //     const w = 120;
  //     const h = (logo.height / logo.width) * w;
  //     page.drawImage(logo, {
  //       x: A4.w / 2 - w / 2,
  //       y: y - h,
  //       width: w,
  //       height: h,
  //     });
  //     y -= h + 20;
  //   }

  //   const wrapText = (text, maxWidth, fontSize = 10) => {
  //     const words = String(text || "").split(" ");
  //     const lines = [];
  //     let line = "";

  //     for (const word of words) {
  //       const testLine = line ? `${line} ${word}` : word;
  //       const width = font.widthOfTextAtSize(testLine, fontSize);

  //       if (width > maxWidth) {
  //         if (line) lines.push(line);
  //         line = word;
  //       } else {
  //         line = testLine;
  //       }
  //     }

  //     if (line) lines.push(line);
  //     return lines;
  //   };


  //   draw("Order Invoice", margin, y, 18, true);
  //   y -= 22;
  //   draw(`Order ID: ${order.id}`, margin, y);
  //   draw(
  //     `Date: ${formatDate(order.created_at || Date.now())}`,
  //     margin + 260,
  //     y
  //   );
  //   y -= 30;

  //   if (order.order_flag === "Urgent" && order.urgent_reason) {
  //     draw("Urgent Reason:", margin, y, 10, true);
  //     draw(order.urgent_reason, margin + 100, y, 10);
  //     y -= 20;
  //   }

  //   const section = (title) => {
  //     page.drawRectangle({
  //       x: margin,
  //       y: y - 26,
  //       width: A4.w - margin * 2,
  //       height: 26,
  //       color: rgb(0.95, 0.95, 0.97),
  //     });
  //     draw(title, margin + 10, y - 18, 12, true);
  //     y -= 36;
  //   };

  //   const field = (l, v, x, y) => {
  //     draw(l, x, y, 10, true);
  //     draw(v, x, y - 14, 10);
  //   };

  //   // PRODUCT DETAILS
  //   section("Product Details");
  //   for (const item of order.items || []) {
  //     const img = await embedImage(item.image_url);
  //     if (img) {
  //       page.drawImage(img, { x: margin, y: y - 80, width: 80, height: 80 });
  //     }

  //     const fx = margin + 100;
  //     field("Product Name", item.product_name, fx, y);
  //     // COLOR LABEL
  //     draw("Color", fx + 260, y, 10, true);

  //     // Color dot
  //     drawColorDot(item.color, fx + 270, y - 18, 5);

  //     // Color name
  //     draw(item.color || "—", fx + 285, y - 22, 10);

  //     y -= 40;
  //     field("Top", item.top, fx, y);
  //     field("Bottom", item.bottom, fx + 160, y);
  //     field("Extras", item.extra || "—", fx + 320, y);
  //     y -= 40; // Adjust Y position for notes

  //     if (item.notes) {
  //       draw("Product Notes", fx, y, 10, true);
  //       y -= 14;
  //       const productNotesLines = wrapText(item.notes, A4.w - margin - fx, 10);
  //       productNotesLines.forEach((line) => {
  //         draw(line, fx, y, 10);
  //         y -= 14;
  //       });
  //       y -= 20; // Additional spacing after product notes
  //     }
  //     y -= 30; // Adjust Y position for next product item or section
  //   }

  //   // DELIVERY
  //   if (order.mode_of_delivery === "Home Delivery") {
  //     section("Delivery Details");

  //     field("Name", order.delivery_name, margin, y);
  //     field("Email", order.delivery_email, margin + 180, y);
  //     field("Phone", order.delivery_phone, margin + 360, y);
  //     y -= 40;

  //     // ✅ DELIVERY ADDRESS
  //     const fullAddress = [
  //       order.delivery_address,
  //       order.delivery_city,
  //       order.delivery_state,
  //       order.delivery_pincode,
  //     ]
  //       .filter(Boolean)
  //       .join(", ");

  //     draw("Delivery Address", margin, y, 10, true);
  //     y -= 14;

  //     const addrLines = wrapText(fullAddress, A4.w - margin * 2, 10);
  //     addrLines.forEach((line) => {
  //       draw(line, margin, y, 10);
  //       y -= 14;
  //     });

  //     y -= 20;

  //     if (order.delivery_notes) {
  //       draw("Delivery Notes", margin, y, 10, true);
  //       y -= 14;
  //       const deliveryNotesLines = wrapText(order.delivery_notes, A4.w - margin * 2, 10);
  //       deliveryNotesLines.forEach((line) => {
  //         draw(line, margin, y, 10);
  //         y -= 14;
  //       });
  //       y -= 20;
  //     }

  //     if (order.comments) {
  //       draw("General Order Comments", margin, y, 10, true);
  //       y -= 14;
  //       const commentsLines = wrapText(order.comments, A4.w - margin * 2, 10);
  //       commentsLines.forEach((line) => {
  //         draw(line, margin, y, 10);
  //         y -= 14;
  //       });
  //       y -= 20;
  //     }
  //   }
  //   // =====================
  //   // BILLING DETAILS
  //   // =====================
  //   section("Billing Details");

  //   if (order.billing_same) {
  //     draw("Billing Address", margin, y, 10, true);
  //     y -= 14;
  //     draw("Same as delivery address", margin, y, 10);
  //     y -= 24;
  //   } else {
  //     if (order.billing_company) {
  //       field("Company", order.billing_company, margin, y);
  //       y -= 30;
  //     }

  //     if (order.billing_gstin) {
  //       field("GSTIN", order.billing_gstin, margin, y);
  //       y -= 30;
  //     }

  //     const billingAddress = [
  //       order.billing_address,
  //       order.billing_city,
  //       order.billing_state,
  //       order.billing_pincode,
  //     ]
  //       .filter(Boolean)
  //       .join(", ");

  //     if (billingAddress) {
  //       draw("Billing Address", margin, y, 10, true);
  //       y -= 14;

  //       const billLines = wrapText(
  //         billingAddress,
  //         A4.w - margin * 2,
  //         10
  //       );

  //       billLines.forEach((line) => {
  //         draw(line, margin, y, 10);
  //         y -= 14;
  //       });

  //       y -= 20;
  //     }
  //   }


  //   // SALESPERSON
  //   section("Salesperson Details");
  //   field("Name", order.salesperson, margin, y);
  //   field("Email", order.salesperson_email, margin + 180, y);
  //   field("Phone", order.salesperson_phone, margin + 360, y);
  //   y -= 60;

  //   // PAYMENT
  //   section("Payment Details");
  //   draw("Total Amount:", margin, y, 12, true);
  //   draw(`INR ${formatIndianNumber(totalAmount)}`, margin + 150, y, 12, true);
  //   y -= 20;

  //   draw("Discount (%):", margin, y, 10, true);
  //   draw(`${pricing.discountPercent}%`, margin + 150, y, 10);
  //   y -= 16;

  //   draw("Discount Amount:", margin, y, 10, true);
  //   draw(`INR ${formatIndianNumber(pricing.discountAmount)}`, margin + 150, y, 10);
  //   y -= 16;

  //   draw("Net Payable:", margin, y, 10, true);
  //   draw(`INR ${formatIndianNumber(pricing.netPayable)}`, margin + 150, y, 10);
  //   y -= 16;

  //   draw("Advance Payment:", margin, y, 10, true);
  //   draw(`INR ${formatIndianNumber(order.advance_payment ?? 0)}`, margin + 150, y, 10);
  //   y -= 16;

  //   draw("Remaining Payment:", margin, y, 10, true);
  //   draw(`INR ${formatIndianNumber(pricing.remaining)}`, margin + 150, y, 10);
  //   y -= 30;


  //   // =====================
  //   // SIGNATURE (AUTO POSITIONED)
  //   // =====================
  //   // =====================
  //   // SIGNATURE (AUTO POSITIONED – SAFE)
  //   // =====================
  //   const sig = await embedImage(order.signature_url);

  //   if (sig) {
  //     const sigWidth = 160;
  //     const sigHeight = 60;
  //     const labelHeight = 14;
  //     const spacing = 30;

  //     // If not enough space → new page
  //     if (y < sigHeight + labelHeight + margin + spacing) {
  //       page = pdf.addPage([A4.w, A4.h]);
  //       y = A4.h - margin;
  //     }

  //     // Move cursor down
  //     y -= spacing;

  //     const sigX = A4.w - margin - sigWidth;
  //     const sigY = y - sigHeight;

  //     // Draw signature
  //     page.drawImage(sig, {
  //       x: sigX,
  //       y: sigY,
  //       width: sigWidth,
  //       height: sigHeight,
  //     });

  //     // Label
  //     draw(
  //       "Authorized Signature",
  //       sigX,
  //       sigY - labelHeight,
  //       10,
  //       true
  //     );

  //     // Update cursor
  //     y = sigY - labelHeight - 20;
  //   }



  //   return pdf.save();
  // }

//   // ===============================
//   // SAVE ORDER
//   // ===============================
//   // ===============================
//   // SAVE ORDER (DATE SAFE)
//   // ===============================
//   const saveOrderToDB = async (orderToSave) => {
//     try {
//       // 🔴 FIX: Normalize ALL date fields here
//       const normalizedOrder = {
//         ...orderToSave,

//         // Dates
//         created_at: orderToSave.created_at
//           ? new Date(orderToSave.created_at).toISOString()
//           : new Date().toISOString(),

//         delivery_date: toISODate(orderToSave.delivery_date),
//         join_date: toISODate(orderToSave.join_date),

//         // Optional safety (if these exist)
//         billing_date: toISODate(orderToSave.billing_date),
//         expected_delivery: toISODate(orderToSave.expected_delivery),
//       };

//       const { data, error } = await supabase
//         .from("orders")
//         .insert(normalizedOrder)
//         .select()
//         .single();

//       if (error) throw error;

//       // ---------------------------
//       // PDF GENERATION (UNCHANGED)
//       // ---------------------------
//       const logoUrl = new URL(Logo, window.location.origin).href;
//       const pdfBytes = await buildInvoicePdfBytes(data, logoUrl);

//       await supabase.storage
//         .from("invoices")
//         .upload(`orders/${data.id}.pdf`, new Blob([pdfBytes]), {
//           upsert: true,
//           contentType: "application/pdf",
//         });

//       alert("✅ Order saved & invoice generated!");
//       navigate("/orderHistory");
//     } catch (e) {
//       console.error("❌ Order save failed:", e);
//       alert(e.message || "Failed to save order");
//     }
//   };



//   //logo click logout
//   const handleLogout = async () => {
//     try {
//       await supabase.auth.signOut();

//       const raw = sessionStorage.getItem("associateSession");
//       const saved = raw ? JSON.parse(raw) : null;

//       if (saved?.access_token && saved?.refresh_token) {
//         const { error } = await supabase.auth.setSession({
//           access_token: saved.access_token,
//           refresh_token: saved.refresh_token,
//         });

//         if (!error) {
//           sessionStorage.removeItem("associateSession");
//           sessionStorage.removeItem("returnToAssociate");
//           navigate("/AssociateDashboard", { replace: true });
//           return;
//         }
//       }
//       navigate("/login", { replace: true });
//     } catch (e) {
//       console.error("Logout restore error", e);
//       navigate("/login", { replace: true });
//     }
//   };
//   // ==========================
//   // JSX UI BELOW
//   // ==========================

//   if (!order) {
//     return <div>No order found</div>;
//   }

//   return (
//     <div className="screen7">
//       {/* HEADER */}
//       <div className="screen6-header">

//         <img src={Logo} className="sheetal-logo" alt="logo" onClick={handleLogout} />
//         <h2 className="title">Review Detail</h2>
//       </div>



//       <div className="screen6-container">
//         {/* PRODUCT DETAILS */}
//         <div className="section-box">
//           <h3>Product Details</h3>

//           {order.items?.map((item, i) => (
//             <div key={i} className="product-box">
//               <img src={item.image_url} className="prod-img" alt="" />
//               <div className="product-fields">
//                 <div className="row-flex">
//                   <div className="field field-wide">
//                     <label>Product Name:</label>
//                     <span>{item.product_name}</span>
//                   </div>
//                   <div className="field field-small">
//                     <label>Color:</label>
//                     <ColorDotDisplay colorValue={item.color} />
//                   </div>
//                 </div>

//                 {item.notes && (
//                   <div className="field field-wide" style={{ marginTop: "12px" }}>
//                     <label>Product Notes:</label>
//                     <span>{item.notes}</span>
//                   </div>
//                 )}

//                 <div className="row3">
//                   <div className="field">
//                     <label>Top:</label>
//                     <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
//                       <span>{item.top}</span>
//                       {item.top_color && <ColorDotDisplay colorValue={item.top_color} />}
//                     </div>
//                   </div>
//                   <div className="field">
//                     <label>Bottom:</label>
//                     <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
//                       <span>{item.bottom}</span>
//                       {item.bottom_color && <ColorDotDisplay colorValue={item.bottom_color} />}
//                     </div>
//                   </div>
//                   <div className="field">
//                     <label>Size:</label>
//                     <span>{item.size}</span>
//                   </div>
//                   {item.extras && item.extras.length > 0 && (
//                     <div className="field field-wide">
//                       <label>Extras:</label>
//                       <div className="extras-display">
//                         {item.extras.map((extra, idx) => (
//                           <div key={idx} className="extra-item-display">
//                             <span>{extra.name} (₹{formatIndianNumber(extra.price)})</span>
//                             {extra.color && <ColorDotDisplay colorValue={extra.color} />}
//                           </div>
//                         ))}
//                       </div>
//                     </div>
//                   )}
//                 </div>
//               </div>
//             </div>
//           ))}
//         </div>

//         {/* Delivery */}
//         {order.mode_of_delivery === "Home Delivery" && (
//           <div className="section-box">
//             <h3>Delivery Details</h3>

//             <div className="row3">
//               <div className="field">
//                 <label>Name:</label>
//                 <span>{order.delivery_name}</span>
//               </div>
//               <div className="field">
//                 <label>Email:</label>
//                 <span>{order.delivery_email}</span>
//               </div>
//               <div className="field">
//                 <label>Phone:</label>
//                 <span>{order.delivery_phone}</span>
//               </div>
//             </div>

//             {/* ✅ DELIVERY ADDRESS */}
//             <div className="field field-wide" style={{ marginTop: "12px" }}>
//               <label>Delivery Address:</label>
//               <span>
//                 {[
//                   order.delivery_address,
//                   order.delivery_city,
//                   order.delivery_state,
//                   order.delivery_pincode,
//                 ]
//                   .filter(Boolean)
//                   .join(", ")}
//               </span>
//             </div>

//             {order.delivery_notes && (
//               <div className="field field-wide" style={{ marginTop: "12px" }}>
//                 <label>Delivery Notes:</label>
//                 <span>{order.delivery_notes}</span>
//               </div>
//             )}

//             {order.comments && (
//               <div className="field field-wide" style={{ marginTop: "12px" }}>
//                 <label>General Order Comments:</label>
//                 <span>{order.comments}</span>
//               </div>
//             )}
//           </div>
//         )}

//         {/* Billing Details */}
//         <div className="section-box">
//           <h3>Billing Details</h3>

//           {order.billing_same ? (
//             <div className="field field-wide">
//               <label>Billing Address:</label>
//               <span>Same as delivery address</span>
//             </div>
//           ) : (
//             <>
//               {/* Company + GSTIN (same row like other sections) */}
//               {(order.billing_company || order.billing_gstin) && (
//                 <div className="row3">
//                   <div className="field">
//                     <label>Company Name:</label>
//                     <span>{order.billing_company || "—"}</span>
//                   </div>

//                   <div className="field">
//                     <label>GSTIN:</label>
//                     <span>{order.billing_gstin || "—"}</span>
//                   </div>
//                 </div>
//               )}

//               {/* Billing Address */}
//               <div className="field field-wide" style={{ marginTop: "12px" }}>
//                 <label>Billing Address:</label>
//                 <span>
//                   {[
//                     order.billing_address,
//                     order.billing_city,
//                     order.billing_state,
//                     order.billing_pincode,
//                   ]
//                     .filter(Boolean)
//                     .join(", ")}
//                 </span>
//               </div>
//             </>
//           )}
//         </div>



//         {/* Salesperson */}
//         <div className="section-box">
//           <h3>Salesperson Details</h3>
//           <div className="row3">
//             <div className="field">
//               <label>Name:</label>
//               <span>{order.salesperson || "—"}</span>
//             </div>
//             <div className="field">
//               <label>Email:</label>
//               <span>{order.salesperson_email || "—"}</span>
//             </div>
//             <div className="field">
//               <label>Phone:</label>
//               <span>{order.salesperson_phone || "—"}</span>
//             </div>
//           </div>
//         </div>

//         {/* Payment */}
//         <div className="section-box">
//           <h3>Payment Details</h3>
//           <div className="row3">
//             <div className="field">
//               <label>Total Amount:</label>
//               <span>₹{formatIndianNumber(totalAmount)}</span>
//             </div>
//             <div className="field">
//               <label>Advance Payment:</label>
//               <span>₹{formatIndianNumber(advancePayment)}</span>
//             </div>
//             <div className="field">
//               <label>Balance:</label>
//               <span>₹{formatIndianNumber(pricing.remaining)}</span>
//             </div>

//           </div>
//           <div className="row3">
//             {/* <div className="field">
//               <label>Net Payable:</label>
//               <span>₹{formatIndianNumber(pricing.netPayable)}</span>
//             </div> */}

//             <div className="field">
//               <label>Discount %:</label>
//               <span>{pricing.discountPercent}%</span>
//             </div>
//             <div className="field">
//               <label>Discount Amount:</label>
//               <span>₹{formatIndianNumber(pricing.discountAmount)}</span>
//             </div>



//           </div>
//         </div>

//         <button
//           className="confirm-btn"
//           disabled={loading}
//           onClick={handlePlaceOrder}
//         >
//           {loading ? "Saving..." : "Place Order"}
//         </button>
//         <button className="back-btn" onClick={() => navigate(-1)}>
//           ←
//         </button>
//       </div>

//       {/* SIGNATURE MODAL */}
//       {showSignature && (
//         <div className="signature-modal">
//           <div className="signature-box">
//             <h3>Sign Below</h3>
//             <SignatureCanvas
//               penColor="black"
//               ref={setSigPad}
//               canvasProps={{
//                 width: 500,
//                 height: 200,
//                 className: "sig-canvas",
//               }}
//             />
//             <div className="sig-buttons" >
//               <button style={{ color: "white" }} onClick={() => sigPad.clear()}>Clear </button>
//               <button style={{ color: "white !important" }} onClick={saveSignatureAndContinue}>
//                 Save & Continue
//               </button>
//             </div>
//             <button
//               className="close-modal"
//               onClick={() => setShowSignature(false)}
//             >
//               ✖
//             </button>
//           </div>
//         </div>
//       )}
//     </div>
//   );
// }


import React, { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";
import SignatureCanvas from "react-signature-canvas";
import Logo from "../images/logo.png";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import formatIndianNumber from "../utils/formatIndianNumber";
import formatDate from "../utils/formatDate"; // Import formatDate
import "./Screen7.css";

// ===============================
// PDF BRAND THEME
// ===============================
const A4 = { w: 595, h: 842 };
const MARGIN = 40;
const LINE = 14;

const BRAND = {
  text: rgb(0.12, 0.12, 0.12),
  muted: rgb(0.45, 0.45, 0.45),
  gold: rgb(0.82, 0.69, 0.35),
  sectionBg: rgb(0.95, 0.95, 0.97),
};


function ColorDotDisplay({ colorObject }) {
  if (!colorObject || !colorObject.hex) return null;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
      <div
        style={{
          background: colorObject.hex, // Use hex value for background
          height: "15px",
          width: "30px",
          borderRadius: "10px",
          border: "1px solid #ccc", // Add a border for visibility on light colors
        }}
      ></div>
      <span>{colorObject.name}</span>
    </div>
  );
}

// ===============================
// DATE HELPERS (POSTGRES SAFE)
// ===============================
const toISODate = (value) => {
  if (!value) return null;

  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);

  // Convert DD-MM-YYYY → YYYY-MM-DD
  if (/^\d{2}-\d{2}-\d{4}$/.test(value)) {
    const [dd, mm, yyyy] = value.split("-");
    return `${yyyy}-${mm}-${dd}`;
  }

  // Fallback (Date object / timestamp)
  try {
    return new Date(value).toISOString().slice(0, 10);
  } catch {
    return null;
  }
};


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

 function newPage(pdf) {
  const page = pdf.addPage([A4.w, A4.h]);
  return { page, y: A4.h - MARGIN };
}

function ensureSpace(pdf, state, needed = 80) {
  if (state.y < MARGIN + needed) {
    const next = newPage(pdf);
    state.page = next.page;
    state.y = next.y;
  }
}

function drawText(state, text, x, size = 10, bold = false, font, fontB) {
  state.page.drawText(String(text ?? "—"), {
    x,
    y: state.y,
    size,
    font: bold ? fontB : font,
    color: BRAND.text,
  });
}

function drawSection(state, title, fontB) {
  ensureSpace(state.pdf, state, 60);
  state.page.drawRectangle({
    x: MARGIN,
    y: state.y - 24,
    width: A4.w - MARGIN * 2,
    height: 24,
    color: BRAND.sectionBg,
  });
  state.page.drawText(title, {
    x: MARGIN + 10,
    y: state.y - 17,
    size: 12,
    font: fontB,
    color: BRAND.text,
  });
  state.y -= 36;
}

async function embedImage(pdf, url) {
  if (!url) return null;
  try {
    const bytes = await fetch(url).then(r => r.arrayBuffer());
    try {
      return await pdf.embedPng(bytes);
    } catch {
      return await pdf.embedJpg(bytes);
    }
  } catch {
    return null;
  }
}

//.........................................................

async function buildCustomerOrderPdf(order, logoUrl) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);

  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontB = await pdf.embedFont(StandardFonts.HelveticaBold);

  let state = { pdf, ...newPage(pdf) };

  // LOGO
  const logo = await embedImage(pdf, logoUrl);
  if (logo) {
    const w = 120;
    const h = (logo.height / logo.width) * w;
    state.page.drawImage(logo, {
      x: A4.w / 2 - w / 2,
      y: state.y - h,
      width: w,
      height: h,
    });
    state.y -= h + 20;
  }

  drawText(state, "ORDER COPY", MARGIN, 18, true, font, fontB);
  state.y -= 22;

  drawText(state, `Order ID: ${order.id}`, MARGIN, 10, false, font, fontB);
  drawText(
    state,
    `Date: ${formatDate(order.created_at)}`,
    A4.w - MARGIN - 160,
    10,
    false,
    font,
    fontB
  );
  state.y -= 30;

  // PERSONAL
  drawSection(state, "Customer Details", fontB);
  drawText(state, order.delivery_name, MARGIN, 10, true, font, fontB);
  drawText(state, order.delivery_email, MARGIN + 250, 10, false, font, fontB);
  state.y -= LINE;
  drawText(state, order.delivery_phone, MARGIN, 10, false, font, fontB);
  state.y -= 20;

  // ADDRESS
  drawSection(state, "Delivery / Pickup", fontB);
  drawText(
    state,
    order.mode_of_delivery === "Store Pickup"
      ? "Store Pickup"
      : `${order.delivery_address}, ${order.delivery_city}, ${order.delivery_state} - ${order.delivery_pincode}`,
    MARGIN,
    10,
    false,
    font,
    fontB
  );
  state.y -= 30;

  // PRODUCTS
  drawSection(state, "Product Details", fontB);

  for (const item of order.items || []) {
    ensureSpace(pdf, state, 160);

    const img = await embedImage(pdf, item.image_url);
    if (img) {
      state.page.drawImage(img, {
        x: MARGIN,
        y: state.y - 90,
        width: 70,
        height: 90,
      });
    }

    const fx = MARGIN + 90;
    drawText(state, item.product_name, fx, 11, true, font, fontB);
    state.y -= LINE;
    drawText(state, `Top: ${item.top}`, fx, 10, false, font, fontB);
    drawText(state, `Bottom: ${item.bottom}`, fx + 180, 10, false, font, fontB);
    state.y -= LINE;
    drawText(state, `Color: ${item.color}`, fx, 10, false, font, fontB);
    drawText(state, `Size: ${item.size}`, fx + 180, 10, false, font, fontB);

    if (item.extras?.length) {
      state.y -= LINE;
      drawText(
        state,
        `Extras: ${item.extras.map(e => e.name).join(", ")}`,
        fx,
        10,
        false,
        font,
        fontB
      );
    }

    state.y -= 40;
  }

  // PAGE 2
  state = { pdf, ...newPage(pdf) };

  // BILLING
  drawSection(state, "Billing Summary", fontB);
  drawText(state, `Subtotal: INR${formatIndianNumber(order.subtotal)}`, MARGIN, 10, false, font, fontB);
  state.y -= LINE;
  drawText(state, `GST (18%): INR${formatIndianNumber(order.taxes)}`, MARGIN, 10, false, font, fontB);
  state.y -= LINE;
  drawText(state, `Total: INR${formatIndianNumber(order.grand_total)}`, MARGIN, 10, true, font, fontB);

  if (order.discount_amount > 0) {
    state.y -= LINE;
    drawText(state, `Discount: INR${formatIndianNumber(order.discount_amount)}`, MARGIN, 10, false, font, fontB);
  }

  state.y -= LINE;
  drawText(state, `Advance Paid: INR${formatIndianNumber(order.advance_payment)}`, MARGIN, 10, false, font, fontB);
  state.y -= LINE;
  drawText(state, `Balance Due: INR${formatIndianNumber(order.remaining_payment)}`, MARGIN, 10, true, font, fontB);

  state.y -= 20;
  drawText(state, `Payment Mode: ${order.payment_mode}`, MARGIN, 10, false, font, fontB);

  // SIGNATURE
  const sig = await embedImage(pdf, order.signature_url);
  if (sig) {
    ensureSpace(pdf, state, 100);
    state.page.drawImage(sig, {
      x: A4.w - MARGIN - 160,
      y: state.y - 60,
      width: 160,
      height: 60,
    });
    drawText(state, "Authorized Signature", A4.w - MARGIN - 160, 10, true, font, fontB);
    state.y -= 90;
  }

  // POLICY TEXT (EXACT)
  drawSection(state, "A Note To You", fontB);
  const policy = `All orders once confirmed are final... (exact reference PDF text goes here)`;
  policy.split("\n").forEach(line => {
    drawText(state, line, MARGIN, 9, false, font, fontB);
    state.y -= 12;
  });

  return pdf.save();
}

async function buildWarehouseOrderPdf(order, logoUrl) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);

  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontB = await pdf.embedFont(StandardFonts.HelveticaBold);

  let state = { pdf, ...newPage(pdf) };

  const logo = await embedImage(pdf, logoUrl);
  if (logo) {
    state.page.drawImage(logo, {
      x: MARGIN,
      y: state.y - 50,
      width: 100,
      height: 50,
    });
    state.y -= 70;
  }

  drawText(state, "WAREHOUSE ORDER COPY", MARGIN, 16, true, font, fontB);
  state.y -= 30;

  drawText(state, `Order ID: ${order.id}`, MARGIN, 10, false, font, fontB);
  drawText(state, `Delivery Date: ${order.delivery_date}`, MARGIN + 250, 10, false, font, fontB);
  state.y -= 20;

  for (const item of order.items || []) {
    drawSection(state, item.product_name, fontB);

    drawText(state, `Top: ${item.top}`, MARGIN, 10, false, font, fontB);
    drawText(state, `Bottom: ${item.bottom}`, MARGIN + 200, 10, false, font, fontB);
    drawText(state, `Size: ${item.size}`, MARGIN + 400, 10, false, font, fontB);
    state.y -= LINE;

    drawText(state, `Color: ${item.color}`, MARGIN, 10, false, font, fontB);

    if (item.measurements?.Kurta) {
      state.y -= LINE;
      drawText(
        state,
        `Measurements – Bust: ${item.measurements.Kurta.Bust}, Waist: ${item.measurements.Kurta.Waist}, Hip: ${item.measurements.Kurta.Hip}`,
        MARGIN,
        10,
        false,
        font,
        fontB
      );
    }

    state.y -= 30;
  }

  return pdf.save();
}


  // ===============================
  // PDF BUILDER (SAFE)
  // ===============================
  // async function buildInvoicePdfBytes(order, logoUrl) {
  //   const A4 = { w: 595, h: 842 };
  //   const margin = 40;

  //   const pdf = await PDFDocument.create();
  //   pdf.registerFontkit(fontkit);

  //   const font = await pdf.embedFont(StandardFonts.Helvetica);
  //   const fontB = await pdf.embedFont(StandardFonts.HelveticaBold);

  //   let page = pdf.addPage([A4.w, A4.h]);

  //   let y = A4.h - margin;

  //   const draw = (t, x, y, s = 11, b = false) =>
  //     page.drawText(String(t ?? "—"), {
  //       x,
  //       y,
  //       size: s,
  //       font: b ? fontB : font,
  //       color: rgb(0.1, 0.1, 0.1),
  //     });

  //   const embedImage = async (url) => {
  //     if (!url) return null;
  //     try {
  //       const r = await fetch(url);
  //       if (!r.ok) return null;
  //       const bytes = await r.arrayBuffer();
  //       try {
  //         return await pdf.embedPng(bytes);
  //       } catch {
  //         return await pdf.embedJpg(bytes);
  //       }
  //     } catch {
  //       return null;
  //     }
  //   };

  //   const COLOR_MAP = {
  //     pink: "#FFC0CB",
  //     orange: "#FFA500",
  //     ivory: "#FFFFF0",
  //     blue: "#0000FF",
  //     purple: "#800080",
  //     red: "#FF0000",
  //     gold: "#C9A24D",
  //     green: "#008000",
  //     mustard: "#FFDB58",
  //     "off rose": "#F4C2C2",
  //   };

  //   //function to draw the color dot:
  //   const drawColorDot = (colorValue, x, y, size = 6) => {
  //     try {
  //       if (!colorValue) return;

  //       let hex = null;

  //       // Already hex
  //       if (colorValue.startsWith("#")) {
  //         hex = colorValue;
  //       } else {
  //         // Named color → map
  //         hex = COLOR_MAP[colorValue.toLowerCase()];
  //       }

  //       // Fallback if unknown
  //       if (!hex || hex.length !== 7) hex = "#000000";

  //       const r = parseInt(hex.slice(1, 3), 16) / 255;
  //       const g = parseInt(hex.slice(3, 5), 16) / 255;
  //       const b = parseInt(hex.slice(5, 7), 16) / 255;

  //       page.drawCircle({
  //         x,
  //         y,
  //         size,
  //         color: rgb(r, g, b),
  //       });
  //     } catch {
  //       // silent fail
  //     }
  //   };


  //   // LOGO
  //   const logo = await embedImage(logoUrl);
  //   if (logo) {
  //     const w = 120;
  //     const h = (logo.height / logo.width) * w;
  //     page.drawImage(logo, {
  //       x: A4.w / 2 - w / 2,
  //       y: y - h,
  //       width: w,
  //       height: h,
  //     });
  //     y -= h + 20;
  //   }

  //   const wrapText = (text, maxWidth, fontSize = 10) => {
  //     const words = String(text || "").split(" ");
  //     const lines = [];
  //     let line = "";

  //     for (const word of words) {
  //       const testLine = line ? `${line} ${word}` : word;
  //       const width = font.widthOfTextAtSize(testLine, fontSize);

  //       if (width > maxWidth) {
  //         if (line) lines.push(line);
  //         line = word;
  //       } else {
  //         line = testLine;
  //       }
  //     }

  //     if (line) lines.push(line);
  //     return lines;
  //   };


  //   draw("Order Invoice", margin, y, 18, true);
  //   y -= 22;
  //   draw(`Order ID: ${order.id}`, margin, y);
  //   draw(
  //     `Date: ${formatDate(order.created_at || Date.now())}`,
  //     margin + 260,
  //     y
  //   );
  //   y -= 30;

  //   if (order.order_flag === "Urgent" && order.urgent_reason) {
  //     draw("Urgent Reason:", margin, y, 10, true);
  //     draw(order.urgent_reason, margin + 100, y, 10);
  //     y -= 20;
  //   }

  //   const section = (title) => {
  //     page.drawRectangle({
  //       x: margin,
  //       y: y - 26,
  //       width: A4.w - margin * 2,
  //       height: 26,
  //       color: rgb(0.95, 0.95, 0.97),
  //     });
  //     draw(title, margin + 10, y - 18, 12, true);
  //     y -= 36;
  //   };

  //   const field = (l, v, x, y) => {
  //     draw(l, x, y, 10, true);
  //     draw(v, x, y - 14, 10);
  //   };

  //   // PRODUCT DETAILS
  //   section("Product Details");
  //   for (const item of order.items || []) {
  //     const img = await embedImage(item.image_url);
  //     if (img) {
  //       page.drawImage(img, { x: margin, y: y - 80, width: 80, height: 80 });
  //     }

  //     const fx = margin + 100;
  //     field("Product Name", item.product_name, fx, y);
  //     // COLOR LABEL
  //     draw("Color", fx + 260, y, 10, true);

  //     // Color dot
  //     drawColorDot(item.color, fx + 270, y - 18, 5);

  //     // Color name
  //     draw(item.color || "—", fx + 285, y - 22, 10);

  //     y -= 40;
  //     field("Top", item.top, fx, y);
  //     field("Bottom", item.bottom, fx + 160, y);
  //     field("Extras", item.extra || "—", fx + 320, y);
  //     y -= 40; // Adjust Y position for notes

  //     if (item.notes) {
  //       draw("Product Notes", fx, y, 10, true);
  //       y -= 14;
  //       const productNotesLines = wrapText(item.notes, A4.w - margin - fx, 10);
  //       productNotesLines.forEach((line) => {
  //         draw(line, fx, y, 10);
  //         y -= 14;
  //       });
  //       y -= 20; // Additional spacing after product notes
  //     }
  //     y -= 30; // Adjust Y position for next product item or section
  //   }

  //   // DELIVERY
  //   if (order.mode_of_delivery === "Home Delivery") {
  //     section("Delivery Details");

  //     field("Name", order.delivery_name, margin, y);
  //     field("Email", order.delivery_email, margin + 180, y);
  //     field("Phone", order.delivery_phone, margin + 360, y);
  //     y -= 40;

  //     // ✅ DELIVERY ADDRESS
  //     const fullAddress = [
  //       order.delivery_address,
  //       order.delivery_city,
  //       order.delivery_state,
  //       order.delivery_pincode,
  //     ]
  //       .filter(Boolean)
  //       .join(", ");

  //     draw("Delivery Address", margin, y, 10, true);
  //     y -= 14;

  //     const addrLines = wrapText(fullAddress, A4.w - margin * 2, 10);
  //     addrLines.forEach((line) => {
  //       draw(line, margin, y, 10);
  //       y -= 14;
  //     });

  //     y -= 20;

  //     if (order.delivery_notes) {
  //       draw("Delivery Notes", margin, y, 10, true);
  //       y -= 14;
  //       const deliveryNotesLines = wrapText(order.delivery_notes, A4.w - margin * 2, 10);
  //       deliveryNotesLines.forEach((line) => {
  //         draw(line, margin, y, 10);
  //         y -= 14;
  //       });
  //       y -= 20;
  //     }

  //     if (order.comments) {
  //       draw("General Order Comments", margin, y, 10, true);
  //       y -= 14;
  //       const commentsLines = wrapText(order.comments, A4.w - margin * 2, 10);
  //       commentsLines.forEach((line) => {
  //         draw(line, margin, y, 10);
  //         y -= 14;
  //       });
  //       y -= 20;
  //     }
  //   }
  //   // =====================
  //   // BILLING DETAILS
  //   // =====================
  //   section("Billing Details");

  //   if (order.billing_same) {
  //     draw("Billing Address", margin, y, 10, true);
  //     y -= 14;
  //     draw("Same as delivery address", margin, y, 10);
  //     y -= 24;
  //   } else {
  //     if (order.billing_company) {
  //       field("Company", order.billing_company, margin, y);
  //       y -= 30;
  //     }

  //     if (order.billing_gstin) {
  //       field("GSTIN", order.billing_gstin, margin, y);
  //       y -= 30;
  //     }

  //     const billingAddress = [
  //       order.billing_address,
  //       order.billing_city,
  //       order.billing_state,
  //       order.billing_pincode,
  //     ]
  //       .filter(Boolean)
  //       .join(", ");

  //     if (billingAddress) {
  //       draw("Billing Address", margin, y, 10, true);
  //       y -= 14;

  //       const billLines = wrapText(
  //         billingAddress,
  //         A4.w - margin * 2,
  //         10
  //       );

  //       billLines.forEach((line) => {
  //         draw(line, margin, y, 10);
  //         y -= 14;
  //       });

  //       y -= 20;
  //     }
  //   }


  //   // SALESPERSON
  //   section("Salesperson Details");
  //   field("Name", order.salesperson, margin, y);
  //   field("Email", order.salesperson_email, margin + 180, y);
  //   field("Phone", order.salesperson_phone, margin + 360, y);
  //   y -= 60;

  //   // PAYMENT
  //   section("Payment Details");
  //   draw("Total Amount:", margin, y, 12, true);
  //   draw(`INR ${formatIndianNumber(totalAmount)}`, margin + 150, y, 12, true);
  //   y -= 20;

  //   draw("Discount (%):", margin, y, 10, true);
  //   draw(`${pricing.discountPercent}%`, margin + 150, y, 10);
  //   y -= 16;

  //   draw("Discount Amount:", margin, y, 10, true);
  //   draw(`INR ${formatIndianNumber(pricing.discountAmount)}`, margin + 150, y, 10);
  //   y -= 16;

  //   draw("Net Payable:", margin, y, 10, true);
  //   draw(`INR ${formatIndianNumber(pricing.netPayable)}`, margin + 150, y, 10);
  //   y -= 16;

  //   draw("Advance Payment:", margin, y, 10, true);
  //   draw(`INR ${formatIndianNumber(order.advance_payment ?? 0)}`, margin + 150, y, 10);
  //   y -= 16;

  //   draw("Remaining Payment:", margin, y, 10, true);
  //   draw(`INR ${formatIndianNumber(pricing.remaining)}`, margin + 150, y, 10);
  //   y -= 30;


  //   // =====================
  //   // SIGNATURE (AUTO POSITIONED)
  //   // =====================
  //   // =====================
  //   // SIGNATURE (AUTO POSITIONED – SAFE)
  //   // =====================
  //   const sig = await embedImage(order.signature_url);

  //   if (sig) {
  //     const sigWidth = 160;
  //     const sigHeight = 60;
  //     const labelHeight = 14;
  //     const spacing = 30;

  //     // If not enough space → new page
  //     if (y < sigHeight + labelHeight + margin + spacing) {
  //       page = pdf.addPage([A4.w, A4.h]);
  //       y = A4.h - margin;
  //     }

  //     // Move cursor down
  //     y -= spacing;

  //     const sigX = A4.w - margin - sigWidth;
  //     const sigY = y - sigHeight;

  //     // Draw signature
  //     page.drawImage(sig, {
  //       x: sigX,
  //       y: sigY,
  //       width: sigWidth,
  //       height: sigHeight,
  //     });

  //     // Label
  //     draw(
  //       "Authorized Signature",
  //       sigX,
  //       sigY - labelHeight,
  //       10,
  //       true
  //     );

  //     // Update cursor
  //     y = sigY - labelHeight - 20;
  //   }



  //   return pdf.save();
  // }

  // ===============================
  // SAVE ORDER
  // ===============================
  // ===============================
  // SAVE ORDER (DATE SAFE)
  // ===============================
  const saveOrderToDB = async (orderToSave) => {
  try {
    // ===============================
    // 1️⃣ NORMALIZE ORDER (DATE SAFE)
    // ===============================
    const normalizedOrder = {
      ...orderToSave,

      created_at: orderToSave.created_at
        ? new Date(orderToSave.created_at).toISOString()
        : new Date().toISOString(),

      delivery_date: toISODate(orderToSave.delivery_date),
      expected_delivery: toISODate(orderToSave.expected_delivery),
      billing_date: toISODate(orderToSave.billing_date),
    };

    // ===============================
    // 2️⃣ SAVE ORDER TO DB
    // ===============================
    const { data, error } = await supabase
      .from("orders")
      .insert(normalizedOrder)
      .select()
      .single();

    if (error) throw error;

    // ===============================
    // 3️⃣ GENERATE BOTH PDFs
    // ===============================
    const logoUrl = new URL(Logo, window.location.origin).href;

    const customerPdfBytes = await buildCustomerOrderPdf(data, logoUrl);
    const warehousePdfBytes = await buildWarehouseOrderPdf(data, logoUrl);

    // ===============================
    // 4️⃣ UPLOAD CUSTOMER PDF
    // ===============================
    await supabase.storage
      .from("invoices")
      .upload(
        `orders/${data.id}_customer.pdf`,
        new Blob([customerPdfBytes]),
        {
          upsert: true,
          contentType: "application/pdf",
        }
      );

    // ===============================
    // 5️⃣ UPLOAD WAREHOUSE PDF
    // ===============================
    await supabase.storage
      .from("invoices")
      .upload(
        `orders/${data.id}_warehouse.pdf`,
        new Blob([warehousePdfBytes]),
        {
          upsert: true,
          contentType: "application/pdf",
        }
      );

    // ===============================
    // 6️⃣ DONE
    // ===============================
    alert("✅ Order saved & both PDFs generated!");
    navigate("/orderHistory");

  } catch (e) {
    console.error("❌ Order save failed:", e);
    alert(e?.message || "Failed to save order");
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
                    <ColorDotDisplay colorObject={item.color} />
                  </div>
                </div>

                {item.notes && (
                  <div className="field field-wide" style={{ marginTop: "12px" }}>
                    <label>Product Notes:</label>
                    <span>{item.notes}</span>
                  </div>
                )}

                <div className="row3">
                  <div className="field">
                    <label>Top:</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <span>{item.top}</span>
                      {item.top_color && <ColorDotDisplay colorObject={item.top_color} />}
                    </div>
                  </div>
                  <div className="field">
                    <label>Bottom:</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <span>{item.bottom}</span>
                      {item.bottom_color && <ColorDotDisplay colorObject={item.bottom_color} />}
                    </div>
                  </div>
                  <div className="field">
                    <label>Size:</label>
                    <span>{item.size}</span>
                  </div>
                  {item.extras && item.extras.length > 0 && (
                    <div className="field field-wide">
                      <label>Extras:</label>
                      <div className="extras-display">
                        {item.extras.map((extra, idx) => (
                          <div key={idx} className="extra-item-display">
                            <span>{extra.name} (₹{formatIndianNumber(extra.price)})</span>
                            {extra.color && <ColorDotDisplay colorObject={extra.color} />}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
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

            {order.delivery_notes && (
              <div className="field field-wide" style={{ marginTop: "12px" }}>
                <label>Delivery Notes:</label>
                <span>{order.delivery_notes}</span>
              </div>
            )}

            {order.comments && (
              <div className="field field-wide" style={{ marginTop: "12px" }}>
                <label>General Order Comments:</label>
                <span>{order.comments}</span>
              </div>
            )}
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
              <label>Balance:</label>
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
              <button style={{ color: "white" }} onClick={() => sigPad.clear()}>Clear </button>
              <button style={{ color: "white !important" }} onClick={saveSignatureAndContinue}>
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
