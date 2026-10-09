-- =========================================================
-- DIAGNOSTICO: la diferencia de ~$190 en GEICO septiembre de DORAL
-- =========================================================
-- Solo LEE. No cambia nada. Pegalo entero en el SQL Editor y dale Run.
--
-- LO QUE YA SE SABE, leido de los archivos de Excel:
--
--   GEICO SEP MASTER.xlsx cuadra con su propia caratula: $40,129.88
--   Filtrado a los agentes que GEICO llama Doral (Thalia Rodriguez + Christian Alvarez):
--     279 lineas | prima $106,793.37 | comision $14,336.45
--   GEICO SEP DORAL.xlsx es identico a eso, linea por linea. Cero diferencias.
--
--   => GEICO pago $14,336.45 por la produccion que GEICO atribuye a Doral en septiembre.
--
-- POR QUE EL SISTEMA PUEDE DECIR OTRA COSA, legitimamente: en GEICO el sistema reparte por
-- numero de poliza contra el Book, no por el nombre que manda GEICO (migracion 20260926000004).
-- Y el estado de cuenta de la oficina solo suma lineas en 'conciliado_auto' o
-- 'conciliado_confirmado' (migracion 20260927000004, linea 46). Una linea de Doral en cualquier
-- otro estado no entra en el total de Doral.
--
-- LOS DOS CANDIDATOS DE ~$190, los dos NEGATIVOS, los dos de Thalia:
--
--   -$190.03  pol 6272812261  HECTOR RIVERO CLIMENT       First Year, sin codigo, fila 122
--   -$190.55  pol 6224347382  FRANCISCO SARMIENTO ANGULO  Renewal, "Cancel",    fila 646
--
-- Si el sistema se come una de esas dos, Doral aparece cobrando ~$190 MAS de lo que GEICO pago,
-- y se le paga de mas. Esta consulta dice cual de las dos es, y por que.

with geico as (
  select a.id
    from aseguradoras a
   where a.nombre ilike '%geico%'
      or exists (select 1 from aseguradora_alias al
                  where al.aseguradora_id = a.id and al.texto ilike '%geico%')
),
rep as (
  select r.*
    from reportes r
   where r.aseguradora_id in (select id from geico)
     and coalesce(mes_del_periodo(r.periodo), r.created_at::date)
         >= date '2026-09-01'
     and coalesce(mes_del_periodo(r.periodo), r.created_at::date)
         <  date '2026-10-01'
),
lin as (
  select l.*,
         coalesce(l.oficina_id, ag.oficina_id) as of_id,
         ag.nombre as agente_nombre
    from lineas_comision l
    left join agentes ag on ag.id = l.agente_id
   where l.reporte_id in (select id from rep)
),
doral as (
  select id from oficinas where nombre ilike '%doral%'
)
select * from (

  select 1 as n, 'A. Statements de GEICO de septiembre cargados' as chequeo,
    coalesce((select string_agg(coalesce(nombre_archivo,'(sin nombre)')
                 || ' | periodo=' || coalesce(periodo,'(vacio)')
                 || ' | estado=' || coalesce(estado,'?')
                 || ' | lineas=' || total_lineas, '  ||  ')
              from rep), 'NO HAY NINGUNO CARGADO') as resultado

  union all select 2, 'B. Total de DORAL que el sistema cuenta (solo conciliadas)',
    coalesce((select 'lineas=' || count(*)
                || ' | prima=' || round(coalesce(sum(prima),0),2)
                || ' | comision=' || round(coalesce(sum(monto),0),2)
              from lin
             where of_id in (select id from doral)
               and estado in ('conciliado_auto','conciliado_confirmado')),
             'sin lineas')

  union all select 3, 'C. Total de DORAL contando TODOS los estados',
    coalesce((select 'lineas=' || count(*)
                || ' | prima=' || round(coalesce(sum(prima),0),2)
                || ' | comision=' || round(coalesce(sum(monto),0),2)
              from lin where of_id in (select id from doral)), 'sin lineas')

  union all select 4, 'D. GEICO pago por Doral (de los Excel)',
    'lineas=279 | prima=106793.37 | comision=14336.45'

  union all select 5, 'E. DORAL por estado (aca se ve que queda afuera)',
    coalesce((select string_agg(estado || ': ' || c || ' lineas, $' || m, '  |  ' order by m)
              from (select estado, count(*) c, round(sum(monto),2) m
                      from lin where of_id in (select id from doral)
                     group by estado) t), 'sin lineas')

  union all select 6, 'F. Lineas de DORAL que NO entran en el total',
    coalesce((select string_agg(
                 estado || ' | pol ' || coalesce(numero_normalizado,'?')
                 || ' | ' || coalesce(nombre_asegurado_crudo,'?')
                 || ' | $' || monto, '  ||  ' order by monto)
              from lin
             where of_id in (select id from doral)
               and estado not in ('conciliado_auto','conciliado_confirmado')),
             'NINGUNA: todas las lineas de Doral estan conciliadas')

  union all select 7, 'G. CANDIDATO 1 - HECTOR RIVERO CLIMENT (6272812261)',
    coalesce((select string_agg(
                 'estado=' || estado || ' | $' || monto
                 || ' | tipo=' || tipo_transaccion
                 || ' | agente=' || coalesce(agente_nombre,'(ninguno)')
                 || ' | oficina=' || coalesce((select nombre from oficinas o where o.id = of_id),'(ninguna)'),
                 '  ||  ')
              from lin where numero_normalizado like '6272812261%'),
             'NO ESTA EN LA BASE: el sistema nunca cargo esta linea')

  union all select 8, 'H. CANDIDATO 2 - FRANCISCO SARMIENTO ANGULO (6224347382)',
    coalesce((select string_agg(
                 'estado=' || estado || ' | $' || monto
                 || ' | tipo=' || tipo_transaccion
                 || ' | agente=' || coalesce(agente_nombre,'(ninguno)')
                 || ' | oficina=' || coalesce((select nombre from oficinas o where o.id = of_id),'(ninguna)'),
                 '  ||  ')
              from lin where numero_normalizado like '6224347382%'),
             'NO ESTA EN LA BASE: el sistema nunca cargo esta linea')

  union all select 9, 'I. Lineas de GEICO sep SIN oficina (no entran en ninguna)',
    coalesce((select string_agg('pol ' || coalesce(numero_normalizado,'?')
                 || ' | ' || coalesce(nombre_asegurado_crudo,'?')
                 || ' | $' || monto || ' | ' || estado, '  ||  ' order by monto)
              from lin where of_id is null), 'ninguna')

) t order by n;
