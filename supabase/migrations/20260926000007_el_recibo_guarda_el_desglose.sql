-- =========================================================
-- El recibo de un mes cerrado guarda de dónde salió el pago
-- =========================================================
-- Ahora que se paga solo sobre el negocio nuevo, el recibo de un mes cerrado tiene que decir
-- cuánto era negocio nuevo, cuánto renovación y cuánto no se pudo clasificar. Si solo guarda el
-- total, dentro de seis meses nadie va a poder explicar por qué se pagó lo que se pagó.
--
-- Las columnas entran en 0 para los meses que ya estaban cerrados: en esos el pago se calculó
-- sobre la comisión entera, y el desglose no existía. La pantalla los sigue mostrando con el
-- total y el monto pagado que quedaron guardados, que es la verdad de lo que pasó.

alter table liquidacion_agente
  add column if not exists comision_nuevo numeric(14,2) not null default 0,
  add column if not exists comision_renovacion numeric(14,2) not null default 0,
  add column if not exists comision_sin_clasificar numeric(14,2) not null default 0;

comment on column liquidacion_agente.comision_nuevo is
  'La base sobre la que se calculó el pago: comisión de negocio nuevo del período. 0 en los '
  'meses cerrados antes de que existiera el corte por tipo de negocio.';

notify pgrst, 'reload schema';
