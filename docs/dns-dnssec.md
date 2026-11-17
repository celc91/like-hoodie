# DNSSEC de likehoodie.com

## Estado

- DNS y registrador: **Cloudflare**.
- Nameservers: `ashley.ns.cloudflare.com`, `carter.ns.cloudflare.com`.
- Registro DS: **pendiente** (comprobado con `node scripts/check-dns.mjs`).
- Sin DS, los resolutores no pueden validar DNSSEC aunque Cloudflare firme la
  zona.

## Activarlo

1. Entra en <https://dash.cloudflare.com> con la cuenta del dominio.
2. Selecciona **likehoodie.com → DNS → Settings**.
3. Activa **DNSSEC**.
4. Cloudflare es también el registrador, así que publica el DS directamente.
   Si la pantalla muestra un **DS record** y no lo publica sola, cópialo y
   añádelo en **Domain Registration → Manage → DNSSEC**.
5. Espera la propagación (de minutos a 24 h) y verifica:

   ```sh
   node scripts/check-dns.mjs
   ```

   Debe mostrar `Registros DS: 1` o más y `Validación DNSSEC (AD): sí`.

## Seguridad

- No cambies los nameservers para activar DNSSEC.
- Si el DS no coincide con la zona, el dominio puede dejar de resolver en
  resolutores validadores. Guarda el DS que muestra Cloudflare antes de
  publicarlo.
- El workflow **Disponibilidad** avisa con un `warning` mientras falte el DS,
  pero no falla para no generar incidencias diarias por un pendiente conocido.
