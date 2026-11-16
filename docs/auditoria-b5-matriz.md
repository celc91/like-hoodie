# Fase B.5 — Matriz de pruebas RLS y abuso

- **Versión evaluada:** v1.14.1.
- **Fecha de diseño:** 2026-11-15.
- **Estado:** diseño estático. No se ejecutó Supabase, ninguna migración ni ningún test.
- **Esqueleto asociado:** `supabase/tests/rls.test.sql`.
- **Fuentes normativas:** `docs/auditoria-rls.md`, `supabase/README.md` —secciones Seguridad y Orden de SQL—, `SECURITY.md`, `CHANGELOG.md` 1.14.0–1.14.1 y `privacidad.html`.

## 1. Regla de oro y alcance

La expectativa de cada caso procede de las fuentes anteriores, no del comportamiento actual del código. Si el código permite algo que el informe identifica como vulnerabilidad, el test debe esperar el comportamiento corregido y, cuando proceda, **DENEGADO**.

La matriz contiene **121 casos**:

| Área | Casos |
|---|---:|
| Pedidos | 16 |
| Carrito | 8 |
| Facturación | 18 |
| Logos | 10 |
| Cupones | 12 |
| Newsletter | 13 |
| Rate limit | 17 |
| Settings | 8 |
| Storage | 10 |
| Privilegios | 9 |
| **Total** | **121** |

En la columna **LH**, `NR` significa caso de no regresión sin hallazgo específico. Las referencias a líneas de documentación son orientativas; la fuente principal de cada expectativa queda indicada en la última columna.

## 2. Roles y claims

| Alias | Rol y claims | Uso |
|---|---|---|
| `ANON` | `role=anon`, sin `sub`, sin `aal` | Visitante sin sesión. |
| `CART` | `role=authenticated`, `sub=UC`, `aal=aal1` | Sesión anónima de carrito. El rol `authenticated` no le concede privilegios administrativos. |
| `A` | `role=authenticated`, `sub=UA`, `aal=aal1` | Cliente dueño de `OA`, `CA`, `LA` y objetos bajo `UA/`. |
| `B` | `role=authenticated`, `sub=UB`, `aal=aal1` | Otro cliente; dueño de `OB`, `CB`, `LB` y objetos bajo `UB/`. |
| `ADM1` | `role=authenticated`, `sub=UADM`, `aal=aal1`, perfil `admin` | Administrador autenticado solo con contraseña. |
| `ADM2` | `role=authenticated`, `sub=UADM`, `aal=aal2`, perfil `admin` | Administrador con MFA verificado. |
| `SR` | `role=service_role` | Siembra, lecturas de control y flujos expresamente documentados como backend. Nunca se usa para una aserción de política. |

Cuando una fila enumera varios roles, el caso se ejecuta por separado para cada uno, con fixtures aislados o restaurados. Un único identificador de caso puede producir varias aserciones, pero cuenta como un test pgTAP agrupado.

## 3. Fixtures comunes

Todos se siembran con `SR` antes de cambiar al rol bajo prueba. Los datos son sintéticos: UUID reservados para QA, correos bajo `example.invalid`, IP de documentación y datos fiscales de prueba. No se utilizan datos personales reales.

| Fixture | Contenido |
|---|---|
| `UA`, `UB`, `UC`, `UADM` | Usuarios Auth A, B, carrito y administrador. Perfiles `customer`, `customer`, `customer`, `admin`. |
| `OA` | Pedido pagado de A, número `990001`, total conocido, `billing_status=pending`. |
| `OB` | Pedido demo de B, número `990002`. |
| `OC` | Pedido demo de C, número `990003`. |
| `OG` | Pedido pagado adicional de B, número `990004`, destinado a una factura global. |
| `CA`, `CB`, `CC` | Un carrito abierto por A, B y C, con un artículo conocido. |
| `LA`, `LB` | Un `logo_assets` por A y B, con rutas `UA/original.png` y `UB/original.png`. |
| `SA`, `SB` | Objetos `order-logos/UA/original.png` y `order-logos/UB/original.png`. |
| `PA` | Objeto `order-prints/UA/print.png`. |
| `Q1` | Cupón `QA_UNICO_10`, 10 %, vigente, `max_uses=1`, `used_count=0`. |
| `N0` | Suscriptor pendiente con correo sintético y token controlado para casos aislados. |
| `F0` | Solicitud de `OA` en `unverified`, con token y caducidad controlados. |
| `G0` | Una factura global y su relación con `OG`. |
| `M0` | Un evento y un `client_errors` por A y B, sin PII. |
| `MOCK` | Resend, Clip y llamadas HTTP simulados. Ningún test envía correos, cobra ni contacta producción. |
| `:cliente` | JSON válido con nombre, correo, teléfono, dirección, ciudad, estado y CP sintéticos. |
| `:item899` | JSON válido de sudadera negra, cantidad 1, precio de servidor y `unitPrice` 899. |
| `:hash64` | Cadena hexadecimal de 64 caracteres derivada de una IP sintética. |

`N0` no demuestra por sí solo que un token fuera emitido por el backend. En las pruebas positivas de newsletter se crea primero el suscriptor mediante `subscribe_newsletter()` y después `SR` recupera el token como fixture. La prueba LH-03 ejecuta el ataque completo desde `ANON`, sin sembrar previamente el token elegido por el atacante.

## 4. Reglas para evitar falsos positivos

1. **Canario obligatorio.** Antes de una lectura negativa se siembra una fila u objeto conocido. Después, `SR` confirma que existe. Una tabla vacía no demuestra una política.
2. **Control positivo.** Cada aislamiento A/B tiene un control en el que el dueño o `ADM2` sí accede al mismo fixture.
3. **SELECT filtrado.** RLS puede devolver cero filas sin SQLSTATE. El test compara los UUID exactos visibles y verifica el canario con `SR`.
4. **Denegación con error.** Grants, RPC e `INSERT` que violan RLS se comprueban con `throws_ok` y el SQLSTATE esperado.
5. **UPDATE/DELETE invisible.** Si hay grant pero ninguna política permite la operación, PostgreSQL puede devolver éxito con cero filas afectadas. Se comprueba el número de filas y un snapshot posterior con `SR`.
6. **Ausencia de efectos.** Después de cada error se comprueba que no apareció un pedido, intento, cupón, solicitud, objeto ni llamada externa.
7. **Concurrencia real.** Los casos paralelos requieren conexiones independientes, una barrera de inicio y commits reales. Un bucle serial nunca sustituye una prueba de carrera.
8. **Sin red real.** Resend, Clip y `pg_net` se sustituyen por dobles locales. Si no existe el doble, el caso permanece pendiente.
9. **Sin políticas evaluadas como `SR`.** Las lecturas `SR` solo comprueban fixtures y efectos posteriores.
10. **Sin secretos en salida.** No se imprimen tokens, claims completos, hashes asociados a IP real, URLs firmadas ni filas fiscales.

### Códigos empleados

| Código | Significado |
|---|---|
| `[]` | Consulta permitida pero filtrada por RLS; conjunto vacío con canario comprobado. |
| `42501` | Permiso insuficiente o violación RLS en escritura. |
| `23514` | Violación de constraint. |
| `22023` | Dato inválido donde el contrato documentado lo fija, incluido precio manipulado. |
| `P0001` | Regla de negocio o frecuencia cuando la función documenta ese resultado. |
| `PENDIENTE_SQLSTATE` | La fuente exige rechazo pero no fija el código; ver Q-02. Se exige excepción y cero efectos, sin adoptar el código actual como contrato. |
| `HTTP 4xx/5xx` | Caso de integración local de Edge Function o Storage; no se sustituye por una llamada SQL que omita esa capa. |

## 5. Diez bloqueantes de merge

Ordenados por gravedad y alcance. En `rls.test.sql` sus nombres empiezan por `BLOQUEANTE-`.

| Orden | Caso | Referencia | Condición mínima |
|---:|---|---|---|
| 1 | `NEW-03` | LH-03 | `ANON` no puede insertar un suscriptor con token elegido; ese token no confirma ni genera cupón; el alta RPC sigue funcionando. |
| 2 | `PED-13` | LH-01 | Con llamadas realmente paralelas: máximo 3 pedidos por correo y 5 por usuario; resto rechazado; sin correos adicionales. |
| 3 | `NEW-12` | LH-02 | Con 50 altas paralelas desde una IP: máximo 5 intentos y 5 envíos; resto `rate`. |
| 4 | `FAC-05` | LH-07 | Reenviar una solicitud `review` o `cancelled` devuelve `locked` y no altera ningún dato. |
| 5 | `PED-03` | Aislamiento de pedidos | B no puede leer `OA`; A sí; la fila existe durante toda la prueba. |
| 6 | `PRIV-03` | MFA | `ADM1` no es admin ni accede a datos o RPC administrativos; solo `ADM2` pasa. |
| 7 | `PRIV-02` | Escalación de rol | A/B/CART no pueden convertir su perfil en admin ni insertar otro perfil admin. |
| 8 | `STO-03` | Aislamiento Storage | B no puede listar, descargar ni firmar `SA`; A sí; el objeto permanece privado. |
| 9 | `PED-08` | Precio de servidor | `unitPrice` manipulado devuelve `22023`, sin pedido, correo ni consumo de cupón. |
| 10 | `FAC-08` | Factura verificada | Una solicitud `unverified` no puede marcarse `issued` ni cambiar la facturación del pedido. |

## 6. Matriz completa

### 6.1 Pedidos — 16 casos

