import { gateActions, pieceWhere } from "./storeGate";

const p = (gate_event, extra = {}) => ({ gate_event, ...extra });

test("a dispatched piece not yet at the store: Received first", () => {
  expect(gateActions([p(null), p(null)])[0]).toBe("in_from_warehouse");
});

test("pieces in the store: Delivered or Send to warehouse", () => {
  expect(gateActions([p("in_from_warehouse"), p("in_from_customer")])).toEqual(["out_delivered", "out_to_warehouse"]);
});

test("delivered pieces: back from customer, or straight to warehouse", () => {
  expect(gateActions([p("out_delivered")])).toEqual(["in_from_customer", "out_to_warehouse"]);
});

test("back from the warehouse after work: Received first", () => {
  expect(gateActions([p("out_to_warehouse")])[0]).toBe("in_from_warehouse");
});

test("a mix offers everything; nothing selected offers nothing", () => {
  expect(gateActions([p("in_from_warehouse"), p("out_delivered")])).toHaveLength(4);
  expect(gateActions([])).toEqual([]);
});

test("where a piece is, in words", () => {
  expect(pieceWhere(p(null, { dispatched: true }))).toBe("Dispatched by warehouse");
  expect(pieceWhere(p(null, { dispatched: false }))).toBe("Not dispatched yet");
  expect(pieceWhere(p("in_from_warehouse", { gate_store: "Delhi" }))).toBe("Received at store · Delhi");
});
