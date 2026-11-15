-- ---------------------------------------------------------------------------
-- Fase 11: precios por producto (sudadera y tote)
--
-- Corrige dos fallos de checkout:
--   1. El blanco (#ffffff) no estaba en product_prices y fallaba al pagar.
--   2. El tote usaba los precios de la sudadera y sus materiales no existían.
--
-- Ejecutar en Supabase → SQL Editor o con `supabase db query --file`.
-- Es idempotente: se puede volver a ejecutar.
-- ---------------------------------------------------------------------------

begin;

alter table public.product_prices
  add column if not exists product text not null default 'hoodie';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.product_prices'::regclass
       and conname = 'product_prices_product_chk'
  ) then
    alter table public.product_prices
      add constraint product_prices_product_chk
      check (product in ('hoodie', 'tote'));
  end if;
end
$$;

-- La PK original era (kind, key). La cambiamos a (product, kind, key).
do $$
declare
  v_cols text;
begin
  select string_agg(a.attname, ',' order by a.attname)
    into v_cols
    from pg_constraint c
    join unnest(c.conkey) k(attnum) on true
    join pg_attribute a
      on a.attrelid = c.conrelid
     and a.attnum = k.attnum
   where c.conrelid = 'public.product_prices'::regclass
     and c.contype = 'p';

  if v_cols is null or position('product' in v_cols) = 0 then
    alter table public.product_prices
      drop constraint if exists product_prices_pkey;
    alter table public.product_prices
      add constraint product_prices_pkey primary key (product, kind, key);
  end if;
end
$$;

insert into public.product_prices (product, kind, key, amount) values
  -- Sudadera
  ('hoodie', 'color', '#1c1c1f', 899),
  ('hoodie', 'color', '#ffffff', 949),
  ('hoodie', 'color', '#efe6d6', 949),
  ('hoodie', 'color', '#cdf25a', 969),
  ('hoodie', 'color', '#f2603c', 949),
  ('hoodie', 'color', '#26324f', 899),
  ('hoodie', 'color', '#efb7c4', 899),
  ('hoodie', 'material', 'cotton400', 0),
  ('hoodie', 'material', 'cotton320', -50),
  ('hoodie', 'material', 'french300', -30),
  ('hoodie', 'material', 'blend350', -20),
  ('hoodie', 'material', 'polyester280', 20),
  ('hoodie', 'technique', 'dtg', 0),
  ('hoodie', 'technique', 'dtf', 39),
  ('hoodie', 'technique', 'bordado', 149),
  ('hoodie', 'technique', 'serigrafia', 129),
  ('hoodie', 'technique', 'vinilo', 49),
  ('hoodie', 'technique', 'sublimacion', 49),
  -- Tote
  ('tote', 'color', '#efe6d6', 349),
  ('tote', 'color', '#ffffff', 379),
  ('tote', 'color', '#1c1c1f', 379),
  ('tote', 'color', '#cdf25a', 379),
  ('tote', 'color', '#f2603c', 379),
  ('tote', 'color', '#26324f', 379),
  ('tote', 'color', '#efb7c4', 379),
  ('tote', 'material', 'loneta12', 0),
  ('tote', 'material', 'loneta10', -40),
  ('tote', 'material', 'reciclada', 30),
  ('tote', 'technique', 'dtf', 0),
  ('tote', 'technique', 'serigrafia', 129),
  ('tote', 'technique', 'vinilo', 49),
  ('tote', 'technique', 'bordado', 99),
  -- Ajustes globales
  ('hoodie', 'setting', 'logo_price', 99),
  ('hoodie', 'setting', 'xxl_price', 49),
  ('hoodie', 'setting', 'free_shipping', 1200),
  ('hoodie', 'setting', 'shipping', 99)
on conflict (product, kind, key) do update set amount = excluded.amount;

create or replace function public.item_unit_price(p_item jsonb)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_product text := lower(coalesce(nullif(p_item->>'product', ''), 'hoodie'));
  v_color text := lower(coalesce(p_item->>'colorHex', ''));
  v_material text := nullif(p_item->>'materialId', '');
  v_technique text := nullif(p_item->>'techniqueId', '');
  v_base integer;
  v_material_delta integer;
  v_technique_fee integer;
  v_logo_price integer;
  v_xxl_price integer;
  v_logos integer := 0;
begin
  if v_product not in ('hoodie', 'tote') then
    raise exception 'Producto no válido' using errcode = '22023';
  end if;

  if v_material is null then
    v_material := case p_item->>'materialName'
      when 'Algodón 400 g' then 'cotton400'
      when 'Algodón 320 g' then 'cotton320'
      when 'French terry 300 g' then 'french300'
      when 'French terry' then 'french300'
      when 'Mezcla 50/50' then 'blend350'
      when 'Poliéster técnico' then 'polyester280'
      when 'Loneta 12 oz' then 'loneta12'
      when 'Loneta 10 oz' then 'loneta10'
      when 'Lona reciclada' then 'reciclada'
      else null
    end;
  end if;

  if v_technique is null then
    v_technique := case p_item->>'techniqueName'
      when 'DTG' then 'dtg'
      when 'DTF' then 'dtf'
      when 'Bordado' then 'bordado'
      when 'Serigrafía' then 'serigrafia'
      when 'Vinilo textil' then 'vinilo'
      when 'Sublimación' then 'sublimacion'
      else null
    end;
  end if;

  select amount into v_base
    from public.product_prices
   where product = v_product
     and kind = 'color'
     and key = v_color;

  if v_base is null then
    raise exception 'Color no válido' using errcode = '22023';
  end if;

  select amount into v_material_delta
    from public.product_prices
   where product = v_product
     and kind = 'material'
     and key = v_material;

  if v_material_delta is null then
    raise exception 'Material no válido' using errcode = '22023';
  end if;

  select amount into v_technique_fee
    from public.product_prices
   where product = v_product
     and kind = 'technique'
     and key = v_technique;

  if v_technique_fee is null then
    raise exception 'Técnica no válida' using errcode = '22023';
  end if;

  select amount into v_logo_price
    from public.product_prices
   where kind = 'setting' and key = 'logo_price'
   limit 1;

  select amount into v_xxl_price
    from public.product_prices
   where kind = 'setting' and key = 'xxl_price'
   limit 1;

  if coalesce(p_item->'front'->>'logoName', '') <> ''
     or coalesce(p_item->'front'->>'logoPath', '') <> ''
     or coalesce(p_item->'front'->>'logoData', '') <> '' then
    v_logos := v_logos + 1;
  end if;

  if coalesce(p_item->'back'->>'logoName', '') <> ''
     or coalesce(p_item->'back'->>'logoPath', '') <> ''
     or coalesce(p_item->'back'->>'logoData', '') <> '' then
    v_logos := v_logos + 1;
  end if;

  return v_base
    + v_material_delta
    + v_technique_fee
    + (v_logos * coalesce(v_logo_price, 99))
    + case when p_item->>'size' = 'XXL' then coalesce(v_xxl_price, 49) else 0 end;
end;
$function$;

revoke all on function public.item_unit_price(jsonb) from public;
revoke all on function public.item_unit_price(jsonb) from anon;
revoke all on function public.item_unit_price(jsonb) from authenticated;

notify pgrst, 'reload schema';

commit;
