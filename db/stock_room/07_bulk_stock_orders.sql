-- ============================================================
-- Stock Room 07 — bulk stock orders from a CSV.
--
-- One call raises many stock orders. The browser parses the file and shows a
-- preview; THIS function is what actually writes, and it re-checks everything
-- it can rather than trusting the preview.
--
-- THE RULES (agreed with the client, 2026-09-25):
--   * EXACT MATCHES ONLY. Product, size, colour, dupatta colour, extra,
--     production head and channel must match a known value exactly (spaces
--     trimmed, letter case ignored). Nothing is guessed or auto-corrected; an
--     unmatched value fails its order. Error text may NAME a close value as a
--     hint, but nothing acts on that hint.
--   * WHOLE ORDERS, OR NOTHING. One bad line fails its whole order, so no
--     order ever reaches the floor missing a line. Every other order in the
--     file is unaffected — each runs in its own exception block, which rolls
--     back that order alone (its order number is never issued).
--   * 6 UNITS PER ORDER, counted across its lines.
--   * NO STOCK CHECKS. A stock order is a request to make or buy pieces, so
--     made-to-order, unlimited (9999) and out-of-stock designs are all fine.
--
-- Mirrors the single-order path (ProductForm.js in stock mode + ReviewDetail.js)
-- field for field: zero money, "WH Delhi", delivery_name 'Internal Stock',
-- status 'order_received', and the same barcode rules as
-- generateOrderComponents (barcodeService.js) / migration 35's backfill.
--
-- Access: the same people who may already change stock — stock_room_can_write()
-- via stock_room__start, which also makes a retried request replay its stored
-- result instead of raising the orders twice.
--
-- ⚠ RUN ON UAT FIRST, and place one real file there before prod. The `orders`
-- table's full column list is not in this repo; this file writes exactly the
-- columns the existing stock-order path writes, and a missing NOT NULL column
-- would surface here as a failed order (never a half-written one).
--
-- Idempotent (CREATE OR REPLACE / IF NOT EXISTS). Safe to re-run.
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- SECTION A — the batch record.
-- One row per upload, so a run can be reviewed, downloaded again and undone.
-- ────────────────────────────────────────────────────────────

create table if not exists public.stock_order_batch (
  id            uuid primary key default gen_random_uuid(),
  request_id    uuid not null references public.stock_room_request (id),
  file_name     text,
  -- SHA-256 of the uploaded file, so the screen can warn "this exact file was
  -- imported 20 minutes ago" instead of silently doubling a week's production.
  file_hash     text,
  actor_email   text,
  created_at    timestamptz not null default now(),
  order_count   integer not null default 0,
  line_count    integer not null default 0,
  failed_count  integer not null default 0
);
create index if not exists stock_order_batch_when on public.stock_order_batch (created_at desc);
create index if not exists stock_order_batch_hash on public.stock_order_batch (file_hash) where file_hash is not null;

create table if not exists public.stock_order_batch_order (
  batch_id   uuid not null references public.stock_order_batch (id) on delete cascade,
  -- orders.id. Deliberately NOT a foreign key, like every other stock_room
  -- table: nothing here may lock or cascade into orders.
  order_id   uuid not null,
  order_ref  text,
  primary key (batch_id, order_id)
);
create index if not exists stock_order_batch_order_order on public.stock_order_batch_order (order_id);

alter table public.stock_order_batch       enable row level security;
alter table public.stock_order_batch_order enable row level security;

drop policy if exists stock_order_batch_read on public.stock_order_batch;
create policy stock_order_batch_read on public.stock_order_batch
  for select to authenticated using (public.stock_room_can_write());

drop policy if exists stock_order_batch_order_read on public.stock_order_batch_order;
create policy stock_order_batch_order_read on public.stock_order_batch_order
  for select to authenticated using (public.stock_room_can_write());

revoke all on public.stock_order_batch, public.stock_order_batch_order from anon;
grant select on public.stock_order_batch, public.stock_order_batch_order to authenticated;
-- Written only by the function below.
revoke insert, update, delete on public.stock_order_batch, public.stock_order_batch_order from authenticated;


