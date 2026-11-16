# Reseñas de clientes

La sección `#resenas` existe en `index.html` pero **está oculta por defecto**.
`resenas.js` la muestra solo cuando `resenas.json` tiene al menos una reseña con
consentimiento explícito. Así el sitio nunca enseña reseñas inventadas ni un
bloque vacío.

## Formato de `resenas.json`

```json
[
  {
    "name": "María G.",
    "rating": 5,
    "text": "Llegó en tres días y la impresión se ve increíble.",
    "date": "2026-12-02",
    "product": "Sudadera negra · DTG",
    "consent": true
  }
]
```

| Campo | Obligatorio | Notas |
|---|---|---|
| `name` | sí | Nombre o iniciales, como la persona acepte publicarse |
| `rating` | sí | Entero de 1 a 5 |
| `text` | sí | Copia fiel; solo se corrigen erratas evidentes |
| `date` | no | `AAAA-MM-DD`; se muestra como mes y año |
| `product` | no | Prenda o técnica |
| `consent` | sí | Debe ser `true`; sin esto la reseña no se pinta |

Los campos se escapan al renderizar, así que no hace falta limpiar HTML a mano.

## Reglas

1. Solo reseñas reales, con permiso de quien las escribe. Se recomienda pedirlo
   por correo o WhatsApp y guardar la respuesta.
2. No se edita el sentido del texto ni se sube la valoración.
3. No se ofrecen descuentos a cambio de reseñas: además de ser opaco, va contra
   las políticas de Google y Meta.
4. Si una reseña es negativa, se publica igual. Es más creíble un 4.6 con una
   queja que un 5.0 perfecto.

## Datos estructurados

**No** se inyecta `Review`/`AggregateRating` desde JavaScript a propósito: la
página ya tiene un bloque `Product` en `index.html` y añadir otro `Product` con
valoraciones duplicaría la entidad y puede confundir a Google.

Cuando haya reseñas reales, se añaden al bloque `Product` existente (línea 39 de
`index.html`) a mano o con un script de build:

```json
"aggregateRating": {
  "@type": "AggregateRating",
  "ratingValue": "4.8",
  "reviewCount": "12"
},
"review": [
  {
    "@type": "Review",
    "author": { "@type": "Person", "name": "María G." },
    "datePublished": "2026-12-02",
    "reviewRating": { "@type": "Rating", "ratingValue": 5, "bestRating": 5 },
    "reviewBody": "Llegó en tres días y la impresión se ve increíble."
  }
]
```

Nunca se declara `aggregateRating` sin reseñas visibles en la página.

## Caché

`resenas.json` se pide con `cache: "no-cache"`, así que un cambio se ve al
recargar. Si algún día se sirve desde CDN con caché agresiva, conviene añadir un
`?v=` al fetch igual que a los scripts.
