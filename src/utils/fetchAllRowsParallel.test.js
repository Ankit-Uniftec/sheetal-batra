import { fetchPagesParallel, runLimited } from "./fetchAllRowsParallel";

// A fake table of `n` rows with ids 1..n, served page by page like PostgREST.
const table = (n) => {
  const rows = Array.from({ length: n }, (_, i) => ({ id: i + 1 }));
  const calls = [];
  const fetchPage = async (from, to) => {
    calls.push([from, to]);
    return { data: rows.slice(from, to + 1), error: null };
  };
  return { rows, calls, fetchPage };
};

test("returns every row in order, across many pages", async () => {
  const t = table(2537);
  const { data, error } = await fetchPagesParallel(t.fetchPage, { pageSize: 100, concurrency: 4 });
  expect(error).toBeNull();
  expect(data.map((r) => r.id)).toEqual(t.rows.map((r) => r.id));
});

test("an exact multiple of the page size still ends", async () => {
  const t = table(300);
  const { data } = await fetchPagesParallel(t.fetchPage, { pageSize: 100, concurrency: 3 });
  expect(data).toHaveLength(300);
});

test("empty and single-page tables need one request", async () => {
  const e = table(0);
  expect((await fetchPagesParallel(e.fetchPage, { pageSize: 100 })).data).toEqual([]);
  expect(e.calls).toHaveLength(1);
  const s = table(42);
  expect((await fetchPagesParallel(s.fetchPage, { pageSize: 100 })).data).toHaveLength(42);
  expect(s.calls).toHaveLength(1);
});

test("a row that slid across a page boundary is not counted twice", async () => {
  // Page 2 repeats the last row of page 1 (as if a new row was inserted at the top mid-fetch).
  const fetchPage = async (from) => {
    if (from === 0) return { data: [{ id: 1 }, { id: 2 }], error: null };
    if (from === 2) return { data: [{ id: 2 }, { id: 3 }], error: null };
    return { data: [], error: null };
  };
  const { data } = await fetchPagesParallel(fetchPage, { pageSize: 2, concurrency: 2 });
  expect(data.map((r) => r.id)).toEqual([1, 2, 3]);
});

test("an error that persists after one retry is returned, not swallowed", async () => {
  const fetchPage = async (from) =>
    from >= 200 ? { data: null, error: { message: "boom" } } : { data: Array.from({ length: 100 }, (_, i) => ({ id: from + i })), error: null };
  const { data, error } = await fetchPagesParallel(fetchPage, { pageSize: 100, concurrency: 3, retryDelayMs: 1 });
  expect(data).toBeNull();
  expect(error.message).toBe("boom");
});

test("runLimited keeps job order and never exceeds the limit", async () => {
  let running = 0;
  let peak = 0;
  const jobs = Array.from({ length: 10 }, (_, i) => async () => {
    running++; peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, 5));
    running--;
    return i;
  });
  expect(await runLimited(jobs, 3)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  expect(peak).toBeLessThanOrEqual(3);
});

test("a page that fails once (e.g. a timeout) is retried and the load still completes", async () => {
  let failedOnce = false;
  const fetchPage = async (from) => {
    if (from === 100 && !failedOnce) { failedOnce = true; return { data: null, error: { code: "57014" } }; }
    const n = from >= 300 ? 0 : 100;
    return { data: Array.from({ length: n }, (_, i) => ({ id: from + i })), error: null };
  };
  const { data, error } = await fetchPagesParallel(fetchPage, { pageSize: 100, concurrency: 2, retryDelayMs: 1 });
  expect(error).toBeNull();
  expect(data).toHaveLength(300);
});
