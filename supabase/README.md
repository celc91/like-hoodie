# Backend de pedidos con Supabase

Este proyecto usa **Supabase** para guardar carritos, pedidos y eventos de uso. El sitio sigue siendo estático; el panel de administración se publica en `admin.html` y se protege con Supabase Auth + Row Level Security.

## 1. Crear el proyecto

1. Entra a <https://supabase.com> y crea una cuenta.
2. Crea un proyecto nuevo (región: la más cercana a México, por ejemplo `us-east-1` o `us-west-1`).
3. Espera a que termine de aprovisionarse.

## 2. Crear las tablas

1. Abre **SQL Editor**.
2. Copia todo el contenido de `supabase/schema.sql`.
3. Ejecútalo una sola vez.

Esto crea:

- `profiles`: perfiles y rol de administrador.
- `carts`: carritos de cada visitante.
- `orders`: pedidos.
- `events`: eventos del embudo.
- Funciones `is_admin()` y `admin_stats()`.
- Políticas RLS.

## 3. Activar usuarios anónimos

Los carritos se asocian a una sesión anónima segura de Supabase, no a un correo.

1. Ve a **Authentication → Providers**.
2. Activa **Anonymous sign-ins**.
3. Guarda.

Sin esto, la tienda sigue funcionando, pero no se registrarán carritos ni pedidos.

## 4. Crear el administrador

1. Ve a **Authentication → Users → Add user**.
2. Crea el usuario con tu correo y una contraseña fuerte. Marca **Auto Confirm User** para poder entrar sin esperar un correo de confirmación.
3. Vuelve a **SQL Editor** y ejecuta:

```sql
insert into public.profiles (id, email, role)
select id, email, 'admin'
from auth.users
where email = 'tu-correo@dominio.com'
on conflict (id) do update set role = 'admin';
```

El usuario administrador podrá entrar en `admin.html`.

## 5. Conectar la web

En **Project Settings → API Keys** copia:

- **Project URL**
- **Publishable key** (empieza con `sb_publishable_`)

Edita `supabase-config.js` en la raíz del proyecto:

```js
window.LIKEHOODIE_SUPABASE = {
  url: "https://TU-PROYECTO.supabase.co",
  publishableKey: "TU_PUBLISHABLE_KEY",
};
```

La `publishable key` es pública y está protegida por RLS. **Nunca** pongas la `secret key` ni la antigua `service_role key` en el frontend. Las legacy API keys se retirarán a principios de 2027.

## 6. Publicar

Sube los cambios a GitHub Pages. Quedarán disponibles:

- Tienda: `https://celc91.github.io/like-hoodie/`
- Panel: `https://celc91.github.io/like-hoodie/admin.html`

El panel tiene `noindex` y no muestra datos sin iniciar sesión. Aun así, se recomienda usar un dominio propio y una contraseña fuerte.

## 7. Comprobar que funciona

1. Abre la tienda y añade una sudadera al carrito.
2. Espera unos segundos (el carrito se sincroniza con retardo).
3. Entra al panel con el usuario administrador.
4. Deberías ver el carrito en **Carritos**.
5. Completa el checkout de prueba y verifica que aparece en **Pedidos**.

## 8. Archivo de impresión DTG

1. En **SQL Editor**, ejecuta `supabase/logo-assets.sql`. Crea la tabla
   `logo_assets`, el bucket privado `order-prints` y sus políticas.
2. Despliega la función:

   ```sh
   npx supabase login
   npx supabase functions deploy process-logo --remote=<project-ref>
   ```

3. Sube un logo en la tienda o pulsa **Personalizar** en un modelo de la
   colección. Debe aparecer el estado “Quitando el fondo del logo…” y después
   “Archivo de impresión listo”.
4. En el pedido, el admin verá **Descargar print** con el DPI final. Si el
   procesado falla, el botón **Reprocesar** vuelve a lanzarlo.

La función no necesita secretos propios: usa `SUPABASE_URL`,
`SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` del entorno de Supabase.

## Seguridad

