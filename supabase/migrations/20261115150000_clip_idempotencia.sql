-- LH-06: reclamacion atomica para evitar cargos y enlaces duplicados.
--
-- clip-pay reclama el pedido con payment_attempt_id antes de llamar a Clip:
-- dos peticiones paralelas ya no pueden cobrar dos veces.
-- clip-checkout usa clip_claim_id como compare-and-swap antes de crear el link.
--
-- Idempotente.

alter table public.orders
  add column if not exists payment_attempt_id uuid,
  add column if not exists payment_attempt_at timestamptz,
  add column if not exists clip_claim_id uuid,
  add column if not exists clip_claim_at timestamptz;
