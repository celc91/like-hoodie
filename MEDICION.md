# Medición y consentimiento

Cómo se mide la tienda, con qué herramientas y bajo qué permiso. Este documento
explica las decisiones para que cualquiera pueda revisarlas, mantenerlas o
revertirlas sin tener que leer el código.

> **Resumen:** nada de Google ni de Meta se descarga hasta que la persona lo
> autoriza. Analítica y publicidad son permisos independientes. Las compras se
> envían también desde el servidor, y solo si esa persona aceptó publicidad.

## En una tabla

| Herramienta | Para qué | Cuándo se carga |
| --- | --- | --- |
| Google Analytics 4 | Saber qué páginas y pasos del configurador se usan | Solo con permiso de **analítica** |
| Meta Pixel | Medir campañas en Facebook e Instagram | Solo con permiso de **publicidad** |
| Meta Conversions API | Recuperar compras que el navegador pierde (bloqueadores, iOS) | En el servidor, al crear el pedido, y solo si esa persona aceptó publicidad |

Los identificadores de medición viven en `analytics-config.js`. No hay secretos
ahí: ese archivo se sirve al navegador y cualquiera puede leerlo.

## Dos decisiones de diseño

**1. Analítica y publicidad no comparten permiso.**
Google Analytics mide uso; el píxel de Meta hace publicidad. Meterlos en el mismo
botón obligaría a la gente a aceptar publicidad para permitir estadísticas. Son
dos casillas separadas y se puede aceptar una, otra, las dos o ninguna.

**2. Nada se carga antes de decidir.**
No hay etiquetas en el HTML. `analytics.js` y `legal.js` se cargan, pero no
inyectan ningún script de terceros hasta que existe una decisión guardada. Antes
de aceptar, el navegador no hace ni una petición a Google ni a Meta.

## Consentimiento

El aviso ofrece tres salidas:

- **Solo esenciales** — `{ analytics: false, ads: false }`
- **Configurar** — dos casillas independientes y un botón Guardar
- **Aceptar todo** — `{ analytics: true, ads: true }`

La decisión se guarda en `localStorage` bajo `likehoodie_consent_v2`, como JSON.
Si alguien tiene una decisión del formato anterior (solo `granted` / `denied`),
se migra a `{ analytics: true, ads: false }`: conserva lo que aceptó y **no** le
atribuye un permiso de publicidad que nunca dio.

El permiso es reversible desde `cookies.html` (*Cambiar preferencias*). Al
retirarlo se borran las cookies propias (`_ga`, `_gid`, `_fbp`, `_fbc`), se envía
`consent update` con `analytics_storage: denied` a Google y `consent revoke` a
Meta.

## Google Analytics 4

Se carga con `gtag` solo si `analytics` está aceptado. La configuración fija
`anonymize_ip: true` y declara por defecto las señales publicitarias como
denegadas (`ad_storage`, `ad_user_data`, `ad_personalization`), para que GA no
sirva para publicidad aunque la persona acepte analítica.

Eventos enviados: `page_view`, `add_to_cart`, `begin_checkout`, `purchase`,
`sign_up` y `select_promotion`.

## Meta Pixel

Se inicia con `fbq('init', …)` y un `PageView` solo si `ads` está aceptado. Los
eventos salen del mismo punto único que los de GA (`LikeHoodieConsent.track`), y
cada uno se envía **solo** a las plataformas permitidas: aceptar publicidad sin
analítica manda eventos a Meta y ninguno a Google, y al revés.

### Lo que se omite a propósito

El fragmento oficial de Meta incluye un `<noscript><img src="…/tr?id=…">`. **No
está puesto**: esa imagen dispara `PageView` sin JavaScript y, por tanto, sin
consentimiento. Habría roto el bloqueo entero.

Meta añade por su cuenta el evento `SubscribedButtonClick` (seguimiento
automático de clics). Es inofensivo; si ensucia los informes, se desactiva en la
configuración del píxel.

## Meta Conversions API

### Por qué en el servidor

Un porcentaje de compras se pierde en el navegador: bloqueadores, modo privado,
restricciones de iOS. La Conversions API manda el mismo evento desde el servidor,
donde nada de eso interviene.

### El problema del consentimiento

El servidor no tiene `localStorage`, así que no puede saber si esa persona aceptó
publicidad. Si se enviara sin comprobarlo, Meta recibiría compras de gente que
pulsó *Solo esenciales*.

La solución es guardar el permiso en la base de datos:

```
Web acepta publicidad → rpc set_ad_consent(true) → tabla ad_consent
Pedido insertado en orders ────────────────────────┘
  └─ trigger notify_meta_purchase
       ├─ ¿hay token en Vault?      no → termina
       ├─ ¿ad_consent.granted?      no → no envía nada
       └─ sí → POST a Meta (Purchase)
```

`ad_consent` no es legible ni escribible desde la web: solo la escribe la función
`set_ad_consent`, que usa el `auth.uid()` de la sesión anónima. El permiso se
sincroniza al pulsar en el aviso y otra vez justo antes de crear el pedido, por
si la decisión se tomó en otra pestaña.

