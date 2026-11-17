# Retención de logos y archivos de impresión

## Política

| Contenido | Se conserva | Se elimina |
|---|---|---|
| Logo de un pedido activo (pendiente, confirmado, en producción o enviado) | Mientras el pedido esté activo | — |
| Logo de un pedido entregado o cancelado | 180 días desde la última actualización | Después de 180 días |
| Logo sin ningún pedido | 30 días | Después de 30 días |
| Archivo de impresión (PNG final) | Igual que su pedido | Igual que su pedido |
| Objeto huérfano sin fila en `logo_assets` | 30 días | Después de 30 días |

Los plazos se pueden ajustar con `LOGO_ORPHAN_DAYS` y `LOGO_CLOSED_DAYS` en
los secretos de Supabase Edge Functions. Los valores por defecto son 30 y 180.

## Cómo funciona

La función `cleanup-storage`:

1. Lista `order-logos` y `order-prints` con la API de Storage.
2. Lee `logo_assets` y los `pricingGroup`/`logoAssetId` de los pedidos.
3. Decide qué conservar según las reglas anteriores.
4. Borra los archivos con la API de Storage (no solo metadatos).
5. Borra las filas de `logo_assets` cuando sus archivos ya no existen.

No toca los pedidos: si un pedido antiguo guarda un `printPath`, el archivo
puede haber caducado. El admin debe tratar ese enlace como histórico.

## Ejecución

- Automática: workflow **Retención**, lunes a las 06:40 UTC.
- Manual sin borrar:

  ```sh
  curl -X POST "https://qrblsclpzoaxfaggsrda.supabase.co/functions/v1/cleanup-storage?dryRun=1" \
    -H "x-cleanup-secret: $CLEANUP_SECRET"
  ```

- Manual real: el mismo comando con `?dryRun=0` o sin parámetro.
- Desde GitHub: **Actions → Retención → Run workflow** con `dry_run=1`.

La función solo acepta `POST` y exige la cabecera `x-cleanup-secret`. El
secreto se guarda en Supabase (`CLEANUP_SECRET`) y en GitHub Actions
(`CLEANUP_SECRET`).

## Despliegue

```sh
npx supabase functions deploy cleanup-storage --remote qrblsclpzoaxfaggsrda
npx supabase secrets set CLEANUP_SECRET=... --remote qrblsclpzoaxfaggsrda
gh secret set CLEANUP_SECRET --repo celc91/like-hoodie
```

`supabase/config.toml` fija `verify_jwt = false` porque la autenticación es el
secreto compartido, no una sesión de usuario.
