import React, { useEffect, useRef, useState } from "react";

// ============================================================
// Stock Room — the building blocks of the product form, matching the
// prototype's form: section headings, searchable dropdowns (with colour dots
// and "+ Create"), chip multi-selects with Select All, and the Yes/No switch.
// ============================================================

/** A form section: serif gold title with an optional note beside it. */
export function FormSection({ title, note }) {
  return (
    <div className="sr-fsec">
      <span className="sr-fsec-t">{title}</span>
      {note && <span className="sr-fsec-n">{note}</span>}
    </div>
  );
}

/** A labelled field. `actions` sit at the right of the label row. */
export function PField({ label, htmlFor, help, helpTone, actions, children, className = "" }) {
  return (
    <div className={`sr-pfield ${className}`}>
      {(label || actions) && (
        <div className="sr-pfield-head">
          {label && <label htmlFor={htmlFor}>{label}</label>}
          {actions && <div className="sr-pfield-acts">{actions}</div>}
        </div>
      )}
      {children}
      {help && <div className={`sr-help${helpTone ? ` is-${helpTone}` : ""}`}>{help}</div>}
    </div>
  );
}

/** Fields side by side: two per row, or three with `three`. One per row on narrow screens. */
export function FieldRow({ three = false, children }) {
  return <div className={`sr-frow${three ? " is-3" : ""}`}>{children}</div>;
}

export function ColourDot({ hex }) {
  return <i className={`sr-cdot${hex ? "" : " is-multi"}`} style={hex ? { background: hex } : undefined} aria-hidden="true" />;
}

/**
 * Searchable dropdown. options: [{ value, label, hex?, disabled? }].
 * `hex` present (even null) draws a colour dot. `createLabel` + `onCreate`
 * add a "+ Create …" row that receives the typed text.
 */
export function Combo({ id, options, value, onChange, placeholder = "Type to search", createLabel, onCreate, disabled = false, ariaLabel, clearOnPick = false }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const wrapRef = useRef(null);
  const listRef = useRef(null);
  const listId = useRef(`sr-pcombo-${Math.random().toString(36).slice(2, 9)}`).current;
  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    const item = listRef.current?.querySelector(".is-active");
    if (item) item.scrollIntoView({ block: "nearest" });
  }, [active]);

  const q = query.trim().toLowerCase();
  const filtered = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;

  const pick = (o) => {
    if (!o || o.disabled) return;
    onChange(o.value);
    setOpen(false);
    setQuery("");
  };

  const onKeyDown = (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) { setOpen(true); return; }
      setActive((i) => Math.max(0, Math.min(filtered.length - 1, i + (e.key === "ArrowDown" ? 1 : -1))));
    } else if (e.key === "Enter") {
      if (open) { e.preventDefault(); pick(filtered[active]); }
    } else if (e.key === "Escape" && open) {
      e.stopPropagation();
      setOpen(false);
    }
  };

  return (
    <div className="sr-combo" ref={wrapRef}>
      <input
        id={id}
        className="sr-input sr-combo-input"
        type="text"
        autoComplete="off"
        spellCheck={false}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={ariaLabel}
        disabled={disabled}
        value={open ? query : (!clearOnPick && selected ? selected.label : "")}
        placeholder={!clearOnPick && selected ? selected.label : placeholder}
        onFocus={(e) => { e.target.select(); setQuery(""); setActive(0); setOpen(true); }}
        onChange={(e) => { setQuery(e.target.value); setActive(0); setOpen(true); }}
        onKeyDown={onKeyDown}
      />
      {open && (
        <div className="sr-combo-list" role="listbox" id={listId} ref={listRef}>
          {createLabel && (
            <div className="sr-combo-create" onMouseDown={(e) => { e.preventDefault(); setOpen(false); onCreate(query.trim()); setQuery(""); }}>
              ＋ {createLabel}{query.trim() ? ` “${query.trim()}”` : ""}
            </div>
          )}
          {filtered.map((o, i) => (
            <div key={`${o.value}`} role="option" aria-selected={o.value === value}
              className={`sr-combo-item${i === active ? " is-active" : ""}${o.disabled ? " is-disabled" : ""}`}
              onMouseDown={(e) => { e.preventDefault(); pick(o); }}
              onMouseEnter={() => setActive(i)}>
              {o.hex !== undefined && <ColourDot hex={o.hex} />}
              {o.label}
            </div>
          ))}
          {!filtered.length && <div className="sr-combo-empty">No match</div>}
        </div>
      )}
    </div>
  );
}

