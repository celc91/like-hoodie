# Fase A — Qué falta para operar

Inventario de lo que bloquea el paso de demo a tienda real. Lo que requiere
decisión o material del negocio va marcado como **[negocio]**.

## 1. Datos legales [negocio]

Sustituyen los `[completar]` y `[nombre legal o razón social]` de
`privacidad.html` (líneas 81-83 y 251) y `terminos.html` (líneas 80-82 y 187).

| Dato | Dónde |
|---|---|
| Nombre legal o razón social | `privacidad.html`, `terminos.html` |
| RFC | `privacidad.html`, `terminos.html` |
| Domicilio fiscal completo (calle, número, colonia, CP, ciudad, estado) | `privacidad.html`, `terminos.html` |
| Ciudad de jurisdicción | `terminos.html` §12 |
| Correo para derechos ARCO | `privacidad.html` §6 (hoy `hola@likehoodie.com`) |

Revisión pendiente: `privacidad.html` línea 148 afirma que los errores técnicos
no incluyen direcciones ni teléfonos. El endpoint `client-error` guarda texto
libre sin redacción, así que la garantía no está demostrada. Dos opciones:

1. Redactar PII en `client-error/index.ts` (quitar correos, teléfonos y
   direcciones del mensaje, pila y ruta) y mantener la frase.
2. Suavizar la frase a lo que el código sí garantiza.

Recomendación: la 1, porque además evita guardar datos personales por accidente.

## 2. Fotografías (mejora pendiente, no bloqueante)

No hay fotos nuevas por ahora: se mantienen los mockups actuales de
`assets/`, con licencia de uso comercial. El sitio funciona con ellos y no
bloquean publicar.

Sustituirlos es una mejora de confianza y conversión, no un requisito técnico.
Conviene hacerlo cuando existan prendas producidas y fotos propias.

Son la base del configurador: el color se aplica con `mix-blend-mode` sobre la
foto y la máscara, así que la prenda debe ser clara para que el tinte produzca
los siete colores.

| Archivo | Medida actual | Sustituir por |
|---|---|---|
| `assets/hoodie-front.webp` | 1003 × 1229 | Foto frontal real, misma proporción, fondo transparente |
| `assets/hoodie-back.webp` | 999 × 1229 | Foto trasera real |
| `assets/hoodie-side-right.webp` | 375 × 480 | Perfil derecho |
| `assets/modelos/<id>.webp` | 4:5, ~900 px de ancho | Mockup real del modelo |
| `assets/modelos/<id>-logo.webp` | Transparente, < 5 MB | Arte final del modelo |
| `assets/modelos/og-<id>.jpg` | 1200 × 630 | Imagen social del modelo |

Variantes que genera el sitio y hay que recrear para cada foto nueva:

```text
hoodie-front-160.webp   160 px de ancho
hoodie-front-480.webp   480 px
hoodie-front-800.webp   800 px
```

Con ImageMagick:

```bash
magick original.png -resize 1003x1229 -quality 82 assets/hoodie-front.webp
magick assets/hoodie-front.webp -resize 800x assets/hoodie-front-800.webp
magick assets/hoodie-front.webp -resize 480x assets/hoodie-front-480.webp
magick assets/hoodie-front.webp -resize 160x assets/hoodie-front-160.webp
```

Fotos adicionales recomendadas: 3-5 de producto en uso (luz natural, sin filtros
agresivos), un detalle de costura o print, y una foto de empaque.

## 3. Reseñas [negocio]

No existe sección de reseñas en `index.html`. Para añadirla hacen falta 3-5
reseñas reales con nombre, fecha, estrellas y texto, y consentimiento de quien
las escribe. No se deben inventar: el marcado `Review`/`aggregateRating` con
datos falsos es motivo de penalización.

Estructura prevista: sección después de `#modelos`, con `Review` + `AggregateRating`
en el JSON-LD existente. No se implementa hasta tener el contenido.

## 4. Clip [técnico, bloqueante]

Antes de activar cobros:

1. ~~Añadir `orders.currency`~~ (hecho).
2. ~~Idempotencia en `clip-pay` y `clip-checkout`~~ (hecho, ver `docs/clip-idempotencia.md`).
3. KYC y credenciales de producción.
4. Pedido real de bajo monto y comprobación del webhook.

El punto 3 es del negocio; el 4 requiere credenciales reales.

## Orden propuesto

1. Datos legales y frase de PII (bloquea publicar).
2. `orders.currency` + idempotencia de Clip (hecho).
3. Activar Clip y pedido de prueba.
4. Fotos reales cuando existan prendas producidas.
5. Reseñas cuando haya clientes reales.
