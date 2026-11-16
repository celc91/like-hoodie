# Auditoría de seguridad — v1.14.1

- **Alcance:** repositorio `like-hoodie` (sitio estático + Supabase).
- **Modo:** auditoría estática, solo lectura. No se ejecutaron consultas contra Supabase ni se modificaron archivos.
- **Fecha:** 2026-11-14.
- **Documento de entrada para:** fase B.5 (diseño de tests de RLS).

# Informe de seguridad v1.14.1

Auditoría estática y solo lectura del repositorio. Se revisaron los 34 archivos SQL, las siete Edge Functions, el cliente y la documentación indicada. No se ejecutaron consultas contra Supabase ni se modificaron archivos.

No confirmé una vulnerabilidad crítica ni un bypass directo de RLS, MFA o Storage en el orden seguro documentado. Sí encontré tres riesgos altos de abuso y varias debilidades de concurrencia, retención e idempotencia.

## A) Tabla resumen

| ID | Severidad | Área | Archivo:línea | Hallazgo |
|---|---|---|---|---|
| LH-01 | alta | Pedidos y correo | `supabase/fase1-pedidos-seguros.sql:125-141` | Los límites de pedidos por usuario y correo no son atómicos y permiten crear pedidos y correos en ráfagas. |
| LH-02 | alta | Newsletter | `supabase/optin-3-alta.sql:38-49` | El límite de cinco altas por IP no es atómico y no existe tope global, permitiendo envío masivo de confirmaciones. |
| LH-03 | alta | Newsletter y cupones | `supabase/newsletter.sql:18-25`, `supabase/migrations/20261115000400_cupones_unicos.sql:17-78` | La política inicial permite insertar suscriptores con un token elegido y después obtener cupones sin confirmar el correo; `optin-3` no la cierra. |
| LH-04 | media | Cupones | `supabase/antispam-cupones.sql:52-64` | El límite de 30 validaciones por IP es vulnerable a peticiones concurrentes. |
| LH-05 | media | Rate limits | `fase4-seguridad.sql`, `fase5-ratelimit.sql`, `fase6-limites.sql`, `fase7-abuso.sql`, `fase10-facturacion-individual.sql` | Los topes globales y varios contadores por usuario no están serializados; se pueden exceder con concurrencia. |
| LH-06 | media | Pagos Clip | `clip-pay/index.ts:113-168`, `clip-checkout/index.ts:101-141,236-300` | Dos peticiones paralelas pueden crear dos cargos o dos enlaces para el mismo pedido por falta de una reclamación atómica. |
| LH-07 | media | Facturación | `20261115000200_facturacion_verificacion.sql:188-239` | Conocer número y correo de un pedido permite sobrescribir una solicitud ya verificada o cancelada y devolverla a `unverified`. |
| LH-08 | media | Reejecución SQL | `supabase/coupons.sql:22-29`, `setup-premios.sql:53-60`, `fase10-facturacion-individual.sql:245-316` | Reejecutar scripts heredados reabre lectura de cupones o reemplaza funciones posteriores por versiones menos estrictas. |
| LH-09 | media | Privacidad y retención | `supabase/fase4-seguridad.sql:169-191` | La limpieza diaria omite cinco tablas de intentos; sus purgas dependen de que vuelva a llegar tráfico. |
| LH-10 | baja | Configuración | `optin-2-funciones.sql:64-75`, `20261115000500_aviso_factura.sql:143-144` | `has_resend_key()` sigue siendo ejecutable por cualquier sesión anónima con rol `authenticated`. |
| LH-11 | baja | Privacidad | `supabase/functions/_shared/clip.ts:34-50` | Sin `LOOKUP_IP_SALT`, los hashes usan una sal pública, son enumerables y correlacionables entre tablas. |
| LH-12 | baja | Procesado de logos | `process-logo/index.ts:99-112`, `store-supabase.js:414-418` | El mensaje interno de error se guarda y puede leerse desde el cliente, pese a la respuesta HTTP genérica. |

### Controles revisados sin hallazgo

