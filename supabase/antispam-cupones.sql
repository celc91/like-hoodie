-- Límite de intentos para validar cupones (evita enumeración de códigos)
-- Ejecuta esto en Supabase → SQL Editor → Run

create table if not exists public.coupon_attempts (
  id bigint generated always as identity primary key,
  ip text not null,
  created_at timestamptz not null default now()
);

create index if not exists coupon_attempts_ip_time
  on public.coupon_attempts (ip, created_at desc);

alter table public.coupon_attempts enable row level security;
revoke all on public.coupon_attempts from anon, authenticated;

create or replace function public.check_coupon(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text := upper(trim(coalesce(p_code, '')));
  v_row public.coupons;
  v_ip text;
  v_recent integer;
begin
  if v_code = '' or length(v_code) > 32 then
    return jsonb_build_object('valid', false, 'reason', 'invalid');
  end if;

  v_ip := coalesce(
    nullif(
      split_part(
        coalesce(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''),
        ',', 1
      ),
      ''
    ),
    'unknown'
  );
  v_ip := left(trim(v_ip), 64);

  delete from public.coupon_attempts
  where created_at < now() - interval '2 days';

  select count(*) into v_recent
  from public.coupon_attempts
  where ip = v_ip and created_at > now() - interval '1 hour';

  -- 30 intentos por hora: margen de sobra para una persona, inviable para escanear
  if v_recent >= 30 then
    return jsonb_build_object('valid', false, 'reason', 'rate');
  end if;

  insert into public.coupon_attempts (ip) values (v_ip);

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

-- Ver intentos sospechosos:
-- select ip, count(*) from public.coupon_attempts
-- where created_at > now() - interval '1 day' group by ip order by 2 desc limit 20;
