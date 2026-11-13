# Checklist antes de entregar un logo

## Archivo raster

- [ ] Se trabajó sobre una copia; el original sigue intacto.
- [ ] El fondo es transparente o uniforme y se recortó sin comerse partes del logo.
- [ ] El ancho de salida cubre el tamaño de impresión:
      `ancho_px ≥ ancho_cm / 2.54 × 300`.
- [ ] DPI de origen ≥ 150. Si es menor, se avisó al cliente.
- [ ] No se amplió más de 2×.
- [ ] El PNG conserva transparencia (canal alfa) si el diseño la necesita.

## Archivo vectorial

- [ ] El SVG abre en navegador y en Illustrator/Inkscape.
- [ ] Tiene `width`, `height` y `viewBox`.
- [ ] No queda el color centinela `rgb(255, 0, 255)`.
- [ ] Modo `mono`: exactamente 1 color de relleno.
- [ ] Modo `color`: ≤ 8 colores para serigrafía; más solo para DTG/DTF.
- [ ] Trazos < 600 y nodos < 9000. Si se pasa, revisar o simplificar.
- [ ] El trazo no tiene huecos ni islas que no existan en el logo.
- [ ] Los textos siguen siendo legibles (comparar original vs. vector).

## Por técnica

- [ ] DTG/DTF: PNG 300 DPI con transparencia.
- [ ] Serigrafía/vinilo: SVG de 1 tinta, sin degradados.
- [ ] Sublimación: PNG 300 DPI, tejido claro y ≥ 50 % poliéster.
- [ ] Bordado: no se entrega SVG; se digitaliza (Ink/Stitch, Hatch o taller).

## Cuándo detenerse

- El logo es una foto o tiene sombras/degradados suaves.
- El fondo no es uniforme y no hay recorte limpio.
- El cliente solo tiene una captura de pantalla o un logo de menos de 400 px
  para una espalda de 28 cm.
- El resultado del vector cambia la tipografía o pierde detalles del original.

En esos casos: explicar el problema, pedir el archivo original o proponer otra
técnica (DTG con el raster, bordado digitalizado, etc.).
