# Seguridad

## Reportar una vulnerabilidad

No abras un issue público para fallos de seguridad. Escribe a
**hola@likehoodie.com** con:

- Descripción del problema y dónde ocurre (URL, función, endpoint).
- Pasos para reproducirlo.
- Impacto que crees que tiene.
- Si quieres, una prueba de concepto.

Respondemos en un máximo de 72 horas laborables. Si el fallo afecta a datos de
clientes o pagos, priorizamos la corrección antes de cualquier otra tarea.

## Alcance

Este repositorio incluye el sitio estático, el panel de administración, las
políticas SQL y las Edge Functions de Supabase. También es relevante:

- El bucket privado `order-logos` (originales) y `order-prints` (derivados).
- La Edge Function `process-logo`.
- Las funciones de Clip (`clip-checkout`, `clip-pay`, `clip-webhook`).
- La autenticación de Supabase y la tabla `profiles` con el rol de administrador.

## Prácticas del proyecto

- Las claves secretas viven en **Supabase Vault/secrets**, nunca en el repo.
- La publishable key de Supabase puede ser pública: RLS protege los datos.
- Los precios y los totales se validan en el servidor (`place_order`), no en el
  navegador.
- Los logos y prints se sirven con enlaces firmados de una hora.
- Los buckets son privados; el print solo lo puede leer un administrador.
- El checkout real de Clip está desactivado por defecto.

## Si se filtra una credencial

1. Revócala en el proveedor (Supabase, GitHub, Clip, Resend).
2. Crea una nueva y actualízala en Supabase secrets o en el archivo local que
   corresponda (fuera del repo).
3. Revisa los logs de Supabase y del proveedor por accesos no autorizados.
4. Si afecta a clientes, comunícalo según corresponda.