| ID | Área | LH | Rol | Operación | Resultado esperado exacto | Consulta o llamada concreta | Fixture necesario | Cómo evita el falso positivo |
|---|---|---|---|---|---|---|---|---|
| PED-01 | Pedidos | NR | ANON | Leer un pedido por ID. | Permitido con filtro: `[]`; ninguna columna devuelta. | `select id from public.orders where id = :OA;` | `OA`, `OB`. | `SR` confirma que ambos pedidos existen; no se acepta una tabla inicialmente vacía. README Seguridad 124. |
| PED-02 | Pedidos | NR | CART | Listar pedidos visibles. | Exactamente `OC`; nunca `OA` ni `OB`. | `select id from public.orders where id in (:OA,:OB,:OC) order by id;` | `OA`, `OB`, `OC`. | Se añade un segundo pedido de C y se comparan conjuntos de UUID, no solo un conteo positivo. |
| PED-03 | Pedidos | NR | A y B | A lee su pedido; B intenta leerlo directamente y mediante join con carritos. **Bloqueante 5.** | A obtiene exactamente `OA`; B obtiene `[]` en ambas consultas. | `select id,email from public.orders where id=:OA;` y `select o.id from public.orders o join public.carts c on c.id=o.cart_id where o.id=:OA;` | `OA`, `OB`, `CA`, `CB`; correo canario sintético. | `SR` comprueba que `OA` y su correo existen antes y después. B ejecuta las dos vías; A es control positivo. |
| PED-04 | Pedidos | NR | ADM1 | Leer pedidos de clientes con sesión admin sin MFA. | `[]`; `aal1` no activa la política administrativa. | `select id from public.orders where id in (:OA,:OB);` | `OA`, `OB`; perfil admin. | El mismo fixture se lee después como ADM2; además `is_admin()` debe ser `false`. README 129–132. |
| PED-05 | Pedidos | NR | ADM2 | Leer pedidos de varios clientes. | Exactamente `OA`, `OB`, `OC`. | `select id from public.orders where id in (:OA,:OB,:OC) order by id;` | Tres pedidos y un cuarto fuera del predicado. | El cuarto pedido no debe aparecer, demostrando que el predicado y RLS se evalúan correctamente. |
| PED-06 | Pedidos | NR | ANON, CART y A | Insertar pedido directo con total arbitrario. | Denegado `42501`; cero filas nuevas. | `insert into public.orders(user_id,customer_name,email,items,total) values (:uid,'QA','qa-ped-06@example.invalid','[]'::jsonb,1);` | Usuarios y correo único por rol. | `SR` busca el correo canario antes y después; no basta capturar cualquier error ajeno al INSERT. README 110. |
| PED-07 | Pedidos | NR | A y B | A actualiza/borra `OA`; B intenta marcarlo pagado y cambiar total. | Cada operación afecta 0 filas; `OA` permanece idéntico. | `update public.orders set payment_status='paid',total=1 where id=:OA;` y `delete from public.orders where id=:OA;` | Snapshot completo de `OA`. | `SR` compara estado, total, correo, artículos y facturación antes/después. Un UPDATE sin error no se interpreta como permiso. |
| PED-08 | Pedidos | NR | A | Crear pedido con `unitPrice=1` aunque el precio de servidor sea 899. **Bloqueante 9.** | Denegado `22023`; no pedido, no correo, `Q1.used_count` sin cambios. | `select public.place_order(:cliente,jsonb_build_array(jsonb_set(:item899,'{unitPrice}','1')),:CA,'', 'QA_UNICO_10');` | `:cliente`, `:item899`, `CA`, `Q1`, MOCK. | Se comparan número de pedidos, `used_count` y llamadas Resend antes/después. CHANGELOG 1.2.0; README 110–111. |
| PED-09 | Pedidos | NR | CART | Crear pedido válido con campos extra que intentan imponer total, estado y pago. | Permitido: subtotal 899, envío 99, total 998, `user_id=UC`, `status=pending`, `payment_method=demo`, `payment_status=demo`; `CC=converted`. | `select public.place_order(:cliente,jsonb_build_array(:item899),:CC,'',null);` | Precios base, `CC`, `clip_enabled=false`. | `SR` lee el pedido y compara todos los campos. Los valores `total=1`, `status=delivered` y `payment_status=paid` incluidos en JSON no se copian. |
| PED-10 | Pedidos | NR | CART | Enviar email, teléfono, dirección, ciudad, estado o CP inválidos; 51 artículos; artículo >4 MiB; payload >8 MiB. | Todas las llamadas denegadas; campos `PENDIENTE_SQLSTATE`; constraints físicas `23514` cuando aplique; cero pedidos. | Nueve llamadas independientes a `public.place_order(:cliente_mutado,:items_mutados,:CC,'',null)`. | Un grupo limpio por subcaso y un control válido. | Cada subcaso comprueba ausencia de pedido, correo y consumo de cupón. El control válido demuestra que el fixture no es la causa del rechazo. Q-02. |
| PED-11 | Pedidos | NR | A | Crear pedido usando el carrito de B. | Denegado con excepción; no pedido; `CB.status=open`. | `select public.place_order(:cliente,jsonb_build_array(:item899),:CB,'',null);` | `CB`, artículo válido. | Se repite con `CA` como control positivo; `SR` verifica que `CB` no fue convertido. |
| PED-12 | Pedidos | NR | Catálogo y ANON | Comprobar sobrecargas y grants de `place_order`. | Solo existe `place_order(jsonb,jsonb,uuid,text,text)`; firma de cuatro argumentos devuelve `42883`; ANON `42501`. | `select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='place_order';` y llamada de cuatro argumentos. | Esquema final. | Se inspecciona `regprocedure`, no el nombre del script. También se comprueba `has_function_privilege`. Informe controles 37. |
| PED-13 | Pedidos | LH-01 | CART y A | Veinte RPC paralelas con mismo usuario/correo; repetir con mismo usuario y correos distintos. **Bloqueante 2.** | Escenario correo: máximo 3 pedidos. Escenario usuario: máximo 5. Resto error de frecuencia; como máximo dos correos simulados por pedido creado. | Veinte llamadas concurrentes a `public.place_order(:cliente,jsonb_build_array(:item899),null,'',null)` por escenario. | Dos grupos limpios, artículos válidos, MOCK. | Conexiones independientes y commits; se cuentan pedidos y correos. Un bucle serial no puede marcar este caso como superado. |
| PED-14 | Pedidos | LH-01 | CART y A | Superar secuencialmente los límites de correo y usuario. | Cuarta llamada con mismo correo `P0001`; sexta con mismo usuario `P0001`; conteos quedan en 3 y 5. | `select public.place_order(...)` después de sembrar 3 pedidos por correo y, en otro grupo, 5 por usuario. | Dos ventanas limpias; pedidos antiguos fuera de una hora. | Un pedido anterior a una hora no cuenta; se prueba también la llamada inmediatamente anterior al umbral. |
| PED-15 | Pedidos | NR | ADM2 | Calcular métricas con pedidos pagado, demo, pendiente y pagado cancelado. | `orders_range=1`, `revenue_range=1000`; hoy, 7/30 días, AOV, conversión, series y rankings excluyen demo, pending y cancelado. | `select public.admin_stats(30);` | Pagado 1000, demo 900, pending 800, pagado cancelado 700 y carritos conocidos. | Se consultan todas las claves JSON y las filas base. No se limita la aserción a ingresos. README 115; CHANGELOG 1.14.0; Q-09. |
| PED-16 | Pedidos | NR | ANON, CART, A, B y ADM1 | Ejecutar métricas administrativas sin autorización. | `42501` para cada rol; ningún JSON de métricas. | `select public.admin_stats(30);` | `OA`. | ADM2 es control positivo. A y B no reciben métricas ni de sus propios pedidos. |

### 6.2 Carrito — 8 casos

| ID | Área | LH | Rol | Operación | Resultado esperado exacto | Consulta o llamada concreta | Fixture necesario | Cómo evita el falso positivo |
|---|---|---|---|---|---|---|---|---|
| CAR-01 | Carrito | NR | ANON | Leer carritos conocidos. | `[]`. | `select id from public.carts where id in (:CA,:CB,:CC);` | `CA`, `CB`, `CC`. | `SR` confirma tres carritos con artículos canarios. |
| CAR-02 | Carrito | NR | CART y B | Listar carritos propios y leer el de otro usuario. | CART obtiene solo `CC`; B obtiene solo `CB` y `[]` para `CA`. | `select id,items from public.carts;` y `select id from public.carts where id=:CA;` | Tres carritos. | Se comparan UUID y contenido canario; A es control positivo para `CA`. |
| CAR-03 | Carrito | NR | ADM1 y ADM2 | Leer los mismos carritos con distinto AAL. | ADM1 `[]`; ADM2 exactamente `CA`, `CB`, `CC`. | `select id from public.carts where id in (:CA,:CB,:CC) order by id;` | Tres carritos y perfil admin. | Solo cambia el claim `aal`; el resto del token y fixture permanece igual. |
| CAR-04 | Carrito | NR | CART y A | Insertar carrito propio y carrito con `user_id` ajeno. | Propio permitido; ajeno `42501`; solo aparece el carrito propio. | `insert into public.carts(user_id,items,item_count) values (:uid,'[]'::jsonb,0) returning id;` | UA, UB, UC. | `SR` busca ambos UUID; la operación ajena no deja fila ni cuenta para el límite. |
| CAR-05 | Carrito | NR | A y B | Actualizar contenido propio, transferir propiedad y modificar/borrar el carrito ajeno. | Actualización propia permitida; transferencia `42501`; operaciones de B sobre `CA` afectan 0 filas; propietario y contenido final íntegros. | `update public.carts set items=:items2 where id=:CA;` `update public.carts set user_id=:UB where id=:CA;` `delete from public.carts where id=:CA;` | `CA`, `CB`. | Snapshot `user_id,items,status` con `SR`; después de la primera actualización A conserva acceso. |
| CAR-06 | Carrito | NR | CART | Insertar diez carritos abiertos y el undécimo; incluir uno convertido. | Diez abiertos permitidos; undécimo `P0001`; quedan diez abiertos; convertido no cuenta. | Diez INSERT propios y `insert into public.carts(user_id,status) values (:UC,'open');` adicional. | UC sin carritos recientes; un carrito `converted`. | Se prueba el noveno y décimo para detectar off-by-one; `SR` cuenta por estado. README 119. |
| CAR-07 | Carrito | LH-05 | CART | Veinte INSERT paralelos de carritos abiertos. | Como máximo diez abiertos; excedentes `P0001`. | Veinte conexiones ejecutan `insert into public.carts(user_id,status) values (:UC,'open');`. | UC y grupo limpio. | Conexiones reales y commits; CAR-06 no sirve como sustituto. |
| CAR-08 | Carrito | NR | A | Guardar 51 artículos y, por separado, JSON mayor de 8 MiB. | Denegado `23514`; `CA.items` conserva su valor original. | `update public.carts set items=:items51 where id=:CA;` y `update public.carts set items=:items9MiB where id=:CA;` | `CA`, payloads de 50/51 elementos y tamaños frontera. | Controles con 50 artículos y tamaño permitido; se compara `octet_length(items::text)`. |