- Las 21 tablas tienen RLS habilitado en los scripts. En el estado final seguro no encontré un `GRANT` que exponga filas sin una política efectiva.
- `is_admin()` exige el claim `aal2` y comprueba el rol en `profiles`. Un token `aal1` no cumple la condición; el rol no puede modificarse con una política de usuario propio.
- `orders`, `carts` y `profiles` limitan las filas por `auth.uid()`. Las RPC administrativas y de facturación revisadas llaman a `is_admin()`.
- Las políticas de `order-logos` comprueban bucket y primer componente del path. `order-prints` solo permite lectura a administradores. No encontré una política que permita listar o descargar archivos ajenos.
- Tras el orden completo queda únicamente `place_order(jsonb,jsonb,uuid,text,text)`. Calcula el precio con `item_unit_price()`, toma `user_id` de Auth e ignora totales, estados y pagos enviados por el cliente. El `unitPrice` recibido solo se compara con el calculado; no determina el importe.
- `get_order_status` y los contadores `take_*` no son ejecutables directamente por `anon` o `authenticated`. Los errores de rate limit se tratan de forma cerrada en las Edge Functions.
- El webhook de Clip exige secreto, consulta el checkout real, compara importe y moneda y evita reprocesar un pedido ya pagado.
- Las funciones `SECURITY DEFINER` revisadas fijan `search_path`. Los datos renderizados en el panel se escapan; no confirmé un XSS almacenado.

## B) Detalle de hallazgos

### LH-01. Concurrencia en los límites de `place_order`

**Qué está mal**

Las dos comprobaciones hacen `count(*)` antes del `INSERT`, sin bloquear al usuario ni al correo:

```sql
select count(*) from public.orders
 where user_id = v_uid
   and created_at > now() - interval '1 hour'
...
select count(*) from public.orders
 where lower(email) = v_email
   and created_at > now() - interval '1 hour'
```

El pedido se inserta posteriormente en las líneas 230-240. Además, `orders_notify_email` se ejecuta para todo pedido insertado, también demo (`email-notifications.sql:141-144`).

**Escenario de explotación**

Un visitante obtiene gratuitamente una sesión anónima, que usa el rol `authenticated`, y lanza 20 RPC `place_order` paralelas con artículos válidos. Varias transacciones pueden leer cero pedidos antes de que ninguna confirme. Cada una inserta un pedido y encola un correo al cliente y otro al administrador.

**Impacto real**

Spam operativo, consumo de Resend, correos no solicitados a direcciones elegidas por el atacante, pedidos basura y degradación de la reputación del dominio. La creación de nuevas cuentas anónimas permite seguir multiplicando el volumen aun después de corregir la carrera.

**Parche propuesto**

Dentro de `place_order`, después de validar y normalizar los datos y antes de los conteos:

```sql
perform pg_advisory_xact_lock(
  hashtext('place_order:user:' || v_uid::text)
);
perform pg_advisory_xact_lock(
  hashtext('place_order:email:' || v_email)
);
```

El orden usuario-correo debe mantenerse en todas las llamadas. Los bloqueos duran hasta el commit del pedido.

**Verificación**

En staging, lanzar 20 llamadas paralelas con el mismo usuario y el mismo correo. Deben crearse como máximo tres pedidos por el límite de correo; las demás llamadas deben terminar con el error de frecuencia. Repetir con correos distintos: el mismo usuario no debe superar cinco.

---

### LH-02. El límite del newsletter se puede superar en paralelo

**Qué está mal**

`subscribe_newsletter()` borra intentos antiguos, cuenta y después inserta, sin bloqueo:

```sql
select count(*) into v_recent
from public.newsletter_attempts
where ip = v_ip and created_at > now() - interval '1 hour';

if v_recent >= 5 then ...
insert into public.newsletter_attempts (ip) values (v_ip);
```

No hay contador global. Después se envía una confirmación por Resend para cada correo nuevo o pendiente.

**Escenario de explotación**

