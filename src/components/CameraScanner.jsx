import React, { useEffect, useRef, useState } from "react";
import "./CameraScanner.css";

// ============================================================
// CameraScanner — read a Code128 piece label with the tablet camera
// (Release 35). Opens the back camera, shows the picture with a target box,
// and calls onDetected(code) once a label is read.
//
// Two readers, best first:
//   1. The browser's own BarcodeDetector (Chrome on Android tablets) — fast,
//      nothing to download.
//   2. ZXing (Safari / iPad and anything without BarcodeDetector) — loaded from
//      the CDN only when the camera is opened, pinned to one version with an
//      integrity hash, so the app bundle and package files are unchanged.
//
// The camera needs HTTPS (the live site) or localhost. When it cannot start
// (no camera, permission refused) the message says why and the typed box
// beside it still works.
// ============================================================

const ZXING_URL = "https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js";
const ZXING_SRI = "sha384-BzBxP10ZE72aitqj5UMmUsbKFliP/DZqA8Wq+BNNhlIJDGoEd1tpkMYXOg9+n6sB";
const SCAN_EVERY_MS = 180;

let zxingLoad = null;
function loadZxing() {
  if (window.ZXing) return Promise.resolve(window.ZXing);
  if (!zxingLoad) {
    zxingLoad = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = ZXING_URL;
      s.integrity = ZXING_SRI;
      s.crossOrigin = "anonymous";
      s.async = true;
      s.onload = () => (window.ZXing ? resolve(window.ZXing) : reject(new Error("Barcode reader did not load.")));
      s.onerror = () => { zxingLoad = null; reject(new Error("Barcode reader could not be downloaded.")); };
      document.head.appendChild(s);
    });
  }
  return zxingLoad;
}

/** A reader for one frame: (canvasOrVideo) => Promise<string|null>. */
async function makeReader() {
  if ("BarcodeDetector" in window) {
    try {
      const formats = await window.BarcodeDetector.getSupportedFormats();
      if (formats.includes("code_128")) {
        const detector = new window.BarcodeDetector({ formats: ["code_128"] });
        return { kind: "native", read: async (source) => (await detector.detect(source))[0]?.rawValue || null };
      }
    } catch { /* fall through to ZXing */ }
  }
  const Z = await loadZxing();
  const hints = new Map();
  hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.CODE_128]);
  hints.set(Z.DecodeHintType.TRY_HARDER, true);
  const reader = new Z.MultiFormatReader();
  reader.setHints(hints);
  return {
    kind: "zxing",
    read: async (canvas) => {
      try {
        const bitmap = new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.HTMLCanvasElementLuminanceSource(canvas)));
        return reader.decode(bitmap).getText() || null;
      } catch {
        return null; // nothing readable in this frame
      }
    },
  };
}

// Exported for checking the reader without a camera (a drawn barcode canvas).
export async function readBarcodeFromCanvas(canvas) {
  const r = await makeReader();
  return r.read(canvas);
}

export default function CameraScanner({ onDetected, active = true }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [status, setStatus] = useState("starting"); // starting | live | error
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!active) return undefined;
    let stream = null;
    let timer = null;
    let stopped = false;
    let done = false;

    const stop = () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus("error");
        setMessage(window.isSecureContext ? "This device has no camera access." : "The camera only works on the secure (https) site.");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        });
      } catch (err) {
        setStatus("error");
        setMessage(err?.name === "NotAllowedError"
          ? "Camera permission was refused. Allow the camera for this site in the browser settings, or type the code."
          : "The camera could not be started. Type the code instead.");
        return;
      }
      if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
      const video = videoRef.current;
      video.srcObject = stream;
      video.setAttribute("playsinline", "true");
      try { await video.play(); } catch { /* autoplay with muted video is allowed */ }

      let reader;
      try {
        reader = await makeReader();
      } catch (err) {
        setStatus("error");
        setMessage(`${err.message} Type the code instead.`);
        return;
      }
      if (stopped) return;
      setStatus("live");

      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      const tick = async () => {
        if (stopped || done) return;
        if (video.readyState >= 2 && video.videoWidth) {
          // Read the middle band where the target box is: faster and fewer misreads.
          const w = video.videoWidth;
          const h = video.videoHeight;
          const cropH = Math.round(h * 0.5);
          canvas.width = w;
          canvas.height = cropH;
          ctx.drawImage(video, 0, Math.round((h - cropH) / 2), w, cropH, 0, 0, w, cropH);
          const text = await reader.read(canvas);
          if (text && !stopped && !done) {
            done = true;
            if (navigator.vibrate) navigator.vibrate(80);
            stop();
            onDetected(String(text).trim().toUpperCase());
            return;
          }
        }
        timer = setTimeout(tick, SCAN_EVERY_MS);
      };
      tick();
    })();

    return stop;
  }, [active, onDetected]);

  return (
    <div className="cam-scan">
      <div className="cam-scan-view">
        <video ref={videoRef} muted playsInline className="cam-scan-video" />
        <div className="cam-scan-target" aria-hidden="true" />
        {status !== "live" && (
          <div className={`cam-scan-note ${status === "error" ? "is-error" : ""}`}>
            {status === "starting" ? "Starting the camera…" : message}
          </div>
        )}
      </div>
      {status === "live" && <p className="cam-scan-help">Hold the barcode inside the box. It reads by itself.</p>}
      <canvas ref={canvasRef} hidden />
    </div>
  );
}

/** Tablets and phones (touch screens) open the camera straight away. */
export const prefersCamera = () => {
  try { return window.matchMedia("(pointer: coarse)").matches; } catch { return false; }
};