### 6.3 Facturación — 18 casos

| ID | Área | LH | Rol | Operación | Resultado esperado exacto | Consulta o llamada concreta | Fixture necesario | Cómo evita el falso positivo |
|---|---|---|---|---|---|---|---|---|
| FAC-01 | Facturación | NR | ANON | Leer solicitud fiscal directamente. | Denegado `42501`; ningún dato fiscal. | `select id,rfc from public.invoice_requests where id=:F0;` | `F0`. | `SR` confirma fila y RFC canario. README 143–149. |
| FAC-02 | Facturación | NR | CART, A, B y ADM1 | Leer y actualizar solicitud fiscal. | SELECT `[]`; UPDATE afecta 0 filas; solicitud intacta. | `select id from public.invoice_requests where id=:F0;` y `update public.invoice_requests set notes='ataque' where id=:F0;` | `F0`. | Snapshot fiscal y de verificación con `SR`; ADM2 es control positivo. |
| FAC-03 | Facturación | NR | ADM2 | Leer, actualizar notas e intentar INSERT/DELETE directos. | SELECT y UPDATE de notas permitidos; INSERT y DELETE `42501`; solo cambia `notes`. | `select ... where id=:F0;` `update ... set notes='QA' where id=:F0;` `insert ...;` `delete ...;` | `F0` y payload fiscal sintético. | `SR` compara todos los campos; lectura admin no se interpreta como permiso arbitrario de escritura. |
| FAC-04 | Facturación | NR | ANON, CART, A y B | Ejecutar directamente RPC públicas de factura desde el navegador. | Ambas RPC `42501`; sin fila, token, cambio de estado ni correo. | `select public.submit_invoice_request(:number,:email,:rfc,:name,:regime,:zip,:use,:invoiceEmail,'','04');` y `select public.confirm_invoice_request(:token);` | `OA`, `F0`, MOCK. | Backend `SR` ejerce los controles funcionales en FAC-06/09, no como prueba de política. |
| FAC-05 | Facturación | LH-07 | SR como backend; atacante externo simulado | Repetir solicitud con otros datos cuando está `review` o `cancelled`. **Bloqueante 4.** | `{ok:false,reason:'locked'}` en ambos estados; RFC, nombre, correos, `status`, `verified_at`, token y `orders.billing_status` idénticos. | `select public.submit_invoice_request(:number,:purchaseEmail,'XAXX010101000','OTRO NOMBRE','601','00000','G03','otro@example.invalid','ataque','28');` | Una solicitud `review` y otra `cancelled`, pedidos pagados, MOCK. | Snapshot completo antes/después y mock sin envíos. No se acepta `unverified` como resultado. |
| FAC-06 | Facturación | NR | SR como backend | Crear solicitud válida para pedido pagado. | `{ok:true,status:'unverified',email_sent:true}`; token nuevo, expira en 24 h, `verified_at=null`, pedido sigue `pending`; un correo simulado. | `select public.submit_invoice_request(:number,:email,:rfc,:name,'601','00000','G03',:invoiceEmail,'','04');` | Pedido pagado sin solicitud; MOCK. | Se comprueba que el pedido no pasa a `individual` antes de confirmar. README 243–246. |
| FAC-07 | Facturación | NR | SR como backend | Enviar payload inválido, correo no coincidente, pedido demo y pedido cancelado. | Razones `invalid`, `notfound`, `unpaid`, `cancelled`; sin solicitud, correo ni cambio de billing. | Cuatro llamadas a `submit_invoice_request` con el mismo contrato de diez argumentos. | Cuatro grupos de pedidos. | El correo incorrecto usa un número existente para comprobar respuesta no enumeradora; se comparan conteos posteriores. |
| FAC-08 | Facturación | LH-08 | ADM2 | Marcar emitida una solicitud no verificada. **Bloqueante 10.** | Denegado `P0001`; sigue `unverified`, UUID nulo, pedido sin UUID ni `billed_at`. | `select public.mark_invoice_request_issued(:F_unverified,:uuid);` | Solicitud `unverified` con SAT 04. | FAC-12 aporta control positivo verificado; `SR` compara solicitud y pedido. |
| FAC-09 | Facturación | NR | SR como backend | Confirmar token emitido por backend. | `{ok:true,status:'review'}`; `verified_at` no nulo, token/expiración nulos, pedido `individual`; un aviso admin simulado. Reutilizar token consumido devuelve `notfound`. | `select public.confirm_invoice_request(:token_backend);` | Resultado de FAC-06. | Se comprueban ambos estados y el segundo uso del mismo token; no se imprime el UUID. |
| FAC-10 | Facturación | NR | SR como backend | Confirmar token inexistente, caducado, cancelado o cuyo pedido quedó no pagado/cancelado. | Razones `notfound`, `expired`, `cancelled`, `unpaid` o `cancelled`; ninguna solicitud pasa a `review`. | `select public.confirm_invoice_request(:token_caso);` para cuatro fixtures. | Cuatro solicitudes independientes. | Token caducado no se renueva; mock no envía aviso; se comparan snapshots. |
| FAC-11 | Facturación | LH-08 | ADM2 | Emitir `review` sin `verified_at` y otra verificada sin forma SAT. | Ambas `P0001`; no UUID ni cambios en pedido. | `select public.mark_invoice_request_issued(:request_id,:uuid);` | Dos solicitudes, cada una con un solo requisito ausente. | Controles separados con cada campo corregido; evita que una guarda oculte la ausencia de la otra. |
| FAC-12 | Facturación | NR | ADM2 | Emitir solicitud `review` verificada con SAT 04 y repetir el mismo UUID. | Primera `{ok:true}`, estado `issued`; pedido `individual`, UUID/SAT/`billed_at` correctos. Segunda `{ok:true,alreadyIssued:true}` sin duplicados. | Dos llamadas a `mark_invoice_request_issued(:F_review,:uuid)`. | Solicitud válida. | Se cuentan solicitudes y relaciones y se compara snapshot tras la segunda llamada. |
| FAC-13 | Facturación | NR | ADM2 | Cancelar una solicitud `review` y tratar de cancelar una `issued`. | Primera `cancelled`, tokens nulos y pedido vuelve `pending` si era `individual`; segunda `P0001` intacta. | `select public.cancel_invoice_request(:request_id);` | Dos solicitudes y pedidos asociados. | `SR` verifica ambos estados; la solicitud fiscal no se borra. |
| FAC-14 | Facturación | NR | ANON, CART, A, B y ADM1 | Ejecutar RPC administrativas individuales y globales. | Cada llamada `42501`; estados, globales y mock sin cambios. | Llamadas a `mark_invoice_request_issued`, `cancel_invoice_request`, `resend_invoice_verification`, `global_invoice_preview`, `set_order_billing` y `create_global_invoice` con parámetros válidos. | Fixtures válidos para las seis funciones. | Cada función tiene su propia aserción y ADM2 control positivo; no se infiere todo de una sola RPC. |
| FAC-15 | Facturación | NR | ADM2 | Reenviar verificación `unverified` y tratar de reenviar una `review`. | Primera genera token distinto y expiración de 24 h; token viejo deja de funcionar. Segunda `P0001`; solo un correo simulado permitido. | `select public.resend_invoice_verification(:F_unverified);` y después `confirm_invoice_request(:old_token)`. | Dos solicitudes, MOCK. | Se guarda el token anterior sin imprimirlo y se prueba explícitamente su invalidez. |
| FAC-16 | Facturación | NR | ANON, CART/A/B, ADM1 y ADM2 | Leer y escribir directamente globales y sus relaciones. | ANON `42501`; no admin y ADM1 SELECT `[]`; ADM2 ve exactamente `G0` y su enlace. Escrituras directas `42501`; sin cambios. | SELECT/INSERT/UPDATE/DELETE sobre `public.global_invoices` y `public.global_invoice_orders`. | `G0` enlazada a `OG`. | `SR` confirma global y enlace antes/después; lectura ADM2 no se usa como prueba de escritura. |
| FAC-17 | Facturación | NR | ADM2 | Previsualizar periodo y cambiar estados de facturación; enviar datos inválidos y modificar un pedido global. | Preview incluye solo pagados no cancelados del periodo; set permite solo `pending/individual` y SAT `04/28`; global protegido `P0001`; entradas inválidas `22023`. | `select public.global_invoice_preview(:start,:end);` `select public.set_order_billing(:order,:status,:sat);` | Pagado, demo, cancelado, individual y global en el mismo periodo. | Se comparan UUID de la lista y ausencia de nombre/dirección/teléfono, no solo totales. |
| FAC-18 | Facturación | NR | ADM2 | Crear global SAT 04 y repetir cuando ya no hay pendientes. | Una global solo con pagados pendientes 04 del periodo, total exacto, enlaces y UUID; demás pedidos intactos. Segunda llamada `P0001`. | `select public.create_global_invoice(:start,:end,'04',:uuid,'QA');` | Pagados 04/28, demo, cancelado, individual y global. | Se cuentan `global_invoice_orders` y se revisa cada `orders.billing_status/uuid`; no se genera CFDI automáticamente. |

### 6.4 Logos — 10 casos