Un cliente anónimo envía 100 solicitudes simultáneas con correos distintos desde una misma IP. Las transacciones que cuentan antes de que las demás confirmen pueden superar ampliamente las cinco altas y encolar un correo por solicitud.

**Impacto real**

Correo no solicitado, coste de Resend y daño a la capacidad de entrega de `likehoodie.com`. La ausencia de tope global también permite rotar IP si la cabecera de origen no está siendo normalizada por el gateway.

**Parche propuesto**

Antes de borrar y contar intentos:

```sql
perform pg_advisory_xact_lock(
  hashtext('newsletter:ip:' || v_ip)
);
```

Añadir además un límite global. Para un volumen pequeño puede serializarse con una segunda cerradura:

```sql
declare
  v_global integer;
begin
  -- Después del bloqueo por IP:
  perform pg_advisory_xact_lock(hashtext('newsletter:global'));

  select count(*) into v_global
    from public.newsletter_attempts
   where created_at > now() - interval '1 hour';

  if v_global >= 500 then
    return jsonb_build_object('ok', false, 'reason', 'rate');
  end if;
```

**Verificación**

Con Resend simulado, enviar 50 altas paralelas desde una IP. La tabla `newsletter_attempts` debe registrar como máximo cinco altas para esa IP y no deben generarse más de cinco envíos.

---

### LH-03. Inserción directa de suscriptores y generación de cupones sin doble confirmación

**Qué está mal**

La política heredada permite cualquier inserción:

```sql
create policy "newsletter_insert_public"
on public.newsletter_subscribers
for insert
to anon, authenticated
with check (true);

grant insert on public.newsletter_subscribers to anon, authenticated;
```

`optin-3-alta.sql` no elimina esa política ni revoca el permiso. Solo `antispam.sql:80` revoca el `INSERT`, por lo que el resultado depende del orden de instalación. `security-fixes.sql:21` vuelve a concederlo si se reejecuta.

La migración de cupones confirma cualquier fila localizada por su token y genera el cupón aunque el token haya sido elegido directamente por quien insertó la fila.

**Escenario de explotación**

Si la política y el grant están presentes:

1. Un usuario anónimo inserta en `newsletter_subscribers` un correo válido y un UUID elegido como `token`.
2. Llama a `confirm_newsletter(p_token)` con ese UUID.
3. La función marca o encuentra el registro confirmado y devuelve un cupón único válido, sin enviar ni recibir ningún correo.
4. Repite con otros correos y UUID para obtener descuentos reutilizables en distintos pedidos.

**Impacto real**

Evasión del doble consentimiento y generación ilimitada de cupones del 10 %. Si Clip está activo, supone una pérdida económica directa.

**Parche propuesto**

Añadir al final de la migración canónica `20261115000400_cupones_unicos.sql` y mantenerlo en cualquier script heredado:

```sql
drop policy if exists "newsletter_insert_public"
  on public.newsletter_subscribers;

revoke insert on public.newsletter_subscribers
  from anon, authenticated;
```

El alta debe quedar exclusivamente en `subscribe_newsletter()`; las confirmaciones solo deben usar tokens generados por ese backend.

**Verificación**

Como `anon`, un `INSERT` directo debe devolver `42501` o ser rechazado por RLS. Después, el alta por RPC debe seguir funcionando y únicamente el token recibido por correo debe permitir confirmar y obtener el cupón.

---

### LH-04. Carrera en `check_coupon`

**Qué está mal**

El contador de `coupon_attempts` usa el patrón contar-insertar sin cerradura (`antispam-cupones.sql:52-64`).

**Escenario de explotación**

Un atacante envía cientos de códigos distintos en paralelo desde una IP. Varias ejecuciones pueden leer un contador inferior a 30 y continuar. La respuesta diferencia códigos válidos, inexistentes, caducados y agotados.

**Impacto real**

Enumeración de códigos débiles y carga evitable en Postgres. Los cupones aleatorios actuales tienen bastante entropía, por lo que no afirmo que sean recuperables en la práctica; el problema confirmado es la elusión del límite.