### Deduplicación

Navegador y servidor mandan el **mismo** `event_id`: `lh-<número de pedido>`.

```js
fbq("track", "Purchase", { … }, { eventID: "lh-1042" })   // navegador
"event_id": "lh-" || new.number                            // servidor
```

Meta cuenta una sola compra. Si el navegador falla, la del servidor queda.

### Qué viaja

- `em`: correo normalizado en SHA-256 (nunca en claro).
- `ph`: teléfono solo con dígitos, en SHA-256.
- `client_ip_address` y `client_user_agent`: tal cual los manda el navegador.
- `country`: `mx`.
- `custom_data`: `value`, `currency` (MXN), `order_id`, `num_items`.

### Robustez

El envío va dentro de un bloque `exception when others then null`. Si Meta cambia
su API, el token caduca o la red falla, **el pedido se crea igual**. La medición
nunca puede romper una venta.

### El token

Vive cifrado en Supabase Vault como `meta_capi_token`. El trigger lo lee en cada
compra; si no existe, no hace nada y no falla.

Se eligió **sin caducidad** a propósito: un token de 60 días muere en silencio y
la medición deja de funcionar sin avisar a nadie. Como contrapartida, conviene
rotarlo de vez en cuando (ver *Operación*).

## Eventos

| Acción | GA4 | Meta Pixel | CAPI |
| --- | --- | --- | --- |
| Visita | `page_view` | `PageView` | — |
| Añadir a la cesta | `add_to_cart` | `AddToCart` | — |
| Abrir checkout | `begin_checkout` | `InitiateCheckout` | — |
| Pedido creado | `purchase` | `Purchase` | `Purchase` |
| Alta en el club | `sign_up` | `Lead` | — |
| Cupón aplicado | `select_promotion` | `AddToCart` | — |

## Cómo comprobarlo

**Google.** GA4 → *Informes* → *Tiempo real*. Antes de aceptar no debe aparecer
ninguna visita; después, sí.

**Meta Pixel.** Events Manager → el píxel → *Probar eventos*. Abre la web,
acepta publicidad, añade algo al carrito: deben llegar `PageView` y `AddToCart`
con `value` y `currency`.

**Conversions API.** Con una cuenta administradora:

```sql
select public.meta_last_response();
```

Devuelve algo como `{"status": 200, "body": "{\"events_received\":1,…}"}`. Solo
lo pueden ejecutar administradores: la función está cerrada a `anon` y
`authenticated`.

**Consentimiento.** Que se respete de verdad se comprueba así: con la publicidad
rechazada, `meta_last_response()` no debe cambiar de marca de tiempo aunque se
cree un pedido.

**Servidor sano.** Si `events_received` es 0 o hay `error.code` 190, el token está
revocado o caducado.

## Operación

### Rotar el token

1. Business Settings → **System users** → el system user de Conversions API.
2. **Revoke tokens** y genera uno nuevo (`ads_management` +
   `business_management`, caducidad *Never*).
3. Guárdalo en Vault:

```sql
select vault.create_secret('EAAG…el-token-completo…', 'meta_capi_token', 'Meta CAPI');
```

4. Comprueba con `meta_last_response()` tras un pedido.

### Si deja de llegar la compra del servidor

En este orden:

1. `select public.meta_last_response();` → 190 significa token revocado.
2. ¿La persona tenía `granted = true` en `ad_consent`? Sin eso no se envía nada.
3. ¿El trigger sigue puesto?

```sql
select tgname from pg_trigger where tgname = 'orders_meta_purchase';
```

4. ¿Meta devuelve 400 con `error.code` 100? Suele ser un campo del payload.

### Dar de baja el consentimiento de una persona

Ella misma puede hacerlo desde `cookies.html`; el cambio se propaga a la tabla en
ese momento. A partir de ahí, sus pedidos nuevos no se envían a Meta.

## Archivos

| Archivo | Papel |
| --- | --- |
| `analytics-config.js` | IDs de medición |
| `analytics.js` | Consentimiento, carga de GA y Pixel, envío de eventos |
| `legal.js` | Aviso de cookies y panel de preferencias |
| `app.js` | Llama a los eventos desde el carrito y el checkout |
| `store-supabase.js` | Sincroniza el permiso publicitario y el `event_id` |
| `supabase/meta-capi-1-consentimiento.sql` | Tabla de consentimiento y diagnóstico |
| `supabase/meta-capi-2-compra.sql` | Trigger de compra hacia Meta |
| `cookies.html` | Tabla de cookies y cambio de preferencias |
| `privacidad.html` | Explicación en lenguaje llano |

## Lo que no se hace

- No se carga nada de terceros antes del consentimiento.
- No se envía ningún evento de publicidad sin permiso de publicidad.
- No se guarda el correo ni el teléfono en claro en Meta: siempre SHA-256.
- No se venden ni se ceden datos a terceros ajenos a la medición.
- No se mide a menores de forma deliberada ni se crean audiencias con sus datos.
