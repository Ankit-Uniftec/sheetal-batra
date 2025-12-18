import React, { useEffect, useMemo, useRef, useState } from "react";
import "../screens/Screen4.css"; // Reusing the CSS from Screen4 for now

/**
 * Generic Searchable Select (no external libs)
 * - Keyboard: ↑/↓ to move, Enter to select, Esc to close
 * - Click outside closes menu
 * - Works with arrays of primitives or {label, value}
 */
export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = "Select…",
  disabled = false,
  className = "",
}) {
  const normalized = useMemo(() => {
    return (options || []).map((o) =>
      typeof o === "object" && o !== null && "label" in o && "value" in o
        ? o
        : { label: String(o), value: o }
    );
  }, [options]);

  const current = useMemo(
    () => normalized.find((o) => String(o.value) === String(value)) || null,
    [normalized, value]
  );

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [focusIdx, setFocusIdx] = useState(-1);
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return normalized;
    return normalized.filter((o) => o.label.toLowerCase().includes(q));
  }, [normalized, query]);

  useEffect(() => {
    const onDoc = (e) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target)) {
        setOpen(false);
        setFocusIdx(-1);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    if (!open || !listRef.current || focusIdx < 0) return;
    const el = listRef.current.querySelector(`[data-idx="${focusIdx}"]`);
    if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
  }, [focusIdx, open]);

  const handleSelect = (opt) => {
    onChange(opt?.value ?? "");
    setOpen(false);
    setQuery(opt?.label ?? ""); // Set query to the selected label
    setFocusIdx(-1);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const handleKeyDown = (e) => {
    if (!open && (e.key === "ArrowDown" || e.key === "Enter")) {
      setOpen(true);
      setFocusIdx(0);
      return;
    }
    if (!open) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusIdx((i) => Math.min((filtered.length || 1) - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const opt = filtered[focusIdx];
      if (opt) handleSelect(opt);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      setFocusIdx(-1);
    }
  };

  const clear = (e) => {
    e.stopPropagation();
    onChange("");
    setQuery(""); // Clear the query when clearing the selection
    inputRef.current?.focus();
  };

  return (
    <div ref={rootRef} className={`ss-root ${disabled ? "ss-disabled" : ""} ${className}`}>
      <div className={`ss-control ${open ? "ss-open" : ""}`} onClick={() => !disabled && setOpen((o) => !o)}>
        <input
          ref={inputRef}
          className="ss-input"
          placeholder={placeholder}
          value={open ? query : current?.label || ""}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!open) setOpen(true);
            setFocusIdx(0);
          }}
          onKeyDown={handleKeyDown}
          disabled={disabled}
        />
        {current && (
          <button className="ss-clear" title="Clear" onClick={clear}>
            ×
          </button>
        )}
        {/* <span className="ss-caret">▾</span> */}
      </div>

      {open && (
        <div className="ss-menu" role="listbox">
          {filtered.length === 0 ? (
            <div className="ss-empty">No matches</div>
          ) : (
            <ul ref={listRef} className="ss-list">
              {filtered.map((opt, idx) => {
                const selected = String(opt.value) === String(value);
                const focused = idx === focusIdx;
                return (
                  <li
                    key={String(opt.value)}
                    data-idx={idx}
                    className={`ss-option ${selected ? "is-selected" : ""} ${focused ? "is-focused" : ""}`}
                    onMouseEnter={() => setFocusIdx(idx)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handleSelect(opt)}
                    role="option"
                    aria-selected={selected}
                  >

                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {opt.hex && (
                        <span
                          style={{
                            width: 14,
                            height: 14,
                            borderRadius: "50%",
                            backgroundColor: opt.hex,
                            border: "1px solid #ccc",
                          }}
                        />
                      )}
                      {opt.label}
                    </div>

                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
