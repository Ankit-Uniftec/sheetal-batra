// ============================================================
// What each figure on the Production Manager dashboard means. Shown when the
// label is hovered or tapped. Plain words: what it shows, how it is worked
// out, and what is left out.
// ============================================================

export const TILE_INFO = {
  "In Production": "Orders still being made: not yet completed, dispatched, delivered or cancelled. Unapproved B2B orders are not counted.",
  "Late Orders": "Orders still in production after their due date (two days before the client's delivery date). Website and stock orders are not counted because they are not promised by a date.",
  "Due This Week": "Orders still in production whose due date falls in the next 7 days, today included.",
  "Pieces on the Floor": "Garment pieces of running orders that are being worked on in the warehouse right now. Pieces at vendors, not started or finished are counted separately.",
  "At Vendors": "Pieces out with an outside vendor right now, by the latest gate scan.",
  "Scans Today": "Every stage scan recorded today, across all stations and both warehouses.",
  "On-Time Scans": "Share of scans in the period where the piece moved on within its stage's time limit, as recorded by the scan station.",
  "Finished Today": "Pieces that reached Completed, Packaging or Dispatched today.",
  "Ready to Dispatch": "Pieces that have passed Final QC or been marked complete and are waiting to be packed and sent.",
  "Stuck Pieces": "Pieces in the warehouse that have stayed at their stage longer than the stage's time limit. Pieces at vendors are counted under vendor returns instead.",
  "QC Pass Rate": "Share of QC checks in the period that passed. Final QC overrides are left out because nobody inspected the garment.",
  "Re-work Passes": "Pieces sent back to an earlier stage after a QC failure, in the period.",
  "Overdue at Vendors": "Pieces still out with a vendor after the return date set when they were sent.",
  "Waiting for You": "Stage change requests and replacement requests waiting for your decision.",
  "Not Started": "Pieces of running orders that have not been scanned at Cloth Issue yet.",
  "Average Lead Time": "Average days from an order being placed to its last piece being finished, for orders finished in the period.",
  "Active Scanners": "People who recorded at least one scan in the period.",
  "Manual Moves": "Scans recorded as a manual override instead of a station scan, in the period.",
  Dispatched: "Orders dispatched in the period.",
  "Delivered On Time": "Share of orders delivered in the period on or before the client's delivery date.",
  Cancelled: "Orders cancelled in the period.",
  "Pieces Pulled": "Pieces taken off the floor because their order was cancelled, in the period.",
};

export const CARD_INFO = {
  "Needs Your Attention": "Everything that needs a decision or a push today, worked out from the live orders, pieces, vendor trips, QC checks and requests. Click one to see the list behind it.",
  "The Floor Right Now": "Where every piece of a running order is at this moment: by stage, split into in the warehouse and out at vendors. Click a stage to see its pieces.",
  "Today vs Last 7 Days": "Scans and finished pieces today against the daily average of the previous 7 days.",
  "Daily Throughput": "Pieces finished (reached Completed, Packaging or Dispatched) each day.",
  "Due Date Pressure": "Running orders by how far away their due date is. Late orders are on the left.",
  "Late by Channel": "Late orders split by where they were placed. Website and stock orders are not counted.",
  "Stuck by Stage": "Pieces past their stage time limit, by stage, with how long they have been over.",
  "Oldest Running Orders": "Running orders that were placed the longest time ago.",
  "Due Next 7 Days": "Running orders due in the next 7 days, soonest first.",
};

export const COLUMN_INFO = {
  "Due Date": "The warehouse date: two days before the client's delivery date (the real date when the order had less than two days to run).",
  "At Stage": "How long the piece has been at its current stage, and how far past the stage's time limit it is.",
  Status: "Where the order stands, worked out from its pieces: Order Received, In Production, Completed, Dispatched or Delivered.",
};
