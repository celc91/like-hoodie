# Contribuir

Gracias por querer mejorar like hoodie ♡. Este repo es un sitio estático
(HTML, CSS y JavaScript sin build) con Supabase para pedidos, storage y
Edge Functions.

## Ponerlo en marcha

No hace falta instalar nada para ver la tienda:

```sh
# opción 1: abrir index.html en el navegador
# opción 2: servidor local
npx serve .
# o
python -m http.server 4173
```

Para el panel y los pedidos necesitas el proyecto de Supabase:

1. Sigue [`supabase/README.md`](supabase/README.md).
2. Pega la URL y la publishable key en `supabase-config.js`.
3. Crea un usuario administrador y entra a `admin.html`.

## Ramas y commits

- Parte de `main` y usa una rama corta: `editor/capas`, `catalogo/nuevo-modelo`,
  `fix/checkout-movil`.
- Commits en español, en imperativo y sin acentos en el asunto cuando sea
  posible:
  `Catalogo: modelo cocodrilo`, `Editor: barra flotante`.
- Un commit = un cambio coherente. No mezcles refactors con features.
- No subas `00-accesos`, `.env`, claves de servicio ni datos de clientes.

## Antes de abrir un PR

- [ ] La tienda abre en local sin errores de consola.
- [ ] Probado en escritorio y en móvil (o al menos a 375 px de ancho).
- [ ] El configurador sigue funcionando: color, talla, material, técnica,
      texto, logo, frente/espalda.
- [ ] El precio se actualiza y el carrito conserva los cambios.
- [ ] Deshacer/rehacer y los atajos del editor no rompen el diseño.
- [ ] Si tocaste el pipeline de impresión, probaste una subida y viste
      “Archivo de impresión listo”.
- [ ] Si tocaste el admin, probaste un pedido con logo.
- [ ] No hay secretos ni archivos temporales en el diff.
- [ ] Actualizaste `CHANGELOG.md` si el cambio es visible para el usuario.

## Estilo

- JavaScript sin frameworks; mantén el patrón de `app.js` (funciones pequeñas,
  `data-*` como contrato con el HTML).
- CSS con variables de `:root`; evita colores y tamaños sueltos si ya existe un
  token.
- Español para el texto de la interfaz y comentarios; nombres de código en
  inglés cuando el resto del archivo ya lo hace.
- Respeta `prefers-reduced-motion` y el foco visible.

## Añadir un modelo al catálogo

1. Mockup en `assets/modelos/<id>.webp` (4:5, ~900 px).
2. Arte en `assets/modelos/<id>-logo.webp` con transparencia y < 5 MB.
3. Tarjeta en `index.html` con `data-model-size="<id>"` y `data-buy-model="<id>"`.
4. Entrada en `MODELS` al final de `app.js`.

Más detalle en el [README](README.md#colección-de-modelos).

## Ajustes del repositorio (GitHub)

Hay ajustes que no viven en el código y hay que hacerlos en la web de GitHub:

- **Homepage:** `https://likehoodie.com/` (no la URL de `github.io`).
- **Description:** “Tienda de sudaderas personalizadas con editor tipo Canva, DTG y Supabase.”
- **Topics:** `ecommerce`, `supabase`, `dtg`, `streetwear`, `vanilla-javascript`, `github-pages`.
- **Social preview:** subir `docs/capturas/social-preview.png` (1280×640).
- **Seguridad:** 2FA, secret scanning, Dependabot alerts y protección de `main`.
- **Issues:** las plantillas de `.github/ISSUE_TEMPLATE` se activan solas al estar en `main`.

## Reportar un fallo

Usa la plantilla de issue. Incluye URL, navegador, pasos y lo que esperabas.
Para problemas de seguridad, sigue [`SECURITY.md`](SECURITY.md).