**Parche propuesto**

Después de normalizar `v_ip` y antes del borrado/conteo:

```sql
perform pg_advisory_xact_lock(
  hashtext('coupon:ip:' || v_ip)
);
```

**Verificación**

Enviar 100 validaciones paralelas desde la misma IP. Como máximo 30 deben consultar la tabla `coupons`; el resto debe devolver `reason = 'rate'`.

---

### LH-05. Topes globales y contadores adicionales no atómicos

**Qué está mal**

- `take_order_lookup` bloquea por IP, pero no antes del tope global (`fase5-ratelimit.sql:28-49`).
- `take_invoice_request` y `take_logo_process` presentan el mismo problema global (`fase10:96-116`, `fase7:260-290`).
- `take_client_error` calcula el global sobre `client_errors`, cuya inserción ocurre después, en otra llamada (`fase6:84-104`).
- `take_clip_pay` bloquea por IP, no por usuario (`fase6:160-181`).
- `log_client_error` cuenta por usuario y global sin cerraduras (`fase4:133-159`).
- Los triggers de eventos, carritos y altas de logos cuentan después del `INSERT`, también sin serialización (`fase7:65-101,110-145,179-212`).

**Escenario de explotación**

Peticiones sincronizadas desde varias IP pueden superar los topes globales porque cada IP usa una cerradura distinta. Un mismo usuario de Clip puede usar varias IP para superar seis intentos. Un usuario anónimo también puede superar los límites de eventos, carritos o errores con escrituras paralelas.

**Impacto real**

Consumo de CPU de procesamiento de imágenes, escrituras excesivas y reducción de la eficacia de los topes antiabuso. No implica lectura de datos ajenos.

**Parche propuesto**

Antes de cada conteo global, en su función correspondiente:

```sql
perform pg_advisory_xact_lock(hashtext('order_lookup:global'));
perform pg_advisory_xact_lock(hashtext('invoice_request:global'));
perform pg_advisory_xact_lock(hashtext('logo_process:global'));
perform pg_advisory_xact_lock(hashtext('client_error:global'));
```

En `take_client_error`, contar el global sobre `client_error_attempts`, no sobre `client_errors`, para que conteo e inserción queden en la misma transacción.

En `take_clip_pay`, antes del bloqueo por IP:

```sql
perform pg_advisory_xact_lock(
  hashtext('clip_pay:user:' || p_user_id::text)
);
```

En `log_client_error`, bloquear por `v_uid` y después por una clave global. Para los triggers de eventos, carritos y logos, usar un trigger `BEFORE INSERT FOR EACH ROW` con una cerradura por `new.user_id` antes de contar.

**Verificación**

Con 400 hashes distintos y peticiones simultáneas, `order_lookup_attempts` no debe superar 300 altas por minuto. Para Clip, un mismo `user_id` con distintos hashes no debe superar seis. Las pruebas deben hacerse en staging, no contra producción.

---

### LH-06. Falta de idempotencia en los cobros Clip

**Qué está mal**

`clip-pay` comprueba `payment_status = 'pending'`, espera la respuesta de Clip y solo después marca el pedido como pagado. No hay una transición atómica previa que impida que otra petición haga lo mismo. `clip-checkout` tiene una carrera equivalente antes de guardar el nuevo `clip_checkout_id`.

**Escenario de explotación**

Con pagos activos, el propietario de un pedido envía dos solicitudes paralelas con tokens de tarjeta válidos. Ambas leen `pending` y ambas pueden ejecutar `POST /payments`. En Checkout redireccionado, dos llamadas paralelas pueden crear dos enlaces antes de que cualquiera guarde su ID.

**Impacto real**

Posibilidad de cargos duplicados y conciliación manual. El impacto actual está limitado porque Clip está desactivado por defecto. Además, en una instalación limpia del SQL del repositorio ambas funciones fallan antes porque consultan `orders.currency`, columna que no se crea; este fallo funcional no sustituye a la idempotencia necesaria antes de activar pagos.

**Parche propuesto**

