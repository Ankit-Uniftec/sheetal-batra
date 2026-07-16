import { useCallback } from "react";
import { useLocation, useSearchParams } from "react-router-dom";

// ============================================================
// useTabParam — dashboard tab state that lives in the URL (?tab=orders).
//
// Every dashboard used to hold its active tab in plain useState. Navigating to
// a detail page (/order/:id, /b2b-order-view/:id) unmounted the dashboard, so
// Back remounted it at the DEFAULT tab — the user lost their place. And browser
// Back never moved between tabs, because tab clicks never touched history.
//
// Putting the tab in the URL fixes both at once:
//   - Back from a detail page returns to the exact previous URL, tab included.
//   - Each tab click pushes a history entry, so Back walks back through tabs.
//   - Tab views become linkable/refreshable (?tab=orders survives a reload).
//
// Drop-in replacement for the old pattern:
//   const [activeTab, setActiveTab] = useState("overview");
//     becomes
//   const [activeTab, setActiveTab] = useTabParam("overview");
//
// location.state?.activeTab is still honoured (several flows push it — the
// notification bell, OrderDetailPage's Back) so existing callers keep working.
//
// paramName lets one page host two independent tab levels (?tab=..&subtab=..).
// ============================================================
export default function useTabParam(defaultTab, paramName = "tab") {
    const [searchParams, setSearchParams] = useSearchParams();
    const location = useLocation();

    const activeTab =
        searchParams.get(paramName) ||
        (paramName === "tab" ? location.state?.activeTab : null) ||
        defaultTab;

    const setActiveTab = useCallback(
        (next) => {
            setSearchParams(
                (prev) => {
                    const p = new URLSearchParams(prev);
                    const value = typeof next === "function" ? next(p.get(paramName) || defaultTab) : next;
                    if (value === defaultTab) p.delete(paramName); // keep default URLs clean
                    else p.set(paramName, value);
                    return p;
                }
                // note: intentionally PUSH (not replace) — each tab change is a
                // history entry so the browser Back button moves between tabs.
            );
        },
        [setSearchParams, paramName, defaultTab]
    );

    return [activeTab, setActiveTab];
}