-- ────────────────────────────────────────────────────────────
-- SECTION B — matching helpers.
-- Every one of these is EXACT: trim the ends, ignore letter case, nothing else.
-- ────────────────────────────────────────────────────────────

-- Same value? The one definition of "matches", used by every check below.
create or replace function public.stock_room__same(a text, b text)
returns boolean
language sql immutable
as $$ select lower(btrim(coalesce(a, ''))) = lower(btrim(coalesce(b, ''))) $$;

-- A garment option that is really absent. Mirrors hasGarmentOption()
-- (barcodeService.js): staff type "NA" for a line that genuinely has no top or
-- bottom, and a phantom barcode for one blocks the whole order at packaging.
create or replace function public.stock_room__blank_option(p text)
returns boolean
language sql immutable
as $$
  select btrim(coalesce(p, '')) = ''
      or lower(btrim(p)) in ('na', 'n/a', 'n.a.', 'none', '-')
$$;

-- text[] or jsonb array column -> text[]. products.available_size and
-- top_options/bottom_options are arrays; to_jsonb() flattens either shape.
create or replace function public.stock_room__list(p jsonb)
returns text[]
language sql immutable
as $$
  select coalesce(
    array(select jsonb_array_elements_text(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end)),
    '{}'::text[])
$$;

create or replace function public.stock_room__in_list(p_list text[], p_value text)
returns boolean
language sql immutable
as $$ select exists (select 1 from unnest(coalesce(p_list, '{}')) x where public.stock_room__same(x, p_value)) $$;

-- A hint for the error message only — never applied. Deliberately crude: the
-- first value sharing the first two letters. It exists so a person can spot a
-- typo, not so the import can "fix" one.
create or replace function public.stock_room__hint(p_values text[], p_value text)
returns text
language sql immutable
as $$
  select x from unnest(coalesce(p_values, '{}')) x
  where left(lower(btrim(x)), 2) = left(lower(btrim(p_value)), 2)
  order by abs(length(x) - length(p_value)), x
  limit 1
$$;

-- Colour by exact name -> {name, hex} as the order items store it. Raises with
-- a hint when it does not match.
create or replace function public.stock_room__colour(p_name text, p_row integer, p_field text)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_name text;
  v_hex  text;
  v_hint text;
begin
  if btrim(coalesce(p_name, '')) = '' then
    raise exception 'Row %: % is required.', p_row, p_field;
  end if;
  select c.name, c.hex into v_name, v_hex
  from public.colors c where public.stock_room__same(c.name, p_name) limit 1;
  if v_name is null then
    select public.stock_room__hint(array(select name from public.colors), p_name) into v_hint;
    raise exception 'Row %: colour "%" was not found.%', p_row, btrim(p_name),
      case when v_hint is null then ' The value must match a colour exactly.'
           else ' Did you mean ' || v_hint || '? The value must match exactly.' end;
  end if;
  return jsonb_build_object('name', v_name, 'hex', v_hex);
end $$;

-- Dupatta colours live in their own table (they gained a hex in migration 47).
create or replace function public.stock_room__dupatta_colour(p_name text, p_row integer)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_name text;
  v_hex  text;
  v_hint text;
begin
  if btrim(coalesce(p_name, '')) = '' then
    raise exception 'Row %: dupatta_color is required when the line includes a dupatta.', p_row;
  end if;
  select d.name, d.hex into v_name, v_hex
  from public.dupatta_colors d where public.stock_room__same(d.name, p_name) limit 1;
  if v_name is null then
    select public.stock_room__hint(array(select name from public.dupatta_colors), p_name) into v_hint;
    raise exception 'Row %: dupatta colour "%" was not found.%', p_row, btrim(p_name),
      case when v_hint is null then ' The value must match a dupatta colour exactly.'
           else ' Did you mean ' || v_hint || '? The value must match exactly.' end;
  end if;
  return jsonb_build_object('name', v_name, 'hex', v_hex);
end $$;

-- The production head a stock order may be assigned to.
--
-- ⚠ MIRRORS src/utils/stockProductionHead.js (STOCK_HEAD_OPTIONS) and the CHECK
-- constraint on orders.production_head_designation. The client asked to keep
-- today's list; opening it to every warehouse-role head means widening all
-- three together. Accepts the person's name or the designation itself.
create or replace function public.stock_room__stock_head(p_value text, p_ref text)
returns text
language plpgsql immutable
as $$
declare
  v_designation text;