Añadir una reclamación atómica y un identificador de intento:

```sql
alter table public.orders
  add column if not exists currency text not null default 'MXN',
  add column if not exists payment_attempt_id uuid;
```

Después de validar propiedad y pedido:

```ts
const attemptId = crypto.randomUUID();
const { data: claimed } = await admin
  .from("orders")
  .update({ payment_status: "processing", payment_attempt_id: attemptId })
  .eq("id", orderId)
  .eq("payment_status", "pending")
  .select("id")
  .maybeSingle();

if (!claimed) {
  return json({ error: "Ya hay un pago en curso" }, 409, origin);
}
```

Solo después debe llamarse a Clip. Los estados finalizados deben actualizarse con `.eq("payment_attempt_id", attemptId)`. Un rechazo puede devolver el pedido a `pending`; una respuesta incierta requiere conciliación y la clave de idempotencia del proveedor, no un reintento ciego.

**Verificación**

Simular Clip y ejecutar dos llamadas paralelas para el mismo pedido. El mock debe recibir una sola petición de cobro y la otra llamada debe devolver 409.

---

### LH-07. Sobrescritura de solicitudes de factura verificadas

**Qué está mal**

La migración solo bloquea el estado `issued`:

```sql
if found and v_request.status = 'issued' then
  return jsonb_build_object('ok', false, 'reason', 'issued');
end if;
```

Después actualiza cualquier otra solicitud existente, cambia sus datos fiscales y establece:

```sql
status = 'unverified',
verified_at = null,
verify_token = v_token
```

**Escenario de explotación**

Una persona que conozca el número y correo de un pedido pagado envía otra solicitud mientras la original está en `review`. No necesita token para borrar la verificación, sustituir RFC, nombre fiscal o correo de entrega y devolver el pedido a `pending`. Si el titular confirma el nuevo correo, los datos elegidos por el atacante pasan a revisión.

**Impacto real**

Interrupción de facturas legítimas, datos fiscales incorrectos y riesgo de emisión o envío a un destinatario equivocado.

**Parche propuesto**

Después del caso `issued`:

```sql
if found and v_request.status in ('review', 'cancelled') then
  return jsonb_build_object('ok', false, 'reason', 'locked');
end if;
```

Las correcciones de una solicitud verificada o cancelada deben requerir intervención del administrador. Añadir en la Edge Function:

```ts
locked: [409, "La solicitud ya fue revisada o cancelada; contacta con soporte"],
```

**Verificación**

Con una solicitud en `review`, repetir `submit_invoice_request`. Debe devolver `locked` y una consulta posterior debe demostrar que datos, `verified_at` y `billing_status` no cambiaron.

---

### LH-08. Reejecución de scripts heredados

**Qué está mal**

- `coupons.sql` y `setup-premios.sql` vuelven a crear `coupons_read_active` y conceden `SELECT` a `anon, authenticated`.
- `security-fixes.sql` sustituye el `check_coupon` con rate limit por una versión sin contador.
- Reejecutar `fase10-facturacion-individual.sql` restaura `mark_invoice_request_issued()` sin la exigencia posterior de `status = 'review'` y `verified_at`.

**Escenario de explotación**

Un operador reejecuta `coupons.sql` para “actualizar cupones”. A partir de ese momento, un anónimo puede seleccionar los códigos activos, incluidos cupones únicos aún no usados, y emplearlos en `place_order`.

La parte de facturación requiere un administrador `aal2`, por lo que es una regresión del flujo, no un acceso anónimo.

**Impacto real**

Robo de descuentos y pérdida de ingresos; en facturación, posibilidad de marcar como emitida una solicitud no verificada mediante una llamada directa del administrador.

**Parche propuesto**

Eliminar las definiciones públicas heredadas o cerrarlas al final:

```sql
drop policy if exists "coupons_read_active" on public.coupons;
revoke select on public.coupons from anon, authenticated;
```

`security-fixes.sql` no debe redefinir `check_coupon`; debe usar la versión canónica de `antispam-cupones.sql`. Después de cualquier ejecución de `fase10`, volver a aplicar `20261115000200` y `20261115000500` para restaurar las funciones vigentes.