- Los visitantes solo pueden leer y modificar **su propio carrito**.
- Los pedidos se crean únicamente con la función `public.place_order()`, que recalcula subtotal, envío y total en el servidor. No se permite insertar pedidos directamente desde el navegador.
- `place_order()` valida cada precio contra `public.product_prices` y rechaza cualquier pedido cuyo `unitPrice` no coincida. También valida el tamaño de impresión, el descuento por volumen y el total del grupo de cotización.
- `place_order()` exige teléfono de 10–15 dígitos, dirección, ciudad, estado y CP de 5 dígitos; guarda `state` y `address_ref` para la guía de envío.
- La tabla `coupons` no es legible desde el navegador: los códigos se validan solo con `check_coupon()`.
- Cada suscriptor confirmado recibe un cupón único, de un solo uso y 90 días. `BIENVENIDA10` queda como código legado limitado a 1,000 usos y un año.
- `admin_stats()` solo cuenta pedidos con `payment_status = 'paid'`; los pedidos demo no entran en ingresos ni conversión.
- `get_order_status(numero, correo)` ya no es público: solo lo invoca la Edge Function `order-status`, que aplica rate limit por IP (12 consultas/10 min) y no expone nombre, dirección ni teléfono. El límite se aplica con `take_order_lookup()`, un contador atómico que falla cerrado; usa `cf-connecting-ip` (cabecera que el gateway sobrescribe) y añade un tope global de 300/min.
- `client_errors` solo lo lee el admin. Los errores se envían por `log_client_error()` o por la Edge Function `client-error`, con límites por sesión/IP y retención de 90 días. El contador `take_client_error()` es atómico (20/h por IP y 2.000/h global) y purga los intentos de más de 2 días.
- Los carritos y pedidos limitan `items` a 50 artículos y 8 MiB; `place_order()` rechaza además cualquier artículo de más de 4 MiB. Así un carrito anónimo no puede inflar filas de varios MB sin tope.
- `events.metadata` está limitado a 16 KiB y a 300 eventos/hora por usuario; cada usuario puede tener como máximo 10 carritos abiertos. Los carritos abandonados se borran a los 180 días.
- `logo_assets` exige que `source_path` empiece por la carpeta del usuario y limita a 50 altas/24 h. `process-logo` aplica 20 intentos/h por usuario, 30/h por IP y 300/h global, con un máximo de 3 intentos por logo; los errores internos no se devuelven al cliente.
- `check_coupon()` limita a 30 intentos/hora por IP con `coupon_attempts`.
- El newsletter usa `cf-connecting-ip` para su límite de 5 altas/hora.
- `clip-pay` aplica un límite por IP y por usuario antes de llamar a Clip (12 y 6 intentos/10 min) con `take_clip_pay()`.
- Los pedidos solo los puede leer el administrador; el cliente puede ver los suyos.
- Nadie puede cambiar su rol a administrador desde la web.
- No se guardan datos de tarjetas.
- Los carritos abandonados no guardan nombre, correo ni teléfono.
- Los pedidos guardan los datos necesarios para producir y enviar.
- El panel exige **MFA TOTP** y `is_admin()` solo responde `true` con una sesión
  `aal2`; un token de contraseña no puede acceder por API. La sesión vive en
  `sessionStorage` y se cierra al cerrar la pestaña o tras 30 minutos de
  inactividad.
- **Primer acceso:** el panel muestra un QR y un secreto para enrolar la app
  TOTP. Hay que verificar el código de 6 dígitos antes de entrar. En los
  siguientes accesos solo se pide el código, no volver a escanear.
- No hay códigos de recuperación: guarda el secreto manual en un lugar seguro.
  Si se pierde el dispositivo, elimina el factor en **Supabase Dashboard →
  Authentication → Users → usuario → MFA factors** y vuelve a enrolar. Sin acceso
  al dashboard no se puede recuperar el panel.
- La pestaña **Facturación** prepara el cierre global semanal: pedidos pagados,
  forma SAT 04/28, exclusión de facturas individuales, exportación CSV y
  registro del UUID. No emite CFDI; la emisión sigue siendo manual.