begin
  if btrim(coalesce(p_value, '')) = '' then
    return null;              -- "Default (by channel)", exactly as the form
  end if;
  select h.designation into v_designation
  from (values
    ('Khushnuma Khan', 'Offline Production Head'),
    ('Tara Gupta',     'B2B Production Head')
  ) as h(name, designation)
  where public.stock_room__same(h.name, p_value) or public.stock_room__same(h.designation, p_value)
  limit 1;
  if v_designation is null then
    raise exception 'Order %: "%" is not a production head. Use the full name exactly: Khushnuma Khan or Tara Gupta.',
      coalesce(p_ref, '?'), btrim(p_value);
  end if;
  return v_designation;
end $$;


-- ────────────────────────────────────────────────────────────
-- SECTION C — minting the barcodes.
-- The SQL twin of generateOrderComponents (barcodeService.js) and migration
-- 35's backfill: TOP / BTM / DUP / EX<k>, with the "-<n>" suffix from the
-- second product onwards. A duplicate barcode raises, which fails that order
-- rather than putting an unscannable tag on the floor.
-- ────────────────────────────────────────────────────────────

create or replace function public.stock_room__mint_components(
  p_order_id uuid, p_order_no text, p_items jsonb)
returns text[]
language plpgsql security definer set search_path = public
as $$
declare
  v_store   text := split_part(p_order_no, '-', 2);
  v_parts   text[] := string_to_array(p_order_no, '-');
  v_seq     text;
  v_item    jsonb;
  v_i       integer := 0;
  v_suffix  text;
  v_label   text;
  v_extra   jsonb;
  v_k       integer;
  v_barcode text;
  v_codes   text[] := '{}';
  v_names_no_piece boolean;
begin
  v_seq := v_parts[array_length(v_parts, 1)];

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_suffix := case when v_i > 0 then (v_i + 1)::text else '' end;

    -- An item that names no garment part at all still needs one piece to track,
    -- which is what the product_name fallback is for. An "NA top + NA bottom"
    -- line (a lone dupatta) must NOT get that fallback — that is the phantom
    -- barcode the JS comment warns about.
    v_names_no_piece :=
      public.stock_room__blank_option(v_item ->> 'top')
      and public.stock_room__blank_option(v_item ->> 'bottom')
      and coalesce((v_item ->> 'includes_dupatta')::boolean, false) is not true
      and coalesce(jsonb_array_length(case when jsonb_typeof(v_item -> 'extras') = 'array'
                                           then v_item -> 'extras' else '[]'::jsonb end), 0) = 0;

    -- TOP
    if not public.stock_room__blank_option(v_item ->> 'top')
       or (v_names_no_piece and coalesce(v_item ->> 'product_name', '') <> '') then
      v_barcode := v_store || '-' || v_seq || '-TOP' || v_suffix;
      v_label := case when not public.stock_room__blank_option(v_item ->> 'top')
                      then v_item ->> 'top'
                      else coalesce(nullif(v_item ->> 'product_name', ''), 'Top') end;
      insert into public.order_components (order_id, order_no, barcode, component_type, component_label, item_index, extra_index)
      values (p_order_id, p_order_no, v_barcode, 'top', v_label, v_i, null);
      v_codes := v_codes || v_barcode;
    end if;

    -- BOTTOM
    if not public.stock_room__blank_option(v_item ->> 'bottom') then
      v_barcode := v_store || '-' || v_seq || '-BTM' || v_suffix;
      insert into public.order_components (order_id, order_no, barcode, component_type, component_label, item_index, extra_index)
      values (p_order_id, p_order_no, v_barcode, 'bottom', coalesce(nullif(v_item ->> 'bottom', ''), 'Bottom'), v_i, null);
      v_codes := v_codes || v_barcode;
    end if;

    -- DUPATTA. Labelled with the product name when it is the only piece on the
    -- line, exactly as the JS does — otherwise "Dupatta" tells them apart.
    if coalesce((v_item ->> 'includes_dupatta')::boolean, false) then
      v_barcode := v_store || '-' || v_seq || '-DUP' || v_suffix;
      v_label := case when public.stock_room__blank_option(v_item ->> 'top')
                       and public.stock_room__blank_option(v_item ->> 'bottom')
                      then coalesce(nullif(v_item ->> 'product_name', ''), 'Dupatta')
                      else 'Dupatta' end;
      insert into public.order_components (order_id, order_no, barcode, component_type, component_label, item_index, extra_index)
      values (p_order_id, p_order_no, v_barcode, 'dupatta', v_label, v_i, null);
      v_codes := v_codes || v_barcode;
    end if;

    -- EXTRAS — note the different suffix shape: "-EX<k>" then an optional
    -- "-<itemNo>" with a dash, not a bare digit.
    v_k := 0;
    for v_extra in select * from jsonb_array_elements(
      case when jsonb_typeof(v_item -> 'extras') = 'array' then v_item -> 'extras' else '[]'::jsonb end) loop
      v_k := v_k + 1;
      v_barcode := v_store || '-' || v_seq || '-EX' || v_k::text
                   || case when v_i > 0 then '-' || (v_i + 1)::text else '' end;
      insert into public.order_components (order_id, order_no, barcode, component_type, component_label, item_index, extra_index)
      values (p_order_id, p_order_no, v_barcode, 'extra',
              coalesce(nullif(v_extra ->> 'name', ''), 'Extra ' || v_k::text), v_i, v_k - 1);
      v_codes := v_codes || v_barcode;
    end loop;

    v_i := v_i + 1;
  end loop;

  -- Same last-resort as the JS: an order always has at least one scannable piece.
  if cardinality(v_codes) = 0 then
    v_barcode := v_store || '-' || v_seq || '-TOP';
    insert into public.order_components (order_id, order_no, barcode, component_type, component_label, item_index, extra_index)
    values (p_order_id, p_order_no, v_barcode, 'top',
            coalesce(nullif(p_items -> 0 ->> 'product_name', ''), 'Main Component'), 0, null);
    v_codes := v_codes || v_barcode;
  end if;

  return v_codes;