**Verificación**

Tras cada reejecución en staging:

- `GET /rest/v1/coupons` con `anon` debe ser denegado.
- `pg_get_functiondef('public.check_coupon(text)'::regprocedure)` debe contener el contador de intentos.
- La definición de `mark_invoice_request_issued` debe contener la comprobación de `review` y `verified_at`.

---

### LH-09. Retención superior a la documentada

**Qué está mal**

`cleanup_monitoring()` solo limpia errores, eventos, carritos y los intentos de seguimiento y errores. Omite:

- `coupon_attempts`
- `newsletter_attempts`
- `invoice_request_attempts`
- `clip_pay_attempts`
- `logo_process_attempts`

Esas tablas se purgan únicamente cuando llega otra llamada a su función. Si dejan de recibir tráfico, sus filas permanecen indefinidamente. Cupones y newsletter almacenan la IP en claro.

**Escenario concreto**

Una sola alta de newsletter y una validación de cupón seguidas de meses sin nuevas solicitudes dejan las IP almacenadas mucho más allá de los siete y dos días declarados.

**Impacto real**

Incumplimiento de la minimización y retención publicada en `privacidad.html:149-149,200`, con datos personales conservados innecesariamente.

**Parche propuesto**

Añadir a `cleanup_monitoring()`:

```sql
delete from public.coupon_attempts
 where created_at < now() - interval '2 days';

delete from public.newsletter_attempts
 where created_at < now() - interval '7 days';

delete from public.invoice_request_attempts
 where created_at < now() - interval '2 days';

delete from public.clip_pay_attempts
 where created_at < now() - interval '2 days';

delete from public.logo_process_attempts
 where created_at < now() - interval '2 days';
```

**Verificación**

Insertar filas antiguas en staging, ejecutar `select public.cleanup_monitoring()` y comprobar que todas las tablas anteriores quedan sin registros fuera de plazo, sin necesidad de nuevas peticiones.

---

### LH-10. `has_resend_key()` accesible por sesiones anónimas

**Qué está mal**

`optin-2` concede ejecución a `anon, authenticated`; la migración 005 solo revoca `anon`. Las sesiones anónimas de Supabase usan `authenticated`, por lo que conservan acceso al booleano que indica si existe la clave en Vault.

**Escenario de explotación**

Un visitante inicia sesión anónima y ejecuta `rpc/has_resend_key`. Obtiene `true` o `false` sobre la configuración de correo.

**Impacto real**

Divulgación menor de configuración útil para reconocimiento. No devuelve la clave ni permite enviar correos.

**Parche propuesto**

```sql
revoke all on function public.has_resend_key()
  from public, anon, authenticated;
```

No hay llamadas del frontend que dependan de esta función.

**Verificación**

Con una sesión anónima, la RPC debe devolver un error de permiso, nunca un booleano.

---

### LH-11. Sal pública de respaldo para hashes de IP

**Qué está mal**

```ts
const salt = Deno.env.get("LOOKUP_IP_SALT") || "likehoodie";
const digest = await crypto.subtle.digest("SHA-256", `${salt}|${ip}`);
```

Si falta el secreto, una IPv4 puede recuperarse mediante enumeración offline. El mismo hash se usa en seguimiento, errores, facturación, Clip y procesamiento de logos, permitiendo correlacionar registros entre tablas.

**Escenario de explotación**

Quien obtenga un volcado limitado de las tablas de intentos puede probar el espacio IPv4 o diccionarios de rangos y reconstruir direcciones. Esas tablas no son públicas; por tanto, este hallazgo es de contención y privacidad, no una exposición directa por API.

**Parche propuesto**

Fallar cerrado cuando falte la variable y usar separación por finalidad:

```ts
const salt = Deno.env.get("LOOKUP_IP_SALT");
if (!salt) return null;
const bytes = new TextEncoder().encode(`${purpose}|${salt}|${ip}`);
```

