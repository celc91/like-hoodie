begin;

-- La versión antigua de un argumento queda obsoleta: todas las llamadas deben
-- usar la firma con cantidad (p_qty) para aplicar el descuento por volumen.
drop function if exists public.item_unit_price(jsonb);

notify pgrst, 'reload schema';

commit;
