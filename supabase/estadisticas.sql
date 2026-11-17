-- Estadísticas del panel (Edge Function `stats`)
--
-- La función corre con service_role para leer el último envío de la Conversions
-- API. `meta_last_response()` está revocada para el navegador; sin este grant el
-- service_role tampoco puede ejecutarla.
--
-- Ejecutar una vez en el SQL Editor de Supabase.

grant execute on function public.meta_last_response() to service_role;
