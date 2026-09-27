-- =========================================================
-- Un solo formato de período
-- =========================================================
-- Los statements tienen el período escrito de dos maneras según quién los subió y cuándo:
--
--   "Agosto 2026"   GEICO, Kemper, National General, United Automobile
--   "JULY 2026"     Progressive de julio
--   "2026-08"       Progressive y Responsive de agosto, y el Book
--
-- Hoy funciona porque mes_del_periodo() entiende las tres formas. Pero ya hubo un accidente por
-- esto: las 31 líneas de National General se fueron a enero porque el período decía "Agosto 2026"
-- y el JavaScript que lo leyó devolvió el año con enero por defecto. El parser de SQL aguanta;
-- el problema es que el dato guardado admite cualquier cosa, y cada lugar nuevo que lo lea tiene
-- que volver a adivinar.
--
-- Se normaliza todo a YYYY-MM: ordena bien alfabéticamente, no depende del idioma, y es lo que
-- ya venía guardando la pantalla de subir desde que tiene los desplegables de mes y año.
--
-- NO CAMBIA NINGÚN MES. El valor nuevo sale de mes_del_periodo() sobre el valor viejo, o sea del
-- mismo parser que ya se estaba usando para decidir a qué mes pertenece cada línea. Medido antes
-- de tocar nada: "Agosto 2026" -> 2026-08 (4 reportes), "JULY 2026" -> 2026-07 (1), "2026-08" y
-- "2026-09" se quedan igual (4). Los 2 reportes con período nulo siguen nulos: no hay de dónde
-- sacarlo, y los cálculos ya caen a fecha_statement para esos.

-- ---------------------------------------------------------
-- 1. Lo que ya está guardado
-- ---------------------------------------------------------
update reportes
   set periodo = to_char(mes_del_periodo(periodo), 'YYYY-MM')
 where periodo is not null
   and mes_del_periodo(periodo) is not null
   and periodo <> to_char(mes_del_periodo(periodo), 'YYYY-MM');

-- ---------------------------------------------------------
-- 2. Que no se vuelva a mezclar
-- ---------------------------------------------------------
-- El trigger y no un check: un check rechazaría "Agosto 2026" y rompería la carga, cuando lo que
-- hay que hacer es entenderlo y guardarlo bien. Si viene algo que el parser no reconoce se deja
-- pasar tal cual — es preferible un período raro a perder el reporte, y así queda a la vista
-- para arreglarlo a mano.
create or replace function normalizar_periodo_reporte()
returns trigger language plpgsql as $fn$
begin
  if new.periodo is not null and mes_del_periodo(new.periodo) is not null then
    new.periodo := to_char(mes_del_periodo(new.periodo), 'YYYY-MM');
  end if;
  return new;
end $fn$;

drop trigger if exists trg_normalizar_periodo on reportes;
create trigger trg_normalizar_periodo
  before insert or update of periodo on reportes
  for each row execute function normalizar_periodo_reporte();

-- ---------------------------------------------------------
-- Cómo quedó
-- ---------------------------------------------------------
select string_agg(l, '   |   ' order by l) as despues from (
  select coalesce(periodo, '(sin período)') || ' -> ' || count(*) || ' reportes' as l
  from reportes group by periodo
) s;