| ID | Área | LH | Rol | Operación | Resultado esperado exacto | Consulta o llamada concreta | Fixture necesario | Cómo evita el falso positivo |
|---|---|---|---|---|---|---|---|---|
| LOG-01 | Logos | NR | ANON | Leer assets conocidos. | `[]`. | `select id from public.logo_assets where id in (:LA,:LB);` | `LA`, `LB`. | `SR` confirma filas y rutas canarias. |
| LOG-02 | Logos | NR | CART, A y B | Listar assets y leer el de otro usuario por ID. | Cada usuario ve solo sus UUID; B recibe `[]` para `LA`. | `select id,source_path from public.logo_assets;` y `select id from public.logo_assets where id=:LA;` | Assets propios y ajenos. | A es control positivo para `LA`; se comparan rutas sin devolverlas a B. |
| LOG-03 | Logos | NR | ADM1 y ADM2 | Leer assets con distinto AAL. | ADM1 `[]`; ADM2 exactamente `LA` y `LB`. | `select id from public.logo_assets where id in (:LA,:LB);` | Dos assets. | Mismo fixture y claims diferenciados únicamente por `aal`. |
| LOG-04 | Logos | NR | A y CART | Insertar asset propio con ruta válida. | Permitido; `user_id=auth.uid()` y fila recuperable por el dueño. | `insert into public.logo_assets(user_id,source_path,width_cm) values (:uid,:uid||'/nuevo.png',20) returning id;` | UA y UC. | Se cuenta antes/después y se lee como dueño; `SR` solo verifica la fila de control. |
| LOG-05 | Logos | NR | A | Insertar con `user_id=UB` y, por separado, con usuario propio pero ruta de B. | Primera operación `42501`; segunda `22023`; ninguna fila. | Dos INSERT en `logo_assets(user_id,source_path,width_cm)` con `UB/robo.png`. | UA y UB. | Los subcasos separan RLS de trigger; `SR` busca ambos canarios. CHANGELOG 1.9.0. |
| LOG-06 | Logos | NR | A, B, ADM1 y ADM2 | Actualizar o borrar directamente assets. | Todas las operaciones afectan 0 filas; assets intactos; admin solo tiene lectura directa. | `update public.logo_assets set status='ready' where id=:LA;` y `delete from public.logo_assets where id=:LA;` | `LA`, `LB`. | Snapshot completo con `SR`; procesamiento backend no se confunde con UPDATE del navegador. |
| LOG-07 | Logos | NR | CART | Insertar 50 assets en 24 h y el 51.º; incluir uno antiguo. | Primeros 50 permitidos; 51.º `P0001`; quedan 50 recientes. | INSERT propios con `source_path=UC/n.png`. | Grupo limpio UC y asset de 25 h. | Controles 49/50 detectan off-by-one; el asset antiguo no eleva el contador. |
| LOG-08 | Logos | LH-05 | CART | Sesenta INSERT paralelos de assets propios. | Como máximo 50 filas recientes; excedentes `P0001`. | Sesenta conexiones ejecutan el INSERT de LOG-04. | Grupo limpio UC. | Conexiones reales; LOG-07 no sirve como sustituto. |
| LOG-09 | Logos | LH-12 | A e integración `process-logo` | Forzar fallo interno y leer `last_error`. | Respuesta HTTP genérica y `last_error='PROCESSING_FAILED'`; ninguna ruta, stack o mensaje del decodificador. | `POST /functions/v1/process-logo` con asset inválido; después `select last_error from public.logo_assets where id=:LA;` | Asset propio fallido; mock que genera texto interno canario. | Se busca el texto canario en respuesta y campo; no basta comprobar que HTTP sea genérico. |
| LOG-10 | Logos | NR | ANON, A y B; integración | Procesar sin sesión, procesar asset ajeno y superar tres intentos por logo. | Sin sesión `401`; asset ajeno `403`; cuarto intento `429`; sin objetos nuevos en fallos. | `POST /functions/v1/process-logo` con `{"assetId":":LA"}`. | `LA`, MOCK y contador de Storage. | Se cuentan objetos e intentos con `SR`; A tiene control de tres intentos válidos. |

### 6.5 Cupones — 12 casos

| ID | Área | LH | Rol | Operación | Resultado esperado exacto | Consulta o llamada concreta | Fixture necesario | Cómo evita el falso positivo |
|---|---|---|---|---|---|---|---|---|
| CUP-01 | Cupones | LH-08 | ANON | Leer directamente un cupón activo. | Denegado `42501`; ningún código, uso o caducidad devuelto. | `select code,percent,max_uses,used_count from public.coupons where code='QA_UNICO_10';` | `Q1`. | `SR` confirma que el cupón está activo; se repite tras reejecución en CUP-11. |
| CUP-02 | Cupones | NR | CART, A, B y ADM2 | Leer directamente cupones. | `42501` para todos; admin del panel tampoco los enumera por API. | Misma consulta de CUP-01. | `Q1`. | `check_coupon` es control positivo; MFA no equivale a grant de gestión. |
| CUP-03 | Cupones | NR | ANON, CART, A y ADM2 | Leer o escribir intentos de cupón. | Todas las operaciones `42501`; intento intacto. | SELECT/INSERT/UPDATE/DELETE sobre `public.coupon_attempts`. | Un intento conocido. | `SR` confirma el intento antes/después; no se imprime la IP. |
| CUP-04 | Cupones | NR | ANON | Validar cupón vigente y payloads inválidos. | Vigente: exactamente `valid=true,code='QA_UNICO_10',percent=10`, sin `max_uses/used_count`. Vacío o >32: `{valid:false,reason:'invalid'}`. | `select public.check_coupon('QA_UNICO_10');` y llamadas con `''` y 33 caracteres. | `Q1`. | Se comparan claves JSON exactas; la fila activa evita un falso `notfound`. |
| CUP-05 | Cupones | NR | ANON | Validar inexistente, inactivo, caducado y agotado. | Razones `notfound`, `notfound`, `expired`, `exhausted`; ninguno válido. | Cuatro llamadas `select public.check_coupon(:code);`. | Cuatro cupones. | Códigos distintos y contador conocido; no se acepta un motivo genérico cuando el contrato lo distingue. |
| CUP-06 | Cupones | NR | CART y A | Validar con `cf-connecting-ip` fija y cabeceras alternativas distintas. | Ambos obtienen válido; intentos agrupados por la IP garantizada, no por `x-forwarded-for`. | `select public.check_coupon('QA_UNICO_10');` con `request.headers` controlado. | `Q1`, IP sintética. | `SR` cuenta por IP fixture; dos valores alternativos no crean cubos si `cf` es fija. |
| CUP-07 | Cupones | LH-04 | ANON | Treinta y una validaciones secuenciales desde una IP. | Primeras 30 `notfound`; 31.ª `rate`; exactamente 30 intentos recientes. | Treinta y una llamadas `check_coupon('NO_EXISTE_QA')`. | IP limpia. | Otra IP sigue consultando; se detecta off-by-one. |
| CUP-08 | Cupones | NR | A | Usar dos veces un cupón único en pedidos secuenciales. | Primero: 10 % de descuento y `used_count=1`. Segundo: `coupon=null`, `discount=0`, total sin descuento; `used_count` permanece 1. | Dos `place_order(:cliente,jsonb_build_array(:item899),:cart,'','QA_UNICO_10')`. | `Q1`, dos carritos propios. | Se comparan `discount,coupon,total` de ambos pedidos; no basta comprobar `used_count`. |
| CUP-09 | Cupones | LH-04 | ANON | Cien validaciones paralelas desde una IP. | Como máximo 30 consultas a `coupons` y 30 intentos; resto `{valid:false,reason:'rate'}`. | Cien llamadas concurrentes `check_coupon(:codigo_distinto)`. | IP limpia y códigos controlados. | Conexiones reales e instrumentación de consultas además de filas. |
| CUP-10 | Cupones | NR | A y CART | Dos pedidos paralelos usando el mismo cupón único. | Como máximo un pedido con descuento; `used_count=1`; ningún uso duplicado. | Dos `place_order` concurrentes con `QA_UNICO_10`. | `Q1`, carritos separados. | `SR` revisa ambos pedidos y totales; no se presupone cuál gana. |
| CUP-11 | Cupones | LH-08 | ANON y CART; base desechable | Reejecutar scripts heredados y repetir lectura directa. | `coupons_read_active` queda ausente; SELECT `42501`; ningún cupón enumerado. | Reejecutar `coupons.sql` y `setup-premios.sql`; después SELECT de CUP-01 y consulta a `pg_policies`. | `Q1`. | Se comprueban política, grants y SELECT canario; no solo texto del script. |
| CUP-12 | Cupones | LH-08 | Catálogo; base desechable | Reejecutar scripts que sustituían funciones posteriores. | `check_coupon` conserva contador; `mark_invoice_request_issued` exige `review` y `verified_at`; `place_order` mantiene una sola firma segura. | Reejecutar `security-fixes.sql` y `fase10-facturacion-individual.sql`; consultar `pg_get_functiondef` y `regprocedure`. | Definiciones finales y fixtures CUP-07/FAC-08. | Después de la inspección se repiten CUP-07 y FAC-08; una coincidencia de texto por sí sola no basta. |

### 6.6 Newsletter — 13 casos

