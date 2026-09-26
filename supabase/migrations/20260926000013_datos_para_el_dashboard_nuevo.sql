-- =========================================================
-- Lo que le falta al dashboard para mostrar de verdad
-- =========================================================
-- El dashboard nuevo tiene tarjetas con una línea de tendencia y una gráfica de prima por ramo.
-- Ninguno de esos dos datos existía, y dibujar una tendencia inventada en una pantalla donde se
-- mira plata es peor que no dibujar nada: se ve igual de bonita y no significa nada.
--
-- Así que acá están los dos, calculados sobre datos reales del Book.

-- ---------------------------------------------------------
-- 1. Cómo venía el Book mes a mes
-- ---------------------------------------------------------
-- Una póliza estaba activa en un mes si ya había entrado en vigencia y todavía no había vencido.
-- Con eso se reconstruye la serie hacia atrás sin necesidad de haber guardado una foto cada mes.
--
-- Las pólizas sin fecha de vigencia no se pueden ubicar en el tiempo y quedan fuera de la serie
-- (siguen contando en el total de hoy, que se calcula aparte). Por eso el último punto de la
-- línea puede no coincidir exactamente con el número grande de la tarjeta: la línea es la forma
-- de la curva, no el total.
create or replace function serie_mensual_book(p_meses int default 12)
returns table (mes date, polizas bigint, prima numeric)
language sql stable as $fn$
  with meses as (
    select (date_trunc('month', current_date) - (n || ' months')::interval)::date as mes
    from generate_series(p_meses - 1, 0, -1) as n
  )
  select m.mes,
         count(p.id) as polizas,
         coalesce(sum(p.prima), 0) as prima
  from meses m
  left join polizas p
    on p.fecha_vigencia is not null
   and p.fecha_vigencia <= (m.mes + interval '1 month - 1 day')::date
   and (p.fecha_vencimiento is null or p.fecha_vencimiento >= m.mes)
   and coalesce(p.estado, '') <> 'cancelada'
  group by m.mes
  order by m.mes;
$fn$;

-- ---------------------------------------------------------
-- 2. La prima del Book repartida por ramo
-- ---------------------------------------------------------
-- Para la gráfica de dona. Los ramos con poca plata se juntan en "Otros" del lado del navegador,
-- no acá: así la pantalla puede decidir cuántos mostrar sin que haya que tocar la base.
create or replace function prima_por_ramo()
returns table (ramo text, polizas bigint, prima numeric)
language sql stable as $fn$
  select coalesce(nullif(btrim(p.ramo), ''), 'Sin clasificar') as ramo,
         count(*) as polizas,
         coalesce(sum(p.prima), 0) as prima
  from polizas p
  where coalesce(p.estado, '') <> 'cancelada'
  group by 1
  having coalesce(sum(p.prima), 0) > 0
  order by prima desc;
$fn$;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------
-- Qué devuelven
-- ---------------------------------------------------------
select 'serie del book' as que,
       count(*)::text as puntos,
       min(mes)::text as desde,
       max(mes)::text as hasta,
       '$' || round(max(prima), 2)::text as prima_mas_alta
from serie_mensual_book(12)
union all
select 'prima por ramo',
       count(*)::text,
       min(ramo),
       max(ramo),
       '$' || round(sum(prima), 2)::text
from prima_por_ramo();
