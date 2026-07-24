# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`sheetal_ui` — a Create React App (CRA) SPA for **Sheetal Batra**, a made-to-order Indian couture house (physical stores in Delhi/GK-II and Ludhiana, plus B2B, Comms/PR, Private, Exhibition, and internal Stock channels). It runs the full lifecycle: place order → mint per-garment barcodes → track each garment component through a physical production pipeline via barcode scans → QC → packaging → dispatch, across ~35 role-specific dashboards. Backed entirely by **Supabase** (Postgres + Auth + Edge Functions); there is **no custom app server** — the React app talks directly to Supabase. Security is enforced by Postgres RLS, and the anon key shipped in the client is expected — do not treat it as a leak. Heavy or must-be-atomic logic lives in **Postgres RPC functions**, not JS.

The root `README.md` is **not** project documentation (it's a personal workflow template); this file is the guide.

## Commands

- `npm start` — dev server (react-scripts, port 3000)
- `npm run build` — production build. Runs `prebuild` first: `scripts/write-version.js` stamps `public/version.json` with a build id (see "Version banner" below).
- `npm test` — Jest via react-scripts (watch mode)
- Run a single test: `npm test -- src/App.test.js` (or `npm test -- -t "test name"`)

There is **no separate lint script**; ESLint runs through `react-scripts` (`react-app` + `react-app/jest` config in package.json). Tailwind is wired the plain-CRA way (no CRACO, no `postcss.config.js` — CRA 5 picks up `tailwindcss` automatically) with **`preflight: false`** (`tailwind.config.js`) — Tailwind's CSS reset is disabled so it coexists with the app's own hand-written CSS. Custom color: `gold` (#d5b85a, the brand color, recurs in PDFs).

**There is effectively no test suite.** Only `src/App.test.js` exists — the stock CRA smoke test ("renders learn react link"), which would actually *fail* against the real `App` (it renders a router/login). Don't rely on `npm test` as a signal; verify changes by running the app.

File-extension convention: entry/logic/service/pdf files are `.js` (`App.js`, `utils/*`, `pdf/*`); nearly all screens and components are `.jsx`, imported without extensions.

## Environment

Requires a `.env` (gitignored) with CRA-prefixed vars:
- `REACT_APP_SUPABASE_URL`
- `REACT_APP_SUPABASE_KEY` (the public **anon** key)

Read via `src/config/config.js` → `src/lib/supabaseClient.js` (single exported `supabase` client, imported directly everywhere). Note: `.env` here is **not** necessarily prod — PROD and UAT are different Supabase projects.

## Data-access conventions (important)

The core pattern, documented in `src/utils/barcodeService.js`:

- **Writes / anything that must be atomic → `supabase.rpc(...)`.** All state-changing production transitions call a Postgres function so the whole thing happens server-side with no partial writes (e.g. `advance_component_stage`, `record_qc_result`, `security_guard_scan`, `initiate_replacement_journey`). These mirror SQL under `db/barcode_system/v2/*.sql`.
- **Reads / simple writes → direct `supabase.from(...).select/insert/update`.**
- **Any table that can exceed 1000 rows → `fetchAllRows(table, buildQuery)`** (`src/utils/fetchAllRows.js`). Supabase silently caps unpaged queries at 1000 rows; do not hand-roll a plain `.select()` for growable tables.

`src/utils/` is the **de-facto service layer** (there is no `services/` folder): pure helpers alongside Supabase-facing modules (`barcodeService.js`, `notificationService.js`, `whatsappService.js`, `qcHistory.js`, `reJourneys.js`, `revenue.js`, `scanReport.js`, …). `whatsappService.js` does not hit a table — it `fetch()`es the `spur-whatsapp` edge function.

## Auth & roles (a known drift risk)

- `src/context/AuthContext.js` is the only context. It tracks **only** the Supabase auth user + loading — **not** role or profile. Mounted at the root in `src/index.js`.
- `src/components/PrivateRoute.js` checks **authentication only** — there is no `allowedRoles` prop and no role in context.
- **Role-based access is decentralized and duplicated:**
  1. At login (`src/screens/SALogin.js`): after auth, look up `role` from the `salesperson` table, then a big `if/else` `navigate()`s to that role's dashboard.
  2. Inside each dashboard: the screen re-queries `salesperson` on mount and self-guards (redirects if the role doesn't match).
  There is no central role→route map. When adding a role or dashboard, update **both** places.
- Identity beyond the Supabase session lives in `localStorage` (`sp_email`) and `sessionStorage` (`currentSalesperson` = `{ store, name, email }`), set at login and re-read by dashboards. `src/utils/restoreAssociateSession.js` re-hydrates it.

## Routing & layout

- All ~40 routes are declared flat in `src/App.js` (single `<BrowserRouter>`, no nested trees, no lazy loading). Most protected routes are **role-specific dashboards**.
- Two folder conventions coexist: `src/screens/` is the real home (30+ dashboards; newer ones are subfolders with co-located `.jsx` + `.css`, older ones are flat `.js`/`.jsx` at root). `src/pages/` holds only `OrderDetailPage.jsx`. B2B screens/components are prefixed `B2b*`.
- Dashboard tab state lives in the **URL**, not `useState`: use `useTabParam(defaultTab, paramName?)` (`src/hooks/useTabParam.js`) so Back and refresh preserve the active tab.
- Alerts/confirms use the shared `Popup` component / `usePopup()` hook (`src/components/Popup.jsx`), not `window.alert`.

## Version banner

`scripts/write-version.js` (npm `prebuild`) writes `public/version.json`. `src/components/UpdateBanner.jsx` polls it every 5 min and on tab focus; when the id changes it shows a manual "Refresh now" banner so long-running tabs don't keep running a stale bundle. Manual refresh (not auto-reload) to avoid losing in-progress form input.

## Barcode / production tracking system (the app's most complex domain)

An order explodes into **components** (top/bottom/dupatta/extras — the scannable unit, table `order_components`). `generateOrderComponents` mints one Code128 barcode per physical piece: `<STORE>-<6-digit seq>-TOP|BTM|DUP|EX<n>` (e.g. `DLC-000376-TOP`); `"NA"/"N/A"` options are skipped to avoid phantom barcodes. Each is scanned through a multi-stage flow at **scan stations**. The V2 model is ~10 logical stages (Order Received → Cloth Issued → Dyeing → Pattern Cutting → Embroidery → Dry Cleaning → QC 1 → Stitching → Hemming → Final QC/QC 2 → Production Complete → Packaging & Dispatch → Dispatched, + Disposed/Scrapped) with 2 QCs; only some are mandatory and the **authoritative skippable set lives in the DB, not JS**. Legacy stages are retained in `PRODUCTION_STAGES` for historical rendering only.

- Constants + classification mirroring the DB, all in `src/utils/barcodeService.js`: `PRODUCTION_STAGES`, `SCAN_STATIONS`, `STAGE_GROUPS`, and channel resolution (`getOrderChannelKey`, `scopeOrdersToDesignation`).
- **Order-number format is `SB-<CHANNEL>-MMYY-NNNNNN`** (e.g. `SB-DLC-0726-003625`); the **prefix is the authoritative channel signal** — `DLC`=Delhi, `LDHC`=Ludhiana, `B2B`, `COM`=Comms, `PVT`=Private, `EXB`=Exhibition, `STOCK`. Flags (`is_b2b`, `is_gifting`, `is_stock_order`, `is_alteration`, LXRTS/`sync_enabled` = Shopify-synced) modify behavior.
- **T-2 rule** (`src/utils/warehouseDate.js`): production deadline = customer `delivery_date − 2 days`. One shared definition used by dashboards + the warehouse PDF.
- Scan UI: `src/components/ScanStation.jsx`, `src/screens/ScanStationPage/`, `src/hooks/useBarcodeScanner.js` (detects HID scanners by keystroke speed, swallows input so it never lands in a focused field, fires on Enter; also handles prefix-less barcodes typed by workers via `resolveFullBarcode`).
- Side paths: external vendor movements (Security Gate exit/entry scans), QC failure → re-journey to an earlier stage, replacement journeys (PH initiates, PM approves), and a global **Factory Pause** that freezes SLA/escalation timers. Main scan flow enforces stage order; **vendor/recovery side-path RPCs** (security gate, external movement, re-journey, replacement) do **not** — check the guard before touching them.

## SQL source of truth & edge functions

- **`db/`** (gitignored, outside `src/`) holds the authoritative SQL: `db/barcode_system/v2/` is a subtree of 50+ numbered, append-only migrations, and `barcodeService.js` comments name which SQL file each RPC mirrors (e.g. `14_production_head_resolver.sql`). **Changing production logic almost always pairs a `db/…v2/NN_*.sql` migration with the JS.** Plus `comms_dashboard.sql`, `order_payments.sql`, `walkins.sql`, `otp/`, `exhibitions/`, etc.
- **`supabase/functions/`** (tracked; secrets are not) — Deno/TypeScript edge functions using the service-role key: `notification-scheduler` (daily pg_cron: delivery reminders, birthdays, delays; its `TYPES` mirror `notificationService.js`), `spur-whatsapp` (outbound WhatsApp — attach XLSX/PDF, not CSV, which is silently undelivered), `scan-report-daily`, `shopify-orders-test`. pg_cron schedules and the functions' deployed config are not in the repo.

## PDF generation

Two libraries, one active path:
- **`@react-pdf/renderer` — the documents actually rendered.** `src/pdf/index.js` exports `CustomerOrderPdf` (customer invoice/order copy: GST-reverse-calculated totals, split payments, signature image, return policy) and `WarehouseOrderPdf` (production work order, one PDF per product, renders master + per-component **barcodes**, measurements, alterations, the T-2 date).
- **`pdf-lib` + `@pdf-lib/fontkit` in `pdfHelpers.js`/`pdfTheme.js`** is a lower-level drawing toolkit that the two active `@react-pdf` components do **not** use — treat it as a likely parallel/legacy path, not the live one.
- Barcodes are Code128 PNG data-URLs from `jsbarcode` on an offscreen canvas (`src/utils/barcodeImageUtils.js`), embedded as `<Image>` in the warehouse doc. `src/index.js` sets `window.Buffer` before render for these libs.
- Note: the top ~360 lines of `pdfStyles.js` are a commented-out earlier stylesheet; the live export is at the bottom.
