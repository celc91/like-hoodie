-- ---------------------------------------------------------------------------
-- Fase 8: MFA obligatorio para el panel de administración
--
-- `is_admin()` solo devuelve true cuando la sesión tiene MFA verificado
-- (aal2) y el perfil tiene rol admin. Así el MFA no se puede saltar llamando
-- directamente a la API con un token de contraseña (aal1).
-- ---------------------------------------------------------------------------

begin;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
     and exists (
       select 1 from public.profiles
       where id = auth.uid() and role = 'admin'
     );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

commit;
