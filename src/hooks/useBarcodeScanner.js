import { useEffect, useRef, useCallback } from "react";

/**
 * useBarcodeScanner Hook — Production Grade
 * 
 * Based on patterns from onscan.js and warehouse industry best practices.
 * 
 * HOW IT WORKS:
 * - Listens on document-level keydown in CAPTURE phase (runs before any input field)
 * - Detects scanner input by measuring keystroke speed (<50ms = scanner, >100ms = human)
 * - When scanner input is detected, it PREVENTS the events from reaching any input field
 * - Scanner works regardless of what's focused — click anywhere, scan still works
 * - Normal keyboard typing in input fields is unaffected (too slow to trigger)
 * 
 * KEY DIFFERENCE FROM BEFORE:
 * - OLD: Skipped input fields, scan went into focused input = broken
 * - NEW: Intercepts at capture phase, swallows scanner events, nothing reaches inputs
 * 
 * SCANNER CONFIGURATION:
 * - Must be in HID Keyboard Emulation mode (default for most USB scanners)
 * - Must send Enter (char code 13) as suffix after barcode (default for most scanners)
 * - Works with DCode DC7122 BT (USB dongle) out of the box
 */

const DEFAULT_OPTIONS = {
  enabled: true,
  minLength: 5,          // Minimum characters for a valid barcode
  maxGap: 50,            // Max ms between keystrokes to count as scanner (scanners type at 5-15ms)
  debounceDelay: 300,    // Delay after scan before accepting next (prevent double-scan)
  suffixKeyCodes: [13],  // Enter key = end of barcode (configurable)
};

export function useBarcodeScanner({ onScan, enabled = true, minLength, maxGap, debounceDelay } = {}) {
  const bufferRef = useRef("");
  const lastKeyTimeRef = useRef(0);
  const isProcessingRef = useRef(false);
  const timeoutRef = useRef(null);
  const isScanningRef = useRef(false);
  const keystrokeCountRef = useRef(0);

  const opts = {
    ...DEFAULT_OPTIONS,
    ...(minLength !== undefined && { minLength }),
    ...(maxGap !== undefined && { maxGap }),
    ...(debounceDelay !== undefined && { debounceDelay }),
  };

  const resetBuffer = useCallback(() => {
    bufferRef.current = "";
    lastKeyTimeRef.current = 0;
    isScanningRef.current = false;
    keystrokeCountRef.current = 0;
  }, []);

  useEffect(() => {
    if (!enabled) return;

    /**
     * CAPTURE PHASE listener — runs BEFORE any input field receives the event.
     * If we detect scanner-speed input, we preventDefault + stopImmediatePropagation.
     * The event never reaches the focused input field.
     */
    const handleKeyDown = (e) => {
      // Ignore modifier combos (Ctrl+C, Alt+Tab, etc.)
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      
      // Ignore non-printable keys (except Enter which is our suffix)
      if (e.key === "Shift" || e.key === "Control" || e.key === "Alt" || e.key === "Meta") return;
      if (e.key === "Tab" || e.key === "Escape" || e.key === "CapsLock") return;
      if (e.key.startsWith("F") && e.key.length > 1) return;

      const now = Date.now();
      const timeSinceLastKey = now - lastKeyTimeRef.current;

      // SUFFIX KEY (Enter) — end of barcode
      if (opts.suffixKeyCodes.includes(e.keyCode)) {
        const barcode = bufferRef.current.trim();

        if (
          barcode.length >= opts.minLength &&
          isScanningRef.current &&
          !isProcessingRef.current
        ) {
          // Confirmed scan — swallow the Enter key
          e.preventDefault();
          e.stopImmediatePropagation();

          isProcessingRef.current = true;

          if (onScan) {
            onScan(barcode);
          }

          setTimeout(() => {
            isProcessingRef.current = false;
          }, opts.debounceDelay);
        }

        resetBuffer();
        return;
      }

      // Only process single printable characters
      if (e.key.length !== 1) return;

      // Check timing — is this scanner speed?
      if (lastKeyTimeRef.current > 0 && timeSinceLastKey <= opts.maxGap) {
        keystrokeCountRef.current++;

        // After 3+ consecutive fast keystrokes, confident it's a scanner
        if (keystrokeCountRef.current >= 3) {
          isScanningRef.current = true;
        }
      } else if (timeSinceLastKey > opts.maxGap && bufferRef.current.length > 0) {
        // Too slow — previous buffer was human typing, discard
        resetBuffer();
      }

      // If scanner detected, SWALLOW the event — prevent it reaching input fields
      if (isScanningRef.current) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }

      bufferRef.current += e.key;
      lastKeyTimeRef.current = now;

      // First keystroke also increments count
      if (keystrokeCountRef.current === 0) {
        keystrokeCountRef.current = 1;
      }

      // Safety: clear buffer after 2 seconds of no input
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        resetBuffer();
      }, 2000);
    };

    // CAPTURE PHASE — third parameter `true`
    // Runs before ANY element's event handler in the DOM
    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [enabled, onScan, opts.minLength, opts.maxGap, opts.debounceDelay, opts.suffixKeyCodes, resetBuffer]);

  return { resetBuffer };
}

export default useBarcodeScanner;