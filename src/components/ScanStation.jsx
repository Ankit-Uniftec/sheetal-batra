import React, { useState, useCallback, useEffect, useMemo } from "react";
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
    PRODUCTION_STAGES,
    SCAN_STATIONS,
    REJOURNEY_STAGES,
    getStageLabel,
    getStageColor,
} from "../utils/barcodeService";

// ============================================================
// SCAN STATION COMPONENT
// ============================================================
const ScanStation = ({ currentUserEmail }) => {
    // Station selection
    const [selectedStation, setSelectedStation] = useState(null);

    // Scan state
    const [scanResult, setScanResult] = useState(null); // { success, data, error }
    const [scanHistory, setScanHistory] = useState([]);
    const [isProcessing, setIsProcessing] = useState(false);

    // Component detail view
    const [selectedComponent, setSelectedComponent] = useState(null);
    const [componentHistory, setComponentHistory] = useState([]);
    const [orderComponents, setOrderComponents] = useState([]);

    // QC popup
    const [qcPopup, setQcPopup] = useState({
        isOpen: false,
        barcode: "",
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

    // Manual barcode input
    const [manualBarcode, setManualBarcode] = useState("");

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

        setIsProcessing(true);
        setScanResult(null);

        try {
            const station = SCAN_STATIONS.find(s => s.value === selectedStation);

            // Security gate has its own flow
            if (selectedStation === "security_gate") {
                const component = await fetchComponentByBarcode(barcode);
                setSecurityPopup({
                    isOpen: true,
                    barcode,
                    scanType: component.is_outside_wh ? "entry" : "exit",
                    vendorName: component.vendor_name || "",
                    vendorLocation: component.vendor_location || "",
                });
                setIsProcessing(false);
                return;
            }

            // QC station — show pass/fail popup
            if (selectedStation === "qc") {
                const component = await fetchComponentByBarcode(barcode);
                setSelectedComponent(component);
                setQcPopup({
                    isOpen: true,
                    barcode,
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
                    error: "FETCH_ERROR",
                    message: err.message || "Failed to look up component",
                });
                setIsProcessing(false);
                return;
            }

            const result = await advanceComponentStage(
                barcode,
                targetStage,
                currentUserEmail,
                station.label,
                null,
                "scan"
            );

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
                    message: result.message,
                    data: result,
                });
            }
        } catch (err) {
            setScanResult({
                success: false,
                error: "SYSTEM_ERROR",
                message: err.message || "Something went wrong",
            });
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
                setScanResult({ success: false, error: "QC_ERROR", message: err.message });
            }
            setQcPopup(prev => ({ ...prev, isOpen: false }));
            setIsProcessing(false);
            return;
        }

        // Fail submission
        if (!qcPopup.failReason.trim()) {
            alert("Please enter a fail reason");
            return;
        }
        if (!qcPopup.outcome) {
            alert("Please select an outcome (Dispose / Scrap / Re-journey)");
            return;
        }
        if (qcPopup.outcome === "rejourney" && !qcPopup.rejourneyStage) {
            alert("Please select which stage to restart from");
            return;
        }

        setIsProcessing(true);
        try {
            const result = await recordQcResult({
                barcode: qcPopup.barcode,
                result: "fail",
                inspectedBy: currentUserEmail,
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
                    alert("⚠️ ALERT: This component has failed QC 3+ times. Manish Batra has been notified.");
                }

                setTodayStats(prev => ({ ...prev, scanned: prev.scanned + 1, failed: prev.failed + 1 }));
            } else {
                setScanResult({ success: false, error: result.error, message: result.message });
            }
        } catch (err) {
            setScanResult({ success: false, error: "QC_ERROR", message: err.message });
        }

        setQcPopup(prev => ({ ...prev, isOpen: false }));
        setIsProcessing(false);
    };

    // ============================================================
    // SECURITY GUARD SUBMIT
    // ============================================================
    const handleSecuritySubmit = async () => {
        if (!securityPopup.barcode) return;

        if (securityPopup.scanType === "exit" && !securityPopup.vendorName.trim()) {
            alert("Please enter vendor name");
            return;
        }

        setIsProcessing(true);
        try {
            const result = await securityGuardScan({
                barcode: securityPopup.barcode,
                scanType: securityPopup.scanType,
                scannedBy: currentUserEmail,
                vendorName: securityPopup.vendorName,
                vendorLocation: securityPopup.vendorLocation,
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
            setScanResult({ success: false, error: "SECURITY_ERROR", message: err.message });
        }

        setSecurityPopup(prev => ({ ...prev, isOpen: false }));
        setIsProcessing(false);
    };

    // ============================================================
    // ACTIVATION SUBMIT (Step 2)
    // ============================================================
    const handleActivationSubmit = async () => {
        if (activationPopup.selectedIds.length === 0) {
            alert("Please select at least one component to activate");
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
            setScanResult({ success: false, error: "ACTIVATION_ERROR", message: err.message });
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
                // All verified — advance all to packaging_dispatch
                for (const barcode of packagingPopup.scannedBarcodes) {
                    await advanceComponentStage(
                        barcode,
                        "packaging_dispatch",
                        currentUserEmail,
                        "Packaging Station",
                        "Packaging verified",
                        "scan"
                    );
                }

                setScanResult({
                    success: true,
                    message: `All ${result.verified_count} components verified — ready for dispatch!`,
                    data: result,
                });
            } else {
                setScanResult({
                    success: false,
                    error: result.error,
                    message: result.message,
                    data: result,
                });
            }
        } catch (err) {
            setScanResult({ success: false, error: "PACKAGING_ERROR", message: err.message });
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
            setSelectedComponent(component);

            const history = await fetchTransitionHistory(component.id);
            setComponentHistory(history);

            const allComponents = await fetchOrderComponents(component.order_id);
            setOrderComponents(allComponents);
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
            {/* Station Selector */}
            {!selectedStation ? (
                <div className="wd-station-selector">
                    <h2 className="wd-scan-title">Select Your Station</h2>
                    <p className="wd-scan-subtitle">Choose the station you are working at today</p>
                    <div className="wd-station-grid">
                        {SCAN_STATIONS.map(station => (
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

                    {/* Manual Input */}
                    <form className="wd-manual-input" onSubmit={handleManualSubmit}>
                        <input
                            type="text"
                            value={manualBarcode}
                            onChange={(e) => setManualBarcode(e.target.value)}
                            placeholder="Type barcode or scan..."
                            className="wd-manual-field"
                            data-barcode-passthrough=""
                            autoFocus
                        />
                        <button type="submit" className="wd-manual-btn" disabled={isProcessing}>
                            {isProcessing ? "Processing..." : "Submit"}
                        </button>
                    </form>

                    {/* Scan Result Display */}
                    {scanResult && (
                        <div className={`wd-scan-result ${scanResult.success ? "wd-scan-success" : "wd-scan-error"}`}>
                            <div className="wd-scan-result-icon">
                                {scanResult.success ? "\u2713" : "\u2717"}
                            </div>
                            <div className="wd-scan-result-body">
                                <p className="wd-scan-result-msg">{scanResult.message}</p>
                                {scanResult.data?.barcode && (
                                    <p className="wd-scan-result-barcode">{scanResult.data.barcode}</p>
                                )}
                                {scanResult.data?.component_label && (
                                    <p className="wd-scan-result-label">{scanResult.data.component_label} ({scanResult.data.component_type})</p>
                                )}
                                {scanResult.data?.is_on_time === false && (
                                    <p className="wd-scan-result-delay">{'\u26A0'} This stage was overdue</p>
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
                                                style={{ backgroundColor: getStageColor(scan.toStage) }}
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
                                <span
                                    className="wd-stage-badge"
                                    style={{ backgroundColor: getStageColor(selectedComponent.current_stage) }}
                                >
                                    {getStageLabel(selectedComponent.current_stage)}
                                </span>
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
                                            <span
                                                className="wd-stage-badge wd-stage-badge-sm"
                                                style={{ backgroundColor: getStageColor(comp.current_stage) }}
                                            >
                                                {getStageLabel(comp.current_stage)}
                                            </span>
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
                                    {componentHistory.map((t, idx) => (
                                        <div key={t.id} className="wd-timeline-item">
                                            <div className="wd-timeline-dot" style={{ backgroundColor: getStageColor(t.to_stage) }} />
                                            <div className="wd-timeline-content">
                                                <p className="wd-timeline-stage">
                                                    {t.from_stage ? `${getStageLabel(t.from_stage)} → ` : ""}{getStageLabel(t.to_stage)}
                                                </p>
                                                <p className="wd-timeline-meta">
                                                    {t.scanned_by} {'\u2022'} {new Date(t.scanned_at).toLocaleString()}
                                                    {t.transition_type !== "scan" && ` (${t.transition_type})`}
                                                </p>
                                                {t.notes && <p className="wd-timeline-notes">{t.notes}</p>}
                                            </div>
                                        </div>
                                    ))}
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
                            <>
                                <div className="wd-form-group">
                                    <label>Vendor Name *</label>
                                    <input
                                        type="text"
                                        value={securityPopup.vendorName}
                                        onChange={e => setSecurityPopup(prev => ({ ...prev, vendorName: e.target.value }))}
                                        placeholder="e.g. Dye Works Pvt Ltd"
                                    />
                                </div>
                                <div className="wd-form-group">
                                    <label>Vendor Location</label>
                                    <input
                                        type="text"
                                        value={securityPopup.vendorLocation}
                                        onChange={e => setSecurityPopup(prev => ({ ...prev, vendorLocation: e.target.value }))}
                                        placeholder="e.g. Ludhiana"
                                    />
                                </div>
                            </>
                        ) : (
                            <p style={{ textAlign: "center", color: "#4caf50", fontSize: 16, marginBottom: 20 }}>
                                Returning from: {securityPopup.vendorName || "External Vendor"}
                            </p>
                        )}

                        <button
                            className="wd-qc-submit-btn"
                            onClick={handleSecuritySubmit}
                            disabled={isProcessing}
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