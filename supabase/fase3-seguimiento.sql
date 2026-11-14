-- ---------------------------------------------------------------------------
-- Fase 3: seguimiento de pedidos
--
-- 1. Guarda paquetería, número de guía y URL de seguimiento.
-- 2. Expone una consulta pública mínima: número de pedido + correo exacto.
--    No devuelve dirección, teléfono ni nombre completo.
--
-- Ejecutar con:
--   npx supabase db query --remote --file supabase/fase3-seguimiento.sql --yes
-- ---------------------------------------------------------------------------

begin;

alter table public.orders
  add column if not exists carrier text,
  add column if not exists tracking_number text,
  add column if not exists tracking_url text;

create or replace function public.get_order_status(
  p_number bigint,
  p_email text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_email text := lower(trim(coalesce(p_email, '')));
  v_items jsonb;
begin
  if p_number is null or p_number < 1 or length(v_email) < 5 then
    return jsonb_build_object('found', false);
  end if;

  select * into v_order
    from public.orders
   where number = p_number
     and lower(email) = v_email
   limit 1;

  if not found then
    -- Frena un poco los intentos de enumeración sin bloquear la consulta.
    perform pg_sleep(0.15);
    return jsonb_build_object('found', false);
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'name', left(coalesce(item->>'name', 'Sudadera'), 120),
        'qty', greatest(1, least(99, coalesce((item->>'qty')::int, 1))),
        'size', left(coalesce(item->>'size', ''), 10),
        'color', left(coalesce(item->>'colorName', ''), 40)
      )
    ),
    '[]'::jsonb
  )
  into v_items
  from jsonb_array_elements(v_order.items) as item;

  return jsonb_build_object(
    'found', true,
    'number', v_order.number,
    'status', v_order.status,
    'payment_status', v_order.payment_status,
    'created_at', v_order.created_at,
    'updated_at', v_order.updated_at,
    'item_count', v_order.item_count,
    'total', v_order.total,
    'carrier', v_order.carrier,
    'tracking_number', v_order.tracking_number,
    'tracking_url', v_order.tracking_url,
    'items', v_items
  );
end;
$$;

revoke all on function public.get_order_status(bigint, text) from public;
grant execute on function public.get_order_status(bigint, text) to anon, authenticated;

commit;
