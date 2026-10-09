-- =========================================================
-- El monto del MVR se ve en la lista
-- =========================================================
-- Arturo, mirando la lista de archivos:
--
--   "No muestra el cargo de los MVR, no lo muestra afuera, lo que dice es cero. Pero necesito
--    ver los montos afuera, donde dice amount. La cantidad de MVR que se cobro, que se proceso,
--    el total del archivo, para saber."
--
-- v_reportes calcula lineas y monto mirando SOLO lineas_comision. Los MVR viven en lineas_costo
-- y las cotizaciones en lineas_cotizacion, asi que los dos salian con monto 0.00 y con los
-- contadores que hubiera dejado escritos el proceso, no los reales.
--
-- El monto del MVR sale en NEGATIVO, y es a proposito: esa columna dice lo que la agencia
-- recibio, y un MVR es lo contrario -- plata que la compania descuenta. Ponerlo en positivo al
-- lado de los $40,129 de GEICO invita a sumarlos, que es justo el error que hay que evitar. Por
-- el mismo motivo queda fuera del "Total recibido" de arriba: no es menos comision, es un gasto
-- aparte que se le descuenta a la oficina despues del royalty.

drop view if exists v_reportes;

create view v_reportes as
select r.*,
       -- El mes al que pertenece el statement. Los reportes de Book y de ventas internas no
       -- tienen periodo de statement y quedan en null, que es lo correcto: no son de ningun mes.
       case when r.tipo = 'comision_aseguradora'
            then coalesce(mes_del_periodo(r.periodo), date_trunc('month', r.created_at)::date)
            else mes_del_periodo(r.periodo)
       end as mes_statement,
       case when coalesce(t.lineas, 0) > 0 then t.lineas else r.total_lineas end as lineas_reales,
       case when coalesce(t.lineas, 0) > 0 then t.ok else r.total_ok end as ok_reales,
       case when coalesce(t.lineas, 0) > 0 then t.pendientes else r.total_excepciones end as pendientes_reales,
       coalesce(t.fuera, 0) as fuera_reales,
       coalesce(t.monto, 0) as monto_total
from reportes r
left join lateral (
  -- Cada tipo de reporte guarda sus lineas en su tabla. Se elige una sola rama por reporte, asi
  -- que esto no suma dos veces aunque un reporte llegara a tener filas en mas de una.
  select * from (
    select count(*) as lineas,
           count(*) filter (where l.estado in ('conciliado_auto','conciliado_confirmado','cuenta_casa')) as ok,
           count(*) filter (where l.estado not in ('conciliado_auto','conciliado_confirmado','cuenta_casa','descartado')) as pendientes,
           count(*) filter (where l.estado = 'descartado') as fuera,
           coalesce(sum(l.monto) filter (where l.estado <> 'descartado'), 0) as monto
      from lineas_comision l
     where r.tipo not in ('mvr','cotizaciones') and l.reporte_id = r.id

    union all

    select count(*),
           count(*) filter (where c.estado in ('conciliado_auto','conciliado_confirmado','cuenta_casa')),
           count(*) filter (where c.estado not in ('conciliado_auto','conciliado_confirmado','cuenta_casa','descartado')),
           count(*) filter (where c.estado = 'descartado'),
           -- En negativo: es plata que sale. Ver arriba.
           -coalesce(sum(c.monto) filter (where c.estado <> 'descartado'), 0)
      from lineas_costo c
     where r.tipo = 'mvr' and c.reporte_id = r.id

    union all

    -- El QuoteReport no tiene plata: es el padron contra el que se cruzan los MVR. Lo que si
    -- tiene sentido contar es cuantas cotizaciones trae y cuantas traen agente, que es lo que
    -- decide si el cruce va a servir para algo.
    select count(*),
           count(*) filter (where q.agente_id is not null),
           count(*) filter (where q.agente_id is null),
           0,
           0
      from lineas_cotizacion q
     where r.tipo = 'cotizaciones' and q.reporte_id = r.id
  ) u
  where u.lineas > 0
  limit 1
) t on true;

-- Igual que siempre: el DROP se lleva security_invoker, y sin el la vista devuelve filas
-- saltandose la RLS con la pantalla viendose identica.
alter view v_reportes set (security_invoker = on);

notify pgrst, 'reload schema';

-- ---------------------------------------------------------
-- Comprobacion
-- ---------------------------------------------------------
select r.tipo, coalesce(a.nombre, '-') as compania, r.periodo,
       v.lineas_reales, v.ok_reales, v.pendientes_reales, v.monto_total,
       (select c.reloptions::text from pg_class c where c.relname = 'v_reportes') as rls
  from v_reportes v
  join reportes r on r.id = v.id
  left join aseguradoras a on a.id = r.aseguradora_id
 where r.tipo in ('mvr','cotizaciones')
 order by r.created_at desc;
