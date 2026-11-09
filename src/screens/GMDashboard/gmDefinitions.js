// ============================================================
// Definitions shown when you point at (or tap) a label on the GM dashboard.
// One place, so a term always reads the same way. Each one says what the
// number shows, how it is worked out, and what is left out, matching the
// calculation in GmPages.
// ============================================================

/** Headline tiles and small figures, keyed by their label. */
export const TILE_INFO = {
  // Store Performance
  "Total Revenue": "The value of all sales in the selected period, after discounts. It covers both stores, B2B, the website, exhibitions and private orders. Cancelled, returned and refunded orders are not counted, nor are internal stock moves, alterations or gifting.",
  "Net SB Revenue": "Total Revenue as Sheetal Batra keeps it. Exhibition sales are counted after the exhibition's commission; every other sale is counted in full.",
  "Total Orders": "The number of sales orders placed in the selected period. These are the same orders that make up Total Revenue.",
  "Average Order Value": "The typical value of one order: Total Revenue divided by Total Orders.",

  // B2B
  "B2B Revenue": "The value of orders from B2B partners in the selected period, after the partner discount. Gifting and internal B2B stock are not counted. The arrow compares it with the same number of days just before.",
  "B2B Orders": "The number of orders placed by B2B partners in the selected period.",
  "B2B Contribution": "How much of the business came from B2B: B2B Revenue as a share of Total Revenue from all channels.",
  "Amount Received": "Money received from partners against these orders. It includes any advance and every payment recorded later with Update Payment.",

  // Client Outstanding
  "Balance Due from Clients": "Money that clients still owe on their orders: the order value minus every payment recorded. It covers store, exhibition and private orders since the start. B2B and website orders are not included.",
  "Over 60 Days Past Delivery": "Money still owed on orders whose delivery date passed more than 60 days ago. These need follow-up; some may have been paid without the payment being recorded.",
  "Sales Associates With Balances": "The number of sales associates who have at least one client order that is not fully paid.",

  // Inventory Health
  "Designs": "Every live design in the catalogue. LXRTS designs are counted by size, custom pieces as a single total, and made-to-order designs carry no stock.",
  "Pieces in Stock": "Finished pieces on hand, as counted in Stock Room. Made-to-order designs are not included because they are made only after an order.",
  "Stock Value": "What the stock on hand is worth at list price: for each design, the pieces on hand multiplied by its price, then added together.",
  "Low Stock": "Designs that are running low, with only 1 to 4 pieces left.",
  "Out of Stock": "Designs that hold stock but have no pieces left right now.",
  "Pieces Sold": "The number of stocked pieces sold to clients in the last 90 days.",
  "Stock-to-Sales Ratio": "How much stock is held compared with what sells: pieces in stock divided by pieces sold in the last 90 days. A high number means stock is moving slowly.",
  "Total Sent": "Pieces sent to B2B partners on consignment, where the partner pays only after selling them.",
  "Sold": "Consignment pieces that partners have sold.",
  "Remaining": "Consignment pieces still with partners and not yet sold.",
  "Lost": "Consignment pieces recorded as lost.",
  "Placed at a Location": "Pieces that Stock Room has recorded at a specific store or warehouse.",
  "In Transit": "Pieces sent from one location to another that have not been received yet.",
  "Not Yet Placed": "Pieces in stock whose store or warehouse has not been recorded in Stock Room yet.",

  // Returns & Analytics
  "Cancellations": "Orders placed in the selected period that have since been cancelled. The amount below is their total value.",
  "Returns": "Orders placed in the selected period that the client returned.",
  "Refunds": "Orders placed in the selected period where a refund was requested or paid.",
  "Exchanges": "Orders placed in the selected period that the client exchanged.",
  "Revoked": "Orders placed in the selected period that are currently revoked. Orders revoked once and later delivered are not counted.",
  "Total Issue Value": "The combined value of cancelled, returned, refunded and exchanged orders. An order with more than one issue is counted once.",

  // Accounts
  "Gross Value": "The full price (MRP) of the orders, including extras, before any discount. Cancelled and returned orders are not counted.",
  "Total Discount": "Everything taken off the full price: store discounts, discount codes and the B2B partner discount. It equals Gross Value minus Invoice Value.",
  "Total GST": "The GST included in the billed amount, at 18% as shown on the client invoice.",
  "Invoice Value": "The amount actually billed to clients and partners, after all discounts.",

  // Delivery Watch
  "Past Delivery Date": "Orders that are still in progress even though the delivery date promised to the client has passed. Website orders are not included.",
  "Over 30 Days Late": "Orders still in progress more than 30 days after the promised delivery date.",
  "Due Today": "Orders promised to the client for today that are still in progress.",
  "Due in Next 7 Days": "Orders promised to the client within the next 7 days that are still in progress.",
};