| ID | Área | LH | Rol | Operación | Resultado esperado exacto | Consulta o llamada concreta | Fixture necesario | Cómo evita el falso positivo |
|---|---|---|---|---|---|---|---|---|
| NEW-01 | Newsletter | NR | ANON, CART/A/B, ADM1 y ADM2 | Leer correos, tokens y cupones de suscriptores. | `[]` para todos; ningún dato devuelto. | `select email,token,coupon_code from public.newsletter_subscribers where id=:N0;` | `N0`. | `SR` confirma los tres valores canarios; admin del panel no se considera lector de lista. |
| NEW-02 | Newsletter | NR | CART, A, B y ADM2 | Actualizar o borrar directamente un suscriptor. | `42501`; correo, token y estado intactos. | `update public.newsletter_subscribers set confirmed=true where id=:N0;` y `delete from public.newsletter_subscribers where id=:N0;` | `N0`. | Snapshot `SR`; la RPC de baja no concede escritura directa. |
| NEW-03 | Newsletter | LH-03 | ANON | Insertar suscriptor con token elegido y confirmarlo. **Bloqueante 1.** | INSERT `42501`; confirmación `{ok:false,reason:'notfound'}`; cero cupones y correos. Alta RPC posterior permitida. | `insert into public.newsletter_subscribers(email,token,confirmed) values ('qa-new-03@example.invalid',:attacker_token,false);` y `select public.confirm_newsletter(:attacker_token);` | IP limpia, MOCK, token no sembrado. | `SR` busca email/token/cupón canarios. El control positivo usa `subscribe_newsletter`, no una fila insertada con `SR`. |
| NEW-04 | Newsletter | LH-03 | CART, A, B y ADM2 | Repetir inserción directa con token elegido. | `42501` para todos; ninguna confirmación ni cupón posterior. | Ataque NEW-03 con correo único por rol. | Cuatro correos nuevos. | Se ejecuta el ataque completo por rol, no solo una consulta de grants. |
| NEW-05 | Newsletter | LH-03 | ANON | Alta válida exclusivamente por RPC. | `{ok:true,duplicate:false,sent:true}`; fila `confirmed=false`, `source=web`, token backend; un correo simulado con ese token. | `select public.subscribe_newsletter('qa-new-05@example.invalid');` | MOCK e IP limpia. | La llamada solo recibe email; `SR` recupera el token después para comprobar correspondencia con el mock. |
| NEW-06 | Newsletter | NR | ANON | Enviar correos vacíos, sin dominio, >254 o con espacios. | `{ok:false,reason:'invalid'}`; sin suscriptor, intento ni correo. | Cuatro `subscribe_newsletter(:invalid_email)`. | IP limpia y MOCK. | Cuatro correos canarios y un control válido; validación anterior al contador. |
| NEW-07 | Newsletter | NR | ANON | Repetir alta de correo confirmado. | `{ok:true,duplicate:true,sent:false}`; token, cupón y fechas sin cambios; cero correos. | `select public.subscribe_newsletter(:confirmed_email);` | Suscriptor confirmado con token/cupón conocidos. | Snapshot completo; no se genera otro cupón. |
| NEW-08 | Newsletter | NR | ANON | Repetir alta pendiente y usar token viejo/nuevo. | Se rota token y se envía una confirmación; viejo `notfound`; nuevo confirma una vez; una sola fila por correo. | `subscribe_newsletter(:pending_email)`, `confirm_newsletter(:old_token)` y `confirm_newsletter(:new_token)`. | Resultado NEW-05. | Se conservan ambos UUID sin imprimirlos y se cuenta el suscriptor por correo. |
| NEW-09 | Newsletter | LH-03 | ANON y CART | Confirmar UUID inexistente y token de suscriptor dado de baja. | `notfound` y `unsubscribed`; ninguna fila confirmada ni cupón nuevo. | `select public.confirm_newsletter(:random_uuid);` y token `N0` dado de baja. | Dos estados. | `SR` compara conteos de cupones y suscriptores antes/después. |
| NEW-10 | Newsletter | LH-03 | ANON | Confirmar token emitido por `subscribe_newsletter`. | `confirmed=true`, `confirmed_at` no nulo; código `LH-…`, 10 %, `max_uses=1`, `used_count=0`, caducidad aproximada de 90 días; enlace único al suscriptor. | `select public.confirm_newsletter(:token_backend);` | Resultado NEW-05. | `SR` verifica código, unicidad y fechas; ANON nunca lee la lista. CHANGELOG 1.14.0. |
| NEW-11 | Newsletter | NR | ANON | Confirmar dos veces el mismo token, darse de baja y confirmar de nuevo. | Dos primeras respuestas con exactamente el mismo código y un solo cupón. Tras baja, `confirmed=false` y `unsubscribed_at` no nulo; última confirmación `unsubscribed`, sin cupón nuevo. | Dos `confirm_newsletter(:token)`, `unsubscribe_newsletter(:token)` y otra confirmación. | Resultado NEW-10. | Se comparan `coupon_code` y número total de cupones; no se acepta `BIENVENIDA10` como sustituto. |
| NEW-12 | Newsletter | LH-02 | ANON | Seis altas secuenciales y, en otro grupo, 50 paralelas desde una IP. **Bloqueante 3.** | Secuencial: 5 aceptadas y 6.ª `rate`. Paralelo: máximo 5 intentos, suscriptores y envíos; resto `rate`. | `subscribe_newsletter('qa-n-'||n||'@example.invalid')` en serie y en conexiones paralelas. | Dos IP limpias y MOCK. | Se cuentan intentos, filas y llamadas al mock, no solo respuestas; concurrencia real. |
| NEW-13 | Newsletter | LH-02 | ANON desde múltiples IP | Seiscientas altas paralelas repartidas entre IP distintas en una hora. | Máximo global 500 intentos/envíos; excedentes `rate`; el máximo por IP sigue aplicando. | Seiscientas llamadas paralelas a `subscribe_newsletter` con correos/IP únicos. | Grupo limpio y MOCK. | Prueba lenta con conexiones reales; umbral de remediación tomado de LH-02, no del comportamiento actual. |

### 6.7 Rate limit — 17 casos

| ID | Área | LH | Rol | Operación | Resultado esperado exacto | Consulta o llamada concreta | Fixture necesario | Cómo evita el falso positivo |
|---|---|---|---|---|---|---|---|---|
| RATE-01 | Rate limit | NR | ANON/CART/A/ADM2; SR backend | Ejecutar seguimiento directamente y por backend. | Navegador, incluido ADM2, `42501`. Backend devuelve solo campos de seguimiento; prohibidos nombre, email, dirección, teléfono, notas y `user_id`. | `select public.get_order_status(:number,:email);` | `OA` con PII canaria. | Se comparan claves JSON exactas; correo incorrecto devuelve `found=false`. `SR` no prueba RLS. |
| RATE-02 | Rate limit | NR | Navegador; SR contador | Ejecutar `take_order_lookup` y probar hashes inválidos. | Navegador `42501`; NULL/corto `false` sin INSERT; hash válido entra en RATE-03. | `select public.take_order_lookup(:hash);` | `:hash64` limpio. | `SR` cuenta intentos y ejerce control válido. |
| RATE-03 | Rate limit | NR | SR contador | Trece llamadas secuenciales con mismo hash en diez minutos. | Doce `true`, 13.ª `false`; exactamente 12 filas. | Trece `select public.take_order_lookup(:hash64);`. | Hash limpio y filas antiguas. | Otro hash sigue permitido; filas de once minutos no cuentan. |
| RATE-04 | Rate limit | LH-05 | SR contador | Cuatrocientas llamadas paralelas con hashes distintos en un minuto. | Como máximo 300 filas/`true`; excedentes `false`. | Cuatrocientas llamadas concurrentes `take_order_lookup(:hash_n)`. | 400 hashes limpios. | Conexiones reales y conteo posterior; RATE-03 no prueba el tope global. |
| RATE-05 | Rate limit | NR | Navegador; SR contador | Ejecutar `take_client_error` y probar hashes inválidos. | Navegador `42501`; inválido `false` sin fila. | `select public.take_client_error(:hash);` | Hash limpio. | Control válido `true`; `client_errors` no se modifica en este contador. |
| RATE-06 | Rate limit | LH-05 | SR contador | Veintiuna llamadas de una IP; sembrar 2.000 intentos globales sin `client_errors` y probar otra IP. | Veinte `true`, 21.ª `false`; con 2.000 intentos globales devuelve `false` aunque `client_errors` esté vacía. | `select public.take_client_error(:hash);` en dos grupos. | Dos grupos limpios y 2.000 `client_error_attempts`. | Demuestra que el global usa `client_error_attempts`, no otra tabla; conteos exactos. |
| RATE-07 | Rate limit | LH-05 | SR contador | 2.050 llamadas paralelas con hashes distintos. | Como máximo 2.000 aceptaciones/intentos por hora; resto `false`. | Llamadas concurrentes `take_client_error(:hash_n)`. | Grupo global limpio. | Test lento con conexiones reales; no depende de inserciones posteriores en `client_errors`. |
| RATE-08 | Rate limit | NR | Navegador; SR contador | Ejecutar `take_invoice_request`, once llamadas por IP y una con 100 globales. | Navegador `42501`; hash inválido `false`; diez `true`, 11.ª `false`; con 100 globales otra `false`. | `select public.take_invoice_request(:hash);` | IP limpia y 100 intentos globales. | Otra IP funciona antes del tope global; se cuentan filas exactas. |
| RATE-09 | Rate limit | LH-05 | SR contador | Ciento cincuenta llamadas paralelas con IP distintas. | Como máximo 100 aceptaciones/intentos globales; resto `false`. | Llamadas concurrentes `take_invoice_request(:hash_n)`. | Grupo limpio. | Conexiones reales; no se sustituye por RATE-08. |
| RATE-10 | Rate limit | NR | Navegador; SR contador | Ejecutar `take_clip_pay`; 13 por IP, 7 por usuario con IP distintas y parámetros inválidos. | Navegador `42501`; inválidos `false`; máximo 12/IP y 6/usuario en diez minutos. | `select public.take_clip_pay(:hash,:user_id);` | Usuario e IP limpios. | Los límites se prueban por separado para que IP no oculte el límite de usuario. |
| RATE-11 | Rate limit | LH-05 | SR contador | Veinte llamadas paralelas del mismo usuario con hashes distintos. | Como máximo seis aceptaciones/filas; resto `false`. | Veinte llamadas concurrentes `take_clip_pay(:hash_n,:UA)`. | Usuario limpio. | Conexiones reales y commits. |
| RATE-12 | Rate limit | NR | Navegador; SR contador | Ejecutar `take_logo_process`; superar 20/usuario y 30/IP; parámetros inválidos. | Navegador `42501`; inválidos `false`; 21.ª por usuario y 31.ª por IP `false`; filas no superan 20/30. | `select public.take_logo_process(:user_id,:hash);` | Usuario/IP limpios. | Se cambia una sola dimensión por escenario; otro usuario/IP sirve de control. |
| RATE-13 | Rate limit | LH-05 | SR contador | Trescientas cincuenta llamadas paralelas sin alcanzar antes topes individuales. | Como máximo 300 aceptaciones/filas por hora; resto `false`. | `take_logo_process(:user_n,:hash_n)` concurrente. | Fixtures suficientes para no chocar con 20/30. | Se asegura que el tope global sea la primera barrera alcanzada. |
| RATE-14 | Rate limit | NR | ANON/CART/A/ADM2 | SELECT/INSERT directos en todas las tablas de intentos. | Todas las operaciones `42501`; ningún hash/IP devuelto ni modificado. | Consultas sobre `order_lookup_attempts`, `client_error_attempts`, `invoice_request_attempts`, `clip_pay_attempts`, `logo_process_attempts`, `coupon_attempts`, `newsletter_attempts`. | Una fila canario por tabla. | `SR` confirma cada canario antes/después; se prueba tabla por tabla. |
| RATE-15 | Rate limit | LH-09 | SR mantenimiento | Ejecutar limpieza con filas antiguas y recientes en todas las tablas cubiertas. | Borra intentos >2 días —newsletter >7—, errores >90, eventos >365 y carritos open/empty >180; conserva recientes y carritos converted. No requiere tráfico posterior. | `select public.cleanup_monitoring();` | Una fila fuera y otra dentro de plazo por tabla, incluidas las cinco omitidas por LH-09. | Se cuentan ambas filas por tabla antes/después; prueba directa de privacidad 149/200. |
| RATE-16 | Rate limit | LH-09 | Catálogo local | Comprobar programación de limpieza. | Existe `likehoodie-cleanup`, activo, programa `15 4 * * *` y ejecuta `cleanup_monitoring()`. | `select jobname,schedule,active,command from cron.job where jobname='likehoodie-cleanup';` | pg_cron local. | La existencia del job no sustituye RATE-15; no se consultan secretos ni contenido de clientes. |
| RATE-17 | Rate limit | LH-05, LH-11 | Integración local | Simular contador caído y ausencia de `LOOKUP_IP_SALT`; después configurar sal de prueba. | Fallo de contador: `503` o rate cerrado, sin operación. Sin sal: `503`, cero intentos y ninguna operación. Con sal: hash de 64 caracteres y distinto por finalidad para una misma IP. | Llamadas locales a `order-status`, `client-error`, `invoice-request`, `process-logo` y `clip-pay` con mocks de contador/red. | Mocks, IP sintética y sal exclusiva de prueba. | Se comparan tablas, Storage, pedidos y llamadas externas antes/después; no se imprimen hashes vinculados a IP real. |

