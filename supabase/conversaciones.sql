-- Embudo de ventas del panel: conversaciones de Marketplace, anuncios y WhatsApp.
-- El registro es manual (Meta no expone los chats de Marketplace por API).
-- Solo el administrador con MFA puede leerlos o modificarlos.

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  name text not null check (char_length(name) between 1 and 80),
  source text not null default 'marketplace'
    check (source in ('marketplace', 'meta_ads', 'whatsapp', 'instagram', 'web', 'otro')),
  product text not null default ''
    check (char_length(product) <= 120),
  stage text not null default 'nuevo'
    check (stage in ('nuevo', 'respondido', 'interesado', 'apartado', 'cerrado', 'perdido')),
  amount integer not null default 0
    check (amount >= 0 and amount <= 100000),
  notes text not null default ''
    check (char_length(notes) <= 1000)
);

create index if not exists conversations_stage_idx
  on public.conversations (stage, created_at desc);

alter table public.conversations enable row level security;

drop policy if exists "conversations_admin_all" on public.conversations;
create policy "conversations_admin_all" on public.conversations
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant select, insert, update, delete on public.conversations to authenticated;

create or replace function public.touch_conversations()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists conversations_touch on public.conversations;
create trigger conversations_touch
  before update on public.conversations
  for each row execute function public.touch_conversations();

revoke all on function public.touch_conversations() from public;
revoke all on function public.touch_conversations() from anon;
revoke all on function public.touch_conversations() from authenticated;
