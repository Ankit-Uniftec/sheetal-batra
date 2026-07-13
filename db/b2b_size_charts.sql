-- ============================================================
-- Reusable B2B size-chart library.
--
-- Some B2B buyers (e.g. Aza, Pernia's Pop-Up) size their garments
-- differently from the house standard, and one brand spans many vendor
-- rows (Aza ~15 locations). Instead of storing the chart on each vendor
-- (which would mean filling identical numbers 15+ times), a named chart
-- is created ONCE in size_charts and each vendor references it by id.
-- vendors.size_chart_id = NULL means "use the default house chart".
--
-- The B2B order form auto-fills Bust/Waist/Hip from the selected
-- vendor's referenced chart (or the JS default when null).
-- ============================================================

create table if not exists size_charts (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  chart       jsonb not null,          -- { "XS": {"Bust":32,"Waist":26,"Hip":36}, ... }
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Vendor references a library chart (nullable = default house chart).
alter table vendors add column if not exists size_chart_id uuid references size_charts (id);

-- Remove the earlier per-vendor inline chart column (superseded by the
-- shared library). Safe: it was only ever populated on UAT test vendors.
alter table vendors drop column if exists size_chart;
