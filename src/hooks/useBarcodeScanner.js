import { useEffect, useRef, useCallback } from "react";

/**
 * useBarcodeScanner Hook
 * 
 * Listens for barcode scanner input globally via keydown events.
 * The DCode DC7122 BT scanner works in HID keyboard emulation mode —
 * it "types" the barcode characters rapidly (< 50ms between keys) then presses Enter.
 * 
 * This hook distinguishes scanner input from human typing by measuring
 * the time gap between keystrokes. Scanner: < 50ms. Human: > 100ms.
 * 
 * Usage:
 *   useBarcodeScanner({
 *     onScan: (barcode) => handleBarcodeScan(barcode),
 *     enabled: true,        // Toggle on/off
 *     minLength: 5,         // Minimum barcode length to accept
 *     maxGap: 50,           // Max ms between keystrokes to count as scanner
 *   });
 */

const DEFAULT_OPTIONS = {
  enabled: true,
  minLength: 5,          // Minimum characters for a valid barcode (e.g. "DLC-0376-TOP" = 12 chars)
  maxGap: 50,            // Max milliseconds between keystrokes to count as scanner input
  debounceDelay: 300,    // Delay after Enter before accepting next scan (prevent double-scan)
};

export function useBarcodeScanner({ onScan, enabled = true, minLength, maxGap, debounceDelay } = {}) {
  const bufferRef = useRef("");
  const lastKeyTimeRef = useRef(0);
  const isProcessingRef = useRef(false);
  const timeoutRef = useRef(null);

  const opts = {
    ...DEFAULT_OPTIONS,
    ...(minLength !== undefined && { minLength }),
    ...(maxGap !== undefined && { maxGap }),
    ...(debounceDelay !== undefined && { debounceDelay }),
  };

  const resetBuffer = useCallback(() => {
    bufferRef.current = "";
    lastKeyTimeRef.current = 0;
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e) => {
      // Don't capture if user is typing in an input/textarea/select
      const tag = e.target.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") {
        // UNLESS the input has data-barcode-passthrough attribute
        if (!e.target.hasAttribute("data-barcode-passthrough")) {
          return;
        }
      }

      // Prevent capturing modifier keys, function keys, etc.
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.key === "Shift" || e.key === "Control" || e.key === "Alt" || e.key === "Meta") return;
      if (e.key.startsWith("F") && e.key.length > 1) return; // F1-F12
      if (e.key === "Tab" || e.key === "Escape" || e.key === "CapsLock") return;

      const now = Date.now();
      const timeSinceLastKey = now - lastKeyTimeRef.current;

      if (e.key === "Enter") {
        e.preventDefault();

        const barcode = bufferRef.current.trim();

        // Check: buffer has content, was typed fast (scanner speed), meets min length
        if (
          barcode.length >= opts.minLength &&
          !isProcessingRef.current
        ) {
          isProcessingRef.current = true;

          // Fire the callback
          if (onScan) {
            onScan(barcode);
          }

          // Debounce: prevent double-scan
          setTimeout(() => {
            isProcessingRef.current = false;
          }, opts.debounceDelay);
        }

        resetBuffer();
        return;
      }

      // If too much time passed since last key, this is a new sequence
      if (timeSinceLastKey > opts.maxGap && bufferRef.current.length > 0) {
        // Previous buffer was typed too slowly — not a scan, clear it
        resetBuffer();
      }

      // Only buffer printable single characters
      if (e.key.length === 1) {
        bufferRef.current += e.key;
        lastKeyTimeRef.current = now;

        // Safety: clear buffer after 2 seconds of no input
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        timeoutRef.current = setTimeout(() => {
          resetBuffer();
        }, 2000);
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);

    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [enabled, onScan, opts.minLength, opts.maxGap, opts.debounceDelay, resetBuffer]);

  // Return a manual reset function in case caller needs it
  return { resetBuffer };
}

export default useBarcodeScanner;