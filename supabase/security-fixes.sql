-- Endurecimiento de la lista del club y de los cupones
-- Ejecuta esto en Supabase → SQL Editor → Run

-- ===========================================================================
-- 1) Lista del club: validar el correo en el servidor
-- ===========================================================================

alter table public.newsletter_subscribers
  add constraint newsletter_email_len check (length(email) <= 254);

alter table public.newsletter_subscribers
  add constraint newsletter_email_format
  check (email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$');

-- nadie puede modificar ni borrar correos desde el navegador
revoke update, delete on public.newsletter_subscribers from anon, authenticated;
grant insert on public.newsletter_subscribers to anon, authenticated;

-- ===========================================================================
-- 2) Cupones: el navegador deja de leer la tabla
--    (antes podía ver max_uses, used_count, etc.)
-- ===========================================================================

drop policy if exists "coupons_read_active" on public.coupons;
revoke select on public.coupons from anon, authenticated;

-- única vía pública: validar un código concreto
create or replace function public.check_coupon(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_code text := upper(trim(coalesce(p_code, '')));
  v_row public.coupons;
begin
  if v_code = '' or length(v_code) > 32 then
    return jsonb_build_object('valid', false, 'reason', 'invalid');
  end if;

  select * into v_row from public.coupons where code = v_code;

  if not found or not v_row.active then
    return jsonb_build_object('valid', false, 'reason', 'notfound');
  end if;

  if v_row.expires_at is not null and v_row.expires_at <= now() then
    return jsonb_build_object('valid', false, 'reason', 'expired');
  end if;

  if v_row.max_uses is not null and v_row.used_count >= v_row.max_uses then
    return jsonb_build_object('valid', false, 'reason', 'exhausted');
  end if;

  return jsonb_build_object('valid', true, 'code', v_row.code, 'percent', v_row.percent);
end;
$$;

revoke all on function public.check_coupon(text) from public;
revoke all on function public.check_coupon(text) from anon;
grant execute on function public.check_coupon(text) to anon, authenticated;

-- recordatorio: los cupones se pueden seguir gestionando desde el panel de Supabase.
