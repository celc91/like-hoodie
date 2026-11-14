# Changelog

Todos los cambios visibles del proyecto. Formato basado en
[Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y versionado
semántico.

## [Sin publicar]

### Por hacer

- Capas y bloqueo de elementos.
- Alineación horizontal/vertical por separado.
- Copiar el logo a la otra cara creando un asset nuevo.
- Plantillas de diseño dentro del editor.
- Integración con Canva Connect (importar diseño y exportar PNG).

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
