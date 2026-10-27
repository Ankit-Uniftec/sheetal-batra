# Local test database

Postgres plus the open-source Supabase components the current app needs (auth, data API, storage,
realtime), running in Docker on this machine. Foundations milestone M3.0 (`redesign/FOUNDATIONS-PLAN.md`).

**It never connects to a Supabase cloud project.** Do not run `supabase link`, do not point it at a
`--project-ref`, and do not copy a cloud `.env` next to it.

## Commands

```bash
bash infra/local-db/db.sh up
```

```bash
bash infra/local-db/db.sh status
```

```bash
bash infra/local-db/db.sh reset
```

```bash
bash infra/local-db/db.sh down
```

`up` prints the local API URL and the local anon key (a fixed development key, not a secret). Studio, a
web view of the local database, runs at http://localhost:54323.

| Service | Local address |
| --- | --- |
| Data API (what the app calls) | http://127.0.0.1:54321 |
| Postgres | `postgresql://postgres:postgres@127.0.0.1:54322/postgres` |
| Studio | http://127.0.0.1:54323 |
| Test mail inbox | http://127.0.0.1:54324 |

The CLI version is pinned in `db.sh`. Analytics, vector storage and the edge-function runtime are switched
off to keep memory use down; edge functions come in session 3.0.4.

## Running the app against it

Session 3.0.2 adds a launch configuration that starts the app on http://localhost:3010 with
`REACT_APP_SUPABASE_URL=http://127.0.0.1:54321` and the local anon key, so no cloud settings file is
involved.

## What is loaded (sessions 3.0.2 and 3.0.3)

1. **Schema:** the production schema from the A0 export (`db/a0_baseline/out/a0_schema_production.sql`,
   kept outside git until it has been scanned for secrets). Cron jobs are loaded **disabled**; edge-function
   calls from the database point at nothing.
2. **Synthetic data** from a seed generator (fixed random seed, so every reset gives the same data):
   - stores Delhi (DLC) and Ludhiana (LDHC), Factory 1 and Factory 2 / SB WH Delhi (2), stations and gates;
   - one staff login per role (`<role>@local.test`, password in the seed file only — local test values);
   - customers with fake names and `+91 90000 0xxxx` phone numbers, measurements;
   - catalogue: products with variants, colours, extras, ready-stock (LXRTS) items;
   - orders on every channel (DLC, LDHC, B2B, COM, PVT, EXB, SHOPIFY, SHOPIFY-USA, STOCK, B2BSTOCK),
     with payments, proofs, store credit, alterations, a cancellation;
   - pieces at every production stage, at a vendor, at Final QC, packed, dispatched, delivered;
   - Stock Room locations, movements and stock levels; B2B buyers with credit limits.
3. **External calls:** WhatsApp (Spur) and Shopify are replaced by local recorders; the OTP step is
   skipped only inside this local stack.

No real customer or staff data is ever loaded here.
