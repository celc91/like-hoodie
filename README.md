# Chama — Sudaderas personalizadas

Tienda online de demostración para vender sudaderas personalizadas. Incluye catálogo, configurador en vivo, carrito persistente y checkout simulado. Todo con HTML, CSS y JavaScript sin dependencias ni proceso de build.

![Vista previa de Chama](preview.png)

## Qué incluye

- **Diseñador en vivo:** color de sudadera, talla, texto, color de texto y subida de logo (PNG, JPG o SVG).
- **Precio dinámico:** base por color, suplemento de talla XXL y extra por logo.
- **Catálogo:** cuatro modelos con selección directa al configurador.
- **Carrito:** cantidades, eliminación, subtotal, envío y envío gratis desde $1,200 MXN.
- **Persistencia:** el carrito se guarda en `localStorage`.
- **Checkout de demostración:** formulario validado y confirmación de pedido. No procesa pagos reales.
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

## Estructura

```text
.
├── index.html        # Contenido y estructura
├── styles.css        # Diseño, responsive y animaciones
├── app.js            # Configurador, carrito, checkout y modales
├── legal.js          # Aviso de cookies y almacenamiento local
├── privacidad.html   # Aviso de privacidad
├── cookies.html      # Política de cookies
├── terminos.html     # Términos y condiciones
├── preview.png       # Captura para el README
└── README.md
```

## Personalización rápida

- **Colores de marca:** variables en `:root` dentro de `styles.css` (`--orange`, `--lime`, `--cream`, `--ink`).
- **Precios:** constantes y mapa `BASE_PRICES` al inicio de `app.js`.
- **Envío gratis:** `FREE_SHIPPING` en `app.js` (por defecto $1,200 MXN).
- **Coste de envío:** `SHIPPING_COST` en `app.js`.
- **Productos del catálogo:** tarjetas en `index.html` y sus botones `data-personalize`.

## Antes de publicar la tienda real

- Completa los datos marcados con `[completar]` en `privacidad.html` y `terminos.html`: razón social, RFC, domicilio fiscal y ciudad de jurisdicción.
- Revisa los documentos legales con un abogado antes de operar comercialmente.
- Actualiza el aviso de privacidad y los términos cuando conectes pagos reales, newsletter, analítica o envíos.
- Si añades cookies de analítica o publicidad, actualiza `cookies.html` y pide consentimiento.

## Nota

El checkout es una demostración visual: valida los datos y muestra una confirmación, pero no realiza ningún cargo. Para cobrar de verdad habría que conectar una pasarela de pago (Stripe, Mercado Pago, Openpay o similar) y un backend que gestione pedidos, archivos de logo e inventario.
