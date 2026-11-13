-- like hoodie ♡ — archivos de impresión (logo_assets)
-- Ejecutar en Supabase → SQL Editor, después de schema.sql y storage-logos.sql.

-- ---------------------------------------------------------------------------
-- Tabla de assets: original, recorte y archivo final para DTG
-- ---------------------------------------------------------------------------

create table if not exists public.logo_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  source_path text not null,
  cutout_path text,
  print_path text,
  side text not null default 'front' check (side in ('front', 'back')),
  product text not null default 'hoodie' check (product in ('hoodie', 'tote')),
  width_cm numeric not null check (width_cm > 0 and width_cm <= 60),
  target_dpi integer not null default 300 check (target_dpi between 72 and 600),
  output_width integer,
  output_height integer,
  output_dpi integer,
  upscale numeric,
  cutout boolean not null default false,
  status text not null default 'queued'
    check (status in ('queued', 'cutout', 'cutout_ready', 'resizing', 'ready', 'review', 'failed')),
  warnings jsonb not null default '[]'::jsonb check (jsonb_typeof(warnings) = 'array'),
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists logo_assets_user_idx on public.logo_assets (user_id, created_at desc);
create index if not exists logo_assets_status_idx on public.logo_assets (status);

drop trigger if exists logo_assets_touch_updated_at on public.logo_assets;
create trigger logo_assets_touch_updated_at
  before update on public.logo_assets
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: el visitante crea y lee sus assets; el admin lo ve todo.
-- El procesado escribe con service_role (bypassa RLS).
-- ---------------------------------------------------------------------------

alter table public.logo_assets enable row level security;

drop policy if exists "logo_assets_select_own" on public.logo_assets;
create policy "logo_assets_select_own"
  on public.logo_assets for select
  to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists "logo_assets_insert_own" on public.logo_assets;
create policy "logo_assets_insert_own"
  on public.logo_assets for insert
  to authenticated
  with check (user_id = auth.uid());

grant select, insert on public.logo_assets to authenticated;
grant all on public.logo_assets to service_role;
grant select on public.logo_assets to anon;

-- ---------------------------------------------------------------------------
-- Bucket privado para recortes y archivos de impresión
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'order-prints',
  'order-prints',
  false,
  26214400,
  array['image/png']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "order_prints_select_admin" on storage.objects;
create policy "order_prints_select_admin"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'order-prints' and public.is_admin());