### 6.8 Settings — 8 casos

| ID | Área | LH | Rol | Operación | Resultado esperado exacto | Consulta o llamada concreta | Fixture necesario | Cómo evita el falso positivo |
|---|---|---|---|---|---|---|---|---|
| SET-01 | Settings | NR | ANON/CART/A/ADM1/ADM2 | Leer o modificar configuración directamente. | SELECT/INSERT `42501`; UPDATE/DELETE `42501`; ningún rol de navegador lee o cambia settings. | SELECT/INSERT/UPDATE/DELETE sobre `public.store_settings`. | `clip_enabled=false`. | `SR` confirma clave y valor antes/después; `store_config` es la única salida pública. |
| SET-02 | Settings | NR | ANON/CART/A/ADM2 | Acceder a precios y ejecutar directamente el helper de precio. | Tabla y RPC `42501`; importe permanece 899. | `select * from public.product_prices;` y `select public.item_unit_price(:item899);` | Precio 899 conocido. | `place_order` válido es control; `SR` confirma que el precio no cambió. |
| SET-03 | Settings | NR | ANON y CART | Leer configuración pública con Clip desactivado. | Exactamente `{payment_provider:'demo'}`; sin otras claves. | `select public.store_config();` | `clip_enabled=false`. | Se comparan claves JSON y `SR` confirma el valor real. |
| SET-04 | Settings | NR | Base nueva desechable | Comprobar valor inicial y reejecutar inicialización. | Valor inicial `clip_enabled='false'`; la instalación nunca lo activa. Reejecutar no sustituye una decisión admin explícita. | `select value from public.store_settings where key='clip_enabled';` | Base sin setting previo. | `store_config=demo` como control; no se afirma que reejecutar resetea un `true` deliberado. |
| SET-05 | Settings | NR | SR fixture + ANON/CART | Activar Clip temporalmente en local, consultar config y crear pedido; restaurar. | Config pública solo `{payment_provider:'clip'}`; pedido `clip/pending`, nunca `paid`; al restaurar vuelve demo. | `store_config()` y `place_order(:cliente,jsonb_build_array(:item899),:CC,'',null)`. | Entorno local sin credenciales Clip. | `SR` verifica estados y ausencia de llamada a Clip; restauración en `finally`. |
| SET-06 | Settings | LH-10 | ANON | Consultar existencia de clave Resend. | `42501`, nunca booleano; Vault no se lee. | `select public.has_resend_key();` | No se consulta ningún valor de Vault. | Se prueba con clave ausente y presencia simulada; ambos resultados deben ser indistinguibles. |
| SET-07 | Settings | LH-10 | CART/A/B/ADM1/ADM2 | Consultar existencia de clave Resend con rol `authenticated`. | `42501` para todos, incluidas sesiones anónimas y admin; nunca booleano. | `select public.has_resend_key();` | Igual que SET-06. | `SR` solo confirma que la función existe; no devuelve ni registra su resultado. |
| SET-08 | Settings | LH-06 | A; integración local | Dos `clip-pay` y dos `clip-checkout` paralelas para el mismo pedido. | Una sola petición de cobro y una de checkout; la petición concurrente recibe `409`; un solo identificador/intento; total tomado de `orders.total`. | Dos POST paralelos a cada función local con `{"orderId":":order"}`. | Pedido `clip/pending`, MOCK y decisión Q-05 sobre `currency`. | Se cuentan llamadas al mock y registros; permanece pendiente si falta la decisión de esquema, sin añadir columnas desde el test. |

### 6.9 Storage — 10 casos

| ID | Área | LH | Rol | Operación | Resultado esperado exacto | Consulta o llamada concreta | Fixture necesario | Cómo evita el falso positivo |
|---|---|---|---|---|---|---|---|---|
| STO-01 | Storage | NR | Catálogo | Comprobar configuración de buckets. | `public=false`; logos: 5 MiB y PNG/JPEG/WebP; prints: 25 MiB y solo PNG. | `select id,public,file_size_limit,allowed_mime_types from storage.buckets where id in ('order-logos','order-prints');` | Buckets instalados. | Se comparan arrays y bytes exactos; las políticas no sustituyen la configuración. |
| STO-02 | Storage | NR | ANON | Leer o crear objetos sin sesión. | SELECT/INSERT `42501`; no lista, lee ni crea objetos. | `select name from storage.objects where bucket_id='order-logos' and name=:SA_name;` e INSERT equivalente. | `SA`. | `SR` confirma `SA` y ausencia del nuevo objeto. |
| STO-03 | Storage | NR | A y B; SQL y API Storage | B selecciona, descarga y firma `SA`; A repite como control. **Bloqueante 8.** | B: SQL `[]`, descarga/firma `403`, sin bytes ni URL. A: accede únicamente a `SA`. | SELECT por `bucket_id/name`; `GET` local del objeto y `createSignedUrl('order-logos',:SA_name,3600)`. | `SA`, `SB`, bytes canarios. | `SR` confirma existencia y bucket privado después; no se imprime la URL firmada. |
| STO-04 | Storage | NR | A y CART | Subir PNG pequeño a carpeta propia y listar logos. | Upload permitido; SELECT devuelve solo objetos cuyo primer componente es el UID. | `POST /storage/v1/object/order-logos/:UID/nuevo.png` y SELECT en `storage.objects`. | UA/UC, `SA`, `SB`. | Se comparan nombres exactos; objetos A/B actúan como canarios cruzados. |
| STO-05 | Storage | NR | A | Subir a carpeta ajena y variantes con barra inicial o `..`. | Ninguna variante crea objeto fuera de la carpeta efectiva de A; ruta ajena `42501` o HTTP `403`; aliases se normalizan o rechazan sin escape. | POST a `UB/robo.png`, `/UB/robo.png` y `UA/../UB/robo.png`. | UA/UB. | `SR` lista por prefijo y comprueba cero objetos nuevos bajo UB; Q-06 cubre normalización. |
| STO-06 | Storage | NR | ADM1 y ADM2 | Leer logo y print de A. | ADM1 no obtiene ninguno; ADM2 puede leer ambos mediante política/enlace firmado. | SELECT en `storage.objects` para `SA` y `PA`; descarga local. | `SA`, `PA`. | Mismo objeto y claims; B sigue sin acceso al print. |
| STO-07 | Storage | NR | A, B y ADM2 | A borra temporal propio; B intenta borrar `SA`; ADM2 borra otro temporal. | A y ADM2 pueden borrar los logos permitidos; B afecta 0 filas y `SA` permanece intacto. | `delete from storage.objects where bucket_id='order-logos' and name=:name;` | Tres objetos temporales más `SA`. | No se usa `SA` para el borrado positivo; `SR` verifica cada objeto. |
| STO-08 | Storage | NR | A/B/ADM1/ADM2 | Leer y escribir directamente en `order-prints`. | A/B/ADM1 SELECT `[]` o `42501`; ADM2 SELECT permitido. INSERT/UPDATE/DELETE directos denegados; solo backend escribe. | SELECT/INSERT/UPDATE/DELETE sobre `storage.objects` con `bucket_id='order-prints'`. | `PA`. | `SR` comprueba objeto antes/después; la carpeta `UA/` no concede acceso en este bucket. |
| STO-09 | Storage | NR | A y API Storage/backend | Subir SVG, MIME falso y exceso de tamaño a logos; no PNG o exceso a prints. | Rechazo HTTP `400` por MIME y `413` por tamaño; ninguna fila/objeto almacenado. | POST a `order-logos` con SVG, PNG falso y >5 MiB; POST backend simulado a `order-prints` con no PNG y >25 MiB. | Rutas propias y contenido controlado. | Se comprueba contenido y MIME, no solo extensión; `SR` lista intentos fallidos. |
| STO-10 | Storage | NR | A/ADM2 y API Storage | Crear URL pública y firmada; probar expiración. | URL pública `403`; firmada dura como máximo 3600 segundos y después `403`; print solo admin. Objeto sigue existiendo. | `createSignedUrl(bucket,:name,3600)`, GET antes y después de avanzar el reloj del mock; intento de URL pública. | Objetos temporales y reloj simulado. | La URL no se registra; expiración del enlace no se confunde con borrado del objeto. |

