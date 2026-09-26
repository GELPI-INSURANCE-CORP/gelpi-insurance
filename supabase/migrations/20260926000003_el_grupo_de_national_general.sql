-- =========================================================
-- National General: el mismo caso que Kemper
-- =========================================================
-- Medido sobre el statement de agosto ANTES de subirlo. La hoja "Summary Details" trae 31
-- transacciones de póliza; cruzadas contra el Book:
--
--   23 de 31 por número de póliza exacto   -> TODAS bajo "Direct Gen Ins Co"
--    2 más por el nombre del asegurado
--    6 sin rastro
--
-- Y las 23 están bajo una compañía que NO es la del statement. En la base, el grupo está
-- repartido en cinco registros y tres de ellos están vacíos:
--
--   Direct Gen Ins Co      40 pólizas   <- acá está todo
--   National Gen Ins Co     2
--   Integon Natl Ins Co     1
--   National General        0
--   Direct Auto             0
--
-- Subiendo el statement como "National General" cruzaría contra cero. Es exactamente lo que le
-- pasó a Kemper, y se resuelve con el mismo mecanismo: declarar el grupo, sin fusionar nada.
--
-- Allstate queda AFUERA a propósito. Compró National General, y en el Book hay pólizas con
-- "MGA: Allstate Ins Grp" y "Writing Carrier: National Gen Ins Co". Pero si los statements de
-- Allstate son negocio aparte, meterlos en el mismo grupo mezclaría dos cosas distintas. Esa es
-- una decisión del negocio, no del código: si hace falta, se agrega con una línea.

update aseguradoras set grupo = 'National General'
 where nombre ilike 'national general%'
    or nombre ilike 'national gen %'
    or nombre ilike 'integon%'
    or nombre ilike 'direct gen%'
    or nombre ilike 'direct auto%';

select
  (select count(*) from aseguradoras where grupo = 'National General') as companias,
  (select string_agg(nombre, ', ' order by nombre) from aseguradoras where grupo = 'National General') as cuales,
  (select count(*) from polizas p join aseguradoras a on a.id = p.aseguradora_id
    where a.grupo = 'National General') as polizas_del_grupo,
  (select string_agg(nombre, ', ' order by nombre) from aseguradoras where grupo is not null and grupo <> 'National General') as otros_grupos;

notify pgrst, 'reload schema';
