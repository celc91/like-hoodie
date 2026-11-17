# Revisión delta — 17 de noviembre

Auditoría enfocada de lo que entró después de la auditoría B.4: aprobación de
diseño, precios por volumen, equipos, locks de pedidos y retención de archivos.
Revisión estática, sin pruebas de penetración.

## Hallazgos

| # | Área | Hallazgo | Severidad | Estado |
|---|---|---|---|---|
| 1 | Retención | `cleanup-storage` solo protegía logos con `logoAssetId`; un logo referenciado por `logoPath` en un pedido activo podía borrarse a los 30 días | media | corregido |
| 2 | Precios | Un artículo con `logoAssetId` o `printPath` pero sin `logoName/Path/Data` no pagaba el suplemento de logo | media | corregido |
| 3 | Precios | `rosterNumber` sin `rosterName` no pagaba el suplemento de equipo | baja | corregido |
| 4 | Precios | `printSize` lo declara el cliente; el servidor imprime al ancho de la cara y no puede verificar el tamaño pagado | baja | riesgo aceptado |
| 5 | Precios | `pricingGroup` lo elige el cliente para agrupar cantidades y alcanzar un tramo de volumen | informativo | regla de negocio |
| 6 | Precios | `rosterName`/`rosterNumber` sin límite de longitud (el artículo está topado a 4 MiB) | baja | pendiente |
| 7 | Aprobación | El cliente no puede cambiar `design_approval_status`; la política de `orders` no permite UPDATE | — | correcto |
| 8 | Locks | `place_order` bloquea usuario y correo antes de contar, y el cupón con `for update` | — | correcto |
| 9 | Regresiones | Las migraciones del 17 no reabren cupones, newsletter, `has_resend_key`, facturas ni idempotencia de Clip | — | correcto |

## Correcciones aplicadas

- `supabase/functions/cleanup-storage/index.ts`: los pedidos activos protegen
  también los objetos referenciados por `logoPath`; los cerrados aplican la
  retención de 180 días.
- `supabase/migrations/20261117140000_precios_logo_equipo.sql`: `item_unit_price`
  cuenta el logo si hay `logoAssetId` o `printPath`, y el suplemento de equipo si
  hay `rosterNumber`.

Verificado en producción con `pg_get_functiondef` y desplegando la función.

## Riesgo aceptado: tamaño de impresión

El precio suma `print_logo_fee` (0), `print_carta_fee` (30) o
`print_doble_carta_fee` (60) según `printSize`, un campo del navegador. El archivo
de impresión se genera al ancho de la cara (24/28/30 cm), así que un cliente
puede declarar `logo` y recibir un print grande pagando 0.

No se corrige en esta ronda porque exige derivar el tamaño del diseño (escala y
área del logo) o medir el archivo generado, y eso cambia el contrato del editor.
Si se quiere cerrar, la vía más simple es que `process-logo` registre el ancho
real y `place_order` compare con la tarifa declarada antes de aceptar el pedido.