### 6.10 Privilegios — 9 casos

| ID | Área | LH | Rol | Operación | Resultado esperado exacto | Consulta o llamada concreta | Fixture necesario | Cómo evita el falso positivo |
|---|---|---|---|---|---|---|---|---|
| PRIV-01 | Privilegios | NR | ANON/CART/A/B/ADM1/ADM2 | Leer perfiles propios y ajenos. | ANON `[]`; CART/A/B solo su perfil; ADM1 solo el suyo; ADM2 todos. | `select id,email,role from public.profiles order by id;` y `select id from public.profiles where id=:UA;` como B. | Cuatro perfiles con emails sintéticos. | Se comparan UUID; `SR` confirma cuatro perfiles. |
| PRIV-02 | Privilegios | NR | CART/A/B | Autoasignarse admin, insertar perfil admin y borrar perfil. **Bloqueante 7.** | UPDATE/DELETE afectan 0 filas; INSERT `42501`; rol permanece `customer` e `is_admin()=false` incluso con `aal2`. | `update public.profiles set role='admin' where id=auth.uid();` `insert into public.profiles(id,role) values (auth.uid(),'admin');` `delete ...;` | Perfiles customer. | Snapshot `SR` y nueva llamada `is_admin`; no basta que el SELECT posterior oculte el cambio. |
| PRIV-03 | Privilegios | NR | ANON/CART/A/B/ADM1/ADM2 | Ejecutar `is_admin` y probar todas las superficies admin con `aal1`. **Bloqueante 6.** | ANON `42501`; CART/A/B `false`; ADM1 `false`, datos admin `[]` y RPC `42501`; ADM2 `true` y controles positivos. | `select public.is_admin();` más SELECT de orders/carts/events/client_errors/storage y llamadas `admin_stats`, `global_invoice_preview`, `mark_invoice_request_issued`. | Fixtures de todas las áreas. | Solo cambia `aal` entre ADM1/ADM2; se revisa cada superficie, no una muestra. |
| PRIV-04 | Privilegios | NR | A con `aal2`; admin degradado | Probar MFA sin rol y rol histórico sin perfil admin. | `is_admin()=false` en ambos; ningún acceso admin. | `select public.is_admin();` después de asignar `aal2` a A y, en otro fixture, cambiar perfil admin a customer con `SR`. | Dos perfiles. | Se restauran fixtures; ADM2 real vuelve a `true` como control. |
| PRIV-05 | Privilegios | NR | ANON/CART/A/B/ADM1/ADM2 | Leer eventos e insertar eventos propios/ajenos. | SELECT no admin y ADM1 `[]`, incluso para eventos propios; ADM2 todos. INSERT propio autenticado permitido; ajeno `42501`; ANON `42501`. | `select id from public.events;` e `insert into public.events(user_id,name,metadata) values (:uid,'qa_event','{}');` | `M0`. | `SR` confirma canarios y nuevas filas; eventos propios no se vuelven legibles por ser propios. |
| PRIV-06 | Privilegios | LH-05 | CART/A | Superar límites de nombre, path, metadata y frecuencia de eventos. | Constraints `23514`; máximo 300 eventos/hora tanto serial como paralelo; excedentes `P0001`, sin filas extra. | INSERT con nombre >80 bytes, path >300, metadata >16 KiB; 301 inserts seriales y 400 paralelos. | Grupos limpios por usuario. | Controles en límites exactos; concurrencia real para el subcaso paralelo. |
| PRIV-07 | Privilegios | LH-05 | ANON/CART/A/B/ADM1/ADM2 | Leer/insertar errores directamente y usar `log_client_error`. | SELECT no admin/ADM1 `[]`; ADM2 ve todo. INSERT directo `42501`. RPC trunca 500/200/2000/180/200 y asigna `auth.uid()`; máximo 30/h por usuario también en paralelo. | SELECT/INSERT en `client_errors`; `select public.log_client_error(:message,:source,:stack,:path,:ua);` 31 veces y grupo paralelo. | `M0`, cadenas con longitudes conocidas. | `SR` lee longitudes y `user_id`; RATE-06/07 cubre global/IP; no se usa PII real. |
| PRIV-08 | Privilegios | NR | ANON/CART/A/B/ADM2 | Acceder directamente a consentimiento y usar su RPC. | Tabla directa `42501`; ANON RPC `42501`; autenticado solo crea/actualiza fila con su propio `auth.uid`, nunca la de otro usuario. | SELECT/INSERT/UPDATE/DELETE en `ad_consent`; `select public.set_ad_consent(true);` y `set_ad_consent(false)`. | Consentimiento A/B. | `SR` verifica A=true/false y B sin cambios; no se consulta token Meta ni red externa. |
| PRIV-09 | Privilegios | NR | Catálogo local | Inventariar RLS, funciones definer, `search_path` y grants. | RLS habilitado en las 21 tablas; cada función `SECURITY DEFINER` del inventario fija `search_path`; funciones backend sin EXECUTE para PUBLIC/ANON/authenticated; RPC públicas solo las documentadas. | Consultas a `pg_class`, `pg_proc`, `pg_namespace`, `pg_policies` e `information_schema.role_table_grants`. | Esquema final. | Comparación por `regprocedure` y lista explícita de diferencias; no se consultan valores de Vault. Q-01 para bootstrap. |

## 7. Cobertura funcional y trazabilidad

### Tablas

- `profiles`: PRIV-01/02/03/04.
- `carts`: CAR-01–08.
- `orders`: PED-01–16.
- `events`: PRIV-05/06 y RATE-15.
- `coupons`: CUP-01–12.
- `coupon_attempts`: CUP-03/07/09, RATE-14/15.
- `product_prices`: SET-02.
- `store_settings`: SET-01/03/04/05.
- `logo_assets`: LOG-01–09.
- `logo_process_attempts`: RATE-12/13/14/15.
- `invoice_requests`: FAC-01–15.
- `invoice_request_attempts`: RATE-08/09/14/15.
- `global_invoices`: FAC-16/17/18.
- `global_invoice_orders`: FAC-16/18.
- `client_errors`: PRIV-07 y RATE-15.
- `client_error_attempts`: RATE-05/06/07/14/15.
- `order_lookup_attempts`: RATE-02/03/04/14/15.
- `clip_pay_attempts`: RATE-10/11/14/15.
- `newsletter_subscribers`: NEW-01–13.
- `newsletter_attempts`: NEW-12/13 y RATE-14/15.
- `ad_consent`: PRIV-08.

### Funciones

- `place_order`: PED-06, PED-08–14, CUP-08/10 y SET-05.
- `check_coupon`: CUP-04–07/09/12.
- `subscribe_newsletter`: NEW-03/05–08/12/13.
- `confirm_newsletter`: NEW-03/04/08–11.
- `admin_stats`: PED-15/16.
- `is_admin`: PRIV-02/03/04.
- `take_order_lookup`: RATE-02/03/04.
- `take_client_error`: RATE-05/06/07.
- `take_invoice_request`: RATE-08/09.
- `take_clip_pay`: RATE-10/11.
- `take_logo_process`: RATE-12/13.
- `has_resend_key`: SET-06/07.
- `store_config`: SET-03/04/05.
- `mark_invoice_request_issued`: FAC-08/11/12/14.
- `submit_invoice_request`: FAC-04–07.
- `confirm_invoice_request`: FAC-04/09/10.
- `resend_invoice_verification`: FAC-14/15.
- `cancel_invoice_request`: FAC-13/14.
- `global_invoice_preview`: FAC-14/17.
- `set_order_billing`: FAC-14/17.
- `create_global_invoice`: FAC-14/18.
- `get_order_status`: RATE-01.
- `log_client_error`: PRIV-07.
- `item_unit_price`: SET-02.
- `set_ad_consent`: PRIV-08.

### Hallazgos LH-01–LH-12

- **LH-01:** PED-13/14.
- **LH-02:** NEW-12/13.
- **LH-03:** NEW-03/04/05/09/10.
- **LH-04:** CUP-07/09.
- **LH-05:** CAR-07, LOG-08, RATE-04/06/07/09/11/13/17, PRIV-06/07.
- **LH-06:** SET-08.
- **LH-07:** FAC-05.
- **LH-08:** CUP-01/11/12 y FAC-08/11.
- **LH-09:** RATE-15/16.
- **LH-10:** SET-06/07.
- **LH-11:** RATE-17.
- **LH-12:** LOG-09.

## 8. Casos de no regresión destacados

1. Solo existe la firma segura de cinco argumentos de `place_order`; el navegador no inserta pedidos directamente.
2. Precio, envío, descuento, usuario y estado de pago se deciden en servidor.
3. A/B/CART solo ven sus pedidos, carritos, perfiles, logos y objetos originales.
4. `order-prints` solo es accesible para admin con `aal2` o backend.
5. Un token `aal1` no obtiene privilegios administrativos; `aal2` sin perfil admin tampoco.
6. Cupones, precios, settings, intentos, solicitudes fiscales y consentimiento no se leen directamente desde el navegador.
7. `get_order_status` y todos los `take_*` no son RPC públicos; seguimiento no devuelve PII.
8. `admin_stats` excluye demo, pendientes y cancelados de todos sus agregados.
9. La solicitud fiscal nace `unverified`; solo token backend la lleva a `review`; solo `review` verificada puede emitirse.
10. Un cupón de suscriptor tiene un solo uso y confirmar dos veces no genera otro.
11. Los buckets permanecen privados, con MIME/tamaño limitados y enlaces firmados de una hora.
12. La limpieza borra por antigüedad sin necesidad de tráfico nuevo y conserva filas dentro de plazo.
13. La reejecución de scripts heredados no reabre cupones, no elimina contadores ni restaura RPC inseguras.
14. Los contadores inválidos o no disponibles fallan cerrados y no producen efectos laterales.
15. Clip permanece desactivado por defecto; activar configuración no convierte un pedido en pagado.
16. El alta de newsletter solo ocurre por RPC y la confirmación positiva utiliza un token emitido por backend.

