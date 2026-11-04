// A merchandiser's name as it should be shown, grouped and matched.
//
// Names are copied from the staff record onto each order, so a stray space there
// ends up on the orders: 2,366 orders carry "Prastuti Kaushik " and 9 carry
// "Prastuti Kaushik". Compared as-is they are two people, and every filter lists
// her twice. Old orders keep what they saved, so read names through here.
export const cleanMerchandiserName = (name) =>
  String(name ?? "").trim().replace(/\s+/g, " ");

// The options for a merchandiser filter: one entry per person, sorted.
export const uniqueMerchandiserNames = (orders) =>
  [...new Set((orders || []).map((o) => cleanMerchandiserName(o.merchandiser_name)).filter(Boolean))].sort();

export const isSameMerchandiser = (a, b) =>
  cleanMerchandiserName(a) === cleanMerchandiserName(b);
