import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";

// ============================================================
// useFilterParam — search / filter state that lives in the URL (?q=kurta).
//
// Sibling of useTabParam, for the same reason. Filters used to sit in plain
// useState: clicking an order navigated to /order/:id, which unmounted the
// dashboard, so Back remounted it with every search box and dropdown reset.
// Users had to re-type the search and re-pick the filters every single time
// they looked at an order — the single most-reported friction on the order
// lists.
//
// Keeping the value in the URL fixes it: Back returns to the exact previous
// URL, filters included, and a filtered view becomes linkable/refreshable.
//
// Drop-in replacement:
//   const [search, setSearch] = useState("");
//     becomes
//   const [search, setSearch] = useFilterParam("q", "");
//
// Notes:
//   - REPLACES rather than pushes, unlike useTabParam. Typing in a search box
//     fires per keystroke; pushing would bury the previous page under dozens of
//     history entries and make Back useless.
//   - The param is DELETED when the value equals defaultValue, so an unfiltered
//     list keeps a clean URL.
//   - Values are strings (URL params always are). For arrays/objects use
//     useFilterParamList below.
// ============================================================
export default function useFilterParam(paramName, defaultValue = "") {
    const [searchParams, setSearchParams] = useSearchParams();
    const value = searchParams.get(paramName) ?? defaultValue;

    const setValue = useCallback(
        (next) => {
            setSearchParams(
                (prev) => {
                    const p = new URLSearchParams(prev);
                    const resolved = typeof next === "function" ? next(p.get(paramName) ?? defaultValue) : next;
                    if (resolved === defaultValue || resolved === "" || resolved == null) p.delete(paramName);
                    else p.set(paramName, String(resolved));
                    return p;
                },
                { replace: true } // see note above — never push on every keystroke
            );
        },
        [setSearchParams, paramName, defaultValue]
    );

    return [value, setValue];
}

// Clear several filter params in ONE navigation.
//
// A "Clear all filters" button that calls five setters in a row does five
// setSearchParams updates within one handler; react-router evaluates them all
// against the same pre-navigation snapshot, so only the last one survives and
// the other four filters silently stay put. This wipes them together.
//
//   const clearFilters = useClearFilterParams(["status", "type", "merch", "from", "to"]);
//   <button onClick={() => { clearFilters(); setCurrentPage(1); }}>Clear</button>
export function useClearFilterParams(paramNames = []) {
    const [, setSearchParams] = useSearchParams();
    return useCallback(() => {
        setSearchParams(
            (prev) => {
                const p = new URLSearchParams(prev);
                paramNames.forEach((name) => p.delete(name));
                return p;
            },
            { replace: true }
        );
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [setSearchParams, paramNames.join(",")]);
}

// Multi-select filters (checkbox lists) — stored comma-separated: ?store=B2B,Private
// Returns a real array so callers can use .includes()/.length unchanged.
export function useFilterParamList(paramName) {
    const [searchParams, setSearchParams] = useSearchParams();
    const raw = searchParams.get(paramName);
    const value = raw ? raw.split(",").filter(Boolean) : [];

    const setValue = useCallback(
        (next) => {
            setSearchParams(
                (prev) => {
                    const p = new URLSearchParams(prev);
                    const current = (p.get(paramName) || "").split(",").filter(Boolean);
                    const resolved = typeof next === "function" ? next(current) : next;
                    const list = (resolved || []).filter(Boolean);
                    if (list.length === 0) p.delete(paramName);
                    else p.set(paramName, list.join(","));
                    return p;
                },
                { replace: true }
            );
        },
        [setSearchParams, paramName]
    );

    return [value, setValue];
}
