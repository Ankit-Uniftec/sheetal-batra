import { extrasTotal, planPieceSync, previewMoney, pieceLock, planToRpcArgs, touchedItemIndexes } from "./orderPieceEdit";

jest.mock("../lib/supabaseClient", () => ({ supabase: {} }));

const ORDER_NO = "SB-DLC-1126-014000";
const item = (over = {}) => ({ top: "Kurta", bottom: "Salwar", product_name: "Ashira", ...over });
const piece = (barcode, type, over = {}) => ({
  id: barcode,
  barcode,
  component_type: type,
  component_label: over.label ?? barcode,
  item_index: 0,
  extra_index: null,
  current_stage: "order_received",
  is_active: false,
  cancelled_at: null,
  ...over,
});
const started = { is_active: true, current_stage: "dyeing" };
const order = (items) => ({ id: "o1", order_no: ORDER_NO, items, grand_total: 20000, net_total: 18000, total_paid: 5000 });
const BEFORE = [item({ includes_dupatta: true, extras: [{ name: "Belt" }, { name: "Potli" }] })];
const plan = (items, comps, packed = new Set(), before = BEFORE) => planPieceSync(order(before), items, comps, packed);

const ROOT = "DLC-014000";

test("adding a dupatta and an extra mints both", () => {
  const p = plan([item({ includes_dupatta: true, extras: [{ name: "Belt", price: 1000 }] })], [], new Set(), [item()]);
  expect(p.add.map((a) => a.barcode)).toEqual([`${ROOT}-DUP`, `${ROOT}-EX1`]);
  expect(p.add[1].extra_index).toBe(0);
  expect(p.changed).toBe(true);
});

test("removing an unstarted dupatta removes the piece", () => {
  const dup = piece(`${ROOT}-DUP`, "dupatta");
  const p = plan([item({ includes_dupatta: false })], [dup]);
  expect(p.remove).toEqual([dup]);
  expect(p.blocked).toEqual([]);
});

test("a started dupatta cannot be removed", () => {
  const p = plan([item({ includes_dupatta: false })], [piece(`${ROOT}-DUP`, "dupatta", started)]);
  expect(p.remove).toEqual([]);
  expect(p.blocked[0].barcode).toBe(`${ROOT}-DUP`);
});

test("removing the first of two extras renames EX1 and removes EX2", () => {
  const comps = [
    piece(`${ROOT}-EX1`, "extra", { label: "Belt", extra_index: 0 }),
    piece(`${ROOT}-EX2`, "extra", { label: "Potli", extra_index: 1 }),
  ];
  const p = plan([item({ extras: [{ name: "Potli", price: 500 }] })], comps);
  expect(p.relabel).toEqual([{ id: `${ROOT}-EX1`, label: "Potli" }]);
  expect(p.remove.map((c) => c.barcode)).toEqual([`${ROOT}-EX2`]);
});

test("a started later extra blocks removing the one before it", () => {
  const comps = [
    piece(`${ROOT}-EX1`, "extra", { label: "Belt", extra_index: 0 }),
    piece(`${ROOT}-EX2`, "extra", { label: "Potli", extra_index: 1, ...started }),
  ];
  const p = plan([item({ extras: [{ name: "Potli", price: 500 }] })], comps);
  expect(p.blocked.map((b) => b.barcode)).toEqual([`${ROOT}-EX2`]);
});

test("a packed piece cannot be removed", () => {
  const dup = piece(`${ROOT}-DUP`, "dupatta");
  const p = plan([item()], [dup], new Set([dup.id]));
  expect(p.blocked).toHaveLength(1);
});

test("tops, bottoms and pieces of another format are left alone", () => {
  const comps = [piece(`${ROOT}-TOP`, "top"), piece("OLD-123-DUP", "dupatta")];
  const p = plan([item()], comps);
  expect(p.changed).toBe(false);
  expect(p.blocked).toEqual([]);
});

test("no change means nothing to do", () => {
  const items = [item({ includes_dupatta: true })];
  const comps = [piece(`${ROOT}-DUP`, "dupatta", { label: "Dupatta" })];
  expect(plan(items, comps, new Set(), items).changed).toBe(false);
});

