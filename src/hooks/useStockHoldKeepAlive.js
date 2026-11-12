import { useEffect } from "react";
import { extendHolds, readHeldCodes, KEEP_ALIVE_MS } from "../utils/stockPieces";

/**
 * Release 35: while an order screen is open, keep the pieces this order has
 * scanned held (every 5 minutes, and on returning to the tab). Leaving the
 * order flow stops it; the hold then runs out after 30 minutes and the piece
 * goes back on sale.
 */
export default function useStockHoldKeepAlive() {
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      const codes = readHeldCodes();
      if (codes.length) extendHolds(codes);
    };
    tick();
    const timer = setInterval(tick, KEEP_ALIVE_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);
}
