import { creditExchangeDifference, returnForStoreCredit, settleCreditUsedOnOrder } from "./storeCredit";

// A tiny stand-in for the database: one profile, a log of writes, and switches
// for whether r31_01 has been run.
let mockDb;
jest.mock("../lib/supabaseClient", () => {
  const table = (name) => {
    const q = { _name: name, _filters: {}, _update: null };
    q.select = () => q;
    q.eq = (k, v) => { q._filters[k] = v; return q; };
    q.limit = () => q;
    q.update = (row) => { q._update = row; return q; };
    q.single = () => Promise.resolve(mockDb.read(name, q));
    q.then = (ok, bad) => Promise.resolve(q._update ? mockDb.write(name, q) : mockDb.read(name, q)).then(ok, bad);
    return q;
  };
  return {
    supabase: {
      from: (name) => table(name),
      rpc: (fn, args) => Promise.resolve(mockDb.rpc(fn, args)),
    },
  };
});

const missing = { code: "PGRST202", message: "Could not find the function" };

beforeEach(() => {
  mockDb = {
    hasR31: true,
    balance: 1000,
    ledgerUse: false,
    writes: [],
    rpcCalls: [],
    rpc(fn, args) {
      this.rpcCalls.push({ fn, args });
      if (!this.hasR31) return { data: null, error: missing };
      this.balance += args.p_amount;
      return { data: this.balance, error: null };
    },
    read(name) {
      if (name === "profiles") return { data: { store_credit: this.balance }, error: null };
      if (name === "store_credit_ledger") {
        if (!this.hasR31) return { data: null, error: { code: "PGRST205", message: "Could not find the table" } };
        return { data: this.ledgerUse ? [{ id: 1 }] : [], error: null };
      }
      return { data: null, error: null };
    },
    write(name, q) {
      this.writes.push({ name, row: q._update, filters: q._filters });
      if (name === "profiles" && q._update.store_credit != null) this.balance = q._update.store_credit;
      return { data: null, error: null };
    },
  };
});

const order = { id: "o1", order_no: "SB-1", user_id: "u1" };

test("a return goes through the database once and adds to the real balance", async () => {
  const r = await returnForStoreCredit(order, { amount: 500, status: "return_store_credit", reason: "Size", returnedItems: null });
  expect(r.balance).toBe(1500);
  expect(mockDb.rpcCalls[0]).toMatchObject({ fn: "issue_store_credit", args: { p_kind: "return", p_amount: 500, p_new_status: "return_store_credit" } });
  expect(mockDb.writes).toHaveLength(0); // the browser writes nothing itself
});

test("before r31_01, a return adds to the balance read just now, not a remembered one", async () => {
  mockDb.hasR31 = false;
  mockDb.balance = 2000; // changed since any page loaded
  const r = await returnForStoreCredit(order, { amount: 500, status: "partial_return", reason: "Fit", returnedItems: [{ x: 1 }] });
  expect(r.balance).toBe(2500);
  expect(mockDb.writes[0]).toMatchObject({ name: "orders", row: { status: "partial_return" } });
});

test("a database refusal is shown, never quietly worked around", async () => {
  mockDb.rpc = () => ({ data: null, error: { code: "P0001", message: "Store credit for order SB-1 has already been given." } });
  await expect(returnForStoreCredit(order, { amount: 500, status: "return_store_credit" })).rejects.toMatchObject({ message: expect.stringMatching(/already been given/) });
  expect(mockDb.writes).toHaveLength(0);
});

test("exchange credit is recorded on the order only by the database once r31_01 is run", async () => {
  await creditExchangeDifference(order, 300);
  expect(mockDb.rpcCalls[0].args).toMatchObject({ p_kind: "exchange", p_amount: 300 });
  expect(mockDb.writes).toHaveLength(0);
  mockDb.hasR31 = false;
  await creditExchangeDifference(order, 300);
  expect(mockDb.writes.map((w) => w.name)).toEqual(["profiles", "orders"]);
});

test("credit used: nothing more to do when the database already took it off", async () => {
  mockDb.ledgerUse = true;
  await settleCreditUsedOnOrder("o1", "u1", 400);
  expect(mockDb.writes).toHaveLength(0);
});

test("credit used before r31_01: taken off the balance as it is now", async () => {
  mockDb.hasR31 = false;
  mockDb.balance = 1000;
  await settleCreditUsedOnOrder("o1", "u1", 1000);
  expect(mockDb.writes[0].row).toEqual({ store_credit: 0, store_credit_expiry: null });
});
