# like hoodie ♡ — Sudaderas personalizadas

Tienda online de demostración para vender sudaderas personalizadas. Incluye catálogo, configurador en vivo, carrito persistente y checkout simulado. Todo con HTML, CSS y JavaScript sin dependencias ni proceso de build.

**Sitio:** https://celc91.github.io/like-hoodie/

![Vista previa de like hoodie ♡](preview.png)

## Qué incluye

- **Diseñador en vivo:** color de sudadera, talla, texto, tipografía, color de texto y subida de logo (PNG, JPG o SVG).
- **Materiales:** algodón 400 g, algodón 320 g, French terry, mezcla 50/50 y poliéster técnico, con ajuste de precio y textura visual en el modelo.
- **Técnicas de personalización:** DTG, DTF, bordado, serigrafía, vinilo textil y sublimación, con costos, acabados visuales y avisos de compatibilidad.
- **Editor frontal y trasero:** cambia de vista, arrastra el texto y el logo, elige tipografía, ajusta su tamaño y personaliza cada cara por separado.
- **Galería de vistas:** frente, perfil derecho, espalda y perfil izquierdo con miniaturas; los perfiles permiten revisar la prenda sin editar el diseño.
- **Cordones personalizables:** elige el color de los cordones de la capucha.
- **Precio dinámico:** base por color, material, técnica, suplemento de talla XXL y extra por logo en cada cara.
- **Catálogo:** cuatro modelos con selección directa al configurador.
- **Carrito:** cantidades, eliminación, subtotal, envío y envío gratis desde $1,200 MXN.
- **Persistencia:** el carrito se guarda en `localStorage` y se sincroniza con Supabase.
- **Checkout de demostración:** formulario validado, confirmación de pedido y registro del pedido en Supabase. No procesa pagos reales.
- **Panel de administración:** pedidos, estados, carritos abandonados, métricas, embudo y exportación CSV, protegido con Supabase Auth.
- **Analítica propia:** eventos de visita, carrito y checkout guardados en Supabase.
- **Guía de tallas, FAQ, opiniones y newsletter.**
- **Páginas legales:** aviso de privacidad, política de cookies y términos y condiciones.
- **Aviso de cookies:** banner informativo con almacenamiento local para recordar la aceptación.
- **Responsive:** móvil, tablet y escritorio.
- **Accesibilidad:** navegación por teclado, foco visible, etiquetas ARIA y respeto por `prefers-reduced-motion`.

## Ver la web en local

No necesita instalación. Abre directamente `index.html` en el navegador.

Si prefieres servirla con un servidor local:

```bash
npx serve .
```

O con Python:

```bash
python -m http.server 4173
```

## Publicar en GitHub Pages

1. Sube el proyecto a un repositorio de GitHub.
2. Entra en **Settings → Pages**.
3. En **Build and deployment**, selecciona **Deploy from a branch**.
4. Elige la rama `main`, carpeta `/ (root)` y guarda.
5. GitHub publicará la web en `https://TU-USUARIO.github.io/NOMBRE-DEL-REPO/`.

El sitio usa rutas relativas, así que funciona sin cambios en la subcarpeta de GitHub Pages.

## Pedidos y administración

La tienda guarda carritos, pedidos y eventos en **Supabase**. El panel está en `admin.html` y requiere iniciar sesión con un usuario administrador.

Para configurarlo:

1. Sigue los pasos de [`supabase/README.md`](supabase/README.md).
2. Pega la URL y la publishable key del proyecto en `supabase-config.js`.
3. Publica los cambios en GitHub Pages.

Mientras `supabase-config.js` tenga los valores de ejemplo, la tienda funciona en modo demostración y el panel muestra un aviso de configuración.

## Calendario de conciertos

