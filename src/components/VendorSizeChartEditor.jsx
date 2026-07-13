import React from "react";
import { B2B_SIZE_OPTIONS, B2B_MEASUREMENT_KEYS, SIZE_CHART_US } from "../utils/b2bSizeChart";
import "./VendorSizeChartEditor.css";

/**
 * VendorSizeChartEditor — an editable grid of Size × Bust/Waist/Hip inputs.
 *
 * value:      the size_chart object (or null)
 * onChange:   (nextChart | null) => void
 * hideToggle: when true, always shows the grid with no on/off checkbox
 *             (used in the reusable Size-Chart library, where a chart is
 *             always "on"). When false/omitted, a checkbox turns the chart
 *             on/off — null when off (used inline on a form that may opt out).
 *
 * Rows are the exact B2B size list, so every size the order form can offer
 * always has a row here (the whole point of a shared size list).
 */
export default function VendorSizeChartEditor({ value, onChange, hideToggle = false }) {
    const enabled = hideToggle ? true : value != null;

    const setEnabled = (on) => {
        // On → start from an empty object (admin fills it, or clicks "Copy from
        // default"). Off → null, so the vendor falls back to the house chart.
        onChange(on ? {} : null);
    };

    const setCell = (size, key, raw) => {
        const next = { ...(value || {}) };
        const row = { ...(next[size] || {}) };
        if (raw === "") {
            delete row[key];
        } else {
            row[key] = Number(raw);
        }
        if (Object.keys(row).length === 0) {
            delete next[size];
        } else {
            next[size] = row;
        }
        onChange(next);
    };

    const copyFromDefault = () => {
        // Deep copy so later edits don't mutate the shared default constant.
        const copy = {};
        Object.entries(SIZE_CHART_US).forEach(([size, row]) => {
            copy[size] = { ...row };
        });
        onChange(copy);
    };

    return (
        <div className="vsc-wrap">
            {!hideToggle && (
                <label className="vsc-toggle">
                    <input
                        type="checkbox"
                        checked={enabled}
                        onChange={(e) => setEnabled(e.target.checked)}
                    />
                    <span>This vendor uses a custom size chart</span>
                </label>
            )}

            {enabled && (
                <div className="vsc-editor">
                    <div className="vsc-editor-head">
                        <p className="vsc-hint">
                            Measurements (inches) auto-fill on B2B orders for this vendor. Leave a
                            cell blank to skip it. Sizes left entirely blank fall back to the default.
                        </p>
                        <button type="button" className="vsc-copy-btn" onClick={copyFromDefault}>
                            Copy from default
                        </button>
                    </div>
                    <div className="vsc-grid-scroll">
                        <table className="vsc-grid">
                            <thead>
                                <tr>
                                    <th>Size</th>
                                    {B2B_MEASUREMENT_KEYS.map((k) => <th key={k}>{k}</th>)}
                                </tr>
                            </thead>
                            <tbody>
                                {B2B_SIZE_OPTIONS.map((size) => (
                                    <tr key={size}>
                                        <td className="vsc-size-cell">{size}</td>
                                        {B2B_MEASUREMENT_KEYS.map((k) => (
                                            <td key={k}>
                                                <input
                                                    type="number"
                                                    inputMode="decimal"
                                                    value={value?.[size]?.[k] ?? ""}
                                                    onChange={(e) => setCell(size, k, e.target.value)}
                                                />
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}
