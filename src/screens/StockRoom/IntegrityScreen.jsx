import React, { useState } from "react";
import { Topline, ProductCell, Badge } from "./StockRoomUi";
import { formatUnits, formatDay, sizeLabel, TYPE_LABELS, REASON_LABELS, productType } from "./stockRoomModel";
import { retryShopify, SHOPIFY_SYNC_ON } from "./stockRoomShopify";

// Findings in the existing product data. Each section names the rows so they
// can be corrected: most in the product editor (click the row), an impossible
// size count with Recount. Nothing is changed on this screen by itself.
const SECTIONS = [
  {
    key: "duplicateShopifyIds", tone: "crit", tag: "Double counting",
    title: "Shopify IDs used by more than one design",
    why: "Two designs sharing one Shopify ID share one Shopify stock count, so every sale of either reduces it.",
  },
  {
    key: "malformedShopifyIds", tone: "crit", tag: "Will not sync",
    title: "LXRTS designs with a missing or invalid Shopify ID",
    why: "Stock sync looks a design up by its full gid://shopify/Product/… ID. Anything else never syncs.",
  },
  {
    key: "invalidVariants", tone: "crit", tag: "Wrong count",
    title: "Sizes holding an impossible count",
    why: "A count below zero, or in the billions, is not stock. These sizes are left out of every total here — but other screens that add up size stock will show them as real.",
  },
  {
    key: "duplicateSizes", tone: "low", tag: "Duplicate rows",
    title: "LXRTS designs with the same size stored more than once",
    why: "Each size should have one stock record. With copies, screens can disagree depending on which copy they read. The Stock Room uses the largest copy — the one order placement reduces.",
  },
  {
    key: "lxrtsWithoutVariants", tone: "low", tag: "No sizes",
    title: "LXRTS designs with no size records",
    why: "Without size records these designs show zero stock everywhere, including the order form's size list.",
  },
  {
    key: "customUnlimited", tone: "low", tag: "Not counted",
    title: "Custom pieces set to unlimited (9999)",
    why: "Custom pieces hold real stock. On the unlimited value they are excluded from every stock total.",
  },
  {
    key: "mtoWithStock", tone: "info", tag: "For information",
    title: "Made to order designs holding a small stock count",
    why: "Made to order carries no inventory, so this count is ignored and changes no total. Listed in case a design was meant to be a custom piece. Counts of 1,000 or more are the unlimited value reduced by sales, and are not listed.",
  },
];

// Every section is Design first, so on narrow screens each row reads as a card
// headed by the design, with the section's own facts labelled beneath it.
function Rows({ sectionKey, items, onRecount, rowsById }) {
  if (sectionKey === "duplicateShopifyIds") {
    return items.flatMap((dup) => dup.products.map((p) => (
      <tr key={`${dup.shopifyId}-${p.id}`} data-product={p.id}>
        <td className="is-primary"><ProductCell product={p} /></td>
        <td data-label="Shared Shopify ID" className="sr-mono wrap">{dup.shopifyId}</td>
        <td data-label="Store">{p.store_category || "All Stores"}</td>
        <td data-label="On hand" className="n">{rowsById?.[p.id]?.stock.tracked ? formatUnits(rowsById[p.id].stock.total) : "—"}</td>
      </tr>
    )));
  }
  if (sectionKey === "invalidVariants") {
    return items.map(({ product, size, qty }, i) => (
      <tr key={`${product.id}-${size}-${i}`}>
        <td className="is-primary"><ProductCell product={product} /></td>
        <td data-label="Size">{size}</td>
        <td data-label="Stored count" className="n">{formatUnits(qty)}</td>
        <td>{onRecount && <button type="button" className="sr-rowbtn" onClick={() => onRecount(product.id, size)}>Recount</button>}</td>
      </tr>
    ));
  }
  if (sectionKey === "duplicateSizes") {
    return items.map(({ product, sizes }) => (
      <tr key={product.id} data-product={product.id}>
        <td className="is-primary"><ProductCell product={product} /></td>
        <td data-label="Stored more than once" className="wrap is-wide">
          <span className="sr-szc-list">
            {sizes.map(({ size, counts }) => (
              <span key={size} className="sr-szc">{size} <b>×{counts.length}</b> {counts.map((c) => formatUnits(c)).join(" / ")}</span>
            ))}
          </span>
        </td>
      </tr>
    ));
  }
  return items.map((p) => (
    <tr key={p.id} data-product={p.id}>
      <td className="is-primary"><ProductCell product={p} /></td>
      <td data-label="Type">{TYPE_LABELS[productType(p)]}</td>
      {sectionKey !== "lxrtsWithoutVariants" && (
        <td data-label={sectionKey === "malformedShopifyIds" ? "Stored ID" : "Stored count"} className="sr-mono">
          {sectionKey === "malformedShopifyIds" ? (p.shopify_product_id || "empty") : formatUnits(p.inventory)}
        </td>
      )}
    </tr>
  ));
}

const HEADS = {
  duplicateShopifyIds: ["Design", "Shared Shopify ID", "Store", "On hand"],
  invalidVariants: ["Design", "Size", "Stored count", ""],
  duplicateSizes: ["Design", "Sizes stored more than once · count in each copy"],
  malformedShopifyIds: ["Design", "Type", "Stored ID"],
  mtoWithStock: ["Design", "Type", "Stored count"],
  customUnlimited: ["Design", "Type", "Stored count"],
  lxrtsWithoutVariants: ["Design", "Type"],
};

const SHOPIFY_LABEL = { pending: "Not settled", not_sent: "Not sent", failed: "Failed" };