Las funciones deben devolver 503 si reciben `null`. Para evitar correlación, `purpose` debe ser distinto en cada endpoint.

**Verificación**

Sin la variable en staging, los endpoints no deben insertar intentos ni continuar la operación. Con ella configurada, el hash debe tener 64 caracteres y ser distinto entre finalidades para una misma IP.

---

### LH-12. Errores internos accesibles mediante `logo_assets`

**Qué está mal**

El endpoint devuelve un mensaje genérico, pero `fail()` guarda hasta 500 caracteres del error original en `logo_assets.last_error`. El cliente solicita expresamente esa columna.

**Escenario de explotación**

Un usuario sube imágenes malformadas o provoca errores de Storage y consulta después su propia fila `logo_assets`, obteniendo mensajes del decodificador, rutas o detalles internos que la Edge Function pretendía ocultar.

**Impacto real**

Reconocimiento de rutas y componentes internos. No encontré evidencia de que estos mensajes contengan claves.

**Parche propuesto**

Guardar únicamente un código seguro:

```ts
await admin.from("logo_assets").update({
  status: "failed",
  last_error: "PROCESSING_FAILED",
  attempts: Number(asset.attempts || 0) + 1,
});
```

Mantener el detalle solo en logs privados o en una tabla separada sin acceso de cliente.

**Verificación**

Después de un fallo, `select last_error from logo_assets` con el propietario debe devolver únicamente el código genérico.

## C) Contradicciones doc vs código

1. **Retención máxima.** `privacidad.html:149,200` habla de máximos de siete y dos días, pero la limpieza por tiempo depende de nuevas llamadas para cinco tablas. Sin tráfico posterior, esos máximos no se cumplen (LH-09).

2. **Errores internos de `process-logo`.** `supabase/README.md:120` afirma que los errores internos no se devuelven al cliente. La respuesta HTTP sí es genérica, pero `last_error` se almacena y se consulta desde `store-supabase.js:414-418` (LH-12).

3. **Orden de SQL no reproducible.** La lista de `supabase/README.md:158-186` omite `logo-assets.sql` y los scripts de newsletter:
   - `fase7-abuso.sql:51-57` referencia `public.logo_assets::regclass`, que no existiría siguiendo solo esa lista.
   - `20261115000400_cupones_unicos.sql:10` referencia `newsletter_subscribers`, tampoco creada por esa lista.
   - `20261115000500_aviso_factura.sql:144` revoca una función `has_resend_key()` que solo se crea en `optin-2-funciones.sql`.

   Por tanto, una instalación nueva no puede completar el orden tal como está documentado.

4. **Diagnóstico de Meta.** `MEDICION.md:163-171` indica que `meta_last_response()` la ejecutan administradores. El SQL revoca `public`, `anon` y `authenticated` y no comprueba `is_admin()`; un administrador del panel con `aal2` no puede ejecutarla por API. El fallo es de documentación y operabilidad, no una exposición.

5. **Activación de Clip.** El procedimiento del README indica que, tras activarlo y pagar, el pedido aparecerá como pagado. En el esquema incluido no se crea `orders.currency`, pero `clip-checkout` y `clip-pay` la seleccionan. En una instalación limpia el flujo falla antes de cobrar. Esto también impide validar de extremo a extremo las defensas de pago solo con el SQL del repositorio.

6. **Ausencia de PII en errores.** `privacidad.html:148` afirma que los errores no incluyen direcciones o teléfonos. `client-error/index.ts:61-68` guarda texto arbitrario sin redacción de PII. No encontré una ruta probada que envíe datos reales del pedido, pero el código no garantiza esa afirmación absoluta.

La afirmación específica de que los scripts heredados no restauran el `place_order` inseguro de cuatro argumentos sí es correcta: esas versiones se eliminan al final y la versión final de cinco argumentos permanece.

## D) Top 5 por riesgo real

