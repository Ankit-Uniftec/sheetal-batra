-- ============================================================
-- 47. dupatta_colors needs its own hex — swatches, like every other colour.
--
-- WHY: dupatta_colors holds (id, name, created_at) only. Top and Bottom colours
-- come from the `colors` table, which has a hex, so their dropdowns and order
-- cards show a colour swatch. The dupatta dropdown could only show a bare name.
--
-- The stopgap (matching a dupatta colour NAME against the colours table) covers
-- 37 of 59 — 22 have no counterpart there ('Blue', 'Blush Rose Pink',
-- 'Midnight Blue', 'Multi Color', 'Olive Green', 'Peach', 'Ruby Red', ...), so
-- those stayed blank, and any NEW dupatta colour would too. Matching across
-- tables by name is not a real fix; the column is.
--
-- This adds hex, backfills what the colours table can supply, and leaves the
-- rest NULL for someone to fill in from the swatch book. The UI shows the name
-- without a dot while hex is NULL — honest, and never invents a colour.
--
-- Idempotent. Run on uat first, then prod.
-- ============================================================

-- ---- 1) The column ----
ALTER TABLE dupatta_colors ADD COLUMN IF NOT EXISTS hex text;

-- ---- 2) Backfill from the main colours table (case/space-insensitive) ----
UPDATE dupatta_colors dc
   SET hex = c.hex
  FROM colors c
 WHERE dc.hex IS NULL
   AND c.hex IS NOT NULL
   AND lower(btrim(dc.name)) = lower(btrim(c.name));

-- ---- 3) What still needs a hex (fill these in by hand) ----
-- Expect ~22 rows on prod. They render as a name with no swatch until set.
SELECT name
  FROM dupatta_colors
 WHERE hex IS NULL
 ORDER BY name;

-- To set one:
--   UPDATE dupatta_colors SET hex = '#1E3A8A' WHERE name = 'Midnight Blue';

-- ---- VERIFY ----
-- SELECT count(*) FILTER (WHERE hex IS NOT NULL) AS with_hex,
--        count(*) FILTER (WHERE hex IS NULL)     AS without_hex,
--        count(*)                                AS total
--   FROM dupatta_colors;
