-- PASO 1 de 3 · columnas de confirmación
-- Pega SOLO este archivo y pulsa Run. No uses el botón de IA del editor.

alter table public.newsletter_subscribers
  add column if not exists confirmed boolean not null default false;

alter table public.newsletter_subscribers
  add column if not exists token uuid not null default gen_random_uuid();

alter table public.newsletter_subscribers
  add column if not exists confirmed_at timestamptz;

alter table public.newsletter_subscribers
  add column if not exists unsubscribed_at timestamptz;

create unique index if not exists newsletter_subscribers_token_key
  on public.newsletter_subscribers (token);

update public.newsletter_subscribers
   set confirmed = true,
       confirmed_at = coalesce(confirmed_at, created_at)
 where confirmed = false;
