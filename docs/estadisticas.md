# Estadísticas del panel (GA4 y Meta)

La pestaña **Estadísticas** de `admin.html` muestra datos reales de Google
Analytics 4 y de Meta. No hay cifras de ejemplo: si falta configuración, la
pestaña explica qué conectar.

## Qué muestra

**Google Analytics 4**

- Usuarios, sesiones, vistas, conversiones e ingresos del periodo.
- Usuarios por día (agrupados por semana en periodos de 90 días).
- Países de las visitas, canales de adquisición, páginas y eventos más
  frecuentes.
- Filtro por país: al elegir uno, el gráfico diario y todos los indicadores se
  limitan a ese país. La tarjeta *Países* sigue mostrando la lista completa para
  poder cambiar de filtro.
- Periodos de 7, 28 o 90 días.

**Meta**

- Gasto, impresiones, clics, CTR, CPC, compras y valor atribuido.
- Estado del último envío de la Conversions API.
- Enlaces directos a GA4 y a Events Manager.

Con cero campañas activas, el bloque de Meta muestra ceros: es lo correcto, no
un error.

## Cómo funciona

```
admin.html (sesión + MFA)
   └─ POST /functions/v1/stats  (JWT del administrador)
        ├─ is_admin()  → exige rol admin y aal2
        ├─ GA4 Data API (cuenta de servicio, solo lectura)
        ├─ Meta Graph API /act_<id>/insights
        └─ meta_last_response()  (último envío de CAPI)
```

La función vive en `supabase/functions/stats/index.ts` y no acepta peticiones
sin una sesión de administrador con MFA.

## Configurar GA4

1. En **Google Cloud**, crea un proyecto (por ejemplo `likehoodie-stats`).
2. Habilita **Google Analytics Data API**.
3. Crea una **cuenta de servicio** y descarga su clave **JSON**.
4. En GA4 → *Administrar* → *Acceso a la propiedad*, añade el correo de la
   cuenta de servicio (`...@<proyecto>.iam.gserviceaccount.com`) como
   **Lectora**.
5. En Supabase → **Edge Functions → Secrets**, crea:
   - `GA_SERVICE_ACCOUNT`: el JSON completo.
   - `GA_PROPERTY_ID` (opcional): por defecto `344891849`.

Coste: **$0**. La Analytics Data API es gratuita y tiene cuota de 200 000
tokens por propiedad al día; el panel consume muy pocos.

## Configurar Meta

1. En Business Settings → **Usuarios del sistema**, abre el system user de
   Conversions API.
2. Asígnale la **cuenta publicitaria** con permiso *View performance* (solo
   lectura).
3. Genera un token con la app del negocio, caducidad *Never* y permisos
   `ads_read` (y `business_management` si hace falta).
4. En Supabase → **Edge Functions → Secrets**:
   - `META_ACCESS_TOKEN`: el token.
   - `META_AD_ACCOUNT_ID` (opcional): por defecto `act_2254330422156099`.

Si no existe `META_ACCESS_TOKEN`, la función reutiliza el token de Conversions
API guardado en Vault (`meta_capi_token`) a través de `stats_meta_token()`. Ese
token solo sirve para insights si el system user tiene la cuenta publicitaria
asignada.

### SQL necesario

Ejecuta una vez `supabase/estadisticas.sql`:

- Da permiso a `service_role` para leer `meta_last_response()`.
- Crea `stats_meta_token()` (solo `service_role`) para reutilizar el token de
  Vault sin exponerlo al navegador.

## Tráfico interno

Abre una vez `https://likehoodie.com/?interno=1` en cada navegador con el que
pruebes. La web guarda la marca en `localStorage` y envía
`traffic_type = internal` a GA4; el filtro de datos **Internal Traffic** está
*Activo* y descarta esos eventos.

- `?interno=0` deshace la marca.
- La marca es por navegador: hazlo también en el móvil.
- El filtro **no es retroactivo**: los datos anteriores siguen contando.

No se filtra por IP a propósito: la IP doméstica cambia y la etiqueta de Google
vive ahora en un contenedor de Tag Manager (`GTM-NRSCJ44D`), donde las reglas de
IP no aplican a esta implementación.

## Enlaces con UTM

La tarjeta **Enlaces con UTM** genera el enlace para una página y un canal:

| Canal | Fuente | Medio | Campaña |
| --- | --- | --- | --- |
| WhatsApp | `whatsapp` | `social` | `lanzamiento` |
| Instagram bio | `instagram` | `social` | `bio` |
| Instagram historia | `instagram` | `story` | `lanzamiento` |
| Facebook | `facebook` | `social` | `lanzamiento` |

Sin UTM, una visita desde una red social aparece como **Direct** y no se puede
atribuir. Usa un enlace por canal y no lo cambies a mitad de campaña.

## Comprobación

- **GA4:** *Informes → Tiempo real*. Con `?interno=1` no debe aparecer tu
  visita; con `?interno=0` sí.
- **Meta:** Events Manager → *Probar eventos*.
- **Función:** si Meta responde `403` o `(#200)`, el token no tiene `ads_read`
  sobre la cuenta publicitaria.
- **Sin datos de GA4:** revisa que la cuenta de servicio siga como *Lectora* en
  la propiedad y que `GA_PROPERTY_ID` sea el correcto.

## Limitaciones

- GA4 solo mide a quien acepta analítica; el tráfico real es mayor.
- Las conversiones e ingresos incluyen pedidos demo anteriores al cambio que
  enviaba `purchase` sin cobro. Desde `meta-capi-3-solo-pagados.sql` solo se
  mide una compra con `payment_status = 'paid'`.
- `meta_last_response()` solo guarda el último envío, no un histórico.
- Los secretos de la función no se pueden leer desde el panel: para cambiarlos
  hay que ir a Supabase.
