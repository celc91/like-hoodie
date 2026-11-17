# DNSSEC de likehoodie.com

## Estado

- DNS y registrador: **Cloudflare**.
- Nameservers: `ashley.ns.cloudflare.com`, `carter.ns.cloudflare.com`.
- DNSSEC: **activo y validado** desde el 17 de noviembre de 2026.
- DS publicado en el registro `.com`:

  ```text
  likehoodie.com. 3600 IN DS 2371 13 2
  31AEB0FC067B281933D9BE9BDE3325F4D50C351593E72EEDA07CFA439AEEF72C
  ```

## Verificación

```sh
node scripts/check-dns.mjs
```

Debe mostrar `Registros DS: 1` y `Validación DNSSEC (AD): sí`.

La comprobación consulta Google y `1.1.1.1` porque distintos resolutores
pueden tardar más en validar. El workflow **Disponibilidad** falla si el DS
desaparece o si ningún resolutor valida la respuesta.

## Historial

- Cloudflare mantuvo el DS en estado pendiente desde el 14 de noviembre.
- El 17 de noviembre se desactivó y reactivó DNSSEC desde el registrador.
- El DS se publicó y la validación quedó activa en menos de 15 minutos.

## Cómo desactivarlo (solo si hace falta)

1. Entra en **Domain Registration → likehoodie.com → Settings**.
2. Pulsa **Disable DNSSEC** y confirma.
3. Espera a que el registrador retire el DS.
4. Mantén la firma de la zona en Cloudflare hasta que expire el TTL del DS.

Nunca retires el DS sin desactivar antes la firma ni cambies los nameservers
con DNSSEC activo.
