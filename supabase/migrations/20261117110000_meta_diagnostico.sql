-- Q-07 / C.4: MEDICION.md pide ejecutar meta_last_response() como administrador,
-- pero el SQL la revocaba a authenticated y no comprobaba is_admin().
-- Ahora exige admin con aal2, igual que el resto del panel.
--
-- Idempotente.

create or replace function public.meta_last_response()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, net
as $$
begin
  if not public.is_admin() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  return (
    select jsonb_build_object(
      'status', r.status_code,
      'body', left(r.content, 800),
      'cuando', r.created
    )
    from net._http_response r
    order by r.id desc
    limit 1
  );
end;
$$;

revoke all on function public.meta_last_response() from public, anon;
grant execute on function public.meta_last_response() to authenticated;
