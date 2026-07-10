import React, { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { usePopup } from "../components/Popup";
import { supabase } from "../lib/supabaseClient";
import { useBarcodeScanner } from "../hooks/useBarcodeScanner";
import {
    advanceComponentStage,
    activateComponents,
    recordQcResult,
    securityGuardScan,
    verifyPackagingComponents,
    fetchOrderComponents,
    fetchComponentByBarcode,
    fetchTransitionHistory,
    fetchMovementHistory,
    enrichComponentsWithMovements,
    describeTransition,
    getStagesOutsideLabel,
    PRODUCTION_STAGES,
    SCAN_STATIONS,
    REJOURNEY_STAGES,
    getStageLabel,
    getStageColor,
    getStageTextColor,
    fetchApprovedVendors,
    getConfiguredMovement,
} from "../utils/barcodeService";
import ScanKindTag from "./ScanKindTag";

// Replace raw stage tokens (e.g. "embroidery_in_progress") with friendly
// labels (e.g. "Embroidery In-Progress") so RPC error messages read
// naturally. Sort longest-first so a shorter value (e.g. "embroidery")
// doesn't shadow a longer one (e.g. "embroidery_in_progress").
const prettifyStageMessage = (msg) => {
    if (!msg) return msg;
    let out = String(msg);
    const stages = [...PRODUCTION_STAGES].sort((a, b) => b.value.length - a.value.length);
    for (const s of stages) {
        if (out.includes(s.value)) {
            out = out.split(s.value).join(s.label);
        }
    }
    return out;
};

// Parse the current ("from") stage out of a raw RPC error message.
// Handles "Cannot move from X to Y", "from stage: X", etc.
const extractCurrentStageFromError = (rawMsg) => {
    if (!rawMsg) return null;
    const s = String(rawMsg);
    const fromToMatch = s.match(/from\s+([a-z][a-z_]*)\s+to\s+/i);
    if (fromToMatch) return fromToMatch[1];
    const fromStageMatch = s.match(/from\s+stage[:\s]+([a-z][a-z_]*)/i);
    if (fromStageMatch) return fromStageMatch[1];
    return null;
};

// Given a stage value (e.g. "dry_cleaning_completed"), return the next
// expected scan station in the workflow (skipping security_gate which has
// step=0 and is special). Returns null when the piece is at the very end.
const getNextStationAfterStage = (stageValue) => {
    if (!stageValue) return null;
    const cur = PRODUCTION_STAGES.find((s) => s.value === stageValue);
    if (!cur) return null;
    const nextStation = SCAN_STATIONS
        .filter((s) => s.step > cur.step && s.step > 0)
        .sort((a, b) => a.step - b.step)[0];
    return nextStation || null;
};

// Build a worker-friendly explanation from a raw RPC error string. Tells
// them where the piece currently is and where it should be scanned next.
// Falls back to the prettified raw message when we can't parse a stage.
const buildFriendlyScanError = (rawMsg, toStage) => {
    if (!rawMsg) return rawMsg;
    // Safety net: PostgREST's "Cannot coerce the result to a single JSON object"
    // (PGRST116) is raw jargon. It means the barcode lookup matched 0 rows (wrong
    // scan) or the retry exhausted on a transient hiccup. Show plain English.
    if (/coerce.*single json object/i.test(rawMsg) || /pgrst116/i.test(rawMsg)) {
        return "Couldn't read this barcode. Check the tag and scan again — if it keeps failing, report it to the Production Head.";
    }
    // toStage (optional): the stage the worker was TRYING to scan into. Lets us
    // tell the two very different "cannot move" cases apart.
    const fromStage = extractCurrentStageFromError(rawMsg);
    if (!fromStage) return prettifyStageMessage(rawMsg);

    const currentLabel = getStageLabel(fromStage) || fromStage.replace(/_/g, " ");
    const nextStation = getNextStationAfterStage(fromStage);
    const nextMsg = nextStation
        ? ` Next scan should happen at the ${nextStation.label} station.`
        : " It has passed the last production stage.";

    // Only Cloth Issue is mandatory now, and stages can be scanned in any
    // direction — so the one remaining "invalid transition" reason is that Cloth
    // Issue hasn't been completed yet. (The DB message already says this; keep a
    // clear fallback.)
    if (/cannot move from/i.test(rawMsg) || /cloth issue must be completed/i.test(rawMsg)) {
        return `This piece can't be scanned here until Cloth Issue is completed. Scan it at the Cloth Issue station first.`;
    }
    // Security gate error — piece is inside, trying to exit again
    if (/security|exit not valid/i.test(rawMsg)) {
        return `This piece is currently inside the warehouse at "${currentLabel}".` +
            ` Security Gate is only for sending pieces OUT to an external vendor.${nextMsg}`;
    }

    return prettifyStageMessage(rawMsg);
};

// ============================================================
// SCAN STATION COMPONENT
// ============================================================
/**
 * ScanStation
 *
 * @param {object} props
 * @param {string} props.currentUserEmail
 * @param {string[]} [props.allowedStations]
 *   Optional list of station `value`s this user is permitted to scan at.
 *   - If omitted/empty → all SCAN_STATIONS visible (legacy / admin use).
 *   - If exactly one → that station is auto-selected and the "Change Station"
 *     button is hidden (worker only has one assignment).
 *   - If more than one → the picker grid is filtered to those stations, and
 *     the worker can switch between them via the existing "Change Station"
 *     button.
 */
const ScanStation = ({ currentUserEmail, allowedStations }) => {
    const { showPopup, PopupComponent } = usePopup();

    // Resolve the visible station list.
    //   - prop omitted (undefined/null)  → show every station (legacy / unscoped use)
    //   - prop is an array (incl. empty) → strict filter to that list
    // An empty array therefore means "no stations assigned" and the picker
    // renders zero buttons + a help message, NOT a permissive fallback.
    const visibleStations = React.useMemo(() => {
        if (allowedStations === undefined || allowedStations === null) return SCAN_STATIONS;
        const allow = new Set(allowedStations);
        return SCAN_STATIONS.filter((s) => allow.has(s.value));
    }, [allowedStations]);

    // If the worker is assigned exactly one station, auto-select it so they
    // don't have to pick from a single-button grid every login.
    const autoSelectStation = visibleStations.length === 1 ? visibleStations[0].value : null;

    // Station selection — starts on auto-selected one when applicable
    const [selectedStation, setSelectedStation] = useState(autoSelectStation);

    // Scan state
    const [scanResult, setScanResult] = useState(null); // { success, data, error }
    const [scanHistory, setScanHistory] = useState([]);
    const [isProcessing, setIsProcessing] = useState(false);

    // Debounce: ignore the SAME barcode re-scanned within this window, so an
    // accidental double-tap can't immediately scan-out a stage it just
    // scanned-in. Tracks { barcode, ts } of the last accepted scan.
    const lastScanRef = useRef({ barcode: null, ts: 0 });
    const SCAN_DEBOUNCE_MS = 1000;

    // Component detail view
    const [selectedComponent, setSelectedComponent] = useState(null);
    const [componentHistory, setComponentHistory] = useState([]);
    const [componentMovements, setComponentMovements] = useState([]);
    const [orderComponents, setOrderComponents] = useState([]);

    // QC popup. `qcStage` distinguishes QC 1 ("qc1") from Final QC ("final").
    const [qcPopup, setQcPopup] = useState({
        isOpen: false,
        barcode: "",
        qcStage: "qc1",
        failReason: "",
        outcome: "",
        rejourneyStage: "",
        scrapLossAmount: "",
        notes: "",
    });

    // Security guard popup
    const [securityPopup, setSecurityPopup] = useState({
        isOpen: false,
        barcode: "",
        scanType: "exit",
        vendorName: "",
        vendorLocation: "",
    });

    // Approved vendors — for the Security Gate exit vendor dropdown.
    const [approvedVendors, setApprovedVendors] = useState([]);
    useEffect(() => {
        fetchApprovedVendors()
            .then((v) => setApprovedVendors(v || []))
            .catch((e) => console.error("Failed to load approved vendors:", e));
    }, []);

    // Activation popup (Step 2 — Production Head activates components)
    const [activationPopup, setActivationPopup] = useState({
        isOpen: false,
        orderId: null,
        orderNo: "",
        components: [],
        selectedIds: [],
    });

    // Packaging verification
    const [packagingPopup, setPackagingPopup] = useState({
        isOpen: false,
        orderId: null,
        orderNo: "",
        expectedCount: 0,
        scannedBarcodes: [],
    });

    // Stats
    const [todayStats, setTodayStats] = useState({ scanned: 0, passed: 0, failed: 0 });

    // Manual barcode input — hidden by default. Workers should be scanning;
    // the manual field is only for the occasional damaged-barcode case.
    const [manualBarcode, setManualBarcode] = useState("");
    const [showManualEntry, setShowManualEntry] = useState(false);

    // ============================================================
    // BARCODE SCANNER HOOK
    // ============================================================
    const handleScan = useCallback(async (barcode) => {
        if (isProcessing) return;
        if (!selectedStation) {
            setScanResult({
                success: false,
                error: "NO_STATION",
                message: "Please select a station first",
            });
            return;
        }

        // Debounce identical rapid scans (accidental double-tap). Same barcode
        // within SCAN_DEBOUNCE_MS is ignored so it can't in-then-out instantly.
        const now = Date.now();
        if (
            lastScanRef.current.barcode === barcode &&
            now - lastScanRef.current.ts < SCAN_DEBOUNCE_MS
        ) {
            return;
        }
        lastScanRef.current = { barcode, ts: now };

        setIsProcessing(true);
        setScanResult(null);
        // Hold the processing/loading state for a brief minimum so every scan
        // visibly registers (worker sees a ~1s loading) and double-taps don't
        // race through.
        const scanStartedAt = now;

        try {
            const station = SCAN_STATIONS.find(s => s.value === selectedStation);

            // Security gate has its own flow
            if (selectedStation === "security_gate") {
                const component = await fetchComponentByBarcode(barcode);
                const scanType = component.is_outside_wh ? "entry" : "exit";

                // 30-minute duplicate-scan guard: block a repeat exit (or entry)
                // within 30 min of the last one for this component, so an
                // accidental double-scan at the gate doesn't record twice.
                {
                    const txnType = scanType === "exit" ? "security_exit" : "security_entry";
                    const { data: lastScan } = await supabase
                        .from("stage_transitions")
                        .select("scanned_at")
                        .eq("component_id", component.id)
                        .eq("transition_type", txnType)
                        .order("scanned_at", { ascending: false })
                        .limit(1)
                        .maybeSingle();
                    if (lastScan?.scanned_at) {
                        const mins = Math.floor((Date.now() - new Date(lastScan.scanned_at).getTime()) / 60000);
                        if (mins < 30) {
                            showPopup({
                                title: scanType === "exit" ? "Exit Already Recorded" : "Entry Already Recorded",
                                message: `This component was scanned ${scanType === "exit" ? "out" : "in"} ${mins < 1 ? "just now" : `${mins} min${mins === 1 ? "" : "s"} ago`}. Please wait 30 minutes before scanning it ${scanType} again.`,
                                type: "warning",
                                confirmText: "OK",
                            });
                            setIsProcessing(false);
                            return;
                        }
                    }
                }

                // On EXIT, the vendor + return date are LOCKED to the movement
                // the Production Head approved — the guard does not choose. Read
                // that configured movement so the popup shows it read-only.
                let movement = null;
                if (scanType === "exit") {
                    movement = await getConfiguredMovement(component.id);
                }
                setSecurityPopup({
                    isOpen: true,
                    barcode,
                    scanType,
                    movement, // PH-approved { vendor_name, vendor_location, return_date } or null
                    vendorName: movement?.vendor_name || component.vendor_name || "",
                    vendorLocation: movement?.vendor_location || component.vendor_location || "",
                });
                setIsProcessing(false);
                return;
            }

            // QC stations — show pass/fail popup. There are two QC stations:
            //   "qc"       → QC 1 (after Embroidery)  → enters qc_in_progress
            //   "final_qc" → QC 2 (before Packaging)  → enters final_qc_in_progress
            // record_qc_result requires the component to already be at the
            // matching *_in_progress stage, so advance it there first if the
            // worker scanned a piece arriving from the prior stage. If it's
            // already in-progress (e.g. re-scan after dismissing the popup),
            // skip the advance.
            if (selectedStation === "qc" || selectedStation === "final_qc") {
                const isFinalQc = selectedStation === "final_qc";
                const entryStage = isFinalQc ? "final_qc_in_progress" : "qc_in_progress";
                const stationLabel = isFinalQc ? "Final QC" : "QC 1";
                let component = await fetchComponentByBarcode(barcode);

                if (component.current_stage !== entryStage) {
                    try {
                        const advRes = await advanceComponentStage(
                            barcode,
                            entryStage,
                            currentUserEmail,
                            stationLabel,
                            null,
                            "scan"
                        );
                        // The RPC reports a REJECTED move (e.g. the piece isn't
                        // eligible for QC yet) by returning { success: false }
                        // as DATA — it does NOT throw. We must honour that and
                        // stop, otherwise we'd optimistically show the piece at
                        // the QC stage it never actually entered (and open the
                        // QC popup on a piece still at, say, Order Received).
                        if (advRes && advRes.success === false) {
                            setScanResult({
                                success: false,
                                error: advRes.error || "QC_ENTRY_ERROR",
                                message: buildFriendlyScanError(advRes.message || "", entryStage),
                            });
                            setIsProcessing(false);
                            return;
                        }
                        // Refresh local copy so the popup sees the new stage
                        component = { ...component, current_stage: entryStage };
                    } catch (advanceErr) {
                        const rawMsg = advanceErr?.message || "";
                        setScanResult({
                            success: false,
                            error: "QC_ENTRY_ERROR",
                            message: buildFriendlyScanError(rawMsg, entryStage),
                        });
                        setIsProcessing(false);
                        return;
                    }
                }

                setSelectedComponent(component);
                setQcPopup({
                    isOpen: true,
                    barcode,
                    qcStage: isFinalQc ? "final" : "qc1",
                    failReason: "",
                    outcome: "",
                    rejourneyStage: "",
                    scrapLossAmount: "",
                    notes: "",
                });
                setIsProcessing(false);
                return;
            }

            // Packaging station — accumulate scans for verification
            if (selectedStation === "packaging") {
                const component = await fetchComponentByBarcode(barcode);

                if (!packagingPopup.isOpen) {
                    // First scan — open packaging popup
                    const allComponents = await fetchOrderComponents(component.order_id);
                    const activeCount = allComponents.filter(c => c.is_active && !["disposed", "scrapped"].includes(c.current_stage)).length;

                    setPackagingPopup({
                        isOpen: true,
                        orderId: component.order_id,
                        orderNo: component.order_no,
                        expectedCount: activeCount,
                        scannedBarcodes: [barcode],
                    });
                } else {
                    // Add to existing
                    if (!packagingPopup.scannedBarcodes.includes(barcode)) {
                        setPackagingPopup(prev => ({
                            ...prev,
                            scannedBarcodes: [...prev.scannedBarcodes, barcode],
                        }));
                    }
                }

                setScanResult({
                    success: true,
                    message: `Scanned ${barcode} for packaging`,
                    data: { barcode, component_type: component.component_type },
                });
                setIsProcessing(false);
                return;
            }

            // Cloth Issue station (Step 2) — Master order scan to activate components
            if (selectedStation === "cloth_issue") {
                // Check if this is a master barcode (no component suffix)
                const isMasterBarcode = !barcode.match(/-(TOP|BTM|DUP|EX\d+)$/i);

                if (isMasterBarcode) {
                    // Look up order by order_no pattern
                    const { data: orders } = await supabase
                        .from("orders")
                        .select("id, order_no")
                        .ilike("order_no", `%${barcode}%`)
                        .limit(1);

                    if (orders && orders.length > 0) {
                        const order = orders[0];
                        const components = await fetchOrderComponents(order.id);
                        const inactiveComponents = components.filter(c => !c.is_active);

                        if (inactiveComponents.length === 0) {
                            setScanResult({
                                success: false,
                                error: "ALL_ACTIVE",
                                message: "All components are already activated",
                            });
                        } else {
                            setActivationPopup({
                                isOpen: true,
                                orderId: order.id,
                                orderNo: order.order_no,
                                components: inactiveComponents,
                                selectedIds: inactiveComponents.map(c => c.id),
                            });
                        }
                    } else {
                        setScanResult({
                            success: false,
                            error: "ORDER_NOT_FOUND",
                            message: `No order found matching: ${barcode}`,
                        });
                    }
                    setIsProcessing(false);
                    return;
                }

                // If component barcode at cloth issue and not active, auto-open activation
                const component = await fetchComponentByBarcode(barcode);
                if (!component.is_active) {
                    const allComponents = await fetchOrderComponents(component.order_id);
                    const inactiveComponents = allComponents.filter(c => !c.is_active);

                    if (inactiveComponents.length > 0) {
                        setActivationPopup({
                            isOpen: true,
                            orderId: component.order_id,
                            orderNo: component.order_no,
                            components: inactiveComponents,
                            selectedIds: inactiveComponents.map(c => c.id),
                        });
                        setIsProcessing(false);
                        return;
                    }
                }
                // If already active, advance it
            }

            // Standard station scan — determine if this is scan IN or scan OUT
            let targetStage;
            try {
                const component = await fetchComponentByBarcode(barcode);

                if (component.current_stage === station.inStage && station.outStage) {
                    // Component is already at this station's in_progress → this is scan OUT (completed)
                    targetStage = station.outStage;
                } else {
                    // Component is arriving at this station → this is scan IN (in_progress)
                    targetStage = station.inStage;
                }
            } catch (err) {
                setScanResult({
                    success: false,
                    error: err.code || "FETCH_ERROR",
                    message: buildFriendlyScanError(err.message) || err.message || "Failed to look up component",
                });
                setIsProcessing(false);
                return;
            }

            // Auto-retry once on the PGRST116 "Cannot coerce ... single JSON object"
            // error — it's a transient server-side race (locks / trigger ordering
            // in the advance_component_stage RPC) and almost always succeeds on
            // a second attempt within a few hundred ms. Keeps workers from
            // seeing scary internal errors for what is effectively a network/
            // timing hiccup.
            const callAdvance = () => advanceComponentStage(
                barcode,
                targetStage,
                currentUserEmail,
                station.label,
                null,
                "scan"
            );
            let result;
            try {
                result = await callAdvance();
            } catch (firstErr) {
                const msg = firstErr?.message || "";
                const code = firstErr?.code || "";
                const isCoerceError = /coerce.*single JSON object/i.test(msg) || code === "PGRST116";
                if (!isCoerceError) throw firstErr;
                // brief pause + retry once
                await new Promise((r) => setTimeout(r, 350));
                result = await callAdvance();
            }

            if (result.success) {
                setScanResult({
                    success: true,
                    message: `${getStageLabel(result.from_stage)} → ${getStageLabel(result.to_stage)}`,
                    data: result,
                });

                // Update stats
                setTodayStats(prev => ({ ...prev, scanned: prev.scanned + 1 }));

                // Add to history
                setScanHistory(prev => [{
                    barcode: result.barcode,
                    orderNo: result.order_no,
                    componentType: result.component_type,
                    label: result.component_label,
                    fromStage: result.from_stage,
                    toStage: result.to_stage,
                    isOnTime: result.is_on_time,
                    timestamp: new Date().toLocaleTimeString(),
                    id: Date.now(),
                }, ...prev].slice(0, 50));

            } else {
                setScanResult({
                    success: false,
                    error: result.error,
                    message: buildFriendlyScanError(result.message, targetStage) || result.message,
                    data: result,
                });
            }
        } catch (err) {
            // Translate the PGRST116 message before the friendly-error helper
            // runs, so workers see actionable text even if the retry above
            // didn't recover.
            const rawMsg = err?.message || "";
            const isCoerceError = /coerce.*single JSON object/i.test(rawMsg) || err?.code === "PGRST116";
            setScanResult({
                success: false,
                error: isCoerceError ? "TRANSIENT_ERROR" : "SYSTEM_ERROR",
                message: isCoerceError
                    ? "Couldn't update this piece. Please scan again. If it keeps failing, contact your admin and share the barcode."
                    : rawMsg || "Something went wrong",
            });
        }

        // Enforce a brief minimum loading window (~1s) so every scan visibly
        // registers and rapid double-taps can't race through.
        const elapsed = Date.now() - scanStartedAt;
        if (elapsed < SCAN_DEBOUNCE_MS) {
            await new Promise((r) => setTimeout(r, SCAN_DEBOUNCE_MS - elapsed));
        }
        setIsProcessing(false);
    }, [selectedStation, isProcessing, currentUserEmail, packagingPopup]);

    const { resetBuffer } = useBarcodeScanner({
        onScan: (barcode) => {
            setManualBarcode("");  // Clear input after scanner captures
            handleScan(barcode);
        },
        enabled: !!selectedStation,
    });

    // ============================================================
    // QC SUBMIT
    // ============================================================
    const handleQcSubmit = async () => {
        if (!qcPopup.barcode) return;

        // For fail: require reason and outcome
        if (qcPopup.outcome === "" && qcPopup.failReason === "") {
            // It's a pass
            setIsProcessing(true);
            try {
                const result = await recordQcResult({
                    barcode: qcPopup.barcode,
                    result: "pass",
                    inspectedBy: currentUserEmail,
                    whichQc: qcPopup.qcStage || "qc1",
                });

                if (result.success) {
                    setScanResult({
                        success: true,
                        message: `QC PASSED — ${qcPopup.barcode}`,
                        data: result,
                    });
                    setTodayStats(prev => ({ ...prev, scanned: prev.scanned + 1, passed: prev.passed + 1 }));
                } else {
                    setScanResult({ success: false, error: result.error, message: result.message });
                }
            } catch (err) {
                setScanResult({ success: false, error: "QC_ERROR", message: buildFriendlyScanError(err.message) || err.message });
            }
            setQcPopup(prev => ({ ...prev, isOpen: false }));
            setIsProcessing(false);
            return;
        }

        // Fail submission
        if (!qcPopup.failReason.trim()) {
            showPopup({ title: "Required", message: "Please enter a fail reason", type: "warning", confirmText: "OK" });
            return;
        }
        if (!qcPopup.outcome) {
            showPopup({ title: "Required", message: "Please select an outcome (Dispose / Scrap / Re-journey)", type: "warning", confirmText: "OK" });
            return;
        }
        if (qcPopup.outcome === "rejourney" && !qcPopup.rejourneyStage) {
            showPopup({ title: "Required", message: "Please select which stage to restart from", type: "warning", confirmText: "OK" });
            return;
        }

        setIsProcessing(true);
        try {
            const result = await recordQcResult({
                barcode: qcPopup.barcode,
                result: "fail",
                inspectedBy: currentUserEmail,
                whichQc: qcPopup.qcStage || "qc1",
                failReason: qcPopup.failReason,
                outcome: qcPopup.outcome,
                rejourneyToStage: qcPopup.rejourneyStage || null,
                scrapLossAmount: Number(qcPopup.scrapLossAmount) || 0,
                notes: qcPopup.notes,
            });

            if (result.success) {
                const msg = qcPopup.outcome === "rejourney"
                    ? `QC FAILED — Re-journey to ${getStageLabel(qcPopup.rejourneyStage)}`
                    : `QC FAILED — ${qcPopup.outcome.toUpperCase()}`;

                setScanResult({
                    success: false,
                    error: "QC_FAIL",
                    message: msg,
                    data: result,
                });

                if (result.alert_manish) {
                    showPopup({
                        title: "Re-journey Alert",
                        message: "This component has failed QC 3+ times. Manish Batra has been notified.",
                        type: "warning",
                        confirmText: "OK",
                    });
                }

                // QC-fail notifications. Rule: EVERY QC fail alerts the
                // Production Head (per order source) + Production Manager +
                // Manish (COO). Urgent orders are highlighted separately.
                // Re-journey additionally notifies the SA who placed the order.
                try {
                    const { sendNotification, NOTIFICATION_TYPES } = await import("../utils/notificationService");
                    const comp = await fetchComponentByBarcode(qcPopup.barcode);
                    const saEmail = comp?.orders?.salesperson_email || comp?.orders?.salesperson;

                    // Resolve the order's source-specific Production Head email.
                    let headEmail = null;
                    try {
                        const { data: he } = await supabase.rpc("get_production_head_email", { p_order_id: comp.order_id });
                        headEmail = he || null;
                    } catch (e) { /* map not deployed yet — fall back to map designations */ }

                    const extra = [];
                    if (headEmail) extra.push({ email: headEmail.toLowerCase(), channel: "in_app" });
                    if (saEmail) extra.push({ email: saEmail.toLowerCase(), channel: "in_app" });

                    // 1) Always: QC fail alert to PH + PM + Manish (+ SA)
                    await sendNotification(NOTIFICATION_TYPES.QC_FAIL_ALERT, {
                        orderId: comp.order_id,
                        orderNo: comp.order_no,
                        metadata: {
                            barcode: qcPopup.barcode,
                            which_qc: qcPopup.qcStage || "qc1",
                            component_label: selectedComponent?.component_label || selectedComponent?.component_type,
                            outcome: qcPopup.outcome,
                            fail_reason: qcPopup.failReason,
                            is_urgent: !!result.is_urgent,
                        },
                        extraRecipients: extra,
                    });

                    // 2) Re-journey only: SA-facing re-journey alert. The
                    //    source-specific Production Head + SA are passed as
                    //    extraRecipients (the map no longer hardcodes a head).
                    if (qcPopup.outcome === "rejourney" || qcPopup.outcome === "rework") {
                        await sendNotification(NOTIFICATION_TYPES.REJOURNEY_ALERT, {
                            orderId: comp.order_id,
                            orderNo: comp.order_no,
                            metadata: {
                                barcode: qcPopup.barcode,
                                component_label: selectedComponent?.component_label || selectedComponent?.component_type,
                                rejourney_stage: getStageLabel(qcPopup.rejourneyStage),
                                fail_reason: qcPopup.failReason,
                                rejourney_count: result.rejourney_count,
                            },
                            extraRecipients: extra,  // source-resolved head + SA
                        });
                    }
                } catch (notifErr) {
                    console.error("QC-fail notification failed:", notifErr);
                }

                setTodayStats(prev => ({ ...prev, scanned: prev.scanned + 1, failed: prev.failed + 1 }));
            } else {
                setScanResult({ success: false, error: result.error, message: result.message });
            }
        } catch (err) {
            setScanResult({ success: false, error: "QC_ERROR", message: buildFriendlyScanError(err.message) || err.message });
        }

        setQcPopup(prev => ({ ...prev, isOpen: false }));
        setIsProcessing(false);
    };

    // ============================================================
    // SECURITY GUARD SUBMIT
    // ============================================================
    const handleSecuritySubmit = async () => {
        if (!securityPopup.barcode) return;

        // Exit requires a Production-Head-configured movement. The guard cannot
        // pick the vendor — it's taken from that approved record (server-side
        // too). Block exit if no movement is configured.
        if (securityPopup.scanType === "exit" && !securityPopup.movement) {
            showPopup({ title: "Not configured", message: "The Production Head must configure the external movement (vendor + return date) before this component can be sent out.", type: "warning", confirmText: "OK" });
            return;
        }

        setIsProcessing(true);
        try {
            // Vendor/location are intentionally NOT sent for exit — the RPC uses
            // the approved external_movements record. (Passed only as a harmless
            // hint; the server ignores them on exit.)
            const result = await securityGuardScan({
                barcode: securityPopup.barcode,
                scanType: securityPopup.scanType,
                scannedBy: currentUserEmail,
                vendorName: securityPopup.movement?.vendor_name || securityPopup.vendorName,
                vendorLocation: securityPopup.movement?.vendor_location || securityPopup.vendorLocation,
            });

            if (result.success) {
                setScanResult({
                    success: true,
                    message: securityPopup.scanType === "exit"
                        ? `Sent to vendor: ${securityPopup.vendorName}`
                        : `Returned from vendor — now at ${getStageLabel(result.new_stage)}`,
                    data: result,
                });
            } else {
                setScanResult({ success: false, error: result.error, message: result.message });
            }
        } catch (err) {
            setScanResult({ success: false, error: "SECURITY_ERROR", message: buildFriendlyScanError(err.message) || err.message });
        }

        setSecurityPopup(prev => ({ ...prev, isOpen: false }));
        setIsProcessing(false);
    };

    // ============================================================
    // ACTIVATION SUBMIT (Step 2)
    // ============================================================
    const handleActivationSubmit = async () => {
        if (activationPopup.selectedIds.length === 0) {
            showPopup({ title: "Required", message: "Please select at least one component to activate", type: "warning", confirmText: "OK" });
            return;
        }

        setIsProcessing(true);
        try {
            const result = await activateComponents(
                activationPopup.selectedIds,
                currentUserEmail
            );

            if (result.success) {
                setScanResult({
                    success: true,
                    message: `Activated ${result.activated_count} components for ${activationPopup.orderNo}`,
                    data: result,
                });
            } else {
                setScanResult({ success: false, error: "ACTIVATION_ERROR", message: "Activation failed" });
            }
        } catch (err) {
            setScanResult({ success: false, error: "ACTIVATION_ERROR", message: buildFriendlyScanError(err.message) || err.message });
        }

        setActivationPopup(prev => ({ ...prev, isOpen: false }));
        setIsProcessing(false);
    };

    // ============================================================
    // PACKAGING VERIFICATION
    // ============================================================
    const handlePackagingVerify = async () => {
        setIsProcessing(true);
        try {
            const result = await verifyPackagingComponents(
                packagingPopup.orderId,
                packagingPopup.scannedBarcodes
            );

            if (result.success) {
                // All verified — advance each component through packaging_dispatch
                // and on to dispatched. Once every active component is dispatched,
                // the sync_order_warehouse_stage trigger auto-completes the order
                // (SA sees "Order Ready & Dispatched"). V2 Stage 10.
                for (const barcode of packagingPopup.scannedBarcodes) {
                    // Step into Packaging & Dispatch (records the packaging step)
                    await advanceComponentStage(
                        barcode,
                        "packaging_dispatch",
                        currentUserEmail,
                        "Packaging Station",
                        "Packaging verified",
                        "scan"
                    );
                    // Then dispatch it (completes the journey)
                    await advanceComponentStage(
                        barcode,
                        "dispatched",
                        currentUserEmail,
                        "Packaging Station",
                        "Dispatched",
                        "scan"
                    );
                }

                setScanResult({
                    success: true,
                    message: `All ${result.verified_count} components dispatched — order complete!`,
                    data: result,
                });
            } else {
                // Build a detailed mismatch message (Additional Rule 3): for a
                // WRONG/extra barcode, show which order+component it belongs to
                // and its last location; for MISSING expected components, show
                // their last recorded stage/location.
                let detailMsg = result.message || "Scanned components do not match order";
                const extras = Array.isArray(result.extra_details) ? result.extra_details : [];
                const missing = Array.isArray(result.missing_details) ? result.missing_details : [];

                if (extras.length > 0) {
                    detailMsg += "\n\nWrong item(s) scanned:";
                    extras.forEach((e) => {
                        detailMsg += `\n• ${e.barcode} belongs to order ${e.belongs_to_order_no || "UNKNOWN"}` +
                            (e.component_label ? ` (${e.component_label})` : "") +
                            (e.current_stage ? ` — currently at ${getStageLabel(e.current_stage)}` : "") +
                            (e.location ? `, ${e.location}` : "");
                    });
                }
                if (missing.length > 0) {
                    detailMsg += "\n\nNot yet scanned (expected for this order):";
                    missing.forEach((m) => {
                        detailMsg += `\n• ${m.barcode}` + (m.component_label ? ` (${m.component_label})` : "") +
                            (m.last_stage ? ` — last at ${getStageLabel(m.last_stage)}` : "") +
                            (m.location ? `, ${m.location}` : "");
                    });
                }

                setScanResult({
                    success: false,
                    error: result.error,
                    message: detailMsg,
                    data: result,
                });
            }
        } catch (err) {
            setScanResult({ success: false, error: "PACKAGING_ERROR", message: buildFriendlyScanError(err.message) || err.message });
        }

        setPackagingPopup(prev => ({ ...prev, isOpen: false, scannedBarcodes: [] }));
        setIsProcessing(false);
    };

    // ============================================================
    // VIEW COMPONENT DETAIL
    // ============================================================
    const handleViewComponent = async (barcode) => {
        try {
            const component = await fetchComponentByBarcode(barcode);
            // Attach stages_outside so the badge reads "Out to Vendor (Embroidery)".
            const [enrichedComp] = await enrichComponentsWithMovements([component]);
            setSelectedComponent(enrichedComp || component);

            const history = await fetchTransitionHistory(component.id);
            setComponentHistory(history);

            // Vendor trips — lets the timeline name the stage each security
            // exit/entry was for ("Sent to Vendor (Dyeing)").
            setComponentMovements(await fetchMovementHistory(component.id));

            const allComponents = await fetchOrderComponents(component.order_id);
            setOrderComponents(await enrichComponentsWithMovements(allComponents));
        } catch (err) {
            console.error("Failed to fetch component detail:", err);
        }
    };

    // ============================================================
    // MANUAL BARCODE SUBMIT
    // ============================================================
    const handleManualSubmit = (e) => {
        e.preventDefault();
        if (manualBarcode.trim()) {
            handleScan(manualBarcode.trim().toUpperCase());
            setManualBarcode("");
        }
    };

    // ============================================================
    // RENDER
    // ============================================================
    return (
        <div className="wd-scan-station">
            {PopupComponent}
            {/* Station Selector */}
            {!selectedStation ? (
                <div className="wd-station-selector">
                    <h2 className="wd-scan-title">Select Your Station</h2>
                    <p className="wd-scan-subtitle">
                        {visibleStations.length === 0
                            ? "You do not have any stations assigned. Please contact your admin."
                            : "Choose the station you are working at today"}
                    </p>
                    <div className="wd-station-grid">
                        {visibleStations.map(station => (
                            <button
                                key={station.value}
                                className="wd-station-btn"
                                onClick={() => setSelectedStation(station.value)}
                            >
                                <span className="wd-station-name">{station.label}</span>
                            </button>
                        ))}
                    </div>
                </div>
            ) : (
                <>
                    {/* Active Station Header */}
                    <div className="wd-scan-header">
                        <div className="wd-scan-header-left">
                            {/* Hide "Change Station" if the worker is locked
                                to a single station (or if they have none \u2014 should
                                never reach here in that case, but guard anyway). */}
                            {visibleStations.length > 1 && (
                                <button
                                    className="wd-scan-back-btn"
                                    onClick={() => {
                                        setSelectedStation(null);
                                        setScanResult(null);
                                        setSelectedComponent(null);
                                    }}
                                >
                                    {'\u2190'} Change Station
                                </button>
                            )}
                            <h2 className="wd-scan-title">
                                {SCAN_STATIONS.find(s => s.value === selectedStation)?.label}
                            </h2>
                        </div>
                        <div className="wd-scan-stats">
                            <span className="wd-stat-pill">Scanned: {todayStats.scanned}</span>
                            {selectedStation === "qc" && (
                                <>
                                    <span className="wd-stat-pill wd-stat-pass">Passed: {todayStats.passed}</span>
                                    <span className="wd-stat-pill wd-stat-fail">Failed: {todayStats.failed}</span>
                                </>
                            )}
                        </div>
                    </div>

                    {/* Manual Entry — hidden by default. Most stations should
                        scan via the connected hardware (captured by useBarcodeScanner).
                        The button below reveals a text input for manually typing a
                        barcode (e.g. when a label is damaged). */}
                    {!showManualEntry ? (
                        <div className="wd-manual-toggle-row">
                            <button
                                type="button"
                                className="wd-manual-toggle-btn"
                                onClick={() => setShowManualEntry(true)}
                            >
                                ⌨ Manual Entry
                            </button>
                        </div>
                    ) : (
                        <form className="wd-manual-input" onSubmit={handleManualSubmit}>
                            <input
                                type="text"
                                value={manualBarcode}
                                onChange={(e) => setManualBarcode(e.target.value)}
                                placeholder="Type barcode and press Submit..."
                                className="wd-manual-field"
                                data-barcode-passthrough=""
                                autoFocus
                            />
                            <button type="submit" className="wd-manual-btn" disabled={isProcessing}>
                                {isProcessing ? "Processing..." : "Submit"}
                            </button>
                            <button
                                type="button"
                                className="wd-manual-cancel-btn"
                                onClick={() => { setShowManualEntry(false); setManualBarcode(""); }}
                                title="Hide manual entry"
                            >
                                ✕
                            </button>
                        </form>
                    )}

                    {/* Scan Result Display */}
                    {scanResult && (
                        <div className={`wd-scan-result ${scanResult.success ? "wd-scan-success" : "wd-scan-error"}`}>
                            <div className="wd-scan-result-icon">
                                {scanResult.success ? "\u2713" : "\u2717"}
                            </div>
                            <div className="wd-scan-result-body">
                                <p className="wd-scan-result-msg" style={{ whiteSpace: "pre-line" }}>
                                    {scanResult.success
                                        ? prettifyStageMessage(scanResult.message)
                                        : scanResult.error === "COMPONENT_MISMATCH"
                                            // Already a detailed, multi-line mismatch message — show as-is.
                                            ? scanResult.message
                                            : buildFriendlyScanError(scanResult.message)}
                                </p>
                                {scanResult.data?.barcode && (
                                    <p className="wd-scan-result-barcode">{scanResult.data.barcode}</p>
                                )}
                                {scanResult.data?.component_label && (
                                    <p className="wd-scan-result-label">{scanResult.data.component_label} ({scanResult.data.component_type})</p>
                                )}
                                {/* is_on_time=false means the piece exceeded the SLA of the
                                    stage it was IN before this scan \u2014 i.e. it reached this
                                    stage later than allowed. Word it that way (the previous
                                    stage ran over), not "this stage is overdue". */}
                                {scanResult.data?.is_on_time === false && (
                                    <p className="wd-scan-result-delay">{'\u26A0'} Reached this stage late {'\u2014'} the previous stage ran over its time limit</p>
                                )}
                            </div>
                            {scanResult.data?.barcode && (
                                <button
                                    className="wd-scan-detail-btn"
                                    onClick={() => handleViewComponent(scanResult.data.barcode)}
                                >
                                    View Details
                                </button>
                            )}
                        </div>
                    )}

                    {/* Waiting for scan indicator */}
                    {!scanResult && !isProcessing && (
                        <div className="wd-scan-waiting">
                            <div className="wd-scan-pulse" />
                            <p className="wd-scan-waiting-text">Waiting for scan...</p>
                            <p className="wd-scan-waiting-hint">Point scanner at barcode or type above</p>
                        </div>
                    )}

                    {isProcessing && (
                        <div className="wd-scan-waiting">
                            <div className="wd-scan-spinner" />
                            <p className="wd-scan-waiting-text">Processing...</p>
                        </div>
                    )}

                    {/* Scan History */}
                    {scanHistory.length > 0 && (
                        <div className="wd-scan-history">
                            <h3 className="wd-scan-history-title">Recent Scans ({scanHistory.length})</h3>
                            <div className="wd-scan-history-list">
                                {scanHistory.map(scan => (
                                    <div
                                        key={scan.id}
                                        className={`wd-scan-history-item ${scan.isOnTime === false ? "wd-delayed" : ""}`}
                                        onClick={() => handleViewComponent(scan.barcode)}
                                    >
                                        <div className="wd-scan-history-left">
                                            <span className="wd-scan-history-barcode">{scan.barcode}</span>
                                            <span className="wd-scan-history-info">
                                                {scan.orderNo} {'\u2022'} {scan.label || scan.componentType}
                                            </span>
                                        </div>
                                        <div className="wd-scan-history-right">
                                            <span
                                                className="wd-scan-history-stage"
                                                style={{ backgroundColor: getStageColor(scan.toStage), color: getStageTextColor(scan.toStage) }}
                                            >
                                                {getStageLabel(scan.toStage)}
                                            </span>
                                            <span className="wd-scan-history-time">{scan.timestamp}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </>
            )}

            {/* ============================================================ */}
            {/* COMPONENT DETAIL MODAL */}
            {/* ============================================================ */}
            {selectedComponent && !qcPopup.isOpen && (
                <div className="wd-modal-overlay" onClick={() => setSelectedComponent(null)}>
                    <div className="wd-modal" onClick={e => e.stopPropagation()}>
                        <button className="wd-modal-close" onClick={() => setSelectedComponent(null)}>{'\u2715'}</button>
                        <h3 className="wd-modal-title">Component Detail</h3>

                        <div className="wd-detail-grid">
                            <div className="wd-detail-item">
                                <span className="wd-detail-label">Barcode</span>
                                <span className="wd-detail-value wd-mono">{selectedComponent.barcode}</span>
                            </div>
                            <div className="wd-detail-item">
                                <span className="wd-detail-label">Order</span>
                                <span className="wd-detail-value">{selectedComponent.order_no}</span>
                            </div>
                            <div className="wd-detail-item">
                                <span className="wd-detail-label">Type</span>
                                <span className="wd-detail-value">{selectedComponent.component_label || selectedComponent.component_type}</span>
                            </div>
                            <div className="wd-detail-item">
                                <span className="wd-detail-label">Current Stage</span>
                                {selectedComponent.is_outside_wh ? (
                                    <span className="wd-stage-badge" style={{ backgroundColor: "#e0913f", color: "#fff" }}>
                                        {getStagesOutsideLabel(selectedComponent.stages_outside)
                                            ? `Out to Vendor (${getStagesOutsideLabel(selectedComponent.stages_outside)})`
                                            : "Out to Vendor"}
                                    </span>
                                ) : (
                                    <span
                                        className="wd-stage-badge"
                                        style={{ backgroundColor: getStageColor(selectedComponent.current_stage), color: getStageTextColor(selectedComponent.current_stage) }}
                                    >
                                        {getStageLabel(selectedComponent.current_stage)}
                                    </span>
                                )}
                            </div>
                            <div className="wd-detail-item">
                                <span className="wd-detail-label">Active</span>
                                <span className="wd-detail-value">{selectedComponent.is_active ? "Yes" : "No"}</span>
                            </div>
                            <div className="wd-detail-item">
                                <span className="wd-detail-label">QC Status</span>
                                <span className="wd-detail-value">{selectedComponent.qc_status}</span>
                            </div>
                            {selectedComponent.is_delayed && (
                                <div className="wd-detail-item">
                                    <span className="wd-detail-label">Delayed</span>
                                    <span className="wd-detail-value wd-text-red">{selectedComponent.delay_days} days overdue</span>
                                </div>
                            )}
                            {selectedComponent.is_outside_wh && (
                                <div className="wd-detail-item">
                                    <span className="wd-detail-label">Location</span>
                                    <span className="wd-detail-value wd-text-orange">At vendor: {selectedComponent.vendor_name}</span>
                                </div>
                            )}
                            {selectedComponent.re_journey_count > 0 && (
                                <div className="wd-detail-item">
                                    <span className="wd-detail-label">Re-journeys</span>
                                    <span className="wd-detail-value wd-text-red">{selectedComponent.re_journey_count}</span>
                                </div>
                            )}
                        </div>

                        {/* Order Info */}
                        {selectedComponent.orders && (
                            <div className="wd-detail-order-info">
                                <p><strong>Client:</strong> {selectedComponent.orders.delivery_name}</p>
                                <p><strong>Delivery:</strong> {selectedComponent.orders.delivery_date}</p>
                                <p><strong>SA:</strong> {selectedComponent.orders.salesperson}</p>
                            </div>
                        )}

                        {/* Sibling Components */}
                        {orderComponents.length > 1 && (
                            <div className="wd-detail-siblings">
                                <h4>All Components in this Order</h4>
                                <div className="wd-sibling-list">
                                    {orderComponents.map(comp => (
                                        <div
                                            key={comp.id}
                                            className={`wd-sibling-item ${comp.id === selectedComponent.id ? "wd-sibling-active" : ""}`}
                                        >
                                            <span className="wd-sibling-barcode">{comp.barcode}</span>
                                            <span className="wd-sibling-label">{comp.component_label || comp.component_type}</span>
                                            {comp.is_outside_wh ? (
                                                <span className="wd-stage-badge wd-stage-badge-sm" style={{ backgroundColor: "#e0913f", color: "#fff" }}>
                                                    {getStagesOutsideLabel(comp.stages_outside)
                                                        ? `Out to Vendor (${getStagesOutsideLabel(comp.stages_outside)})`
                                                        : "Out to Vendor"}
                                                </span>
                                            ) : (
                                                <span
                                                    className="wd-stage-badge wd-stage-badge-sm"
                                                    style={{ backgroundColor: getStageColor(comp.current_stage), color: getStageTextColor(comp.current_stage) }}
                                                >
                                                    {getStageLabel(comp.current_stage)}
                                                </span>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Transition History */}
                        {componentHistory.length > 0 && (
                            <div className="wd-detail-history">
                                <h4>Stage History</h4>
                                <div className="wd-timeline">
                                    {componentHistory.map((t) => {
                                        const d = describeTransition(t, componentMovements);
                                        return (
                                        <div key={t.id} className="wd-timeline-item">
                                            <div className="wd-timeline-dot" style={{ backgroundColor: getStageColor(t.to_stage) }} />
                                            <div className="wd-timeline-content">
                                                <p className="wd-timeline-stage" style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                                                    {d.headline}
                                                    <ScanKindTag kind={d.kind} />
                                                </p>
                                                <p className="wd-timeline-meta">
                                                    {t.scanned_by} {'\u2022'} {new Date(t.scanned_at).toLocaleString()}
                                                    {d.showType && ` (${t.transition_type})`}
                                                </p>
                                                {t.notes && <p className="wd-timeline-notes">{t.notes}</p>}
                                            </div>
                                        </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ============================================================ */}
            {/* QC POPUP */}
            {/* ============================================================ */}
            {qcPopup.isOpen && (
                <div className="wd-modal-overlay">
                    <div className="wd-modal" onClick={e => e.stopPropagation()}>
                        <button className="wd-modal-close" onClick={() => setQcPopup(prev => ({ ...prev, isOpen: false }))}>{'\u2715'}</button>
                        <h3 className="wd-modal-title">Quality Check</h3>
                        <p className="wd-mono" style={{ fontSize: 18, textAlign: "center", marginBottom: 16 }}>{qcPopup.barcode}</p>

                        {selectedComponent && (
                            <p style={{ textAlign: "center", color: "#666", marginBottom: 20 }}>
                                {selectedComponent.component_label || selectedComponent.component_type} {'\u2022'} {selectedComponent.order_no}
                            </p>
                        )}

                        <div className="wd-qc-buttons">
                            <button
                                className="wd-qc-pass-btn"
                                onClick={() => {
                                    setQcPopup(prev => ({ ...prev, outcome: "", failReason: "" }));
                                    handleQcSubmit();
                                }}
                                disabled={isProcessing}
                            >
                                {'\u2713'} PASS
                            </button>
                            <button
                                className="wd-qc-fail-btn"
                                onClick={() => setQcPopup(prev => ({ ...prev, outcome: "showing_form" }))}
                                disabled={isProcessing}
                            >
                                {'\u2717'} FAIL
                            </button>
                        </div>

                        {/* Fail form */}
                        {qcPopup.outcome && qcPopup.outcome !== "" && (
                            <div className="wd-qc-fail-form">
                                <div className="wd-form-group">
                                    <label>Fail Reason *</label>
                                    <textarea
                                        value={qcPopup.failReason}
                                        onChange={e => setQcPopup(prev => ({ ...prev, failReason: e.target.value }))}
                                        placeholder="Describe what went wrong..."
                                        rows={3}
                                    />
                                </div>

                                <div className="wd-form-group">
                                    <label>Outcome *</label>
                                    <div className="wd-outcome-btns">
                                        <button
                                            className={`wd-outcome-btn ${qcPopup.outcome === "rejourney" ? "active" : ""}`}
                                            onClick={() => setQcPopup(prev => ({ ...prev, outcome: "rejourney" }))}
                                        >
                                            Re-journey
                                        </button>
                                        <button
                                            className={`wd-outcome-btn ${qcPopup.outcome === "dispose" ? "active" : ""}`}
                                            onClick={() => setQcPopup(prev => ({ ...prev, outcome: "dispose" }))}
                                        >
                                            Dispose
                                        </button>
                                        <button
                                            className={`wd-outcome-btn ${qcPopup.outcome === "scrap" ? "active" : ""}`}
                                            onClick={() => setQcPopup(prev => ({ ...prev, outcome: "scrap" }))}
                                        >
                                            Scrap
                                        </button>
                                    </div>
                                </div>

                                {qcPopup.outcome === "rejourney" && (
                                    <div className="wd-form-group">
                                        <label>Restart from Stage *</label>
                                        <select
                                            value={qcPopup.rejourneyStage}
                                            onChange={e => setQcPopup(prev => ({ ...prev, rejourneyStage: e.target.value }))}
                                        >
                                            <option value="">Select stage...</option>
                                            {REJOURNEY_STAGES.map(s => (
                                                <option key={s.value} value={s.value}>{s.label}</option>
                                            ))}
                                        </select>
                                    </div>
                                )}

                                {(qcPopup.outcome === "dispose" || qcPopup.outcome === "scrap") && (
                                    <div className="wd-form-group">
                                        <label>Loss Amount ({'\u20B9'})</label>
                                        <input
                                            type="number"
                                            value={qcPopup.scrapLossAmount}
                                            onChange={e => setQcPopup(prev => ({ ...prev, scrapLossAmount: e.target.value }))}
                                            placeholder="0"
                                        />
                                    </div>
                                )}

                                <div className="wd-form-group">
                                    <label>Additional Notes</label>
                                    <textarea
                                        value={qcPopup.notes}
                                        onChange={e => setQcPopup(prev => ({ ...prev, notes: e.target.value }))}
                                        placeholder="Optional notes..."
                                        rows={2}
                                    />
                                </div>

                                <button
                                    className="wd-qc-submit-btn"
                                    onClick={handleQcSubmit}
                                    disabled={isProcessing}
                                >
                                    {isProcessing ? "Processing..." : "Submit QC Result"}
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ============================================================ */}
            {/* SECURITY GUARD POPUP */}
            {/* ============================================================ */}
            {securityPopup.isOpen && (
                <div className="wd-modal-overlay">
                    <div className="wd-modal" onClick={e => e.stopPropagation()}>
                        <button className="wd-modal-close" onClick={() => setSecurityPopup(prev => ({ ...prev, isOpen: false }))}>{'\u2715'}</button>
                        <h3 className="wd-modal-title">
                            Security Gate {'\u2014'} {securityPopup.scanType === "exit" ? "Exit" : "Entry"}
                        </h3>
                        <p className="wd-mono" style={{ fontSize: 18, textAlign: "center", marginBottom: 20 }}>{securityPopup.barcode}</p>

                        {securityPopup.scanType === "exit" ? (
                            securityPopup.movement ? (
                                // Vendor + return date are LOCKED to what the Production
                                // Head approved — the guard confirms, doesn't choose.
                                <div className="wd-sec-locked">
                                    <div className="wd-sec-locked-row">
                                        <span className="wd-sec-locked-key">Vendor</span>
                                        <span className="wd-sec-locked-val">{securityPopup.movement.vendor_name}</span>
                                    </div>
                                    <div className="wd-sec-locked-row">
                                        <span className="wd-sec-locked-key">Location</span>
                                        <span className="wd-sec-locked-val">{securityPopup.movement.vendor_location || "—"}</span>
                                    </div>
                                    <div className="wd-sec-locked-row">
                                        <span className="wd-sec-locked-key">Return by</span>
                                        <span className="wd-sec-locked-val">{securityPopup.movement.return_date || "—"}</span>
                                    </div>
                                    <p className="wd-sec-locked-note">
                                        Approved by the Production Head. Confirm to send this component out.
                                    </p>
                                </div>
                            ) : (
                                // No PH-configured movement → cannot exit. Block it.
                                <div className="wd-sec-blocked">
                                    <p>External movement is <strong>not configured</strong> for this component.</p>
                                    <p>The Production Head must configure the vendor and return date before it can be scanned out.</p>
                                </div>
                            )
                        ) : (
                            <p style={{ textAlign: "center", color: "#4caf50", fontSize: 16, marginBottom: 20 }}>
                                Returning from: {securityPopup.vendorName || "External Vendor"}
                            </p>
                        )}

                        <button
                            className="wd-qc-submit-btn"
                            onClick={handleSecuritySubmit}
                            disabled={isProcessing || (securityPopup.scanType === "exit" && !securityPopup.movement)}
                        >
                            {isProcessing ? "Processing..." : securityPopup.scanType === "exit" ? "Confirm Exit" : "Confirm Entry"}
                        </button>
                    </div>
                </div>
            )}

            {/* ============================================================ */}
            {/* ACTIVATION POPUP (Step 2) */}
            {/* ============================================================ */}
            {activationPopup.isOpen && (
                <div className="wd-modal-overlay">
                    <div className="wd-modal" onClick={e => e.stopPropagation()}>
                        <button className="wd-modal-close" onClick={() => setActivationPopup(prev => ({ ...prev, isOpen: false }))}>{'\u2715'}</button>
                        <h3 className="wd-modal-title">Activate Components</h3>
                        <p style={{ textAlign: "center", color: "#666", marginBottom: 20 }}>
                            Order: <strong>{activationPopup.orderNo}</strong>
                        </p>
                        <p style={{ fontSize: 13, color: "#999", marginBottom: 16, textAlign: "center" }}>
                            Select which components enter production
                        </p>

                        <div className="wd-activation-list">
                            {activationPopup.components.map(comp => (
                                <label key={comp.id} className="wd-activation-item">
                                    <input
                                        type="checkbox"
                                        checked={activationPopup.selectedIds.includes(comp.id)}
                                        onChange={(e) => {
                                            setActivationPopup(prev => ({
                                                ...prev,
                                                selectedIds: e.target.checked
                                                    ? [...prev.selectedIds, comp.id]
                                                    : prev.selectedIds.filter(id => id !== comp.id),
                                            }));
                                        }}
                                    />
                                    <span className="wd-activation-barcode">{comp.barcode}</span>
                                    <span className="wd-activation-label">{comp.component_label || comp.component_type}</span>
                                </label>
                            ))}
                        </div>

                        <button
                            className="wd-qc-submit-btn"
                            onClick={handleActivationSubmit}
                            disabled={isProcessing || activationPopup.selectedIds.length === 0}
                        >
                            {isProcessing ? "Activating..." : `Activate ${activationPopup.selectedIds.length} Component(s)`}
                        </button>
                    </div>
                </div>
            )}

            {/* ============================================================ */}
            {/* PACKAGING VERIFICATION POPUP */}
            {/* ============================================================ */}
            {packagingPopup.isOpen && (
                <div className="wd-modal-overlay">
                    <div className="wd-modal" onClick={e => e.stopPropagation()}>
                        <button className="wd-modal-close" onClick={() => setPackagingPopup(prev => ({ ...prev, isOpen: false, scannedBarcodes: [] }))}>{'\u2715'}</button>
                        <h3 className="wd-modal-title">Packaging Verification</h3>
                        <p style={{ textAlign: "center", color: "#666", marginBottom: 20 }}>
                            Order: <strong>{packagingPopup.orderNo}</strong>
                        </p>

                        <div className="wd-packaging-progress">
                            <div className="wd-packaging-bar">
                                <div
                                    className="wd-packaging-fill"
                                    style={{ width: `${(packagingPopup.scannedBarcodes.length / packagingPopup.expectedCount) * 100}%` }}
                                />
                            </div>
                            <p className="wd-packaging-count">
                                {packagingPopup.scannedBarcodes.length} / {packagingPopup.expectedCount} scanned
                            </p>
                        </div>

                        <div className="wd-packaging-list">
                            {packagingPopup.scannedBarcodes.map((bc, idx) => (
                                <div key={idx} className="wd-packaging-item">
                                    <span>{'\u2713'}</span>
                                    <span className="wd-mono">{bc}</span>
                                </div>
                            ))}
                        </div>

                        <button
                            className="wd-qc-submit-btn"
                            onClick={handlePackagingVerify}
                            disabled={isProcessing || packagingPopup.scannedBarcodes.length < packagingPopup.expectedCount}
                        >
                            {packagingPopup.scannedBarcodes.length < packagingPopup.expectedCount
                                ? `Scan ${packagingPopup.expectedCount - packagingPopup.scannedBarcodes.length} more...`
                                : isProcessing ? "Verifying..." : "Verify & Dispatch"}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ScanStation;
