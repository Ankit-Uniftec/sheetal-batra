import React, { useEffect, useRef, useState } from "react";
import "./UpdateBanner.css";

// ============================================================
// UpdateBanner — tells long-running tabs when a new build is deployed.
//
// The complaint this solves: after a deployment, client tabs/laptops keep
// running the old cached bundle for a long time. A data-fetching library
// can't fix that (it lives inside the stale bundle); the standard fix is a
// version poll. Every build stamps public/version.json (scripts/
// write-version.js via npm prebuild). This component:
//   - records the version the tab loaded with (first successful fetch),
//   - re-checks every 5 minutes AND whenever the tab regains focus
//     (the moment people come back to a stale laptop),
//   - shows a refresh banner when the deployed version differs.
// Manual refresh (not auto-reload) so nobody loses in-progress form input.
// ============================================================

const CHECK_MS = 5 * 60 * 1000;

export default function UpdateBanner() {
    const [updateReady, setUpdateReady] = useState(false);
    const baseline = useRef(null);

    useEffect(() => {
        let cancelled = false;

        const check = async () => {
            try {
                const res = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
                if (!res.ok) return;
                const { version } = await res.json();
                if (cancelled || !version) return;
                if (baseline.current === null) baseline.current = version;
                else if (version !== baseline.current) setUpdateReady(true);
            } catch {
                // offline / transient — try again next tick
            }
        };

        check();
        const timer = setInterval(check, CHECK_MS);
        const onFocus = () => { if (document.visibilityState === "visible") check(); };
        document.addEventListener("visibilitychange", onFocus);
        window.addEventListener("focus", onFocus);
        return () => {
            cancelled = true;
            clearInterval(timer);
            document.removeEventListener("visibilitychange", onFocus);
            window.removeEventListener("focus", onFocus);
        };
    }, []);

    if (!updateReady) return null;

    return (
        <div className="upd-banner" role="status">
            <span className="upd-text">A new version of the app is available.</span>
            <button className="upd-btn" onClick={() => window.location.reload()}>Refresh now</button>
        </div>
    );
}
