-- =========================================================
-- El mes del statement, disponible para la pantalla
-- =========================================================
-- La lista de Comisiones agrupaba por el texto crudo del período, y ese texto lo escribe la IA
-- distinto cada vez: "Agosto 2026", "2026-08" y "JULY 2026" conviven hoy en la misma tabla. Dos
-- statements del mismo mes caían en grupos separados, y el de julio quedaba debajo del de agosto
-- porque se ordenaban como texto.
--
-- mes_del_periodo() ya sabe interpretar todas esas formas (migración anterior). Acá se expone el
-- resultado en la vista para que la pantalla agrupe y ordene por una fecha de verdad, en vez de
-- reimplementar el mismo intérprete en JavaScript y arriesgar que los dos difieran.

create or replace view v_reportes as
select r.*,
       -- El mes al que pertenece el statement. Los reportes de Book y de ventas internas no tienen
       -- período de statement y quedan en null, que es lo correcto: no son de ningún mes.
       case when r.tipo = 'comision_aseguradora'
            then coalesce(mes_del_periodo(r.periodo), date_trunc('month', r.created_at)::date)
            else mes_del_periodo(r.periodo)
       end as mes_statement,
       case when coalesce(c.lineas, 0) > 0 then c.lineas else r.total_lineas end as lineas_reales,
       case when coalesce(c.lineas, 0) > 0 then c.ok else r.total_ok end as ok_reales,
       case when coalesce(c.lineas, 0) > 0 then c.pendientes else r.total_excepciones end as pendientes_reales,
       coalesce(c.fuera, 0) as fuera_reales,
       -- Cuanta plata trae el statement. Es el dato que el usuario busca primero y el unico que no
       -- estaba en la lista: habia que entrar a cada archivo para saberlo. Las lineas marcadas
       -- 'descartado' quedan afuera, que es justamente lo que significan (el pago del mes anterior
       -- que United repite arriba del statement no es plata de este mes).
       coalesce(c.monto, 0) as monto_total
from reportes r
left join lateral (
  select count(*) as lineas,
         count(*) filter (where l.estado in ('conciliado_auto','conciliado_confirmado','cuenta_casa')) as ok,
         count(*) filter (where l.estado not in ('conciliado_auto','conciliado_confirmado','cuenta_casa','descartado')) as pendientes,
         count(*) filter (where l.estado = 'descartado') as fuera,
         coalesce(sum(l.monto) filter (where l.estado <> 'descartado'), 0) as monto
  from lineas_comision l where l.reporte_id = r.id
) c on true;

alter view v_reportes set (security_invoker = on);

notify pgrst, 'reload schema';
