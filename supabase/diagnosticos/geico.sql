-- =========================================================
-- DIAGNÓSTICO GEICO — solo lee, no cambia nada
-- =========================================================
-- Pegá esto entero en el SQL Editor y dale Run. Devuelve una tabla con una fila por chequeo.
-- Mandame el resultado completo.
--
-- Está escrito para que funcione AUNQUE la migración 011 no se haya corrido: en vez de leer
-- la columna nueva directamente (lo que haría fallar la consulta entera si no existe), la lee
-- a través de to_jsonb, que devuelve null cuando la columna no está.

with rep as (
  select * from reportes order by created_at desc limit 1
),
aseg as (
  select a.* from aseguradoras a join rep r on r.aseguradora_id = a.id
),
lin as (
  select l.* from lineas_comision l join rep r on r.id = l.reporte_id
),
pol as (
  select p.* from polizas p join rep r on r.aseguradora_id = p.aseguradora_id
)
select * from (

  select 1 as n, '1. Migración 011 corrida' as chequeo,
    case when exists (select 1 from information_schema.columns
                       where table_name = 'aseguradoras' and column_name = 'regla_numero_poliza')
         then 'SÍ: la columna regla_numero_poliza existe' else 'NO: la columna NO existe' end
    || ' | función normalizar_poliza_con_regla: '
    || case when exists (select 1 from pg_proc where proname = 'normalizar_poliza_con_regla')
            then 'SÍ' else 'NO' end as resultado

  union all select 2, '2. Reporte más reciente',
    coalesce((select coalesce(nombre_archivo, '(sin nombre)') || ' | tipo=' || coalesce(tipo,'?')
              || ' | estado=' || coalesce(estado,'?') || ' | periodo=' || coalesce(periodo,'(vacío)')
              || ' | error=' || coalesce(error,'(ninguno)')
              from rep), 'no hay reportes')

  union all select 3, '3. Aseguradora del reporte',
    coalesce((select nombre || ' | id=' || id::text
              || ' | regla=' || coalesce(to_jsonb(aseg.*)->>'regla_numero_poliza', '(columna no existe)')
              from aseg), 'EL REPORTE NO TIENE ASEGURADORA')

  union all select 4, '4. Líneas del reporte',
    (select count(*)::text || ' líneas | con agente: ' || count(agente_id)::text
     || ' | sin agente: ' || count(*) filter (where agente_id is null)::text from lin)

  union all select 5, '5. Estados de las líneas',
    coalesce((select string_agg(estado || '=' || c::text, '  ' order by c desc)
              from (select estado, count(*) c from lin group by estado) x), '(ninguna)')

  union all select 6, '6. Regla de match',
    coalesce((select string_agg(coalesce(regla_match,'(null)') || '=' || c::text, '  ' order by c desc)
              from (select regla_match, count(*) c from lin group by regla_match) x), '(ninguna)')

  union all select 7, '7. Tipo de transacción (¿separó renovaciones?)',
    coalesce((select string_agg(coalesce(tipo_transaccion,'(null)') || '=' || c::text, '  ' order by c desc)
              from (select tipo_transaccion, count(*) c from lin group by tipo_transaccion) x), '(ninguna)')

  union all select 8, '8. Tasa (%)',
    (select 'con tasa: ' || count(tasa)::text || ' | en null: '
            || count(*) filter (where tasa is null)::text
            || ' | valores: ' || coalesce((select string_agg(distinct tasa::text, ', ') from lin where tasa is not null), '—')
     from lin)

  union all select 9, '9. Monto total del reporte',
    (select '$' || coalesce(sum(monto), 0)::text || '  (GEICO dice $35,718.01)'
     from lin where estado is distinct from 'descartado')

  union all select 10, '10. Muestra: número crudo -> normalizado',
    coalesce((select string_agg(txt, '   |   ') from (
      select coalesce(numero_poliza_crudo,'(null)') || ' -> ' || coalesce(numero_normalizado,'(null)') as txt
      from lin where numero_poliza_crudo is not null limit 3) y), '(sin números)')

  union all select 11, '11. Pólizas en el Book de esa aseguradora',
    (select count(*)::text || ' pólizas | con agente: ' || count(agente_id)::text from pol)

  union all select 12, '12. Muestra del Book: número -> normalizado',
    coalesce((select string_agg(txt, '   |   ') from (
      select coalesce(numero_poliza,'(null)') || ' -> ' || coalesce(numero_normalizado,'(null)') as txt
      from pol limit 3) y), '(el Book no tiene pólizas de esta aseguradora)')

  -- Este es EL número: cuántas líneas del statement encuentran su póliza en el Book.
  union all select 13, '13. >>> LÍNEAS QUE ENCUENTRAN SU PÓLIZA EN EL BOOK <<<',
    (select count(*)::text || ' de ' || (select count(*) from lin where numero_normalizado is not null)::text
     from lin l where l.numero_normalizado is not null
       and exists (select 1 from pol p where p.numero_normalizado = l.numero_normalizado))

  -- Y si se cortara en el guion a mano, ¿cuántas encontrarían? Si este número es mucho mayor
  -- que el de arriba, la regla no se está aplicando.
  union all select 14, '14. Cuántas encontrarían CORTANDO en el guion',
    (select count(*)::text || ' de ' || (select count(*) from lin where numero_poliza_crudo is not null)::text
     from lin l where l.numero_poliza_crudo is not null
       and exists (select 1 from pol p
                   where p.numero_normalizado = normalizar_poliza(split_part(l.numero_poliza_crudo, '-', 1))))

  union all select 15, '15. Todas las aseguradoras que se llaman GEICO',
    coalesce((select string_agg(
        a.nombre || ' (id=' || left(a.id::text, 8) || '…, regla='
        || coalesce(to_jsonb(a.*)->>'regla_numero_poliza','(no existe)')
        || ', pólizas=' || (select count(*) from polizas p where p.aseguradora_id = a.id)::text || ')',
        E'\n')
      from aseguradoras a where a.nombre ilike '%geico%'), 'no hay ninguna aseguradora con GEICO en el nombre')

  union all select 16, '16. Excepciones abiertas de este reporte',
    coalesce((select string_agg(tipo || '=' || c::text, '  ' order by c desc) from (
      select e.tipo, count(*) c from excepciones e
      join lin l on l.id = e.linea_comision_id
      where e.estado in ('pendiente','en_espera') group by e.tipo) z), '(ninguna)')

  -- polizas tiene unique (aseguradora_id, numero_normalizado). Si al cortar en el guion dos
  -- pólizas distintas del Book quedaran con el mismo número, la migración 011 falla entera al
  -- recalcular y NO queda nada aplicado. Este chequeo lo dice antes de intentarlo.
  union all select 17, '17. Cortar en el guion, ¿choca con alguna póliza del Book?',
    coalesce((select 'SÍ, ' || count(*)::text || ' choques — la migración 011 fallaría'
              from (select p.aseguradora_id, normalizar_poliza(split_part(p.numero_poliza,'-',1)) as corto
                    from polizas p
                    join aseguradoras a on a.id = p.aseguradora_id
                    where a.nombre ilike '%geico%'
                    group by 1,2 having count(*) > 1) k
              having count(*) > 0),
             'No, ningún choque: se puede recalcular sin problema')

) d order by n;
