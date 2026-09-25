-- =========================================================
-- Un statement pertenece a un mes: el suyo
-- =========================================================
-- El dashboard agrupaba por la fecha de CADA LÍNEA, y una línea trae la fecha de su transacción,
-- no la del statement. Resultado medido hoy:
--
--   United "Agosto 2026"      ->  enero 119 líneas, julio 1, agosto 49, septiembre 50
--   Progressive "JULY 2026"   ->  mayo 1, junio 7, julio 188, agosto 58, septiembre 2
--   Progressive "2026-08"     ->  junio 1, julio 5, agosto 143, septiembre 29
--   Responsive "2026-09"      ->  agosto 34, septiembre 18
--
-- Cada statement repartido en cinco meses. Por eso, parado en septiembre, el dashboard mostraba
-- $2,952.80 cuando había $45,863.69 conciliados. El número no era chico: era de otra cosa.
--
-- Un statement es de un mes. El de agosto de United es de agosto aunque adentro traiga una
-- cancelación de una póliza de enero — esa cancelación se la cobran en agosto.

-- ---------------------------------------------------------
-- Interpretar el período que quedó guardado
-- ---------------------------------------------------------
-- El período se guarda como texto libre porque así lo devuelve la IA y así lo escribe el usuario:
-- "Agosto 2026", "JULY 2026", "2026-08", "08/2026". Se normaliza al primer día del mes.
-- Devuelve null cuando no se entiende, y ahí el llamador vuelve a la fecha de la línea.
create or replace function mes_del_periodo(p text)
returns date language plpgsql immutable as $$
declare
  s text := lower(trim(coalesce(p, '')));
  anio int;
  mes int;
  nombre text;
  meses text[] := array[
    'ene|jan', 'feb', 'mar', 'abr|apr', 'may', 'jun',
    'jul', 'ago|aug', 'sep|set', 'oct', 'nov', 'dic|dec'
  ];
begin
  if s = '' then return null; end if;

  -- 2026-08 / 2026-08-01 / 2026/08
  if s ~ '^\d{4}[-/]\d{1,2}' then
    anio := split_part(regexp_replace(s, '[/]', '-', 'g'), '-', 1)::int;
    mes  := split_part(regexp_replace(s, '[/]', '-', 'g'), '-', 2)::int;
  -- 08/2026 / 8-2026
  elsif s ~ '^\d{1,2}[-/]\d{4}' then
    mes  := split_part(regexp_replace(s, '[/]', '-', 'g'), '-', 1)::int;
    anio := split_part(regexp_replace(s, '[/]', '-', 'g'), '-', 2)::int;
  -- 202608
  elsif s ~ '^\d{6}$' then
    anio := substr(s, 1, 4)::int;
    mes  := substr(s, 5, 2)::int;
  else
    -- "agosto 2026", "JULY 2026", "ago-26": nombre de mes en español o inglés + año.
    anio := nullif((regexp_match(s, '(\d{4})'))[1], '')::int;
    if anio is null then
      -- Año de dos cifras al final ("ago-26"). Se asume 20xx: este sistema no procesa statements
      -- del siglo pasado.
      anio := nullif((regexp_match(s, '(\d{2})\s*$'))[1], '')::int;
      if anio is not null then anio := 2000 + anio; end if;
    end if;
    for i in 1 .. 12 loop
      nombre := meses[i];
      if s ~ ('(^|[^a-z])(' || nombre || ')') then mes := i; exit; end if;
    end loop;
  end if;

  if anio is null or mes is null then return null; end if;
  if mes < 1 or mes > 12 then return null; end if;
  -- Mismo freno que en la extracción: un año fuera de rango es un error de lectura, no un dato.
  if anio < 1900 or anio > 2200 then return null; end if;

  return make_date(anio, mes, 1);
end $$;

-- ---------------------------------------------------------
-- El dashboard agrupa por el mes del statement
-- ---------------------------------------------------------
create or replace function resumen_kpis(
  p_desde date default date_trunc('month', current_date)::date,
  p_hasta date default (date_trunc('month', current_date) + interval '1 month - 1 day')::date
) returns jsonb language sql stable as $$
  with lc as (
    -- El mes lo manda el período del statement. La fecha de la línea queda solo como respaldo
    -- para los reportes viejos que no tienen período escrito.
    select *
    from v_lineas_comision
    where coalesce(mes_del_periodo(periodo), fecha_statement, created_at::date)
          between p_desde and p_hasta
  ), ex as (select * from v_excepciones where estado = 'pendiente')
  select jsonb_build_object(
    'conciliado', (select coalesce(sum(monto),0) from lc where estado in ('conciliado_auto','conciliado_confirmado','cuenta_casa')),
    'sin_identificar', jsonb_build_object('monto', (select coalesce(sum(monto),0) from ex where tipo='sin_identificar'), 'n', (select count(*) from ex where tipo='sin_identificar')),
    'mismatch', jsonb_build_object('monto', (select coalesce(sum(monto),0) from ex where tipo='mismatch'), 'n', (select count(*) from ex where tipo='mismatch')),
    'duplicados', jsonb_build_object('monto', (select coalesce(sum(monto),0) from ex where tipo='duplicado'), 'n', (select count(*) from ex where tipo='duplicado')),
    'conflictos', (select count(*) from ex where tipo='conflicto_venta'),
    'total_disputa', jsonb_build_object('monto', (select coalesce(sum(monto),0) from ex), 'n', (select count(*) from ex)),
    'por_oficina', (select coalesce(jsonb_agg(jsonb_build_object('oficina', o.nombre, 'oficina_id', o.id, 'comision', coalesce(s.monto,0), 'excepciones', coalesce(x.n,0), 'antiguedad', coalesce(x.dias,0)) order by o.nombre), '[]'::jsonb)
                    from oficinas o
                    left join (select oficina_id, sum(monto) monto from lc where estado in ('conciliado_auto','conciliado_confirmado','cuenta_casa') group by oficina_id) s on s.oficina_id = o.id
                    left join (select oficina_sugerida_id, count(*) n, round(avg(antiguedad_dias)) dias from ex group by oficina_sugerida_id) x on x.oficina_sugerida_id = o.id),
    'por_aseguradora', (select coalesce(jsonb_agg(jsonb_build_object('aseguradora', aseguradora, 'comision', monto) order by monto desc), '[]'::jsonb)
                        from (select aseguradora, sum(monto) monto from lc where estado in ('conciliado_auto','conciliado_confirmado','cuenta_casa') group by aseguradora) t),
    'agentes_con_comision', (select count(distinct agente_id) from lc where agente_id is not null)
  );
$$;

-- ---------------------------------------------------------
-- Qué meses tienen statements, para poder ofrecerlos en el selector
-- ---------------------------------------------------------
-- Hoy el selector ofrece meses del calendario, tenga o no datos, y el usuario se encuentra con
-- pantallas vacías sin saber si es que no hay nada o si algo se rompió.
create or replace view v_meses_con_statements as
select mes,
       count(*) as statements,
       sum(lineas) as lineas
from (
  select coalesce(
           mes_del_periodo(r.periodo),
           date_trunc('month', min(l.fecha_statement))::date,
           date_trunc('month', r.created_at)::date
         ) as mes,
         count(l.id) as lineas
  from reportes r
  join lineas_comision l on l.reporte_id = r.id
  where r.tipo = 'comision_aseguradora'
  group by r.id, r.periodo, r.created_at
) t
where mes is not null
group by mes
order by mes desc;

alter view v_meses_con_statements set (security_invoker = on);

notify pgrst, 'reload schema';
