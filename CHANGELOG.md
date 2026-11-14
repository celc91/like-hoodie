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