function ShopifyUnsent({ view, canWrite, onShopifyRetried }) {
  const ledger = view.ledger;
  const [sending, setSending] = useState(false);
  const rows = ledger.shopifyUnsent;
  if (!rows.length) return null;

  const send = async () => {
    setSending(true);
    const result = await retryShopify(rows);
    setSending(false);
    onShopifyRetried({
      text: result.failed.length
        ? `${result.sent} sent to Shopify; ${result.failed.length} still failing: ${result.failed.slice(0, 3).join("; ")}`
        : `${result.sent} change${result.sent === 1 ? "" : "s"} sent to Shopify.`,
      tone: result.failed.length ? "crit" : "ok",
    });
  };

  return (
    <div className="sr-card" style={{ marginBottom: 16, borderColor: "var(--sr-gold-line)" }}>
      <div className="sr-card-head">
        <h2>Shopify changes not sent</h2>
        <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Badge tone="low">{formatUnits(rows.length)}</Badge>
          {SHOPIFY_SYNC_ON && canWrite && (
            <button type="button" className="sr-btn sr-btn-primary" onClick={send} disabled={sending}>{sending ? "Sending…" : "Send to Shopify now"}</button>
          )}
        </span>
      </div>
      <p className="sr-card-sub">
        {SHOPIFY_SYNC_ON
          ? "These LXRTS stock changes were saved here but did not reach Shopify, so the order form may still show the old stock. Send them, or correct Shopify by hand."
          : "Shopify is not updated from this environment, so these LXRTS changes were saved here only. That is expected while testing: the live store is untouched."}
      </p>
      <div className="sr-scroller">
        <table className="sr-table sr-rtable" style={{ "--sr-table-min": "820px" }}>
          <thead><tr><th>Design</th><th>When</th><th>Type</th><th>Size</th><th className="n">Shopify should change by</th><th>Status</th></tr></thead>
          <tbody>
            {rows.slice(0, 50).map((m) => {
              const p = view.productsById[m.product_id];
              return (
                <tr key={m.id}>
                  <td className="is-primary">{p ? <ProductCell product={p} /> : "Product no longer live"}</td>
                  <td data-label="When">{formatDay(m.occurred_at)}</td>
                  <td data-label="Type">{REASON_LABELS[m.reason] || m.reason}</td>
                  <td data-label="Size">{m.size ? sizeLabel(m.size) : "—"}</td>
                  <td data-label="Change" className={`n tot ${m.legacy_delta > 0 ? "sr-pos" : "sr-neg"}`}>{m.legacy_delta > 0 ? "+" : ""}{m.legacy_delta}</td>
                  <td data-label="Status" title={m.shopify_error || undefined}><Badge tone={m.shopify_status === "failed" ? "crit" : "low"}>{SHOPIFY_LABEL[m.shopify_status]}</Badge></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length > 50 && <p className="sr-note">Showing the latest 50 of {formatUnits(rows.length)}. All of them are in Movements.</p>}
    </div>
  );
}

export default function IntegrityScreen({ view, canWrite, canEditProducts, openEditor, openAction, onShopifyRetried }) {
  const recount = canWrite ? (productId, size) => openAction("adjust", { locationId: "", lines: [{ productId, size }] }) : null;
  const { findings } = view;
  const withItems = SECTIONS.filter((s) => findings[s.key].length);
  const unsent = view.ledger?.installed ? view.ledger.shopifyUnsent.length : 0;

  return (
    <>
      <Topline title="Integrity"
        sub={view.integrityTotal || unsent
          ? `${formatUnits(view.integrityTotal)} findings in the product data${unsent ? ` · ${formatUnits(unsent)} Shopify changes not sent` : ""}`
          : "No problems found in the product data"} />
      <div className="sr-body">
        {view.ledger?.installed && <ShopifyUnsent view={view} canWrite={canWrite} onShopifyRetried={onShopifyRetried} />}
        <div className="sr-grid k3">
          {SECTIONS.filter((s) => s.tone !== "info").map((s) => (
            <div className="sr-card" key={s.key}>
              <div className="sr-card-head"><span className="sr-label">{s.tag}</span><Badge tone={findings[s.key].length ? s.tone : "ok"}>{findings[s.key].length ? "Review" : "Clear"}</Badge></div>
              <span className="sr-kpi-v">{formatUnits(findings[s.key].length)}</span>
              <span className="sr-kpi-note">{s.title}</span>
            </div>
          ))}
        </div>

        {withItems.map((s) => (
          <div className="sr-card" key={s.key}>
            <div className="sr-card-head"><h2>{s.title}</h2><Badge tone={s.tone}>{s.tag}</Badge></div>
            <p className="sr-card-sub">{s.why} {s.key === "invalidVariants"
              ? (canWrite ? "Recount the size to replace the number with what is really there." : "Recount the size to correct it.")
              : canEditProducts ? "Click a row to open the product's Edit form." : "Correct these in the product's Edit form."}</p>
            <div className="sr-scroller">
              <table className={`sr-table sr-rtable${canEditProducts ? " is-editable" : ""}`}>
                <thead><tr>{HEADS[s.key].map((h, i) => <th key={i} className={h === "Stored count" && s.key === "invalidVariants" ? "n" : undefined}>{h}</th>)}</tr></thead>
                <tbody
                  onClick={(e) => {
                    const tr = e.target.closest("tr[data-product]");
                    if (canEditProducts && tr) openEditor(tr.getAttribute("data-product"));
                  }}>
                  <Rows sectionKey={s.key} items={findings[s.key]} onRecount={recount} rowsById={view.rowsById} />
                </tbody>
              </table>
            </div>
          </div>
        ))}

        {!withItems.length && (
          <div className="sr-card"><p className="sr-empty">Every check passes: Shopify IDs are unique and valid, every LXRTS size has one sensible count, and every LXRTS design has sizes.</p></div>
        )}
      </div>
    </>
  );
}
