// Order notes, merged the one way.
//
// An order can carry a note in up to three places: the line item's own `notes`,
// the order's `comments`, and `delivery_notes`. Website orders populate
// `comments`; retail/B2B forms write the others. The warehouse PDF has always
// merged all three, and the order card must show exactly what the PDF prints —
// a card that disagreed with the document the floor works from is worse than no
// card at all — so both call this.
//
// De-duped because the same text is often copied into two of the fields (the
// B2B review screen writes `comments` and `delivery_notes` from one input), and
// printing it twice reads as two separate instructions.
export const mergeOrderNotes = (order, item) =>
  [...new Set([item?.notes, order?.comments, order?.delivery_notes]
    .filter((n) => n && String(n).trim() !== "")
    .map((n) => String(n).trim()))]
    .join(" | ");