- La solicitud pública de factura individual (`factura.html`) pasa por la Edge
  Function `invoice-request`, que valida el pedido y el correo con
  `service_role`. La solicitud nace `unverified`, envía un enlace de confirmación
  al correo de compra y solo pasa a `review` al validarlo. La tabla
  `invoice_requests` no es legible desde el navegador: solo el admin puede verla
  y actualizarla. El límite es de 10 solicitudes/hora por IP y 100/hora global
  con `take_invoice_request()`.

## 8. Pagos con Clip

La integración usa **Checkout redireccionado** y dos Edge Functions:

- `clip-checkout`: recibe el ID del pedido, valida la sesión y crea el link de pago con el total de `orders.total`.
- `clip-webhook`: recibe el aviso de Clip, consulta `GET /v2/checkout/{id}` y actualiza el pedido.

### Bootstrap reproducible en local

`supabase start` aplica `supabase/migrations/` al arrancar, pero esas migraciones
asumen el esquema base (`schema.sql` y `fase*.sql`), que no vive en `migrations/`.
Para una base local nueva usa:

```powershell
node scripts/bootstrap-local.mjs
```

El script aparta `migrations/`, arranca limpio, aplica los 28 scripts base en el
orden canónico, devuelve `migrations/` y ejecuta `supabase migration up`. Es el
mismo camino que usa el workflow `RLS`. No usar `supabase db reset` hasta mover
el esquema base a una migración de línea base: fallaría por el mismo motivo.

### Orden de SQL

En un proyecto nuevo ejecuta:

1. `schema.sql`
2. `storage-logos.sql`
3. `security-hardening.sql`
4. `coupons.sql`
5. `clip-payments.sql`
6. `email-notifications.sql`
7. `fase1-pedidos-seguros.sql` (**siempre al final**)
8. `fase3-seguimiento.sql`
9. `fase3-monitorizacion.sql`
10. `fase4-seguridad.sql` (límites, rate limit y retención)
11. `fase5-ratelimit.sql` (contador atómico `take_order_lookup`)
12. `fase6-limites.sql` (topes de `items`, monitorización y `clip-pay`)
13. `fase7-abuso.sql` (eventos, carritos, logos y `process-logo`)
14. `antispam-cupones.sql` (límite de intentos de cupón)
15. `fase8-admin-mfa.sql` (MFA `aal2` obligatorio para admin)
16. `fase9-facturacion-global.sql` (cierre semanal y factura global)
17. `fase10-facturacion-individual.sql` (solicitudes de factura individual)
18. `supabase/migrations/20261115000100_precios_tote.sql` (precios por producto)
19. `supabase/migrations/20261115000200_facturacion_verificacion.sql` (correo y forma SAT)
20. `supabase/migrations/20261115000300_admin_stats_pagados.sql` (métricas sin demo)
21. `supabase/migrations/20261115000400_cupones_unicos.sql` (cupón único por suscriptor)
22. `supabase/migrations/20261115000500_aviso_factura.sql` (aviso al admin y helper Resend)
23. `supabase/migrations/20261117000100_aprobacion_diseno.sql` (aprobación del diseño)
24. `supabase/migrations/20261117000200_precios_volumen.sql` (tamaño de impresión y volumen)
23. `supabase/migrations/20261115120000_seguridad_rls_b5.sql` (newsletter, `has_resend_key`, retención y facturas bloqueadas)
24. `supabase/migrations/20261115130000_locks_concurrencia.sql` (locks de `place_order` y newsletter)
25. `supabase/migrations/20261115140000_orders_currency.sql` (`orders.currency` para Clip)
26. `supabase/migrations/20261115150000_clip_idempotencia.sql` (reclamación atómica de pagos y links)
27. `supabase/migrations/20261115160000_locks_menores.sql` (locks de cupones, topes globales y triggers)

Las migraciones nuevas viven en [`migrations/`](migrations/README.md) y son
idempotentes. Después de la lista anterior, ejecuta las migraciones en orden.

