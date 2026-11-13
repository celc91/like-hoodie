---
name: Logo Prep
description: Prepara logos de clientes para like hoodie (recorte, fondo, DPI, PNG de impresión y SVG color o 1 tinta) con un pipeline determinista y validaciones antes de producir.
---

# Logo Prep

Pipeline determinista para dejar un logo listo para imprimir o cortar. Úsala
cuando haya que limpiar, medir, vectorizar o preparar el archivo de producción
de un logo: pedidos nuevos, logos borrosos, fondo blanco, logos con transparencia
o preparación para serigrafía/vinilo.

## Reglas

- **Nunca sobrescribas el original.** Todo se escribe en una carpeta de salida.
- **Nada de retoque generativo.** Los modelos de imagen inventan tipografías y
  detalles; para logos se usan solo herramientas deterministas.
- **No amplíes más de 2×** ni prometas detalle que el archivo no tiene.
- **Conserva proporción y transparencia.**
- Si el logo es una foto, un degradado o tiene fondo no uniforme, **detente y
  avisa** antes de vectorizar.

## Decisión por técnica

| Técnica | Archivo de entrega | Modo de vector |
| --- | --- | --- |
| DTG / DTF | PNG a 300 DPI con transparencia | Opcional (solo si llega borroso) |
| Serigrafía | SVG de 1 tinta | `mono` |
| Vinilo textil | SVG de 1 tinta | `mono` |
| Sublimación | PNG 300 DPI (tejido claro) | Opcional |
| Bordado | No usar SVG: digitalizar en Ink/Stitch | No aplica |

Tamaños de impresión de referencia (ancho):

| Zona | Ancho |
| --- | --- |
| Pecho | 8–10 cm |
| Espalda | 28 cm |
| Manga | 7 cm |
| Tote | 30 cm |

## Pipeline

Trabaja **desde la raíz del proyecto like hoodie** (donde están `vectorize.js` y
`vendor/imagetracer-1.2.6.js`). La skill vive en `.opencode/skills/logo-prep/` y
reutiliza ese motor. En este equipo también está enlazada en
`~/.config/opencode/skills/logo-prep` para tenerla disponible desde cualquier
carpeta; el enlace apunta a la copia del repo.

### 0. Instalar dependencias (una vez)

```sh
cd .opencode/skills/logo-prep/scripts
npm install
```

### 1. Analizar y preparar el raster

```sh
SKILL=".opencode/skills/logo-prep"
node "$SKILL/scripts/prepare.js" "ruta/logo.png" \
  --width-cm 28 --dpi 300 --out logo-prep-out
```

Genera:

- `logo-prep-out/<nombre>-print.png`: recortado, fondo eliminado, alfa y DPI
  incrustado. **Este es el archivo que va a producción.**
- `logo-prep-out/<nombre>-logo.png`: recortado a resolución original.
- `logo-prep-out/<nombre>-report.json`: medidas, DPI, uniformidad del fondo,
  porcentaje de fondo eliminado, avisos y factor de ampliación.

Opciones: `--no-trim` (no recortar borde), `--no-cutout` (no quitar el fondo),
`--upscale` (hasta 2×), `--name`.

### DTG

DTG imprime raster, **no SVG**. El entregable es `<nombre>-print.png`:

```sh
node "$SKILL/scripts/prepare.js" "logo-cliente.png" --width-cm 28 --upscale
```

- 300 DPI al ancho elegido, PNG con canal alfa, sRGB.
- El fondo uniforme se elimina por relleno desde el borde y se aplica un
  `defringe` para que no quede halo claro sobre prenda oscura.
- No vectorizar: se pierde detalle y no aporta nada a DTG.

### 2. Vectorizar

```sh
node "$SKILL/scripts/trace.js" "logo-prep-out/logo-print.png" \
  --mode both --garment "#1c1c1f" --out logo-prep-out
```

- `--mode color|mono|both` (por defecto `both`).
- `--garment` es el color de la prenda: sirve para decidir el contraste de logos
  blancos o negros con transparencia.
- Escribe `<nombre>-color.svg`, `<nombre>-mono.svg` y
  `<nombre>-vector-report.json`.

### 3. Validar antes de entregar

Lee `references/checklist.md` y comprueba:

- El SVG abre y tiene `width`, `height` y `viewBox`.
- No queda el color centinela `rgb(255, 0, 255)`.
- Para serigrafía/vinilo: 1 solo color de relleno.
- DPI de origen ≥ 150 (ideal 300) para el ancho de impresión elegido.
- Trazos y nodos dentro de lo razonable (`paths` < 600, `nodes` < 9000).

Si algo falla, **no entregues**: explica qué falta y pide un archivo mejor.

## Flujo completo

```sh
SKILL=".opencode/skills/logo-prep"
node "$SKILL/scripts/prepare.js" "logo-cliente.png" --width-cm 10 --upscale
node "$SKILL/scripts/trace.js" "logo-prep-out/logo-cliente-print.png" --mode both
```

## Qué NO hacer

- No vectorizar fotos, degradados suaves ni sombras: el resultado sale sucio.
- No usar `--upscale` para "salvar" un logo de 200 px: suaviza, no recupera.
- No cambiar colores del logo sin permiso del cliente.
- No usar el SVG para bordado: hace falta digitalización de puntadas.
