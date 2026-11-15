-- ---------------------------------------------------------------------------
-- Fase 14: cupón único por suscriptor
--
-- El código BIENVENIDA10 deja de ser el código principal y pasa a ser legado.
-- Cada alta confirmada recibe un código único, de un solo uso y 90 días.
-- ---------------------------------------------------------------------------

begin;

alter table public.newsletter_subscribers
  add column if not exists coupon_code text;

create unique index if not exists newsletter_subscribers_coupon_code_key
  on public.newsletter_subscribers (coupon_code)
  where coupon_code is not null;

create or replace function public.confirm_newsletter(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_row public.newsletter_subscribers;
  v_code text;
  v_percent integer;
begin
  select * into v_row
    from public.newsletter_subscribers
   where token = p_token
   limit 1
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'notfound');
  end if;

  if v_row.unsubscribed_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'unsubscribed');
  end if;

  if not v_row.confirmed then
    update public.newsletter_subscribers
       set confirmed = true,
           confirmed_at = now()
     where id = v_row.id;
  end if;

  if v_row.coupon_code is not null then
    select percent into v_percent
      from public.coupons
     where code = v_row.coupon_code;

    return jsonb_build_object(
      'ok', true,
      'code', v_row.coupon_code,
      'percent', coalesce(v_percent, 10)
    );
  end if;

  v_code := 'LH-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));

  insert into public.coupons (
    code, percent, active, max_uses, used_count, expires_at
  ) values (
    v_code, 10, true, 1, 0, now() + interval '90 days'
  );

  update public.newsletter_subscribers
     set coupon_code = v_code
   where id = v_row.id;

  return jsonb_build_object('ok', true, 'code', v_code, 'percent', 10);
end;
$fn$;

revoke all on function public.confirm_newsletter(uuid) from public;
grant execute on function public.confirm_newsletter(uuid) to anon, authenticated;

-- El código antiguo sigue vivo para quienes ya lo recibieron, pero deja de ser
-- ilimitado. Los nuevos suscriptores reciben un código único.
update public.coupons
   set max_uses = coalesce(max_uses, 1000),
       expires_at = coalesce(expires_at, now() + interval '1 year')
 where code = 'BIENVENIDA10';

notify pgrst, 'reload schema';

commit;