La sección **Eventos** (`#eventos`) es una fuente de inspiración: muestra los próximos conciertos en México para que cada persona imagine y diseñe su sudadera con el artista, la ciudad o la fecha. Cada evento tiene un botón **Diseñar** que lleva al personalizador con un texto sugerido, y un enlace secundario para comprar boletos en **Ticketmaster México**.

Los datos viven en `eventos.json`. Es una fotografía de la cartelera, así que los horarios, recintos y disponibilidad pueden cambiar; confirma siempre en Ticketmaster antes de comprar. like hoodie ♡ no vende boletos ni participa en esa transacción.

Para actualizar la cartelera con la API oficial:

1. Crea una API key gratuita en [developer.ticketmaster.com](https://developer.ticketmaster.com/).
2. Ejecuta el sincronizador:

```powershell
$env:TICKETMASTER_API_KEY = "TU_API_KEY"
node scripts/sync-ticketmaster.mjs
```

El script consulta la **Discovery API** para México, filtra eventos musicales y reescribe `eventos.json`. La API key solo se usa en la computadora o en CI; nunca se incluye en el sitio publicado.

## Estructura

```text
.
├── index.html        # Contenido y estructura
├── styles.css        # Diseño, responsive y animaciones
├── app.js            # Configurador, carrito, checkout y modales
├── eventos.js        # Calendario de conciertos
├── eventos.json      # Cartelera de Ticketmaster México
├── store-supabase.js # Sincronización de carritos, pedidos y eventos
├── supabase-config.js# URL y publishable key de Supabase
├── admin.html        # Panel de administración
├── admin.js          # Lógica del panel
├── admin.css         # Diseño del panel
├── supabase/         # Esquema SQL y guía de configuración
├── scripts/          # Sincronización de la cartelera de eventos
├── legal.js          # Aviso de cookies y almacenamiento local
├── privacidad.html   # Aviso de privacidad
├── cookies.html      # Política de cookies
├── terminos.html     # Términos y condiciones
├── assets/           # Fotografías de producto y máscaras
├── preview.png       # Captura para el README
└── README.md
```

## Personalización rápida

- **Colores de marca:** variables en `:root` dentro de `styles.css` (`--orange`, `--lime`, `--cream`, `--ink`).
- **Precios:** constantes y mapa `BASE_PRICES` al inicio de `app.js`.
- **Envío gratis:** `FREE_SHIPPING` en `app.js` (por defecto $1,200 MXN).
- **Coste de envío:** `SHIPPING_COST` en `app.js`.
- **Productos del catálogo:** tarjetas en `index.html` y sus botones `data-personalize`.

## Fotografías de producto

El editor usa una maqueta fotográfica frontal y trasera con fondo transparente, extraída de una plantilla de **Mockup Space** (licencia free personal & commercial use). Puedes sustituir `assets/hoodie-front.png` y `assets/hoodie-back.png` por fotografías reales de tus sudaderas manteniendo el fondo transparente y una composición vertical similar. Los colores se aplican con capas de tinte y máscaras, así que las fotos nuevas deben ser claras y con buena iluminación.

## Antes de publicar la tienda real

- Completa los datos marcados con `[completar]` en `privacidad.html` y `terminos.html`: razón social, RFC, domicilio fiscal y ciudad de jurisdicción.
- Revisa los documentos legales con un abogado antes de operar comercialmente.
- Configura Supabase (`supabase/README.md`), crea el usuario administrador y pega la URL y la publishable key en `supabase-config.js`.
- Actualiza el aviso de privacidad y los términos cuando conectes pagos reales, newsletter o envíos.
- Si añades cookies de analítica o publicidad, actualiza `cookies.html` y pide consentimiento.

## Nota

El checkout es una demostración visual: valida los datos, registra el pedido como demostración y muestra una confirmación, pero no realiza ningún cargo. Para cobrar de verdad habría que conectar una pasarela de pago (Stripe, Mercado Pago, Openpay o similar), validar precios en el servidor y gestionar los archivos de logo en un almacenamiento privado.
