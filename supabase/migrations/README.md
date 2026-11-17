# Migraciones versionadas

Esta carpeta contiene los cambios de esquema nuevos, en orden. El proyecto
nació con scripts manuales (`schema.sql`, `security-hardening.sql`, `fase*.sql`);
no existe una línea base automática de todas las migraciones anteriores.

Para un proyecto nuevo, sigue primero el orden de [`../README.md`](../README.md).
Después aplica estas migraciones en orden con:

```powershell
npx supabase db query --remote --yes --file supabase/migrations/20261115000100_precios_tote.sql
npx supabase db query --remote --yes --file supabase/migrations/20261115000200_facturacion_verificacion.sql
```

## Migraciones

- `20261115000100_precios_tote.sql`
  - añade `product` a `product_prices` (`hoodie` o `tote`);
  - añade el blanco de sudadera y todos los precios del tote;
  - hace que `item_unit_price()` valide el producto.
- `20261115000200_facturacion_verificacion.sql`
  - la solicitud de factura individual nace `unverified`;
  - envía un correo de confirmación con token de 24 h;
  - al confirmar pasa a `review` y marca el pedido como `individual`;
  - guarda la forma de pago SAT (`04`/`28`);
  - el admin puede reenviar la confirmación y solo emitir solicitudes verificadas.
- `20261115000300_admin_stats_pagados.sql`
  - las métricas del admin solo cuentan pedidos con `payment_status = 'paid'`;
  - los pedidos demo dejan de inflar ingresos y conversión.
- `20261115000400_cupones_unicos.sql`
  - cada suscriptor confirmado recibe un cupón único, de un solo uso y 90 días;
  - el código antiguo `BIENVENIDA10` queda limitado a 1,000 usos y un año.
- `20261115000500_aviso_factura.sql`
  - avisa por correo al admin cuando una solicitud de factura queda verificada;
  - retira `has_resend_key()` de `anon`.
- `20261117000100_aprobacion_diseno.sql`
  - añade el estado de aprobación del diseño al pedido.
- `20261117000200_precios_volumen.sql`
  - precio por tamaño de impresión (`logo`, `carta`, `doble_carta`);
  - descuentos por volumen: 5% desde 12, 10% desde 24 y 15% desde 48;
  - `pricingGroup` para cotizaciones por tallas.
- `20261117000300_item_price_firma.sql`
  - elimina la firma antigua `item_unit_price(jsonb)` para dejar una sola
    función con cantidad y evitar ambigüedad.

Las migraciones son idempotentes: se pueden volver a ejecutar. No ejecutes
`security-hardening.sql` sobre una base ya migrada sin revisar antes la versión
actual; el archivo ya incluye los precios de tote y la función por producto.
