# Pulido de interacción y sistema visual — apple-design

Checkpoints:
- `checkpoints\mi-proyecto-2026-11-11_1506` — antes de tocar nada.
- `checkpoints\mi-proyecto-2026-11-11_1522-posapple` — tras el primer pase de interacción.

Para volver a cualquiera de los dos, copia su contenido sobre
`C:\Users\celc9\mi-proyecto`.

---

## 1. Interacción (primer pase)

- Feedback al pulsar (`scale .97`, 90 ms) en botones y controles.
- Zonas táctiles de 44 px en carrito, menú y cerrar.
- Borde de scroll suave en la cabecera en vez de línea dura.
- Panel de la cesta **arrastrable**: 1:1, goma elástica, proyección de
  impulso, spring crítico con traspaso de velocidad e interrumpible.
- `prefers-reduced-transparency` y `prefers-contrast`.
- Movimiento reducido respetado.

## 2. Interacción (segundo pase)

### Menú móvil
- Antes aparecía y desaparecía de golpe (`display: none` → `block`).
- Ahora se despliega animando altura (`grid-template-rows: 0fr → 1fr`),
  con fundido y los enlaces escalonados 40 ms.
- Cerrado ocupa **0 px** (antes habría dejado 34 px de relleno).
- Se lee como capa: fondo `--paper` y sombra suave al abrir.

### Modal de checkout y guía de tallas
- Fondo con blur y saturación (material, no solo oscurecer).
- Entrada con más recorrido (`translateY(22px) scale(.965)` → 0) y curva
  más viva.
- **En móvil pasa a ser una hoja inferior** con asa de arrastre.
- Arrastre para cerrar: umbral, goma elástica, impulso y spring.
- Al cerrar, el panel se retira sin reentrar mientras el fondo se apaga.

## 3. Composición, tipografía y color

### Color
- Neutros más cálidos y coherentes: `#f7f2e9` / `#fffdf9` / `#17130f`.
- Un solo acento protagonista: naranja `#f0451a` (un paso menos fluorescente),
  oscuro `#d43a12`.
- El lima baja a `#dcf07e`, solo como subrayado y detalles.
- Radios 24 → 22 px y sombras más difusas.
- Blob del hero y sombras del botón principal recoloreados a juego.

### Tipografía
- `font-optical-sizing: auto` en titulares (Bricolage es variable).
- `text-wrap: balance` en títulos y `pretty` en párrafos.
- Escala revisada: hero `clamp(3.1rem, 7.2vw, 6.6rem)` con `line-height .86`
  y tracking `-.05em`; secciones `clamp(2.1rem, 4.4vw, 3.4rem)`.
- Cuerpo a 16.5 px / 1.62 con medida máxima de ~46–52 caracteres.

### Composición
- Contenedor 1200 → **1160 px** y márgenes laterales 56 px (36/32 en móvil).
- Ritmo vertical unificado: `clamp(78px, 8.6vw, 124px)` en todas las secciones.
- Cabeceras de sección con separación proporcional al viewport.

## Qué NO se tocó
- Estructura HTML (solo se añadió el asa `.sheet-grab` en los dos modales).
- Lógica de carrito, checkout, precios y formularios.
- Contenido y textos.

## Verificado
- Menú: 0 px cerrado → 399 px abierto, con transición interrumpible.
- Modal: arrastre corto vuelve a 0 y sigue abierto; arrastre largo cierra
  y el panel termina en su estado final sin rebote.
- Sin errores de consola; `node --check` limpio.

---

## 4. Plan de la crítica de Impeccable (top 3)

Checkpoint previo: `checkpoints\mi-proyecto-2026-11-11_1620-preplan`.

### Precio visible (P1)
- Barra fija con total + "Añadir a la cesta" al inicio de la columna de controles.
- Usa `position: sticky` y refleja el precio real (se actualiza con cada opción).
- Se cambió `.studio { overflow: hidden }` por `overflow: clip`: recorta igual
  pero no rompe el sticky (con `hidden` la barra no se fijaba).
- El botón de la barra dispara el mismo handler que el botón del final.

### Compra en blanco (P1)
- "Añadir a la cesta" bloquea si no hay texto ni logo en frente o espalda:
  aviso "Añade un texto o un logo antes de añadir a la cesta" y foco al editor.

### Diseño visible en la cesta (P1)
- La miniatura de cada línea pinta el texto y el logo del diseño guardado
  (`.print-area--thumb`), no una sudadera lisa.

### Confianza (P1, parcial)
- El best seller (La Clásica) se generaba con `brightness(0.18)` sobre el mockup
  claro: la tela quedaba casi negra y sin pliegues. Subido a `0.27` con
  contraste `1.06` para que se lea la prenda.
- **No se añadieron fotos de cliente ni macros de impresión**: no existen y
  inventarlas sería prueba social falsa. Requiere sesión de fotos real.
- **El aviso de "pedido de demostración" sigue en el checkout** a la espera de
  confirmar que el cobro con Clip está en producción.

---

## 5. Asas de tamaÃ±o y rotaciÃ³n sobre la prenda

- Cada elemento del diseÃ±o (texto y logo) lleva dos asas visibles sobre la sudadera:
  - **Redimensionar** (esquina inferior derecha): arrastra y escala en vivo, sincronizado
    con el deslizador y el porcentaje.
  - **Rotar** (esquina superior derecha): arrastra para girar; con Shift ajusta de 15 en 15.
- LÃ­mites tomados del propio deslizador (50â€“220 %). Se subiÃ³ el mÃ¡ximo de 150/200 a 220.
- Teclado: con el asa enfocada, flechas verticales cambian el tamaÃ±o y horizontales la rotaciÃ³n.
- La rotaciÃ³n se guarda por cara (textRotate / logoRotate) y se aplica con --item-rotate.
- Las asas se re-crean tras cada repintado: updatePreview reescribe el contenido del texto
  y las borraba.

### Paleta de texto
- De 4 a 12 colores: blanco, negro, naranja, lima, rosa, rojo, violeta, azul, verde,
  amarillo, dorado y gris. La fila envuelve en pantallas estrechas.

### Nota
- Se restaurÃ³ index.html desde el checkpoint porque una ediciÃ³n con PowerShell rompiÃ³ la
  codificaciÃ³n UTF-8; los cambios se reaplicaron con la herramienta de ediciÃ³n.


### Rotación en la cesta
- El snapshot del artículo guarda `textRotate` y `logoRotate`.
- La miniatura de la cesta aplica la rotación al texto y al logo, y recorta el
  desbordamiento.
- Los artículos añadidos antes de este cambio quedan a 0°.
