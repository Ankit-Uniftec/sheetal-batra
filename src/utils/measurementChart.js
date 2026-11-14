// ============================================================
// Measurement chart — the ONE definition of which measurements a garment
// needs (Release 38, the client's chart of 2026-11-14).
//
// A garment (the top or bottom picked on the order form) belongs to a group;
// the group decides the fields asked for. Groups are what an order saves its
// measurements under (item.measurements[groupKey]), so the existing keys are
// kept exactly — old orders, saved customer measurements and the PDFs keep
// working — and two groups are new: SeparateTop and SeparateBottom.
//
// Height is asked once for every garment (its own group, as before).
// "Mori" is not in the client's chart, so it is no longer asked for; values on
// old orders still print (the PDFs print whatever was saved).
// ============================================================

export const MEASUREMENT_FIELDS = {
  Height: ["Height"],
  // Chauga / Dress / Jacket / Kaftan / Kurta
  KurtaChogaKaftan: [
    "Shoulder", "Neck", "Upper Bust", "Bust", "Dart Point", "Sleeves", "Bicep", "Arm Hole",
    "Waist", "Hip", "Length", "Front Cross", "Back Cross",
  ],
  // Blouse / Choli
  Blouse: [
    "Shoulder", "Upper Bust", "Bust", "Dart Point", "Waist", "Length",
    "Front Cross", "Back Cross", "Front Neck", "Back Neck",
  ],
  // Short Anarkali / Long Anarkali / Angrakha
  Anarkali: [
    "Shoulder", "Upper Bust", "Bust", "Dart Point", "Sleeves", "Bicep", "Arm Hole",
    "Waist", "Length", "Yoke Length",
  ],
  SeparateTop: [
    "Shoulder", "Neck", "Upper Bust", "Bust", "Dart Point", "Sleeves", "Bicep", "Arm Hole",
    "Waist", "Hip", "Length", "Front Cross", "Back Cross", "Front Neck", "Back Neck",
  ],
  // Salwar / Dhoti
  SalwarDhoti: ["Waist", "Hip", "Length", "Thigh", "Calf", "Ankle"],
  // Chooridaar / Pant / Palazzo / Drape Saree / Saree
  ChuridaarTrouserPantsPlazo: ["Waist", "Hip", "Length", "Thigh", "Calf", "Ankle", "Knee"],
  // Sharara / Garara
  ShararaGharara: ["Waist", "Hip", "Length"],
  // Lehenga / Skirt
  Lehenga: ["Waist", "Hip", "Length"],
  SeparateBottom: [
    "Waist", "Hip", "Length", "Front Cross", "Back Cross", "Front Neck", "Back Neck",
    "Thigh", "Calf", "Ankle", "Knee", "Yoke Length",
  ],
};

export const GROUP_DISPLAY_NAMES = {
  Height: "Height",
  KurtaChogaKaftan: "Kurta / Chauga / Kaftan / Dress / Jacket",
  Blouse: "Blouse / Choli",
  Anarkali: "Anarkali / Angrakha",
  SeparateTop: "Separate Top",
  SalwarDhoti: "Salwar / Dhoti",
  ChuridaarTrouserPantsPlazo: "Chooridaar / Pant / Palazzo / Saree",
  ShararaGharara: "Sharara / Garara",
  Lehenga: "Lehenga / Skirt",
  SeparateBottom: "Separate Bottom",
};

export const TOP_GROUPS = ["KurtaChogaKaftan", "Blouse", "Anarkali", "SeparateTop"];
export const BOTTOM_GROUPS = ["SalwarDhoti", "ChuridaarTrouserPantsPlazo", "ShararaGharara", "Lehenga", "SeparateBottom"];
export const ALL_GROUP_DISPLAY_NAMES = ["Height", ...TOP_GROUPS, ...BOTTOM_GROUPS].map((k) => GROUP_DISPLAY_NAMES[k]);

/** "Top" / "Bottom" / "Lehenga" label for a saved group (PDFs, dashboards). */
export function groupKind(key) {
  if (key === "Lehenga") return "Lehenga";
  if (TOP_GROUPS.includes(key)) return "Top";
  if (BOTTOM_GROUPS.includes(key)) return "Bottom";
  return key;
}

// Garment name → group. Matching ignores case, spaces and dashes, so
// "Short A-Line Kurta", "short a-line kurta" and "SHORT A LINE KURTA" agree.
const GARMENTS = {
  KurtaChogaKaftan: [
    "Kurta", "Short Kurta", "Long Kurta", "Short A-Line Kurta", "A-line Kurta", "Straight Kurta", "Princess - Cut Kurta",
    "Front Open Straight Kurta", "Peplum", "Chauga", "Kalidaar Chauga", "Choga", "Short Choga", "Long Choga",
    "Kaftan", "Dress", "Princess - Cut Dress", "Jacket", "A-line Front Open Jacket", "Suit",
  ],
  Blouse: ["Blouse", "Choli"],
  Anarkali: ["Anarkali", "Short Anarkali", "Long Anarkali", "Angrakha"],
  SeparateTop: ["Separate Top"],
  SalwarDhoti: ["Salwar", "Dhoti"],
  ChuridaarTrouserPantsPlazo: [
    "Chooridar", "Chooridaar", "Churidaar", "Churidar", "Pant", "Pants", "Trouser", "Palazzo", "Flared Palazzo",
    "Saree", "Drape Saree",
  ],
  ShararaGharara: ["Sharara", "Garara", "Gharara"],
  Lehenga: ["Lehenga", "Skirt", "Crushed Skirt"],
  SeparateBottom: ["Separate Bottom"],
};
const squash = (s) => String(s || "").toLowerCase().replace(/[^a-z]/g, "");
const BY_GARMENT = {};
Object.entries(GARMENTS).forEach(([group, names]) => names.forEach((n) => { BY_GARMENT[squash(n)] = group; }));

/** The measurement group of a garment name, or undefined (e.g. "NA"). */
export const measurementGroupOf = (garment) => BY_GARMENT[squash(garment)];

/**
 * Drop-in for the old `CATEGORY_KEY_MAP[name]` lookups: an object whose
 * property read is measurementGroupOf(name).
 */
export const GARMENT_GROUP = new Proxy({}, { get: (_t, name) => (typeof name === "string" ? measurementGroupOf(name) : undefined) });

// The client's drop-down lists ("Drop Down Color Menu" in COLLECTION LIST.xlsx)
// plus the two separate pieces. The order form also offers every top / bottom
// any catalogue product already uses, so nothing an old product needs is lost.
export const CLIENT_TOPS = ["Angrakha", "Blouse", "Chauga", "Choli", "Dress", "Jacket", "Kaftan", "Kurta", "Long Anarkali", "Short Anarkali", "Separate Top"];
export const CLIENT_BOTTOMS = ["Chooridar", "Dhoti", "Drape Saree", "Garara", "Lehenga", "Palazzo", "Pant", "Salwar", "Saree", "Sharara", "Skirt", "Separate Bottom"];

/** Every option once (case-insensitive), sorted, without NA-style blanks. */
export function mergeOptions(...lists) {
  const seen = new Map();
  lists.flat().forEach((v) => {
    const s = String(v || "").trim();
    if (!s || /^(na|n\/a|none|-)$/i.test(s)) return;
    const k = s.toLowerCase();
    if (!seen.has(k)) seen.set(k, s);
  });
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}
