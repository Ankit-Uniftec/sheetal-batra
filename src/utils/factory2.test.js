jest.mock("../lib/supabaseClient", () => ({ supabase: {} }));
import { gateLeg, gateTransitionType, factoryBadge, WH1, WH2 } from "./factory2";

const trip = (arrived, left) => ({ f2_arrived_at: arrived, f2_left_at: left });

test("SB WH Delhi (2) guard: Arrived first, then Left", () => {
  expect(gateLeg({ isOutside: true, myFactory: WH2, trip: trip(null, null) })).toEqual({ scanType: "entry", leg: "f2_arrival" });
  expect(gateLeg({ isOutside: true, myFactory: WH2, trip: trip("t", null) })).toEqual({ scanType: "exit", leg: "f2_departure" });
  // Already left: another scan is an arrival attempt → the database refuses it.
  expect(gateLeg({ isOutside: true, myFactory: WH2, trip: trip("t", "u") }).leg).toBe("f2_arrival");
});

test("everyone else, or no SB WH Delhi (2) trip: today's gate", () => {
  expect(gateLeg({ isOutside: true, myFactory: WH1, trip: trip("t", null) })).toEqual({ scanType: "entry", leg: null });
  expect(gateLeg({ isOutside: false, myFactory: WH2, trip: null })).toEqual({ scanType: "exit", leg: null });
  expect(gateLeg({ isOutside: true, myFactory: WH2, trip: null })).toEqual({ scanType: "entry", leg: null });
  expect(gateLeg({ isOutside: false, myFactory: null, trip: null })).toEqual({ scanType: "exit", leg: null });
});

test("duplicate-guard type and badges", () => {
  expect(gateTransitionType({ scanType: "exit", leg: null })).toBe("security_exit");
  expect(gateTransitionType({ scanType: "entry", leg: "f2_arrival" })).toBe("f2_arrival");
  expect(factoryBadge(WH1)).toBe("SB WH Delhi (1)");
  expect(factoryBadge(WH2)).toBe("SB WH Delhi (2)");
  expect(factoryBadge("Somewhere")).toBe("");
  expect(factoryBadge(null)).toBe("");
});