1. **LH-03:** si la política inicial sigue activa, cualquier anónimo puede obtener cupones sin confirmar un correo; debe comprobarse primero en la base desplegada.
2. **LH-01:** permite crear pedidos y correos en ráfaga con una cuenta anónima gratuita, con impacto inmediato en operación y Resend.
3. **LH-02:** permite correo masivo no solicitado y daño a la reputación del dominio sin necesidad de autenticación.
4. **LH-07:** una solicitud fiscal ya verificada puede modificarse con solo número de pedido y correo, afectando la integridad de facturación.
5. **LH-09:** conserva IP y otros identificadores más allá de los plazos publicados, con impacto continuado de privacidad y cumplimiento.

La idempotencia de Clip (LH-06) debe corregirse antes de activar pagos reales; su prioridad actual es menor porque el cobro está desactivado y el flujo limpio tiene además el bloqueo de `orders.currency`.

## E) No verificable desde el repositorio y comprobación manual

No se modificó ningún archivo ni se ejecutó ninguna consulta contra Supabase.

### Estado real de RLS, grants y funciones

La explotabilidad actual de LH-03 y LH-08 depende del estado desplegado. Como administrador de base de datos:

```sql
select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname in ('public', 'storage')
order by schemaname, tablename, policyname;

select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in (
    'newsletter_subscribers', 'coupons', 'invoice_requests',
    'orders', 'carts', 'profiles', 'logo_assets'
  )
order by table_name, grantee, privilege_type;
```

Para `newsletter_subscribers`, cualquier `INSERT` para `anon` o `authenticated` junto con `newsletter_insert_public` confirma LH-03.

Revisar funciones realmente instaladas:

```sql
select p.oid::regprocedure, p.prosecdef, p.proconfig
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef
order by 1;

select pg_get_functiondef('public.check_coupon(text)'::regprocedure);
select pg_get_functiondef('public.mark_invoice_request_issued(uuid,text)'::regprocedure);
```

### Cron y retención

```sql
select jobname, schedule, active
from cron.job
where jobname = 'likehoodie-cleanup';
```

Debe existir, estar activo y ejecutar la función que incluya todas las tablas de LH-09. Comprobar también la edad máxima real con `max(created_at)` en cada tabla, sin seleccionar IP ni hashes.

### Secrets y Vault

No consulté valores ni `vault.decrypted_secrets`. En Dashboard debe verificarse únicamente la presencia de los nombres `LOOKUP_IP_SALT`, `resend_api_key` y los secretos de Clip. La afirmación del changelog de que `LOOKUP_IP_SALT` está configurado no puede comprobarse desde el código.

### Cloudflare y cabeceras de IP

No se puede demostrar desde el repositorio que Supabase sobrescriba `cf-connecting-ip`, `x-real-ip` o `x-forwarded-for`. Los endpoints están en `*.supabase.co`, no detrás de las reglas de `likehoodie.com`.

En staging, enviar solicitudes con dos valores deliberadamente distintos de `cf-connecting-ip` y comprobar si producen el mismo contador de IP. Si el gateway respeta el valor aportado por el cliente, todos los límites basados en esa cabecera son evadibles y debe usarse la IP garantizada por la plataforma.

### Auth, MFA y fuerza bruta

No se comprobaron las políticas de Auth ni los límites de Supabase para contraseña y TOTP. Con una cuenta de prueba:

- Un token `aal1` debe hacer que `is_admin()` devuelva `false` y no debe leer pedidos de otros usuarios.
- Un segundo factor verificado debe elevar la sesión a `aal2`.
- Deben documentarse los límites reales de intentos de contraseña y MFA del proveedor.

### Clip y Resend

No se comprobaron credenciales, configuración de Clip, comportamiento real del proveedor ni entregas de Resend. Antes de activar pagos:

```sql
select column_name
from information_schema.columns
where table_schema = 'public'
  and table_name = 'orders'
  and column_name = 'currency';

select value
from public.store_settings
where key = 'clip_enabled';
```

La primera consulta debe devolver `currency`; la segunda debe permanecer en `false` hasta completar pruebas de concurrencia, webhooks, reembolsos y conciliación con credenciales de prueba.
