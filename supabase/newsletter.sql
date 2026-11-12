-- Lista del Club like hoodie
-- Ejecuta esto en Supabase → SQL Editor → Run

create table if not exists public.newsletter_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  source text default 'web',
  created_at timestamptz not null default now()
);

-- un correo no puede repetirse
create unique index if not exists newsletter_subscribers_email_key
  on public.newsletter_subscribers (lower(email));

alter table public.newsletter_subscribers enable row level security;

-- cualquiera puede darse de alta, nadie puede leer la lista desde el navegador
drop policy if exists "newsletter_insert_public" on public.newsletter_subscribers;
create policy "newsletter_insert_public"
  on public.newsletter_subscribers
  for insert
  to anon, authenticated
  with check (true);

grant insert on public.newsletter_subscribers to anon, authenticated;

-- Para ver la lista (solo desde el panel de Supabase, con tu cuenta):
-- select email, created_at from public.newsletter_subscribers order by created_at desc;