`fase1-pedidos-seguros.sql` deja una sola versión de `place_order`: recalcula
precios en servidor, valida cupón, correo, teléfono, dirección, estado y CP, y
guarda `state` y `address_ref`. Los scripts heredados (`schema.sql`,
`security-hardening.sql` y `clip-payments.sql`) eliminan al final su versión
antigua de 4 argumentos, y `coupons.sql` / `setup-premios.sql` ya no definen
`place_order`; reejecutarlos no reabre la versión que confiaba en `unitPrice`.

`clip-payments.sql` crea `store_settings` con `clip_enabled = 'false'`. Mientras esté en `false`, el checkout sigue siendo demostración.

### Secretos

```powershell
npx supabase login
npx supabase link --project-ref qrblsclpzoaxfaggsrda
npx supabase secrets set CLIP_API_KEY=... CLIP_API_SECRET=... CLIP_WEBHOOK_SECRET=... SITE_URL=https://likehoodie.com
```

No subas estos valores al repositorio. La CLI lee `config.toml` y despliega ambas funciones sin verificación JWT automática; la función de checkout valida el token del usuario y el webhook valida su secreto.

El webhook acepta el secreto en `x-clip-secret`, `x-webhook-secret` o
`Authorization: Bearer ...`. Si Clip solo permite configurar una URL, usa
`?secret=...` como respaldo y rota el secreto periódicamente: ese valor puede
quedar en los registros del CDN.

### Desplegar

```powershell
npx supabase functions deploy clip-checkout
npx supabase functions deploy clip-webhook
```

### Activar

```sql
update public.store_settings
   set value = 'true', updated_at = now()
 where key = 'clip_enabled';
```

Para volver a demostración, cambia el valor a `'false'`. La función pública `store_config()` solo expone `payment_provider` (`demo` o `clip`) para que la tienda muestre el aviso correcto.

## 9. Factura individual

La página `factura.html` captura la solicitud del cliente. No emite CFDI: guarda
los datos fiscales para que el admin emita la factura manualmente en el SAT.

1. Ejecuta `supabase/migrations/20261115000200_facturacion_verificacion.sql`
   (después de `fase10-facturacion-individual.sql`).
2. Despliega la función:

   ```sh
   npx supabase functions deploy invoice-request --remote=<project-ref>
   ```

3. La función valida con `service_role` que el número y el correo coincidan con
   un pedido pagado y no cancelado. La solicitud nace **`unverified`** y se envía
   un correo al correo de compra con un enlace de 24 horas.
4. Al confirmar el enlace, pasa a **`review`** y el pedido se marca `individual`.
   Si el pedido ya entró en una global, queda en `review` para que el admin
   decida.
5. En el admin, pestaña **Facturación → Solicitudes individuales**, revisa los
   datos, captura el UUID y emite. Solo se pueden emitir solicitudes
   verificadas. Cancelar devuelve el pedido a `pending` si estaba `individual`.
   Puedes filtrar por estado y reenviar la confirmación. Al verificar el cliente,
   el admin recibe un aviso por correo.

`invoice_requests` guarda RFC, razón social, régimen, CP, uso del CFDI, forma de
pago SAT (`04`/`28`) y correo de envío. Está protegida con RLS: solo el admin con
`aal2` puede leerla o actualizarla; el navegador nunca la consulta directamente.
`take_invoice_request()` aplica 10 intentos/hora por IP y 100/hora global, y
purga los intentos de más de 2 días. Los hashes de IP usan `LOOKUP_IP_SALT`;
configúralo con `npx supabase secrets set LOOKUP_IP_SALT=...`. Sin esa variable los endpoints responden 503 y cada finalidad usa un hash distinto.

## Privacidad

Antes de operar, actualiza `privacidad.html` y `cookies.html` para mencionar:

- Datos de pedido: nombre, correo, dirección y teléfono.
- Carritos anónimos y eventos de uso.
- Supabase como encargado del tratamiento.
- Plazo de conservación y cómo ejercer derechos ARCO.

## Límites del plan gratuito

El plan gratuito de Supabase es suficiente para empezar. Revisa los límites actuales en <https://supabase.com/pricing>. Para producción conviene activar copias de seguridad y alertas.