## 9. Preguntas abiertas

### Q-01. Orden de bootstrap local reproducible

El informe C.3 confirma que la lista del README omite `logo-assets.sql` y los scripts de newsletter; también hay scripts de consentimiento y correo fuera de la lista. Antes de declarar verde una base limpia debe aprobarse una secuencia canónica única. No se debe ocultar un fallo de bootstrap creando tablas manualmente desde el test.

### Q-02. SQLSTATE de validaciones no especificado

Las fuentes exigen rechazo de email, teléfono, dirección, estado, CP, carrito ajeno y límites, pero no siempre fijan `22023`, `P0001` u otro código. Hasta fijar contrato, esos casos deben afirmar “excepción y cero efectos” y quedar marcados `PENDIENTE_SQLSTATE`; no se copia el código actual como expectativa. Sí están fijados `22023` para precio manipulado, `42501` para permisos y `23514` para constraints.

### Q-03. Procedencia del token de newsletter

El esquema guarda un UUID sin una propiedad criptográfica que distinga “elegido por cliente” de “emitido por backend” una vez insertada la fila. La defensa comprobable es cerrar todo INSERT directo y ejercer el ataque completo LH-03. No se debe crear con `SR` una fila con token de atacante y afirmar que representa un token no emitido.

### Q-04. Concurrencia fuera de una transacción pgTAP

Un archivo pgTAP único no demuestra carreras entre transacciones que hacen commit. Los casos paralelos necesitan un runner con conexiones independientes, mocks y base desechable. Sus placeholders no deben reemplazarse por bucles seriales. Debe decidirse si el runner usará `pg_prove` con `dblink` o un script de integración separado.

### Q-05. `orders.currency` y activación de Clip

El informe C.5/LH-06 confirma que las funciones seleccionan `orders.currency`, pero el esquema no la crea. No se añadirá esa columna desde el test para hacer pasar el flujo. SET-08 permanece pendiente hasta que el esquema y el contrato la incluyan formalmente; Clip debe seguir `false`.

### Q-06. Normalización de rutas Storage

La política documentada comprueba el primer componente, pero las fuentes no especifican la normalización exacta de `..`, barras iniciales o aliases. La expectativa de seguridad es inequívoca: ningún objeto puede terminar fuera de la carpeta efectiva del usuario. El test acepta rechazo o normalización segura y verifica el resultado en Storage, no un mensaje concreto.

### Q-07. Diagnóstico de Meta

El informe C.4 señala que `MEDICION.md` promete `meta_last_response()` a administradores, mientras el SQL revoca `authenticated` y no usa `is_admin()`. No se define una expectativa de acceso hasta resolver la contradicción. PRIV-08 solo prueba consentimiento; no abre esta función.

### Q-08. Ausencia absoluta de PII en errores

El informe C.6 indica que el aviso afirma que no hay direcciones o teléfonos en errores, pero el endpoint admite texto arbitrario sin redacción. Los fixtures no introducen PII real ni declaran probada una garantía inexistente. Hace falta una prueba de redacción o una corrección del aviso antes de convertir esa afirmación en test.

### Q-09. Métricas `series`

La documentación dice que `admin_stats()` solo cuenta pedidos pagados. PED-15 aplica esa expectativa también a `series`. Si se decide que la serie histórica tiene otra semántica, debe documentarse primero; no se ajusta el test a una agregación demo solo porque exista hoy.

### Q-10. Códigos HTTP exactos de Storage y funciones

Cuando una fuente no fija si la plataforma devuelve `400`, `403` o `404`, el contrato de seguridad exige denegación y ausencia de contenido/efectos. Antes de implementar aserciones HTTP estrictas debe registrarse el código elegido por la versión local fijada de Supabase. Nunca se acepta `200` con datos, URL firmada u objeto creado como equivalente.

## 10. Ejecución local prevista

Estos comandos son instrucciones para el implementador; no se ejecutaron durante el diseño. Requieren Docker y una instancia local desechable, sin `--linked`, `--remote` ni secretos de producción.

```powershell
npx supabase start
```

Después debe aplicarse la secuencia SQL canónica local aprobada en Q-01. Una secuencia provisional que resuelve las dependencias conocidas es:

```text
schema.sql
storage-logos.sql
security-hardening.sql
coupons.sql
clip-payments.sql
email-notifications.sql
fase1-pedidos-seguros.sql
fase3-seguimiento.sql
fase3-monitorizacion.sql
fase4-seguridad.sql
fase5-ratelimit.sql
fase6-limites.sql
logo-assets.sql
fase7-abuso.sql
fase8-admin-mfa.sql
fase9-facturacion-global.sql
fase10-facturacion-individual.sql
newsletter.sql
optin-1-columnas.sql
optin-2-funciones.sql
security-fixes.sql
antispam.sql
optin-3-alta.sql
antispam-cupones.sql
meta-capi-1-consentimiento.sql
meta-capi-2-compra.sql
migrations/20261115000100_precios_tote.sql
migrations/20261115000200_facturacion_verificacion.sql
migrations/20261115000300_admin_stats_pagados.sql
migrations/20261115000400_cupones_unicos.sql
migrations/20261115000500_aviso_factura.sql
order-email-baja.sql
order-email-baja-pago.sql
```

En PowerShell, una vez aprobada esa secuencia:

```powershell
$schemaFiles = @(
  'supabase/schema.sql',
  'supabase/storage-logos.sql',
  'supabase/security-hardening.sql',
  'supabase/coupons.sql',
  'supabase/clip-payments.sql',
  'supabase/email-notifications.sql',
  'supabase/fase1-pedidos-seguros.sql',
  'supabase/fase3-seguimiento.sql',
  'supabase/fase3-monitorizacion.sql',
  'supabase/fase4-seguridad.sql',
  'supabase/fase5-ratelimit.sql',
  'supabase/fase6-limites.sql',
  'supabase/logo-assets.sql',
  'supabase/fase7-abuso.sql',
  'supabase/fase8-admin-mfa.sql',
  'supabase/fase9-facturacion-global.sql',
  'supabase/fase10-facturacion-individual.sql',
  'supabase/newsletter.sql',
  'supabase/optin-1-columnas.sql',
  'supabase/optin-2-funciones.sql',
  'supabase/security-fixes.sql',
  'supabase/antispam.sql',
  'supabase/optin-3-alta.sql',
  'supabase/antispam-cupones.sql',
  'supabase/meta-capi-1-consentimiento.sql',
  'supabase/meta-capi-2-compra.sql',
  'supabase/migrations/20261115000100_precios_tote.sql',
  'supabase/migrations/20261115000200_facturacion_verificacion.sql',
  'supabase/migrations/20261115000300_admin_stats_pagados.sql',
  'supabase/migrations/20261115000400_cupones_unicos.sql',
  'supabase/migrations/20261115000500_aviso_factura.sql',
  'supabase/order-email-baja.sql',
  'supabase/order-email-baja-pago.sql'
)

foreach ($file in $schemaFiles) {
  npx supabase db query --local --yes --file $file
  if ($LASTEXITCODE -ne 0) { throw "Falló bootstrap local: $file" }
}

npx supabase test db
```

El esqueleto contiene 121 pruebas planificadas. Mientras los diez bloqueantes estén sin implementar, `supabase test db` debe terminar en rojo; los demás casos aparecen como TODO. Esto evita interpretar el esqueleto como una suite aprobada.

## 11. Integración posterior en CI

Cuando se implemente, se añadirá un workflow separado para `pull_request`, con:

- `permissions: contents: read`.
- Supabase CLI en una versión fijada y validada.
- `supabase start` y la misma secuencia local.
- `supabase test db`.
- Ningún secret de producción ni opción `--linked`.
- Los diez bloqueantes en un job obligatorio, sin `continue-on-error`.
- Los tests lentos globales y de Edge Functions en un job local adicional, sin convertir los bloqueantes en informativos.
- Timeout y concurrencia con cancelación de ejecuciones obsoletas.

No se modifica ningún workflow como parte de este diseño.

## 12. Riesgos propios del test

1. **Fixtures privilegiados.** Los helpers crean usuarios Auth y usan `service_role`; solo son aceptables en una base local desechable y dentro de transacciones con rollback cuando el caso lo permita.
2. **Secretos y red.** Un Vault local con claves reales podría disparar correos o llamadas Meta/Resend. El entorno debe partir sin secretos y usar mocks.
3. **Salida sensible.** No imprimir tokens completos, claims, hashes vinculados a IP real, enlaces firmados ni filas fiscales.
4. **Carreras del harness.** Conexiones, ventanas horarias y fixtures compartidos pueden producir resultados no deterministas. Cada escenario necesita espacio de nombres, barrera de inicio y conteos posteriores.
5. **Rollback insuficiente.** Los tests paralelos y Edge Functions necesitan commit; se separan de la transacción pgTAP y usan una base desechable.
6. **Mocks permisivos.** Simular un contador siempre exitoso oculta fallo abierto. RATE-17 debe forzar excepción, timeout y ausencia de sal.
7. **TODO tratado como éxito.** Los TODO no bloquean merge. Al implementar un caso se sustituye por aserciones reales, nunca por `pass()` o `skip()` permanente.
8. **Bootstrap distinto del desplegado.** La secuencia provisional puede no reproducir producción. Q-01 debe resolverse y las comprobaciones de catálogo/grants deben repetirse en staging.
9. **Claims simulados.** Cambiar `request.jwt.claims` prueba RLS con claims dados, no la firma JWT ni el enrolamiento real de MFA. Auth requiere una prueba adicional con factores de prueba.
10. **Limpieza destructiva local.** `cleanup_monitoring`, Storage y reejecución de scripts son destructivos por diseño. Cualquier parámetro remoto es un error de operación.
11. **Dependencia del tiempo.** Los límites horarios y caducidades deben usar márgenes amplios o reloj simulado para evitar resultados intermitentes.
12. **Pruebas de gran volumen.** Los topes de 300, 500 y 2.000 pueden consumir recursos; deben aislarse del suite rápido, pero no eliminarse ni sustituirse por afirmaciones teóricas.
