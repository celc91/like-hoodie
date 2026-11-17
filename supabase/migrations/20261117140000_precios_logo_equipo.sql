-- Cierra dos formas de pagar de menos detectadas en la revisión del 17:
--   - un articulo con logoAssetId o printPath pero sin logoName/Path/Data no
--     pagaba el suplemento de logo;
--   - un articulo con rosterNumber pero sin rosterName no pagaba el de equipo.
--
-- El tamano de impresion (printSize) sigue siendo una eleccion del cliente que
-- el servidor no puede verificar; queda documentado como riesgo de negocio.
--
-- Idempotente.

create or replace function public.item_unit_price(
  p_item jsonb,
  p_qty integer default null
)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_product text := lower(coalesce(nullif(p_item->>'product', ''), 'hoodie'));
  v_qty integer := greatest(1, least(999, coalesce(p_qty, (p_item->>'qty')::int, 1)));
  v_color text := lower(coalesce(p_item->>'colorHex', ''));
  v_material text := nullif(p_item->>'materialId', '');
  v_technique text := nullif(p_item->>'techniqueId', '');
  v_print_size text := lower(coalesce(nullif(p_item->>'printSize', ''), 'logo'));
  v_base integer;
  v_material_delta integer;
  v_technique_fee integer;
  v_print_fee integer := 0;
  v_name_fee integer := 0;
  v_logo_price integer;
  v_xxl_price integer;
  v_discount_pct integer := 0;
  v_logos integer := 0;
  v_unit integer;
begin
  if v_product not in ('hoodie', 'tote') then
    raise exception 'Producto no válido' using errcode = '22023';
  end if;

  if v_print_size not in ('logo', 'carta', 'doble_carta') then
    raise exception 'Tamaño de impresión no válido' using errcode = '22023';
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
   where product = v_product and kind = 'color' and key = v_color;

  if v_base is null then
    raise exception 'Color no válido' using errcode = '22023';
  end if;

  select amount into v_material_delta
    from public.product_prices
   where product = v_product and kind = 'material' and key = v_material;

  if v_material_delta is null then
    raise exception 'Material no válido' using errcode = '22023';
  end if;

  select amount into v_technique_fee
    from public.product_prices
   where product = v_product and kind = 'technique' and key = v_technique;

  if v_technique_fee is null then
    raise exception 'Técnica no válida' using errcode = '22023';
  end if;

  select amount into v_print_fee
    from public.product_prices
   where kind = 'setting' and key = 'print_' || v_print_size || '_fee'
   limit 1;
  v_print_fee := coalesce(v_print_fee, 0);

  if coalesce(p_item->>'nameNumber', 'false') = 'true'
     or coalesce(p_item->>'rosterName', '') <> ''
     or coalesce(p_item->>'rosterNumber', '') <> '' then
    select amount into v_name_fee
      from public.product_prices
     where kind = 'setting' and key = 'name_number_fee'
     limit 1;
    v_name_fee := coalesce(v_name_fee, 0);
  end if;

  select amount into v_logo_price
    from public.product_prices
   where kind = 'setting' and key = 'logo_price'
   limit 1;

  select amount into v_xxl_price
    from public.product_prices
   where kind = 'setting' and key = 'xxl_price'
   limit 1;

  select amount into v_discount_pct
    from public.product_prices
   where kind = 'setting'
     and key = case
       when v_qty >= 48 then 'tier_48_discount'
       when v_qty >= 24 then 'tier_24_discount'
       when v_qty >= 12 then 'tier_12_discount'
       else 'tier_1_discount'
     end
   limit 1;
  v_discount_pct := coalesce(v_discount_pct, 0);

  if coalesce(p_item->'front'->>'logoName', '') <> ''
     or coalesce(p_item->'front'->>'logoPath', '') <> ''
     or coalesce(p_item->'front'->>'logoData', '') <> ''
     or coalesce(p_item->'front'->>'logoAssetId', '') <> ''
     or coalesce(p_item->'front'->>'printPath', '') <> '' then
    v_logos := v_logos + 1;
  end if;

  if coalesce(p_item->'back'->>'logoName', '') <> ''
     or coalesce(p_item->'back'->>'logoPath', '') <> ''
     or coalesce(p_item->'back'->>'logoData', '') <> ''
     or coalesce(p_item->'back'->>'logoAssetId', '') <> ''
     or coalesce(p_item->'back'->>'printPath', '') <> '' then
    v_logos := v_logos + 1;
  end if;

  v_unit := v_base
    + v_material_delta
    + v_technique_fee
    + v_print_fee
    + v_name_fee
    + (v_logos * coalesce(v_logo_price, 99))
    + case when p_item->>'size' = 'XXL' then coalesce(v_xxl_price, 49) else 0 end;

  return greatest(0, round(v_unit * (100 - v_discount_pct) / 100.0)::integer);
end;
$function$;

revoke all on function public.item_unit_price(jsonb, integer) from public, anon, authenticated;

notify pgrst, 'reload schema';
