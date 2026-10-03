-- =========================================================
-- Un cargo de la compania no es de ninguna oficina
-- =========================================================
-- Arturo, mirando el statement de Progressive de septiembre:
--
--   "Es imposible que yo, nada mas Gelpi Insurance Corp, haya ganado 2,912.38. Algunas lineas se
--    estan cruzando mal."
--
-- Tenia razon. GELPI INSURANCE CORP no gano $2,912.38 en ese statement: gano $4,725.18. La
-- diferencia es un solo renglon:
--
--   fila 206 | poliza 99999999 | ".   MVR FEE" | ajuste | comision -$1,812.80
--
-- Es un cargo que Progressive le descuenta a la AGENCIA por correr reportes de manejo. No es
-- produccion de nadie. El sistema lo clasifica bien -- queda en "cuenta de la casa", que es el
-- estado correcto, y por eso ni siquiera entra en el royalty -- pero al mandarlo ahi le pega
-- tambien el agente de la casa Y LA OFICINA DE ESE AGENTE, que es CORP. Resultado: un cargo de
-- toda la agencia aparece restandole la produccion a una oficina.
--
-- No es un caso aislado. En todo el sistema hay 10 lineas en cuenta de la casa por -$5,832.00, y
-- CINCO de ellas tienen oficina pegada por -$5,162.80:
--
--   Progressive  2026-07   MVR FEE   -$1,636.00
--   Progressive  2026-08   MVR FEE   -$1,534.00
--   Progressive  2026-09   MVR FEE   -$1,812.80
--   Responsive   2026-08             -$180.00
--   Kemper       2026-08              $0.00
--
-- Todas en CORP. Tres meses seguidos de Progressive restandole a la oficina corporativa un cargo
-- que es de la agencia entera.
--
-- EL ARREGLO. Una linea en cuenta de la casa se queda sin oficina. El agente de la casa se
-- conserva -- sirve para saber quien la resolvio y para encontrarla -- pero la oficina se vacia,
-- porque ninguna la produjo. Si alguna vez hay que cargarle un fee a una oficina concreta, para
-- eso estan los ajustes manuales del estado de cuenta (migracion 20261001000001), donde se elige
-- a mano y se decide si lleva royalty.
--
-- Va como trigger y no como arreglo en la pantalla porque a cuenta_casa se llega por tres
-- caminos distintos: el extractor al importar, resolver_excepcion, y el boton de "es un cargo de
-- la compania". Arreglar uno dejaba los otros dos.

create or replace function normalizar_tipo_transaccion() returns trigger
language plpgsql as $fn$
begin
  -- Prima positiva y comision positiva: entro plata. Eso no es una cancelacion.
  -- (United Automobile paga "COMM AS COLLECTED" y escribe el menos al final; ver 20261002000005.)
  if new.tipo_transaccion = 'cancelacion'
     and coalesce(new.monto, 0) > 0
     and coalesce(new.prima, 0) >= 0 then
    new.tipo_transaccion := 'otro';
  end if;

  -- Un cargo de la compania no lo produjo ninguna oficina. El agente se conserva; la oficina no.
  if new.estado = 'cuenta_casa' then
    new.oficina_id := null;
  end if;

  return new;
end $fn$;

comment on function normalizar_tipo_transaccion is
  'Dos correcciones que no se le pueden pedir a quien lee el archivo porque son aritmetica y '
  'contabilidad, no lectura: una cancelacion con prima y comision positivas no es una '
  'cancelacion (se guarda como "otro"), y una linea en cuenta de la casa no pertenece a ninguna '
  'oficina (se le vacia la oficina, conservando el agente de la casa).';

-- ---------------------------------------------------------
-- Lo que ya estaba cargado
-- ---------------------------------------------------------
update lineas_comision
   set oficina_id = null
 where estado = 'cuenta_casa'
   and oficina_id is not null;

notify pgrst, 'reload schema';
