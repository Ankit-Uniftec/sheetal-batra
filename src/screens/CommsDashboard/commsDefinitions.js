// ============================================================
// Definitions shown when you point at (or tap) a label on the Comms dashboard.
// Each says what the number shows, how it is worked out, and what is left out,
// matching the calculation in CommsPages.
// ============================================================

/** Headline tiles and small figures, keyed by their label. */
export const TILE_INFO = {
  // Overview
  "Comms Orders": "Orders placed through the Comms channel in the selected period: barter, gifting, sourcing and personal orders. Cancelled and rejected orders are not counted.",
  "Notional Value": "What these outfits would sell for at full price: each piece's price plus its extras. No money changes hands on most Comms orders, so this shows the value given out.",
  "Waiting for Approval": "Orders above the approval limit that are still waiting for an admin to approve or reject them.",
  "Outfits Out on Sourcing": "Sourcing outfits that have gone out and have not been marked returned yet. The note shows how many are past their return date.",
  "PR Captured": "Of the barter, gifting and sourcing orders, the share that has a PR record filled in: coverage, reach and impact.",

  // Sourcing Returns
  "Out on Sourcing": "Sourcing outfits that are out and not yet due back.",
  "Overdue": "Sourcing outfits whose return date has passed and that have not been marked returned.",
  "Returned": "Sourcing outfits marked as returned, with their condition and new location.",

  // Inventory
  "Designs": "Every live design in the catalogue.",
  "Pieces in Stock": "Finished pieces on hand, from the same records Stock Room uses. Made-to-order designs are not included because they are made only after an order.",
  "Active Blocks": "Designs currently reserved for a shoot, event or sourcing. Stores cannot sell them on those dates.",
  "Out of Stock": "Designs that hold stock but have no pieces left right now.",
  "Low Stock": "Designs that hold stock and are running low, with only 1 to 4 pieces left.",
  "Made to Order": "Designs made only after an order is placed. They hold no stock, so they can always be ordered.",

  // PR Performance
  "PR-Eligible Orders": "Barter, gifting and sourcing orders that are approved. Personal orders are paid orders, so they are not tracked for PR.",
  "Captured": "Orders with a PR record filled in.",
  "Not Captured": "Orders still waiting for their PR record.",
  "Outfit Used": "Orders where the celebrity, influencer or agency is recorded as having used the outfit.",
  "High Impact": "Orders whose PR outcome was recorded as high impact.",

  // Calendar
  "Deliveries": "Comms orders due for delivery in the month shown.",
  "My Events": "Follow-ups, events and shoots you have added to your own calendar in the month shown.",
};

/** Card and chart titles. */
export const CARD_INFO = {
  "Needs Your Attention": "Things to act on now: late returns, late deliveries, missing PR records, repeat designs to the same person, today's deliveries and events, and blocks to release.",
  "Monthly Trend": "Comms orders placed each month over the last year, split by engagement type. Cancelled and rejected orders are not counted.",
  "By Occasion": "What the outfits were for, from the purpose on each order. Spellings that differ only in capitals or spaces are counted together.",
  "By Agency": "Which agencies the orders came through, from the agency on each order.",
  "By Request Source": "Whether each request came through an agency or from an individual directly.",
  "Return Condition": "How sourcing outfits came back when they were marked returned.",
  "Data Gaps": "Details left blank on Comms orders. Filling them in keeps reports and insights complete.",
  "Orders by Engagement": "How the period's Comms orders split across barter, gifting, sourcing and personal orders.",
  "Top Recipients": "The people and agencies who received the most Comms orders in the period.",
  "Top Designs": "The designs sent out most often through Comms in the period.",
  "Deliveries Due This Week": "Comms orders due for delivery in the next 7 days that are not delivered yet.",
  "Upcoming Returns": "Sourcing outfits due back in the next 14 days.",
  "Recent Orders": "The latest Comms orders placed in the period.",
  "Active Blocks": "Designs currently reserved. Release a block to make the design available to stores again.",
  "Design Stock": "Every design with its pieces on hand and stock status. Block a design to reserve it for a shoot, event or sourcing.",
  "Designs in Stock": "Designs that hold finished pieces: LXRTS designs counted by size and custom pieces counted as a total. Click a design to see its sizes.",
  "Made to Order": "Designs made only after an order is placed. They hold no stock.",
  "Monthly Report — Agency & Individual": "Barter, gifting and sourcing orders for the chosen month, one row per piece.",
  "Monthly Report — Personal Orders": "Personal orders for the chosen month, with price, discount, advance and dispatch details.",
  "PR Performance Report": "Totals from the PR records: orders tracked, engagement split, outfits used, impact, reach and impressions.",
};

/** Table column headings. */
export const COLUMN_INFO = {
  "Engagement": "The type of Comms order: barter, gifting, sourcing or a personal order.",
  "Notional Value": "The outfit's full price, including extras.",
  "Status": "Where the order stands now, from waiting for approval to delivered.",
  "Delivery Date": "The date the outfit is due to reach the recipient.",
  "Return Date": "The date a sourcing outfit is due back.",
  "Days": "Days past the return date, or days left until it.",
  "Condition": "The condition recorded when the outfit came back.",
  "New Location": "Where the returned outfit was placed.",
  "Pieces": "Pieces on hand, all sizes together.",
  "Sizes": "Pieces on hand in each size.",
  "List Price": "The design's price in the catalogue.",
  "Stock": "Made-to-order designs are made after each order, so they hold no stock.",
  "Reserved For": "Why the design is reserved.",
  "Outfit Used": "Whether the recipient used the outfit.",
  "Impact": "The PR outcome recorded for the order.",
  "PR Record": "Whether a PR record has been filled in for the order.",
  "Production": "The latest production stage the order's pieces have reached, and when.",
};
