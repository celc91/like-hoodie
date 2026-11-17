-- Estadísticas del panel (Edge Function `stats`)
--
-- La función corre con service_role para leer el último envío de la Conversions
-- API. `meta_last_response()` está revocada para el navegador; sin este grant el
-- service_role tampoco puede ejecutarla.
--
-- Ejecutar una vez en el SQL Editor de Supabase.

grant execute on function public.meta_last_response() to service_role;

-- La función reutiliza el token de Conversions API que ya vive en Vault para
-- consultar Ads Insights. Solo service_role puede leerlo: nunca llega al
-- navegador. Si algún día se prefiere un token aparte, basta con definir el
-- secreto META_ACCESS_TOKEN en la Edge Function.
create or replace function public.stats_meta_token()
returns text
language sql
stable
security definer
set search_path = public, vault
as $$
  select decrypted_secret
    from vault.decrypted_secrets
   where name = 'meta_capi_token'
   limit 1;
$$;

revoke all on function public.stats_meta_token() from public;
revoke all on function public.stats_meta_token() from anon;
revoke all on function public.stats_meta_token() from authenticated;
grant execute on function public.stats_meta_token() to service_role;