exception
  when unique_violation then
    raise exception 'Barcode % already exists, so this order was not created. Report it to the Production Head — the order number sequence needs checking.', v_barcode;
end $$;


-- ────────────────────────────────────────────────────────────
-- SECTION D — the one public function.
--
--   p_request  uuid    request id from the browser; a retry replays the stored
--                      result instead of raising every order twice
--   p_file     jsonb   { name, hash } for the batch record
--   p_orders   jsonb   [ { order_ref, channel, production_head, order_flag,
--                          urgent_reason, comments, delivery_notes,
--                          lines: [ { source_row, sku_id, design, size, quantity,
--                                     color, top, top_color, bottom, bottom_color,
--                                     includes_dupatta, dupatta_color,
--                                     extras: [{name, color}], category,
--                                     delivery_date, notes } ] } ]
--
-- returns { batch_id, created: [...], failed: [...] }
-- ────────────────────────────────────────────────────────────

create or replace function public.stock_room_bulk_stock_orders(
  p_request uuid,
  p_file    jsonb default '{}'::jsonb,
  p_orders  jsonb default '[]'::jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_prior     jsonb;
  v_batch     uuid := gen_random_uuid();
  v_actor     text := public.stock_room_actor();
  v_today     date := (now() at time zone 'Asia/Kolkata')::date;
  v_order     jsonb;
  v_line      jsonb;
  v_created   jsonb := '[]'::jsonb;
  v_failed    jsonb := '[]'::jsonb;
  v_lines_ok  integer := 0;
  v_result    jsonb;

  -- per order
  v_ref       text;
  v_channel   text;
  v_head      text;
  v_flag      text;
  v_reason    text;
  v_items     jsonb;
  v_rows      integer[];
  v_units     integer;
  v_due       date;
  v_order_no  text;
  v_order_id  uuid;
  v_codes     text[];
  v_lines_out jsonb;

  -- per line
  v_row       integer;
  v_prod      record;
  v_sizes     text[];
  v_size      text;
  v_qty       integer;
  v_date      date;
  v_item      jsonb;
  v_extras    jsonb;
  v_extra     jsonb;
  v_ex_name   text;
  v_hint      text;
begin
  -- Access + replay, exactly as every other Stock Room action.
  v_prior := public.stock_room__start(p_request, 'bulk_stock_orders');
  if v_prior is not null then return v_prior; end if;

  if jsonb_typeof(p_orders) <> 'array' or jsonb_array_length(p_orders) = 0 then
    raise exception 'There is nothing to import.';
  end if;
  if jsonb_array_length(p_orders) > 100 then
    raise exception 'A file may raise up to 100 orders. This one has %.', jsonb_array_length(p_orders);
  end if;

  insert into public.stock_order_batch (id, request_id, file_name, file_hash, actor_email)
  values (v_batch, p_request, nullif(p_file ->> 'name', ''), nullif(p_file ->> 'hash', ''), v_actor);

  -- ── one order at a time; each in its own exception block ──
  for v_order in select * from jsonb_array_elements(p_orders) loop
    v_ref   := coalesce(nullif(btrim(v_order ->> 'order_ref'), ''), '(no reference)');
    v_rows  := '{}';
    v_items := '[]'::jsonb;
    v_units := 0;
    v_due   := null;
    v_lines_out := '[]'::jsonb;

    begin
      -- ---- order level ----
      v_channel := lower(btrim(coalesce(v_order ->> 'channel', '')));
      if v_channel not in ('retail', 'b2b') then
        raise exception 'Order %: channel "%" is not valid. Use retail or b2b.', v_ref, coalesce(v_order ->> 'channel', '');
      end if;

      v_head := public.stock_room__stock_head(v_order ->> 'production_head', v_ref);

      v_flag := coalesce(nullif(btrim(v_order ->> 'order_flag'), ''), 'Normal');
      if not (public.stock_room__same(v_flag, 'Normal') or public.stock_room__same(v_flag, 'Urgent')) then
        raise exception 'Order %: order_flag must be Normal or Urgent.', v_ref;
      end if;
      v_flag := case when public.stock_room__same(v_flag, 'Urgent') then 'Urgent' else 'Normal' end;

      v_reason := nullif(btrim(coalesce(v_order ->> 'urgent_reason', '')), '');
      if v_flag = 'Urgent' and v_reason is null then
        raise exception 'Order %: an urgent order needs urgent_reason.', v_ref;
      end if;

      if jsonb_typeof(v_order -> 'lines') <> 'array' or jsonb_array_length(v_order -> 'lines') = 0 then
        raise exception 'Order %: has no lines.', v_ref;
      end if;

      -- ---- each line ----
      for v_line in select * from jsonb_array_elements(v_order -> 'lines') loop
        v_row  := coalesce((v_line ->> 'source_row')::integer, 0);
        v_rows := v_rows || v_row;

        -- product, by SKU or by an exact design name
        if btrim(coalesce(v_line ->> 'sku_id', '')) <> '' then
          select p.* into v_prod from public.products p
          where public.stock_room__same(p.sku_id, v_line ->> 'sku_id') limit 1;
          if v_prod.id is null then
            raise exception 'Row %: no product with SKU "%".', v_row, btrim(v_line ->> 'sku_id');
          end if;
        elsif btrim(coalesce(v_line ->> 'design', '')) <> '' then
          if (select count(*) from public.products p where public.stock_room__same(p.name, v_line ->> 'design')) > 1 then
            raise exception 'Row %: design "%" matches more than one product. Use the SKU.', v_row, btrim(v_line ->> 'design');
          end if;
          select p.* into v_prod from public.products p
          where public.stock_room__same(p.name, v_line ->> 'design') limit 1;
          if v_prod.id is null then
            raise exception 'Row %: no product named "%". The name must match exactly.', v_row, btrim(v_line ->> 'design');
          end if;
        else
          raise exception 'Row %: give a sku_id (or a design name).', v_row;
        end if;

        -- size: LXRTS sizes come from the variants, everything else from
        -- available_size. No stock is checked — only that the size is real.
        if coalesce(v_prod.sync_enabled, false) then
          select coalesce(array_agg(distinct pv.size), '{}') into v_sizes
          from public.product_variants pv where pv.product_id = v_prod.id and coalesce(pv.size, '') <> '';
        else
          v_sizes := public.stock_room__list(to_jsonb(v_prod.available_size));
        end if;

        v_size := btrim(coalesce(v_line ->> 'size', ''));
        if cardinality(v_sizes) = 0 then
          v_size := '';                                  -- design has no sizes: "One size"
        elsif v_size = '' then
          raise exception 'Row %: size is required. % has sizes: %.', v_row, v_prod.name, array_to_string(v_sizes, ', ');
        elsif not public.stock_room__in_list(v_sizes, v_size) then
          raise exception 'Row %: % has no size "%". Its sizes are: %.', v_row, v_prod.name, v_size, array_to_string(v_sizes, ', ');
        else
          select s into v_size from unnest(v_sizes) s where public.stock_room__same(s, v_size) limit 1;
        end if;

        -- quantity
        begin
          v_qty := (v_line ->> 'quantity')::integer;
        exception when others then
          raise exception 'Row %: quantity must be a whole number of 1 or more.', v_row;
        end;
        if v_qty is null or v_qty < 1 then
          raise exception 'Row %: quantity must be a whole number of 1 or more.', v_row;
        end if;
        v_units := v_units + v_qty;

        -- delivery date — never defaulted
        if btrim(coalesce(v_line ->> 'delivery_date', '')) = '' then
          raise exception 'Row %: delivery_date is required.', v_row;
        end if;
        begin
          v_date := (v_line ->> 'delivery_date')::date;
        exception when others then
          raise exception 'Row %: delivery_date "%" is not a date. Use YYYY-MM-DD.', v_row, v_line ->> 'delivery_date';
        end;
        if v_date < v_today then
          raise exception 'Row %: delivery date % is in the past.', v_row, to_char(v_date, 'YYYY-MM-DD');
        end if;
        v_due := least(coalesce(v_due, v_date), v_date);

        -- garment options must belong to the product
        if not public.stock_room__blank_option(v_line ->> 'top')
           and not public.stock_room__in_list(public.stock_room__list(to_jsonb(v_prod.top_options)), v_line ->> 'top') then
          v_hint := public.stock_room__hint(public.stock_room__list(to_jsonb(v_prod.top_options)), v_line ->> 'top');
          raise exception 'Row %: "%" is not a top option for %.%', v_row, btrim(v_line ->> 'top'), v_prod.name,
            case when v_hint is null then '' else ' Did you mean ' || v_hint || '?' end;
        end if;
        if not public.stock_room__blank_option(v_line ->> 'bottom')
           and not public.stock_room__in_list(public.stock_room__list(to_jsonb(v_prod.bottom_options)), v_line ->> 'bottom') then
          v_hint := public.stock_room__hint(public.stock_room__list(to_jsonb(v_prod.bottom_options)), v_line ->> 'bottom');
          raise exception 'Row %: "%" is not a bottom option for %.%', v_row, btrim(v_line ->> 'bottom'), v_prod.name,
            case when v_hint is null then '' else ' Did you mean ' || v_hint || '?' end;
        end if;

        -- extras: each one becomes its own barcode, so the name must be real
        v_extras := '[]'::jsonb;
        for v_extra in select * from jsonb_array_elements(
          case when jsonb_typeof(v_line -> 'extras') = 'array' then v_line -> 'extras' else '[]'::jsonb end) loop
          v_ex_name := btrim(coalesce(v_extra ->> 'name', ''));
          if v_ex_name = '' then continue; end if;
          if not exists (select 1 from public.extras e where public.stock_room__same(e.name, v_ex_name)) then
            select public.stock_room__hint(array(select name from public.extras), v_ex_name) into v_hint;
            raise exception 'Row %: extra "%" was not found.%', v_row, v_ex_name,
              case when v_hint is null then ' The value must match an extra exactly.'
                   else ' Did you mean ' || v_hint || '? The value must match exactly.' end;
          end if;
          select e.name into v_ex_name from public.extras e where public.stock_room__same(e.name, v_ex_name) limit 1;
          v_extras := v_extras || jsonb_build_object(
            'name', v_ex_name,
            'color', public.stock_room__colour(v_extra ->> 'color', v_row, 'the colour for extra "' || v_ex_name || '"'),
            'price', 0);
        end loop;

        -- the line, in the shape the order items array already uses
        v_item := jsonb_build_object(
          'product_id',        v_prod.id,
          'product_name',      v_prod.name,
          'sku_id',            v_prod.sku_id,
          'color',             public.stock_room__colour(v_line ->> 'color', v_row, 'color'),
          'top',               nullif(btrim(coalesce(v_line ->> 'top', '')), ''),
          'top_color',         case when public.stock_room__blank_option(v_line ->> 'top') then null
                                    else public.stock_room__colour(v_line ->> 'top_color', v_row, 'top_color') end,
          'bottom',            nullif(btrim(coalesce(v_line ->> 'bottom', '')), ''),
          'bottom_color',      case when public.stock_room__blank_option(v_line ->> 'bottom') then null
                                    else public.stock_room__colour(v_line ->> 'bottom_color', v_row, 'bottom_color') end,
          'includes_dupatta',  coalesce((v_line ->> 'includes_dupatta')::boolean, false),
          'dupatta_color',     case when coalesce((v_line ->> 'includes_dupatta')::boolean, false)
                                    then public.stock_room__dupatta_colour(v_line ->> 'dupatta_color', v_row) ->> 'name'
                                    else null end,
          'extras',            v_extras,
          'additionals',       '[]'::jsonb,
          'size',              v_size,
          'quantity',          v_qty,
          'price',             0,
          'measurements',      '{}'::jsonb,
          'image_url',         v_prod.image_url,
          'notes',             nullif(btrim(coalesce(v_line ->> 'notes', '')), ''),
          'isKids',            public.stock_room__same(v_line ->> 'category', 'Kids'),
          'category',          case when public.stock_room__same(v_line ->> 'category', 'Kids') then 'Kids' else 'Women' end,
          'is_gifting',        false,
          'is_custom_piece',   coalesce(v_prod.is_custom_piece, false),
          'order_type',        'Standard',
          'payment_order_type','Standard',
          'delivery_date',     to_char(v_date, 'YYYY-MM-DD'),
          'mode_of_delivery',  'WH Delhi',
          'sync_enabled',      coalesce(v_prod.sync_enabled, false),
          'shopify_product_id', v_prod.shopify_product_id);

        v_items := v_items || v_item;
        v_lines_out := v_lines_out || jsonb_build_object('source_row', v_row);
      end loop;

      -- 6 units per order, across its lines
      if v_units > 6 then
        raise exception 'Order %: asks for % units. An order may hold up to 6 units across its lines.', v_ref, v_units;
      end if;

      -- ---- the order itself ----
      v_order_no := public.generate_order_no(case when v_channel = 'retail' then 'Internal' else 'B2B Internal' end);
      if coalesce(v_order_no, '') = '' then
        raise exception 'Order %: could not generate an order number.', v_ref;
      end if;

      insert into public.orders (
        order_no, user_id, items, status,
        delivery_date, mode_of_delivery, order_flag, urgent_reason,
        comments, delivery_notes,
        subtotal, taxes, grand_total, total_quantity,
        order_type, payment_order_type, is_gifting,
        is_stock_order, production_head_designation,
        delivery_name, delivery_phone, delivery_email,
        created_at)
      values (
        v_order_no, auth.uid(), v_items, 'order_received',
        to_char(v_due, 'YYYY-MM-DD'), 'WH Delhi', v_flag, v_reason,
        nullif(btrim(coalesce(v_order ->> 'comments', '')), ''),
        nullif(btrim(coalesce(v_order ->> 'delivery_notes', '')), ''),
        0, 0, 0, v_units,
        'Standard', 'Standard', false,
        true, v_head,
        'Internal Stock', '', '',
        -- IST wall clock, the same convention the store and Shopify paths use
        -- (orders.created_at is timestamp WITHOUT time zone).
        (now() at time zone 'Asia/Kolkata'))
      returning id into v_order_id;

      v_codes := public.stock_room__mint_components(v_order_id, v_order_no, v_items);

      insert into public.stock_order_batch_order (batch_id, order_id, order_ref)
      values (v_batch, v_order_id, nullif(btrim(v_order ->> 'order_ref'), ''));

      v_created := v_created || jsonb_build_object(
        'order_ref',  nullif(btrim(v_order ->> 'order_ref'), ''),
        'order_no',   v_order_no,
        'order_id',   v_order_id,
        'channel',    v_channel,
        'units',      v_units,
        'rows',       to_jsonb(v_rows),
        'barcodes',   to_jsonb(v_codes));
      v_lines_ok := v_lines_ok + jsonb_array_length(v_lines_out);

    exception when others then
      -- This order alone is rolled back: no order row, no components, and the
      -- order number it may have taken is never used. Everything already
      -- created in this batch stands.
      v_failed := v_failed || jsonb_build_object(
        'order_ref', nullif(btrim(v_order ->> 'order_ref'), ''),
        'rows',      to_jsonb(v_rows),
        'error',     SQLERRM);
    end;
  end loop;

  update public.stock_order_batch
     set order_count  = jsonb_array_length(v_created),
         line_count   = v_lines_ok,
         failed_count = jsonb_array_length(v_failed)
   where id = v_batch;

  v_result := jsonb_build_object(
    'ok', true,
    'batch_id', v_batch,
    'created', v_created,
    'failed', v_failed);

  update public.stock_room_request set result = v_result where id = p_request;
  return v_result;
end $$;


-- ────────────────────────────────────────────────────────────
-- SECTION E — who may call what.
-- The helpers are internal; only the one public function is callable, and it
-- checks access itself through stock_room__start.
-- ────────────────────────────────────────────────────────────

revoke all on function
  public.stock_room__same(text, text),
  public.stock_room__blank_option(text),
  public.stock_room__list(jsonb),
  public.stock_room__in_list(text[], text),
  public.stock_room__hint(text[], text),
  public.stock_room__colour(text, integer, text),
  public.stock_room__dupatta_colour(text, integer),
  public.stock_room__stock_head(text, text),
  public.stock_room__mint_components(uuid, text, jsonb)
from public, anon, authenticated;

revoke all on function public.stock_room_bulk_stock_orders(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.stock_room_bulk_stock_orders(uuid, jsonb, jsonb) to authenticated;

notify pgrst, 'reload schema';


-- ------------------------------------------------------------
-- VERIFY (uat first)
-- ------------------------------------------------------------
-- 1) A dry single order. Expect one created order and its barcodes back:
--   select public.stock_room_bulk_stock_orders(
--     gen_random_uuid(),
--     '{"name":"verify.csv","hash":"test"}'::jsonb,
--     jsonb_build_array(jsonb_build_object(
--       'order_ref','V1','channel','retail','production_head','Khushnuma Khan',
--       'lines', jsonb_build_array(jsonb_build_object(
--         'source_row',2,'sku_id','<a real sku>','size','<a real size>','quantity',2,
--         'color','<a real colour>','delivery_date', to_char(now() + interval '10 days','YYYY-MM-DD')))));
--
-- 2) The order looks like one raised on the form (zero money, WH Delhi, stock flag):
--   select order_no, status, is_stock_order, mode_of_delivery, grand_total,
--          total_quantity, production_head_designation, delivery_name, created_at
--     from orders where order_no = '<the number from step 1>';
--
-- 3) Its pieces exist, inactive, at order_received:
--   select barcode, component_type, component_label, item_index, is_active, current_stage
--     from order_components where order_no = '<the number>' order by barcode;
--
-- 4) One bad order does not stop a good one — send two orders where the second
--    names a size that does not exist. Expect created = 1, failed = 1 with the
--    size message, and NO gap-filled order for the failed one:
--   select jsonb_array_length(r -> 'created'), jsonb_array_length(r -> 'failed') from (…) r;
--
-- 5) Replay: call it twice with the SAME p_request. The second call returns the
--    first result with "replayed": true and creates nothing new:
--   select count(*) from stock_order_batch where request_id = '<that request id>';  -- 1
--
-- 6) Over the unit ceiling is refused:
--    one order with lines of 4 + 4 units -> failed with "up to 6 units".
--
-- 7) Access: as a user who is not in stock_room_can_write(), the call raises
--    "You do not have access to change stock."
