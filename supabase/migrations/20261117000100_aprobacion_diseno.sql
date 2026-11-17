-- ---------------------------------------------------------------------------
-- Fase 16: aprobación del diseño antes de imprimir
-- ---------------------------------------------------------------------------

begin;

alter table public.orders
  add column if not exists design_approval_status text not null default 'pending',
  add column if not exists design_approved_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.orders'::regclass
       and conname = 'orders_design_approval_status_chk'
  ) then
    alter table public.orders
      add constraint orders_design_approval_status_chk
      check (design_approval_status in ('pending', 'sent', 'approved', 'rejected'));
  end if;
end
$$;

create index if not exists orders_design_approval_idx
  on public.orders (design_approval_status, created_at desc);

notify pgrst, 'reload schema';

commit;
