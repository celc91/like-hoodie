# Idempotencia de Clip (LH-06)

Dos peticiones paralelas del mismo pedido no deben producir dos cargos ni dos
enlaces de pago. La defensa es una reclamación atómica en la base antes de
llamar a Clip.

## Columnas nuevas

| Columna | Uso |
|---|---|
| `orders.payment_attempt_id` | Identifica el intento de cobro en curso |
| `orders.payment_attempt_at` | Marca de tiempo del intento |
| `orders.clip_claim_id` | Reclamación para crear el link de Checkout |
| `orders.clip_claim_at` | Marca de tiempo de la reclamación |

## clip-pay (Checkout Transparente)

1. Valida sesión, pedido, monto y moneda.
2. Reclama el pedido:

   ```sql
   update orders
      set payment_status = 'processing',
          payment_attempt_id = <nuevo>,
          payment_attempt_at = now()
    where id = <pedido> and payment_status = 'pending';
   ```

   Solo una petición afecta una fila. La otra recibe `409` (o `alreadyPaid` si
   ya estaba pagado).
3. Llama a Clip con el `amount` de `orders.total`.
4. Si Clip aprueba, marca pagado solo con `payment_attempt_id = <nuevo>`.
5. Si Clip rechaza de forma explícita, devuelve el pedido a `pending`.
6. Si la red falla o Clip responde `5xx`, el pedido **se queda en `processing`**:
   no se sabe si el cobro se registró, así que no se reintenta a ciegas.

Estados: `pending → processing → paid` (o `processing → pending` en rechazo).

## clip-checkout (link redirigido)

1. Si hay un link activo (`clip_checkout_id`), lo reutiliza.
2. Si no, hace compare-and-swap sobre `clip_claim_id`: solo la petición que lee
   el mismo valor que había al empezar puede reclamar.
3. Crea el link en Clip.
4. Guarda `clip_checkout_id`, `clip_checkout_url` y limpia la reclamación, solo
   si `clip_claim_id` sigue siendo el suyo.
5. Si algo falla, libera la reclamación para permitir reintentar.

## Cómo verificarlo en sandbox

Con `clip-pay` desplegada y un pedido `pending`:

```bash
curl -X POST "$FUNCTIONS/clip-pay" \
  -H "Authorization: Bearer $USER_JWT" \
  -H "Content-Type: application/json" \
  -d '{"orderId":"<uuid>","token":"<token-de-prueba>","customer":{"email":"qa@example.invalid"}}' &
curl -X POST "$FUNCTIONS/clip-pay" ... &
wait
```

Resultado esperado: una respuesta procesa el cobro y la otra devuelve `409`
«Ya hay un pago en curso». En la base, `payment_attempt_id` es uno solo.

Para el link, dos `POST` paralelos a `clip-checkout` deben producir un solo
`clip_checkout_id` y un `409` en la otra petición.

## Limitación conocida

No se envía una clave de idempotencia al proveedor. Si Clip la admite en
`POST /payments`, conviene añadirla con el `payment_attempt_id` para cubrir el
caso de respuesta incierta tras un timeout. Mientras tanto, el pedido queda en
`processing` y requiere conciliación manual.
