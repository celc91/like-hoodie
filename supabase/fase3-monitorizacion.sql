-- ---------------------------------------------------------------------------
-- Fase 3: monitorización de errores del cliente
--
-- Los errores se envían por RPC autenticada, con límite de 30/hora por sesión.
-- Solo el administrador puede leerlos. No se guardan datos de tarjetas ni PII.
-- ---------------------------------------------------------------------------

begin;

create table if not exists public.client_errors (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  message text not null,
  source text,
  stack text,
  path text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists client_errors_created_idx
  on public.client_errors (created_at desc);

alter table public.client_errors enable row level security;

drop policy if exists "client_errors_admin_select" on public.client_errors;
create policy "client_errors_admin_select"
  on public.client_errors for select
  using (public.is_admin());

grant select on public.client_errors to authenticated;
grant all on public.client_errors to service_role;

create or replace function public.log_client_error(
  p_message text,
  p_source text default '',
  p_stack text default '',
  p_path text default '',
  p_user_agent text default ''
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_count integer;
begin
  if v_uid is null then
    return false;
  end if;

  if length(trim(coalesce(p_message, ''))) = 0 then
    return false;
  end if;

  select count(*) into v_count
    from public.client_errors
   where user_id = v_uid
     and created_at > now() - interval '1 hour';

  if v_count >= 30 then
    return false;
  end if;

  insert into public.client_errors (
    user_id, message, source, stack, path, user_agent
  ) values (
    v_uid,
    left(coalesce(p_message, ''), 500),
    left(coalesce(p_source, ''), 200),
    left(coalesce(p_stack, ''), 2000),
    left(coalesce(p_path, ''), 180),
    left(coalesce(p_user_agent, ''), 200)
  );

  return true;
end;
$$;

revoke all on function public.log_client_error(text, text, text, text, text) from public;
grant execute on function public.log_client_error(text, text, text, text, text)
  to authenticated;

commit;
