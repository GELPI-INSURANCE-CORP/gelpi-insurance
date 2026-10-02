-- =========================================================
-- Una cancelacion no te paga plata
-- =========================================================
-- Arturo, mirando el panel de Nadira:
--
--   "El tipo de poliza pusiste cancelacion, y eso no son cancelaciones porque las comisiones
--    estan positivas. Eso son polizas de United, que United lo que hace es que las paga mes tras
--    mes. [...] Eso sigue siendo New Business porque fue el tiempo que se hizo. O si quieres no
--    [contarlo] como New Business, pero lo puedes [poner] como otro. Pero cancelacion no es."
--
-- Tiene razon y es un error grande. Son 115 lineas, todas de United Automobile: $3,120.90 de
-- comision y $25,161.09 de prima, el 72% de toda la prima que hoy esta sin clasificar.
--
--   UAE-000272549  JORDAN JOSUE VIART        prima $243.07   comision +$31.60   "cancelacion"
--   UAE-000275400  GEORGE HERNANDEZ SUAREZ   prima $219.07   comision +$28.48   "cancelacion"
--   UAE-000275704  LISSETT M RODRIGUEZ A.    prima $266.46   comision +$34.64   "cancelacion"
--
-- DE DONDE SALE EL ERROR. El tipo de transaccion no sale de una columna: lo decide el modelo que
-- lee el archivo. United paga "COMM AS COLLECTED" -- la comision se cobra a medida que el
-- asegurado paga las cuotas -- y escribe los importes con el signo menos AL FINAL ("24.51-"),
-- que es notacion de mainframe. El modelo ve ese menos y concluye que es una devolucion. No lo
-- es: es una cuota de una poliza que se vendio y se esta cobrando.
--
-- LA REGLA. Una cancelacion devuelve plata. Si la linea trae comision positiva Y prima positiva,
-- no es una cancelacion, sea cual sea la compania. Eso no hay que adivinarlo ni preguntarselo a
-- un modelo: es aritmetica.
--
-- POR QUE UN TRIGGER Y NO ARREGLAR EL PROMPT. Porque el prompt se lo lleva el proximo reproceso
-- y porque depende de que un modelo acierte. El trigger corre en la base, no se puede olvidar, y
-- vale para cualquier compania que mande lo mismo manana.
--
-- POR QUE "otro" Y NO "nueva". Porque "otro" no mueve un solo centavo: senal_negocio_nuevo()
-- devuelve null tanto para 'cancelacion' como para 'otro', asi que estas lineas siguen
-- exactamente donde estan, en "sin clasificar". Lo unico que cambia es que la pantalla deja de
-- decir una mentira. Si ademas hay que contarlas como negocio nuevo -- que es lo que Arturo
-- cree, y tiene sentido porque son cuotas de una venta del periodo -- eso mueve $25,161.09 de
-- prima entre agentes y lo decide el, no yo.

create or replace function normalizar_tipo_transaccion() returns trigger
language plpgsql as $fn$
begin
  -- Prima positiva y comision positiva: entro plata. Eso no es una cancelacion.
  if new.tipo_transaccion = 'cancelacion'
     and coalesce(new.monto, 0) > 0
     and coalesce(new.prima, 0) >= 0 then
    new.tipo_transaccion := 'otro';
  end if;
  return new;
end $fn$;

drop trigger if exists lineas_comision_normalizar_tipo on lineas_comision;

create trigger lineas_comision_normalizar_tipo
  before insert or update on lineas_comision
  for each row execute function normalizar_tipo_transaccion();

comment on function normalizar_tipo_transaccion is
  'Una cancelacion devuelve plata. Si la linea viene marcada como cancelacion pero trae comision '
  'y prima positivas, no lo es, y se guarda como "otro". Caso United Automobile: paga '
  '"COMM AS COLLECTED" (cuota a cuota) y escribe los importes con el menos al final, y el modelo '
  'que lee el archivo lo interpreta como devolucion. No cambia ningun calculo de pago: '
  'senal_negocio_nuevo() devuelve null para los dos tipos.';

-- ---------------------------------------------------------
-- Lo que ya estaba cargado
-- ---------------------------------------------------------
update lineas_comision
   set tipo_transaccion = 'otro'
 where tipo_transaccion = 'cancelacion'
   and coalesce(monto, 0) > 0
   and coalesce(prima, 0) >= 0;

notify pgrst, 'reload schema';