/** Card and chart titles. */
export const CARD_INFO = {
  "Revenue by Channel": "Total Revenue split by where each order was placed: Delhi Store, Ludhiana Store, B2B, website, exhibition or private.",
  "Orders per Sales Associate": "How busy each store is per person: the store's orders divided by the number of sales associates on its staff.",
  "Sales Associate Performance": "Each sales associate's own sales in the selected period. B2B orders appear under the merchandiser who handled them.",
  "Revenue by Day": "Sales for each day of the selected period. The average counts only days that had at least one sale.",
  "Day-wise Sales by Channel": "Each day's sales, split by where the orders were placed.",
  "Buyout": "B2B orders where the partner buys the pieces outright.",
  "Consignment": "B2B orders where the partner holds the pieces and pays only once they are sold.",
  "Client Order": "B2B orders a partner places for a specific client of theirs.",
  "Partner-wise Sales": "Each B2B partner's sales in the selected period, the money received from them and the balance still owed.",
  "Top B2B Products": "The designs that earned the most from B2B partners. Each order's value after discount is shared across its pieces by price.",
  "Partners With Balance Due": "B2B partners who still owe money on orders from the selected period, largest balance first.",
  "Balance Due by Sales Associate": "Unpaid client balances, grouped by the sales associate who took each order.",
  "Balance Due by Store": "Unpaid client balances, grouped by the store that took each order.",
  "Orders With a Balance": "Every client order that is not fully paid, starting with the one furthest past its delivery date.",
  "Stock vs Sales": "Compares the stock on hand with how quickly it sells, to show whether stock is moving.",
  "Consignment Stock": "Pieces placed with B2B partners on consignment: sent, sold, still with them, or lost.",
  "Where the Stock Is": "How many pieces sit at each store and warehouse, as recorded in Stock Room.",
  "Design Stock": "Every design with its pieces on hand, pieces sold in the last 90 days and stock status.",
  "Issues by Sales Associate": "Cancelled, returned, refunded, exchanged and revoked orders, grouped by the sales associate who took them.",
  "Cancellation Reasons": "The reasons recorded when orders from the selected period were cancelled.",
  "Return Reasons": "The reasons clients gave for returning orders from the selected period.",
  "Refund Reasons": "The reasons recorded when a refund was requested on orders from the selected period.",
  "Exchange Reasons": "The reasons clients gave for exchanging orders from the selected period.",
  "All Issue Orders": "Every order from the selected period that was cancelled, returned, refunded, exchanged or revoked.",
  "Past Delivery Date": "Orders still in progress after their promised delivery date, the latest first.",
  "Due Today": "Orders promised to the client for today that are still in progress.",
  "Due in Next 7 Days": "Orders promised within the next 7 days that are still in progress, soonest first.",
  "Late Orders by Channel": "Orders past their delivery date, grouped by where they were placed.",
  "Late Orders by Production Stage": "Orders past their delivery date, grouped by the production stage they have reached.",
  "Late Orders by Sales Associate": "Orders past their delivery date, grouped by the sales associate who took them.",
};

/** Table column headings. */
export const COLUMN_INFO = {
  "Orders": "The number of orders.",
  "Revenue": "The value of these orders after discounts.",
  "Average Order Value": "The typical value of one order: revenue divided by orders.",
  "Discount Given": "The total discount given on these orders.",
  "Share": "This row's part of the total for everyone listed.",
  "Total Revenue": "The value of that day's sales after discounts.",
  "Sales": "The value of the partner's orders after the partner discount.",
  "Amount Received": "Money received so far, including any advance.",
  "Balance Due": "Money still owed: order value minus amount received.",
  "Days Past": "The number of days since the promised delivery date.",
  "Order Value": "The order's value after discounts.",
  "Sold, 90 Days": "Pieces sold to clients in the last 90 days.",
  "Gross": "The full price (MRP) of this item, including extras.",
  "Discount": "The amount taken off this item's full price.",
  "Taxable": "The billed amount for this item without GST.",
  "GST": "The 18% GST included in this item's billed amount.",
  "Invoice": "The amount billed for this item after discounts.",
  "Payment": "Paid means fully paid; Partly Paid means some money received; Unpaid means nothing received yet.",
  "Journey": "The latest production stage the order's pieces have reached, and when.",
  "Production": "The latest production stage the order's pieces have reached, and when.",
  "Value": "The order's value after discounts.",
  "Days Late": "The number of days past the promised delivery date.",
  "Achieved": "Sales so far as a share of the monthly target. Green means the associate is on track for the month.",
  "Target": "The sales target set for this month.",
  "Amount": "The order's value after discounts.",
  "Status": "Where the order stands now, from received to delivered.",
  "Store": "The store that took the order.",
  "Channel": "Where the order was placed.",
  "Sales Associate": "The person who took the order. For B2B orders, the merchandiser.",
  "SA": "The person who took the order. For B2B orders, the merchandiser.",
  "SA Name": "The person who took the order. For B2B orders, the merchandiser.",
  "Delivery Date": "The delivery date promised to the client.",
  "Due In": "The number of days until the promised delivery date.",
  "Issue": "What happened to the order: cancelled, returned, refunded, exchanged or revoked.",
  "Reason": "The reason recorded for the issue.",
  "Qty": "The number of pieces.",
  "Type": "LXRTS designs are counted by size, custom pieces as a single total, and made-to-order designs carry no stock.",
};
