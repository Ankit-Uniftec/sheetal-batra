// Guards the production-privacy rule: a Production Head must not see client
// identity, order money, or the customer's delivery date (they work to T-2).
import {
  isProductionRole,
  canSeeOrderMoney,
  canSeeClientIdentity,
  CLIENT_IDENTITY_COLUMNS,
  ORDER_MONEY_COLUMNS,
} from "./productionPrivacy";
import { getWarehouseDate } from "./warehouseDate";

test("every production role is recognised, however it is cased or spaced", () => {
  ["production", "Production", "  PRODUCTION  ",
   "offline production head", "Offline Production Head",
   "online production head"].forEach((r) => {
    expect(isProductionRole(r)).toBe(true);
  });
});

test("non-production roles are not withheld from", () => {
  ["executive", "merchandiser", "comms", "store manager", "admin", "gm"].forEach((r) => {
    expect(isProductionRole(r)).toBe(false);
  });
});

test("a missing role does not silently widen the rule", () => {
  // This helper decides what to HIDE; an unresolved role must not make a screen
  // hide MORE than its own guard already does.
  [null, undefined, ""].forEach((r) => expect(isProductionRole(r)).toBe(false));
});

test("the convenience inverses track isProductionRole", () => {
  expect(canSeeOrderMoney("production")).toBe(false);
  expect(canSeeClientIdentity("production")).toBe(false);
  expect(canSeeOrderMoney("merchandiser")).toBe(true);
  expect(canSeeClientIdentity("merchandiser")).toBe(true);
});

test("the withheld column lists name no overlapping or empty entries", () => {
  const all = [...CLIENT_IDENTITY_COLUMNS, ...ORDER_MONEY_COLUMNS];
  expect(all.every((c) => typeof c === "string" && c.length > 0)).toBe(true);
  expect(new Set(all).size).toBe(all.length);
  // delivery_date is NOT withheld at the column level — production needs it as
  // the INPUT to the T-2 calculation; the rule is that it is never rendered raw.
  expect(all).not.toContain("delivery_date");
});

test("T-2 is two days before the customer date, so the two never coincide", () => {
  // The reason the customer date is hidden: it is later than the PH's deadline.
  const warehouse = getWarehouseDate("2026-09-20", "2026-09-01");
  expect(warehouse).toBe("18-09-2026");
});

test("a rush order keeps the real date rather than going backwards", () => {
  // Less than 2 days to run: nothing to subtract, so T-2 falls back.
  expect(getWarehouseDate("2026-09-02", "2026-09-01")).toBe("02-09-2026");
});
