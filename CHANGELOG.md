# Changelog

Todos los cambios visibles del proyecto. Formato basado en
[Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y versionado
semántico.

## [Sin publicar]

### Por hacer

- (ninguno pendiente en el editor)

### Descartado por ahora

- **Canva Connect:** requiere Canva Pro para PNG transparente, export máximo
  8000 × 3125 px, solo raster y revisión de app. Se sustituye, si hace falta,
  por un enlace a plantillas y subida manual.

## [1.10.2] — 2026-11-14

### Seguridad

- Se externalizaron los scripts inline de `index.html`, `confirmar.html`,
  `cookies.html` y las páginas de producto (`boot.js`, `confirmar.js`,
  `modelos/producto.js`); el botón de preferencias de cookies pasó a
  `legal.js`.
- La CSP ya **no permite `unsafe-inline` en `script-src`**. Se añadió
  `script-src-attr 'none'`, así que tampoco se aceptan manejadores inline.
- Los estilos inline se mantienen con `style-src 'unsafe-inline'` por los
  atributos de estilo del editor; eliminarlos requiere un refactor aparte.

### Verificado

- Home, producto, `confirmar`, cookies, seguimiento y admin cargan sin errores
  de consola.
- Google Analytics, Meta, Cloudflare Insights y el botón de preferencias siguen
  funcionando.
- El selector de talla del producto sigue actualizando precio y enlace.
- `node --check`, `html-validate` y smoke test con **57 comprobaciones**.

## [1.10.1] — 2026-11-14

### Seguridad

- **CSP por origen** en Cloudflare: limita scripts, estilos, imágenes, fuentes,
  conexiones y frames a los proveedores reales. En 1.10.2 se retiró
  `unsafe-inline` de `script-src` al externalizar los scripts; los estilos
  inline siguen permitidos con `style-src 'unsafe-inline'`.
- **WAF:** bloquea `/supabase/`, `/scripts/`, `/.opencode/`, `.md`, `.sql`,
  `.ts`, `.mjs`, `.gitignore`, `.htmlvalidate.json` y `.nojekyll`.
- **Admin:** la sesión pasa a `sessionStorage` (no sobrevive al cierre de la
  pestaña), `X-Robots-Tag: noindex, nofollow, noarchive` y
  `Cache-Control: no-store`.
- **Correo/DNS:** DMARC pasa a `p=quarantine` con reportes a
  `hola@likehoodie.com`; se añaden CAA para Let's Encrypt y Google Trust
  Services; DNSSEC queda activado en Cloudflare (DS en propagación por
  Cloudflare Registrar).
- Se desactiva **Email Address Obfuscation** de Cloudflare; ya no se inyecta
  `email-decode.min.js`.
- Se añade `/.well-known/security.txt` y `security.txt` con el canal de
  reporte.
- El checkout se etiqueta como **demostración** también en la cesta y en el
  pie, no solo en el modal.

### Verificado

- CSP aplicada en apex y admin; home, producto, seguimiento y admin cargan sin
  errores de consola; GA, Meta, Cloudflare y fuentes siguen funcionando.
- El formulario de seguimiento sigue respondiendo a través de la Edge Function.
- Archivos internos: **403**. Home, CSS, producto, sitemap y robots: **200**.
- DMARC y CAA visibles por DNS.
- `node --check`, `html-validate` y smoke test con **57 comprobaciones**.

## [1.10.0] — 2026-11-14

### Añadido

- **MFA TOTP obligatorio en el panel:** en el primer acceso se muestra un QR y
  una clave manual para configurar Google Authenticator, 1Password, Authy u otra
  app compatible. Sin MFA verificado no se abre el panel.
- **Verificación en dos pasos** en cada inicio de sesión con un código de 6
  dígitos.
- **Aplicación en servidor:** `is_admin()` ahora exige `aal2` además del rol
  admin. Un token de contraseña (`aal1`) no puede leer pedidos, carritos,
  errores ni storage por API aunque conozca la contraseña.
- **Cierre por inactividad:** la sesión del panel se cierra tras 30 minutos sin
  actividad y vuelve al login.

### Verificado

- Con sesión `aal1`, `is_admin()` devuelve **false**.
- El QR y la clave manual se generan correctamente.
- Tras verificar el código, el panel se abre y `is_admin()` devuelve **true**.
- El factor de prueba se eliminó al terminar; no queda MFA configurado.
- `html-validate` sin errores, `node --check` correcto y smoke test con
  **57 comprobaciones**.
- CI y Pages en verde.

## [1.9.0] — 2026-11-14

### Añadido

- **Límites de abuso** en `process-logo`: 20 intentos/h por usuario, 30/h por
  IP, 300/h global y máximo de 3 intentos por logo. Los errores internos ya no
  se devuelven al cliente.
- `logo_assets` exige que `source_path` empiece por la carpeta del usuario y
  limita a 50 altas/24 h.
- `events.metadata` limitado a 16 KiB, nombre a 80 bytes y ruta a 300 bytes;
  máximo de 300 eventos/h por usuario.
- Máximo de 10 carritos abiertos por usuario y limpieza de carritos
  abandonados a los 180 días.
- `check_coupon()` con límite de 30 intentos/h por IP mediante
  `coupon_attempts`.
- El newsletter usa `cf-connecting-ip` para su límite de 5 altas/h.

### Verificado

- `fase4`, `fase7`, `antispam-cupones` y `optin-3` aplicadas en producción.
- 21 llamadas a `take_logo_process`: **20 permitidas**.
- 31 intentos de cupón: **30 `notfound` y 1 `rate`**.
- Evento con metadata de 20 KB: rechazado por `events_metadata_size_chk`.
- `logo_assets` con ruta ajena: rechazado por el trigger; ruta propia: aceptada.
- Inserts normales de evento y carrito: aceptados.
- `process-logo` sin sesión: **401**.
- `html-validate` y smoke test (**57 comprobaciones**) sin errores.

## [1.8.5] — 2026-11-14

### Cambiado

- Se retira la sección **“Opiniones reales”** y el bloque **4,9/5 · +2.400
  sudaderas** del héroe hasta tener reseñas y casos verificables.
- Se eliminan los enlaces **Opiniones** de la navegación de escritorio y móvil.
- La home queda sin prueba social inventada; FAQ y el resto de secciones siguen
  igual.

### Verificado

- `html-validate` sin errores en `index.html`.
- Smoke test: **57 comprobaciones**.
- Sin cambios de precios, carrito ni checkout.

## [1.8.4] — 2026-11-14

### Cambiado

- **Aviso de privacidad:** añade Cloudflare como CDN/protección y su medición
  agregada sin cookies, aclara el uso de Google Fonts y actualiza la cartelera
  (CSV/hoja propia; Ticketmaster solo como enlace externo).
- **Newsletter:** el aviso ya no lo describe como demostrativo. Documenta la
  doble confirmación con Resend, la conservación de 7 días de los intentos y la
  baja desde el correo.
- **Política de cookies:** refleja las claves reales de almacenamiento
  (`likehoodie_consent_v2`, `likehoodie_design_v1`, `likehoodie.coupon`,
  `lh-grid-visible`), explica Cloudflare Web Analytics y Google Fonts, y corrige
  la contradicción sobre el píxel de Meta.
- Retención: intentos de seguimiento/error 2 días, newsletter 7 días.
- Fechas de actualización de ambas políticas al 14 de noviembre de 2026.

### Verificado

- `html-validate` sin errores en `privacidad.html` y `cookies.html`.
- Smoke test: **57 comprobaciones**.
- Sin cambios de código ni de configuración de terceros.

## [1.8.3] — 2026-11-14

### Cambiado

- **Cloudflare delante de GitHub Pages:** los registros `A` del dominio y el
  `CNAME www` pasan a **proxied**. Los registros de correo (`send`, `rsend`, MX
  y TXT) siguen solo DNS.
- **SSL/TLS:** modo **Full (strict)**, TLS 1.2 mínimo, HTTP/3, **Always Use
  HTTPS** y HSTS de 6 meses (sin `preload` ni `includeSubDomains`).
- **Cabeceras de seguridad** en todas las respuestas: `X-Content-Type-Options`,
  `Referrer-Policy`, `Permissions-Policy`, CSP con `frame-ancestors 'self'`,
  `X-Frame-Options` y `X-Permitted-Cross-Domain-Policies`.
- **Redirección `www` → dominio principal** en el edge, 301 y conservando ruta
  y query.

### Verificado

- `https://likehoodie.com/` responde 200 con `Server: cloudflare`.
- `http://likehoodie.com/` → 301 a HTTPS.
- `https://www.likehoodie.com/modelos/cocodrilo.html?x=1&y=2` → 301 a
  `https://likehoodie.com/modelos/cocodrilo.html?x=1&y=2`.
- HSTS, `nosniff`, `Referrer-Policy`, `Permissions-Policy`,
  `frame-ancestors 'self'`, `X-Frame-Options` y
  `X-Permitted-Cross-Domain-Policies` presentes en apex y www.
- Home, producto, admin, CSS, JS, sitemap y robots: 200; sin errores de consola.
- Correo: `send` y `rsend` siguen sin proxy.

## [1.8.2] — 2026-11-14

### Corregido

- **Scripts heredados:** `schema.sql`, `security-hardening.sql` y
  `clip-payments.sql` eliminan al final su antigua versión de `place_order` de
  4 argumentos; `coupons.sql` y `setup-premios.sql` ya no definen `place_order`.
  Reejecutarlos no reabre la versión que confiaba en el `unitPrice` del
  navegador. `fase3-seguimiento.sql` deja `get_order_status` solo para
  `service_role`.
- **Tamaño de carritos y pedidos:** tope de 50 artículos y 8 MiB por fila en
  `carts` y `orders`; `place_order()` rechaza artículos de más de 4 MiB.
- **Monitorización:** `take_client_error()` hace el conteo y la inserción de
  forma atómica (20/h por IP y 2.000/h global), usa `cf-connecting-ip` y purga
  los intentos de más de 2 días. La IP ya no se puede falsificar con
  `x-real-ip`.
- **Clip:** `clip-pay` aplica 12 intentos/10 min por IP y 6 por usuario antes de
  llamar a la API. El webhook acepta el secreto en `x-clip-secret`,
  `x-webhook-secret` o `Authorization: Bearer`; `?secret=` queda como respaldo.
- `antispam-cupones.sql` prioriza `cf-connecting-ip` y `x-real-ip` sobre
  `x-forwarded-for`.

### Verificado

- `fase1` y `fase6` aplicadas en producción.
- Carrito/pedido con 51 artículos: rechazado por `orders_items_count_chk`.
- `take_client_error`: 20 permitidos de 21; 20 errores guardados desde una sola
  IP y el 21.º descartado.
- `take_clip_pay`: 6 permitidos de 7 con el mismo usuario.
- `order-status` tras el despliegue: **12 × 200 y la 13.ª 429**.
- Webhook sin secreto o con secreto incorrecto: **401**.
- Funciones desplegadas: `order-status`, `client-error`, `clip-pay` y
  `clip-webhook`.

## [1.8.1] — 2026-11-14

### Corregido

- **Rate limit del seguimiento:** el contador anterior hacía `count` e `insert`
  por separado, ignoraba el error del `insert` y agrupaba mal las IP, así que el
  límite de 12 consultas/10 min no se aplicaba en producción. Ahora
  `take_order_lookup()` cuenta e inserta de forma atómica (con bloqueo por IP) y
  la Edge Function falla cerrado si el contador no responde.
- La IP se toma de `cf-connecting-ip`, cabecera que el gateway sobrescribe;
  `x-real-ip` y `x-forwarded-for` ya no permiten crear cubos nuevos.
- Tope global de 300 intentos/min y purga de intentos de más de 2 días dentro
  del propio contador.

### Verificado

- 13 consultas seguidas desde la misma IP: **12 × 200 y la 13.ª 429**.
- Los 12 intentos quedaron en un único `ip_hash`.
- `x-real-ip` y `x-forwarded-for` falsificados: **429**; `cf-connecting-ip`
  falsificado: **403**.
- Intentos de prueba borrados de `order_lookup_attempts`.

## [1.8.0] — 2026-11-14

### Añadido

- **Cartelera sin API key:** `eventos.csv` es ahora la fuente editable. El
  workflow **Eventos** lo convierte en `eventos.json` al guardar el CSV o cada
  lunes.
- También se puede usar una **hoja de Google publicada como CSV** mediante la
  variable de repositorio `EVENTS_CSV_URL`; no requiere cuenta de developer.
- El workflow no vacía la cartelera si el CSV falla o no tiene eventos futuros.
- Si pasan más de 45 días sin cambios, abre una incidencia recordatoria y la
  cierra cuando se actualiza.
- `eventos.csv` sembrado con la cartelera actual (eventos futuros).

### Cambiado

- La API de Ticketmaster queda como opción secundaria en
  `scripts/sync-ticketmaster.mjs`; ya no es necesaria para publicar.

### Verificado

- `sync-events-csv.mjs` genera 128 eventos futuros desde el CSV.
- El workflow ya no depende de `TICKETMASTER_API_KEY`.
- Smoke test: **51 comprobaciones**.

## [1.7.0] — 2026-11-14

### Cambiado

- **Una sola fuente para los modelos:** `modelos/modelos.json` genera las
  páginas de producto, `modelos/modelos-data.js`, el nombre y el precio de las
  tarjetas de la home.
- `app.js` deja de tener una copia de `MODELS` y consume
  `window.LIKEHOODIE_MODELS`.
- La compra de un modelo usa el precio del catálogo (`model.price`), no una
  segunda fórmula.
- El CI regenera todo y falla si `modelos.json`, las páginas, los datos o las
  tarjetas no están sincronizados.

### Verificado

- Compra local de Cocodrilo: $1,048 y print `ready`.
- `modelos-data.js` incluye los cuatro modelos.
- Smoke test: **49 comprobaciones**.
- CI de HTML, enlaces y Pages en verde.

## [1.6.1] — 2026-11-14

### Corregido

- Cada página de producto tiene su propia imagen OG **1200 × 630 JPG**
  (`og-<modelo>.jpg`) en lugar de la portada genérica.
- El CI regenera las páginas de producto y falla si `modelos.json` y el HTML
  publicado no están sincronizados.
- El monitor de disponibilidad comprueba la Edge Function `order-status` y
  reintenta 4 veces con espera antes de abrir una incidencia.
- Smoke test ampliado a **47 comprobaciones**, incluida la coherencia de IDs
  entre `MODELS` y `modelos.json`.

## [1.6.0] — 2026-11-14

### Seguridad

- **Seguimiento con rate limit:** el RPC `get_order_status` deja de ser
  público. La Edge Function `order-status` aplica 12 consultas/10 min por IP y
  usa `service_role`. Se elimina el `pg_sleep` que podía agotar conexiones.
- **Errores de cliente protegidos:** nueva Edge Function `client-error` con
  límite de 20 errores/hora por IP, tope global de 2.000/hora y sin datos
  personales.
- **Retención automática:** `pg_cron` limpia cada día errores técnicos (90
  días), eventos (365 días) e intentos de consulta (2 días).
- **Privacidad:** el aviso incluye errores técnicos, WhatsApp y plazos de
  conservación.

### Corregido

- `monitor.js` ya funciona en tienda, producto y seguimiento sin cargar el SDK
  de Supabase.

### Verificado

- Rate limit del seguimiento: 12 respuestas 200 y la 13.ª devuelve 429.
- Error lanzado en una página de producto guardado en `client_errors` con
  `user_id` nulo.
- RLS: admin ve el error, un cliente ve 0.
- Job `likehoodie-cleanup` activo a las 04:15 UTC.
- Smoke test: 42 comprobaciones.

## [1.5.2] — 2026-11-14

### Corregido

- El enlace de WhatsApp usa el prefijo internacional correcto para México:
  `wa.me/5215552142692`.
- El sincronizador de Ticketmaster no reescribe `eventos.json` si la API
  devuelve 0 eventos, para no vaciar la cartelera por un fallo temporal.

## [1.5.1] — 2026-11-14

### Cambiado

- El workflow **Eventos** abre una incidencia con instrucciones si falta
  `TICKETMASTER_API_KEY`, en vez de terminar en silencio.
- Documentado el alta de la clave y la primera sincronización manual.

## [1.5.0] — 2026-11-14

### Añadido

- **WhatsApp** `+52 55 5214 2692`: botón flotante con mensaje contextual en
  tienda, producto y seguimiento, además de enlaces en el pie.
- **Monitorización de errores JS** con la tabla `client_errors` y el RPC
  `log_client_error()` (30/hora por sesión, solo lectura admin).
- Sección **Salud** en el admin con errores, checkouts fallidos, prints
  fallidos y compras de modelo fallidas de las últimas 24 h.
- Eventos `checkout_failed`, `print_failed` y `model_purchase_failed`.
- Workflow **Disponibilidad**: cada 30 min comprueba home, CSS, producto,
  seguimiento, admin y el RPC de Supabase; si falla, abre o actualiza una
  incidencia.

### Verificado

- `log_client_error` guarda el error desde una sesión anónima real y el admin
  puede leerlo por RLS.
- WhatsApp genera el enlace `wa.me` con el número y el mensaje correctos.
- Smoke test ampliado a 38 comprobaciones; HTML y enlaces en verde.

## [1.4.0] — 2026-11-14

### Añadido

- **Páginas de producto** para los cuatro modelos (`/modelos/<id>.html`) con
  precio por talla, compra directa, detalles y FAQ.
- Schema `Product` + `Offer`, `BreadcrumbList` y `FAQPage`; canonical y OG
  propios por modelo.
- Enlace **Ver detalle** en cada tarjeta y compra automática al volver desde la
  página de producto con `?comprar=<id>&talla=<talla>`.
- **Seguimiento de pedido** en `/pedido.html`: número + correo, estado,
  progreso, artículos y guía.
- Columnas `carrier`, `tracking_number` y `tracking_url`; el admin puede
  guardarlas y el CSV las exporta.
- RPC `get_order_status(numero, correo)` con datos mínimos y sin PII.
- Workflow semanal de **Ticketmaster** para mantener `eventos.json` al día
  cuando exista `TICKETMASTER_API_KEY`.

### SEO

- `ItemList` y `FAQPage` en la home, `og:locale`, `og:site_name` y metadatos
  de Twitter.
- Canonical en aviso de privacidad, cookies y términos.
- Sitemap con las cuatro páginas de producto.

### Verificado

- Página de producto: cambio de talla actualiza precio (XXL $1,097) y enlace.
- Compra desde producto: talla XXL, print `ready` a 271 DPI y cesta abierta.
- Seguimiento: LH-1011 con correo correcto devuelve estado y artículos; con
  correo incorrecto devuelve “no encontrado”.
- Smoke test ampliado a 34 comprobaciones; HTML y enlaces en verde.

## [1.3.0] — 2026-11-14

### Rendimiento

- Mockups y logos de modelos convertidos a **WebP**: el héroe pasa de 914 KB a
  81 KB, la espalda de 905 KB a 74 KB y el logo del cocodrilo de 2,7 MB a
  337 KB.
- Precarga del héroe con `fetchpriority="high"` y mockups de modelos con carga
  diferida.
- El peso de las imágenes baja de ~2,2 MB a ~160 KB; el LCP en 4G lenta
  (1,6 Mbps, CPU 4×) pasa de ~20,9 s a ~2,6 s y el CLS queda en 0,017.
- El pipeline de impresión sigue recibiendo PNG: el navegador convierte el
  WebP antes de subirlo.

### Accesibilidad

- **Lighthouse Accesibilidad 100**: foco atrapado en cesta, checkout y guía de
  tallas, cierre con Escape y `inert` en el fondo y en los diálogos cerrados.
- Contraste corregido en botones, etiquetas naranjas, miniaturas del editor,
  calendario y pie de página.
- Jerarquía de encabezados del footer y nombres accesibles de cesta, estrellas,
  calendario y redes.

### Añadido

- **Autoguardado del diseño** en `localStorage` con botón **Recuperar diseño**
  al volver; se borra al vaciar el diseño.

### CI

- `node --check`, `html-validate` y smoke test pasan a ser **bloqueantes**.
- Lychee comprueba enlaces con `fail: true`.
- Nuevo `scripts/smoke.mjs` con 18 comprobaciones de checkout, editor,
  seguridad y migración.

## [1.2.0] — 2026-11-14

### Seguridad

- **Una sola `place_order` segura:** se eliminan las sobrecargas antiguas que
  confiaban en el `unitPrice` del navegador y se instala la versión de 5
  argumentos que recalcula el precio con `item_unit_price()`.
- Valida correo, teléfono (10–15 dígitos), dirección, estado, CP (5 dígitos) y
  aplica límites de 5 pedidos/hora por usuario y 3 por correo.
- El cupón se valida y se descuenta en servidor; `coupons` deja de ser legible
  desde el navegador.
- **XSS del panel corregido:** `textColor` y `colorHex` se validan como hex en
  el cliente y en el servidor antes de pintarse en el admin.

### Añadido

- Campos de envío **estado** y **referencias** en el checkout, la tabla
  `orders`, el detalle del admin y la exportación CSV.
- **Teléfono obligatorio** y CP con validación de 5 dígitos.

### Verificado

- Pedido de prueba LH-1013 con estado, referencias y teléfono guardados y
  visibles; total correcto de $998.
- Pedido con `unitPrice` manipulado rechazado con error 22023.
- Pedido con `textColor` malicioso rechazado antes de guardarse.
- Cesta y checkout sin errores de consola; validación de teléfono de 9 dígitos
  bloqueada antes de crear el pedido.

## [1.1.6] — 2026-11-14

### Añadido

- **Alineación del elemento activo:** botones para izquierda, centro y derecha,
  y para arriba, medio y abajo dentro del área de impresión.
- El panel muestra el elemento activo (texto o logo) y su posición actual
  (`Izquierda · Medio`, `Libre`, etc.).
- La alineación respeta el bloqueo: los botones se deshabilitan y se indica que
  hay que desbloquear desde Capas.
- Aplica los mismos límites de posición que el arrastre, también en el tote.

## [1.1.5] — 2026-11-14

### Cambiado

- **La colección de modelos ya no es para personalizar:** cada tarjeta tiene
  selector de talla (XS–XXL) y un botón **Comprar** que añade el diseño tal cual
  a la cesta, sin pasar por el editor.
- El modelo descarga su logo, lo sube a Storage, prepara el archivo de impresión
  DTG con el ancho de su cara y guarda el asset en el artículo del pedido.
- El precio se calcula como una sudadera normal: base por color + extra de logo
  y suplemento XXL. La talla M del Cocodrilo queda en $1,048.
- Comprar dos veces el mismo modelo y talla agrupa cantidades.

### Añadido

- Caché de assets por modelo en la sesión: el primer modelo tarda unos segundos
  en preparar el print y los siguientes son inmediatos.

## [1.1.4] — 2026-11-14

### Añadido

- **Plantillas de diseño** en el editor: Clásica, Panorama, Minimal, Neón,
  Dúo y Cintura.
- Aplican texto, tipografía, color de contraste, escala y posición a la cara
  activa; la plantilla Dúo también coloca el logo si existe.
- La aplicación respeta el bloqueo del texto, actualiza el panel de Texto y se
  puede deshacer con el historial.

## [1.1.3] — 2026-11-14

### Añadido

- **Copiar el logo a la otra cara** desde la barra flotante. Crea un asset
  nuevo para esa cara, con su ancho de impresión (28 cm en espalda), ejecuta
  `process-logo` y conserva escala y rotación; lo centra en el área.
- Si el logo es SVG, se rasteriza a PNG antes de copiarlo.

### Cambiado

- La barra flotante del logo incluye ahora la acción de copiar.
- Copiar respeta el bloqueo del logo destino y no duplica el toast de carga.

## [1.1.2] — 2026-11-14

### Añadido

- **Capas por cara:** panel con texto y logo, orden de apilado, visibilidad y
  bloqueo.
- **Bloqueo:** impide arrastrar, escalar, rotar, mover con flechas y eliminar.
  Se desbloquea desde Capas; el texto bloqueado también deshabilita su campo.
- **Acción de bloqueo** en la barra flotante del elemento.
- El pedido y el admin guardan y respetan el orden de capas y la visibilidad.

### Cambiado

- El candado no cuenta para separar artículos del carrito: dos diseños
  idénticos se fusionan aunque uno esté bloqueado.

## [1.1.1] — 2026-11-13

### Añadido

- **Barra superior fija** del editor bajo la cabecera del sitio. Mide la altura
  real del header con `--site-header-h`, añade sombra al quedar fija y respeta
  el scroll con `scroll-margin-top` en `#personalizar`.

### Cambiado

- `.studio.editor` deja de recortar el contenido (`overflow: visible`) para
  permitir `position: sticky`; las esquinas se redondean por pieza (barra,
  rail y panel) para conservar el diseño.

## [1.1.0] — 2026-11-13

### Añadido

- **Colección de modelos** (`#modelos`): Cocodrilo de Miami, Insignia
  atardecer, Panorama Vice y Corazón neón. Cada tarjeta carga el modelo en el
  estudio con su color y logo, y lanza el archivo de impresión.
- **Color blanco** (`#ffffff`) en la paleta: $949 en sudadera y $379 en tote.
- **Editor tipo Canva, fase 2**: historial de 50 pasos con deshacer/rehacer,
  atajos (`Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z`, `Ctrl/Cmd+Y`, `Ctrl/Cmd+D`,
  flechas, `Supr`), barra flotante del elemento (centrar, copiar al otro lado,
  eliminar) y guía de colocación plegable.
- Assets de modelo en `assets/modelos/` y logo del cocodrilo con transparencia.
- Enlaces **Modelos** en la navegación principal, móvil y footer.
- Documentación: `CONTRIBUTING.md`, `SECURITY.md`, `CHANGELOG.md`, licencia
  MIT para el código y licencia separada para marca/assets.
- Plantillas de issue/PR y workflows de enlaces, HTML y Lighthouse.
- Página `404.html`.

### Cambiado

- El estudio pasa a layout de editor: barra superior, rail de herramientas,
  lienzo central y panel de propiedades contextual.
- La galería de vistas se limita a frente y espalda.
- `npm`/build siguen sin ser necesarios: todo es estático.

## [1.0.0] — 2026-11-13

### Añadido

- Tienda estática con catálogo base, configurador en vivo, carrito persistente
  y checkout de demostración.
- Materiales, técnicas, precios dinámicos y guía de tallas.
- Panel de administración con pedidos, carritos, métricas y export CSV.
- Supabase: carritos, pedidos, eventos, RLS y funciones de servidor.
- Archivo de impresión DTG automático en dos etapas (`process-logo`), con
  recorte de fondo, defringe y ampliación a 300 DPI.
- Vectorizador de logo en el navegador (color y 1 tinta).
- Analítica con consentimiento, páginas legales y calendario de conciertos.
- Integración de pagos con Clip preparada y desactivada por defecto.