test("an old order whose flag and pieces disagree is left alone unless that product is edited", () => {
  const items = [item()]; // flag says no dupatta, but a started dupatta piece exists
  const comps = [piece(`${ROOT}-DUP`, "dupatta", started)];
  const p = plan(items, comps, new Set(), items);
  expect(p.changed).toBe(false);
  expect(p.blocked).toEqual([]);
});

test("editing one product does not touch another product's pieces", () => {
  const before = [item(), item()];
  const after = [item(), item({ extras: [{ name: "Belt", price: 1 }] })];
  const comps = [piece(`${ROOT}-DUP`, "dupatta", { item_index: 0 })];
  const p = plan(after, comps, new Set(), before);
  expect(p.remove).toEqual([]);
  expect(p.add.map((a) => a.barcode)).toEqual([`${ROOT}-EX1-2`]);
});

test("touched products are found by dupatta and extra names, not prices or colours", () => {
  const a = [item({ extras: [{ name: "Belt", price: 1 }] })];
  expect(touchedItemIndexes(a, [item({ extras: [{ name: "Belt", price: 9, color: "Red" }] })]).size).toBe(0);
  expect([...touchedItemIndexes(a, [item()])]).toEqual([0]);
  expect([...touchedItemIndexes([item()], [item(), item({ includes_dupatta: true })])]).toEqual([1]);
});

test("a product cannot lose its last piece", () => {
  const items = [{ top: "NA", bottom: "NA", product_name: "Light Dupatta", includes_dupatta: false }];
  const p = plan(items, [piece(`${ROOT}-DUP`, "dupatta")]);
  expect(p.blocked.some((b) => /no pieces left/.test(b.why))).toBe(true);
});

test("extras total adds across products", () => {
  expect(extrasTotal([{ extras: [{ price: 100 }, { price: "50" }] }, {}, { extras: [{}] }])).toBe(150);
  expect(extrasTotal(null)).toBe(0);
});

test("money moves by the full extra price", () => {
  const o = { ...order([item({ extras: [{ price: 1000 }] })]) };
  const m = previewMoney(o, [item({ extras: [{ price: 1000 }, { price: 500 }] })]);
  expect(m).toMatchObject({ delta: 500, oldTotal: 18000, newTotal: 18500, newDue: 13500, belowPaid: false });
});

test("removing an extra below what is paid is refused", () => {
  const o = { ...order([item({ extras: [{ price: 1000 }] })]), net_total: 5500, total_paid: 5000 };
  expect(previewMoney(o, [item({ extras: [] })]).belowPaid).toBe(true);
});

test("a dupatta change never moves money, and a 0-total order stays 0", () => {
  expect(previewMoney(order([item()]), [item({ includes_dupatta: true })]).delta).toBe(0);
  const free = { ...order([item()]), grand_total: 0, net_total: 0, total_paid: 0 };
  expect(previewMoney(free, [item({ extras: [{ price: 900 }] })])).toMatchObject({ delta: 0, newTotal: 0 });
});

test("pieceLock reports started pieces by position only", () => {
  const comps = [piece(`${ROOT}-EX1`, "extra", { extra_index: 0, ...started }), piece(`${ROOT}-EX2`, "extra", { extra_index: 1 })];
  expect(pieceLock(comps, new Set(), 0, "extra", 0)).toBeTruthy();
  expect(pieceLock(comps, new Set(), 0, "extra", 1)).toBeNull();
  expect(pieceLock(comps, new Set(), 0, "dupatta")).toBeNull();
});

test("the database arguments carry ids and new pieces", () => {
  const dup = piece(`${ROOT}-DUP`, "dupatta");
  const args = planToRpcArgs(plan([item({ extras: [{ name: "Belt", price: 1 }] })], [dup]));
  expect(args.p_remove).toEqual([dup.id]);
  expect(args.p_add[0]).toMatchObject({ barcode: `${ROOT}-EX1`, component_type: "extra", item_index: 0, extra_index: 0 });
});
