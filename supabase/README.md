# Backend de pedidos con Supabase

Este proyecto usa **Supabase** para guardar carritos, pedidos y eventos de uso. El sitio sigue siendo estático; el panel de administración se publica en `admin.html` y se protege con Supabase Auth + Row Level Security.

## 1. Crear el proyecto

1. Entra a <https://supabase.com> y crea una cuenta.
2. Crea un proyecto nuevo (región: la más cercana a México, por ejemplo `us-east-1` o `us-west-1`).
3. Espera a que termine de aprovisionarse.

## 2. Crear las tablas

1. Abre **SQL Editor**.
2. Copia todo el contenido de `supabase/schema.sql`.
3. Ejecútalo una sola vez.

Esto crea:

- `profiles`: perfiles y rol de administrador.
- `carts`: carritos de cada visitante.
- `orders`: pedidos.
- `events`: eventos del embudo.
- Funciones `is_admin()` y `admin_stats()`.
- Políticas RLS.

## 3. Activar usuarios anónimos

Los carritos se asocian a una sesión anónima segura de Supabase, no a un correo.

1. Ve a **Authentication → Providers**.
2. Activa **Anonymous sign-ins**.
3. Guarda.

Sin esto, la tienda sigue funcionando, pero no se registrarán carritos ni pedidos.

## 4. Crear el administrador

1. Ve a **Authentication → Users → Add user**.
2. Crea el usuario con tu correo y una contraseña fuerte. Marca **Auto Confirm User** para poder entrar sin esperar un correo de confirmación.
3. Vuelve a **SQL Editor** y ejecuta:

```sql
insert into public.profiles (id, email, role)
select id, email, 'admin'
from auth.users
where email = 'tu-correo@dominio.com'
on conflict (id) do update set role = 'admin';
```

El usuario administrador podrá entrar en `admin.html`.

## 5. Conectar la web

En **Project Settings → API Keys** copia:

- **Project URL**
- **Publishable key** (empieza con `sb_publishable_`)

Edita `supabase-config.js` en la raíz del proyecto:

```js
window.LIKEHOODIE_SUPABASE = {
  url: "https://TU-PROYECTO.supabase.co",
  publishableKey: "TU_PUBLISHABLE_KEY",
};
```

La `publishable key` es pública y está protegida por RLS. **Nunca** pongas la `secret key` ni la antigua `service_role key` en el frontend. Las legacy API keys se retirarán a principios de 2027.

## 6. Publicar

Sube los cambios a GitHub Pages. Quedarán disponibles:

- Tienda: `https://celc91.github.io/like-hoodie/`
- Panel: `https://celc91.github.io/like-hoodie/admin.html`

El panel tiene `noindex` y no muestra datos sin iniciar sesión. Aun así, se recomienda usar un dominio propio y una contraseña fuerte.

## 7. Comprobar que funciona

1. Abre la tienda y añade una sudadera al carrito.
2. Espera unos segundos (el carrito se sincroniza con retardo).
3. Entra al panel con el usuario administrador.
4. Deberías ver el carrito en **Carritos**.
5. Completa el checkout de prueba y verifica que aparece en **Pedidos**.

## 8. Archivo de impresión DTG

1. En **SQL Editor**, ejecuta `supabase/logo-assets.sql`. Crea la tabla
   `logo_assets`, el bucket privado `order-prints` y sus políticas.
2. Despliega la función:

   ```sh
   npx supabase login
   npx supabase functions deploy process-logo --remote=<project-ref>
   ```

3. Sube un logo en la tienda o pulsa **Personalizar** en un modelo de la
   colección. Debe aparecer el estado “Quitando el fondo del logo…” y después
   “Archivo de impresión listo”.
4. En el pedido, el admin verá **Descargar print** con el DPI final. Si el
   procesado falla, el botón **Reprocesar** vuelve a lanzarlo.

La función no necesita secretos propios: usa `SUPABASE_URL`,
`SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` del entorno de Supabase.

## Seguridad

- Los visitantes solo pueden leer y modificar **su propio carrito**.
- Los pedidos se crean únicamente con la función `public.place_order()`, que recalcula subtotal, envío y total en el servidor. No se permite insertar pedidos directamente desde el navegador.
- `place_order()` valida cada precio contra `public.product_prices` y rechaza cualquier pedido cuyo `unitPrice` no coincida.
- Los pedidos solo los puede leer el administrador; el cliente puede ver los suyos.
- Nadie puede cambiar su rol a administrador desde la web.
- No se guardan datos de tarjetas.
- Los carritos abandonados no guardan nombre, correo ni teléfono.
- Los pedidos guardan los datos necesarios para producir y enviar.

## 8. Pagos con Clip

La integración usa **Checkout redireccionado** y dos Edge Functions:

- `clip-checkout`: recibe el ID del pedido, valida la sesión y crea el link de pago con el total de `orders.total`.
- `clip-webhook`: recibe el aviso de Clip, consulta `GET /v2/checkout/{id}` y actualiza el pedido.

### Orden de SQL

En un proyecto nuevo ejecuta:

1. `schema.sql`
2. `storage-logos.sql`
3. `security-hardening.sql`
4. `clip-payments.sql`
5. `email-notifications.sql`

`clip-payments.sql` crea `store_settings` con `clip_enabled = 'false'`. Mientras esté en `false`, el checkout sigue siendo demostración.

### Secretos

```powershell
npx supabase login
npx supabase link --project-ref qrblsclpzoaxfaggsrda
npx supabase secrets set CLIP_API_KEY=... CLIP_API_SECRET=... CLIP_WEBHOOK_SECRET=... SITE_URL=https://likehoodie.com
```

No subas estos valores al repositorio. La CLI lee `config.toml` y despliega ambas funciones sin verificación JWT automática; la función de checkout valida el token del usuario y el webhook valida su secreto.

### Desplegar

```powershell
npx supabase functions deploy clip-checkout
npx supabase functions deploy clip-webhook
```

### Activar

```sql
update public.store_settings
   set value = 'true', updated_at = now()
 where key = 'clip_enabled';
```

Para volver a demostración, cambia el valor a `'false'`. La función pública `store_config()` solo expone `payment_provider` (`demo` o `clip`) para que la tienda muestre el aviso correcto.

## Privacidad

Antes de operar, actualiza `privacidad.html` y `cookies.html` para mencionar:

- Datos de pedido: nombre, correo, dirección y teléfono.
- Carritos anónimos y eventos de uso.
- Supabase como encargado del tratamiento.
- Plazo de conservación y cómo ejercer derechos ARCO.

## Límites del plan gratuito

El plan gratuito de Supabase es suficiente para empezar. Revisa los límites actuales en <https://supabase.com/pricing>. Para producción conviene activar copias de seguridad y alertas.
