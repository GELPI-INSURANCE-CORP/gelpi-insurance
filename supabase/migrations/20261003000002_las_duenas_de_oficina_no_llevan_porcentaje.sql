-- =========================================================
-- Las duenas de oficina no llevan porcentaje
-- =========================================================
-- Arturo: *"olvidate del % de Heidi y Thalia porque ellas son las duenas de cada oficina. Thalia
-- y Christian son los duenos de Doral y Heidi es la duena de Miami Lakes."*
--
-- Una duena no cobra un porcentaje sobre lo que vende: se queda con lo que deja su oficina,
-- menos el royalty que le paga a la casa matriz. Mezclarla con los agentes en la pantalla de
-- pago no es solo ruido, es peligroso: las dos tenian el porcentaje en 100 y el sistema les
-- mostraba $101,665.42 y $91,505.03 "a pagar". Un clic en Cerrar mes y eso quedaba congelado.
--
-- POR QUE UNA COLUMNA Y NO oficinas.gerente_agente_id, QUE YA EXISTE. Porque esa columna tiene
-- lugar para una sola persona por oficina y Doral tiene dos duenos, Thalia y Christian. Hoy
-- Doral apunta a Christian, asi que Thalia quedaria afuera -- y Thalia es justamente una de las
-- dos que el nombro. Un dueno es una propiedad de la persona, no un puesto unico de la oficina.
--
-- Solo se marcan los tres que nombro. Santiago Vidal figura como gerente de Palmetto Bay y
-- Arturo como gerente de la corporativa, pero gerente no es dueno y eso no lo decide una
-- migracion: queda preguntado.

alter table agentes
  add column if not exists es_dueno_oficina boolean not null default false;

comment on column agentes.es_dueno_oficina is
  'true = es dueno/a de su oficina, no un agente al que se le liquida un porcentaje. La pantalla '
  'de pago le muestra la produccion (que cuenta para el royalty de la oficina) pero no le calcula '
  'un pago, porque el dueno se queda con lo que deja su oficina menos el royalty.';

update agentes
   set es_dueno_oficina = true
 where nombre ilike 'Heidi Vilan%'
    or nombre ilike 'Thalia Rodriguez%'
    or nombre ilike 'Christian Alvarez%';

notify pgrst, 'reload schema';

-- ---------------------------------------------------------
-- Comprobacion
-- ---------------------------------------------------------
select string_agg(a.nombre || ' (' || coalesce(o.nombre, 'sin oficina') || ')', ', ' order by a.nombre)
  as duenos_marcados
from agentes a
left join oficinas o on o.id = a.oficina_id
where a.es_dueno_oficina;
