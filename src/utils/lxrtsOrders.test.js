// The light all-LXRTS lookup for list screens that don't load items (point 44).
const mockFetchAll = jest.fn();
jest.mock("./fetchAllRows", () => ({ fetchAllRows: (...a) => mockFetchAll(...a) }));
import { fetchAllLxrtsOrderIds } from "./lxrtsOrders";

test("keeps only orders whose every non-charge line is LXRTS; long orders stay visible", async () => {
  mockFetchAll.mockResolvedValue({ error: null, data: [
    { id: "all", n0: "Mohsina (LXRTS)", c0: null },
    { id: "mixed", n0: "Mohsina (LXRTS)", c0: null, n1: "Lightweight dupatta", c1: null },
    { id: "withCharge", n0: "Ayra (Lxrts)", c0: null, n1: "Customisation", c1: "true" },
    { id: "long", n0: "A (LXRTS)", extra: "Ninth product (LXRTS)" },
    { id: "lookalike", n0: "Aabish LXRTSX Kurta", c0: null },
  ] });
  const ids = await fetchAllLxrtsOrderIds();
  expect([...ids].sort()).toEqual(["all", "withCharge"]);
});