/** Chips for the chosen values, a search box for the rest, and optional Select All / Clear All. */
export function MultiSelect({ id, label, options, values, onChange, selectAll = false, placeholder, createLabel, onCreate, help }) {
  const all = options.map((o) => o.value);
  const every = all.length > 0 && all.every((v) => values.includes(v));
  const remaining = options.filter((o) => !values.includes(o.value));
  const byValue = (v) => options.find((o) => o.value === v) || { value: v, label: String(v) };

  return (
    <PField label={label} htmlFor={id} help={help}
      actions={selectAll && all.length > 0 && (
        <button type="button" className="sr-linkbtn" onClick={() => onChange(every ? [] : all)}>{every ? "Clear All" : "Select All"}</button>
      )}>
      {values.length > 0 && (
        <div className="sr-chips">
          {values.map((v) => {
            const o = byValue(v);
            return (
              <span key={v} className="sr-chip">
                {o.hex !== undefined && <ColourDot hex={o.hex} />}
                {o.label}
                <button type="button" className="sr-chip-x" aria-label={`Remove ${o.label}`} onClick={() => onChange(values.filter((x) => x !== v))}>×</button>
              </span>
            );
          })}
        </div>
      )}
      <Combo id={id} options={remaining} value={undefined} clearOnPick placeholder={placeholder}
        createLabel={createLabel} onCreate={onCreate} onChange={(v) => onChange([...values, v])} />
    </PField>
  );
}

/** Yes / No switch. */
export function Switch({ on, onChange, label, disabled = false, title }) {
  return (
    <span className="sr-switch-row" title={title}>
      <button type="button" className={`sr-switch${on ? " is-on" : ""}`} aria-pressed={on} aria-label={label}
        disabled={disabled} onClick={() => onChange(!on)}>
        <span className="sr-switch-knob" />
      </button>
      <span className={`sr-switch-label${on ? " is-on" : ""}`}>{on ? "Yes" : "No"}</span>
    </span>
  );
}

/** Pill toggles (sizes for made to order). */
export function Pills({ options, values, onToggle }) {
  return (
    <div className="sr-swatches">
      {options.map((o) => (
        <button key={o} type="button" className={`sr-swatch${values.includes(o) ? " is-on" : ""}`} aria-pressed={values.includes(o)} onClick={() => onToggle(o)}>
          {o}
        </button>
      ))}
    </div>
  );
}

/** The grey hint above a stock form: what a location holds, size by size. */
export function StockHint({ title, chips }) {
  return (
    <div className="sr-stock-hint">
      <span className="sr-label">{title}</span>
      {chips.length ? (
        <div className="sr-sizechips" style={{ marginTop: 8 }}>
          {chips.map((c) => (
            <span key={c.label} className="sr-sizechip" style={c.qty ? undefined : { opacity: 0.5 }}>{c.label} <b>{c.qty}</b></span>
          ))}
        </div>
      ) : <div className="sr-help" style={{ marginTop: 6 }}>Nothing held here yet.</div>}
    </div>
  );
}

/** Choose a CSV file: click or drag. Shows the file once loaded, with replace and remove. */
export function DropZone({ file, onFile, onClear, rows, hint = "or drag it here · header row must match the export" }) {
  const inputRef = useRef(null);
  const [over, setOver] = useState(false);
  const [readError, setReadError] = useState("");
  const read = (f) => {
    if (!f) return;
    if (!/\.csv$/i.test(f.name) && f.type !== "text/csv") { setReadError(`“${f.name}” is not a .csv file.`); return; }
    const reader = new FileReader();
    reader.onload = () => { setReadError(""); onFile({ name: f.name, size: f.size, text: String(reader.result || "") }); };
    reader.onerror = () => setReadError(`Could not read “${f.name}”.`);
    reader.readAsText(f);
  };
  const choose = () => inputRef.current?.click();
  return (
    <>
      <input ref={inputRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => { read(e.target.files?.[0]); e.target.value = ""; }} />
      <div className={`sr-dropzone${over ? " is-over" : ""}${file ? " is-loaded" : ""}`}
        role={file ? undefined : "button"} tabIndex={file ? undefined : 0} aria-label={file ? undefined : "Choose a CSV file to import"}
        onClick={file ? undefined : choose}
        onKeyDown={file ? undefined : (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(); } }}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); read(e.dataTransfer.files?.[0]); }}>
        {file ? (
          <>
            <span className="sr-dz-info">
              <span className="sr-dz-name">{file.name}</span>
              <span className="sr-dz-meta">
                {rows != null ? `${rows} data row${rows === 1 ? "" : "s"}` : ""}{file.size ? ` · ${Math.max(1, Math.round(file.size / 1024))} KB` : ""}
              </span>
            </span>
            <button type="button" className="sr-rowbtn" onClick={choose}>Choose Different File</button>
            <button type="button" className="sr-rowbtn" onClick={onClear}>Remove</button>
          </>
        ) : (
          <>
            <span className="sr-dz-ico">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M12 15V3m0 0 4 4m-4-4-4 4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </span>
            <span className="sr-dz-title">Choose a CSV file</span>
            <span className="sr-dz-hint">{hint}</span>
          </>
        )}
      </div>
      {readError && <div className="sr-form-err">{readError}</div>}
    </>
  );
}
