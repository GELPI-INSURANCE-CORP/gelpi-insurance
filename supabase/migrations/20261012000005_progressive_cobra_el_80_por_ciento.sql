-- =========================================================
-- Progressive cobra el 80 por ciento
-- =========================================================
-- Arturo mando la pantalla del "MVR Chargeback Report" de Progressive, agent code 04BW4,
-- septiembre 2026. Dice, con todas las letras:
--
--   "MVR chargeback has been reduced to 80%. As of September 1, 2024 agents will be charged
--    80% of the MVR registry fee for unsold MVRs if they do not meet their threshold."
--
--   Personal Lines    $2,154.00
--   Commercial Lines    $112.00
--   Monthly Total     $1,812.80
--
-- $2,154.00 + $112.00 = $2,266.00, que es EXACTAMENTE lo que suman las 389 lineas del archivo
-- de MVR que subimos. Y $2,266.00 x 0.80 = $1,812.80, que es EXACTAMENTE el "MVR FEE" que
-- Progressive descuenta dentro del statement de comisiones.
--
-- O sea que las dos cifras que parecian un doble cobro son la misma plata: el archivo trae la
-- tarifa de lista y la compania cobra el 80%. El sistema estaba repartiendo $453.20 de mas
-- entre las oficinas.
--
-- La correccion no va a fuego en el codigo. Es 80% desde septiembre de 2024, puede cambiar, y
-- ademas es condicional ("if they do not meet their threshold"): si algun mes la agencia llega
-- al umbral, el cobro puede ser otro. Por eso el porcentaje vive en la compania, se puede
-- cambiar desde la base sin tocar una linea de codigo, y lo que manda para verificar siempre va
-- a ser el MVR FEE del statement.

alter table aseguradoras
  add column if not exists factor_mvr numeric(5,4) not null default 1.0
  check (factor_mvr > 0 and factor_mvr <= 1);

comment on column aseguradoras.factor_mvr is
  'Que proporcion de la tarifa del archivo de MVR cobra realmente esta compania. Progressive '
  'manda la tarifa de lista y cobra el 80%, asi que vale 0.80; las demas mandan ya lo que '
  'cobran y valen 1. Se aplica al INSERTAR la linea, asi que volver a leer el archivo da el '
  'mismo resultado. Si Progressive cambia el porcentaje, se cambia aca y se vuelve a leer.';

update aseguradoras set factor_mvr = 0.80
 where nombre ilike '%progressive%' and factor_mvr is distinct from 0.80;

-- ---------------------------------------------------------
-- Aplicarlo al entrar
-- ---------------------------------------------------------
-- Va en el trigger que ya normaliza la linea, y SOLO al insertar: en un update volveria a
-- multiplicar y cada edicion a mano iria achicando el monto sin que nadie lo note.
create or replace function lineas_costo_normalizar() returns trigger
language plpgsql as $fn$
declare
  v_ap text; v_pi text; v_factor numeric;
begin
  new.es_comercial := coalesce(nullif(trim(coalesce(new.asegurado_crudo,'')), ''), 'N/A') = 'N/A';

  v_ap := normalizar_nombre(split_part(coalesce(new.asegurado_crudo,''), ',', 1));
  v_pi := normalizar_nombre(substr(coalesce(new.asegurado_crudo,''),
            length(split_part(coalesce(new.asegurado_crudo,''), ',', 1)) + 2));

  new.apellido_norm  := v_ap;
  new.apellido_pre13 := left(coalesce(v_ap,''), 13);
  new.pila_norm      := split_part(coalesce(v_pi,''), ' ', 1);
  new.nombre_normalizado := nullif(trim(coalesce(v_pi,'') || ' ' || coalesce(v_ap,'')), '');
  new.conductor_norm := normalizar_nombre(
    substr(coalesce(new.conductor_crudo,''),
           length(split_part(coalesce(new.conductor_crudo,''), ',', 1)) + 2)
    || ' ' || split_part(coalesce(new.conductor_crudo,''), ',', 1));

  -- El porcentaje que cobra la compania de verdad.
  if TG_OP = 'INSERT' then
    select coalesce(a.factor_mvr, 1) into v_factor
      from reportes r left join aseguradoras a on a.id = r.aseguradora_id
     where r.id = new.reporte_id;
    if coalesce(v_factor, 1) <> 1 then
      new.monto := round(coalesce(new.monto, 0) * v_factor, 2);
    end if;
  end if;

  return new;
end $fn$;

-- ---------------------------------------------------------
-- Y a lo que ya esta cargado
-- ---------------------------------------------------------
-- Una sola vez, sobre las lineas de Progressive que entraron con la tarifa de lista. Es un
-- UPDATE, asi que el trigger no vuelve a aplicar el factor.
update lineas_costo c
   set monto = round(c.monto * a.factor_mvr, 2)
  from reportes r
  join aseguradoras a on a.id = r.aseguradora_id
 where c.reporte_id = r.id
   and r.tipo = 'mvr'
   and a.factor_mvr <> 1;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------
-- Comprobacion
-- ---------------------------------------------------------
-- Lo que tiene que dar: Progressive $1,812.80, igual al MVR FEE de su statement.
select coalesce(a.nombre,'-')        as compania,
       a.factor_mvr                  as cobra_el,
       count(*)                      as cargos,
       round(sum(c.monto), 2)        as monto
  from lineas_costo c
  join reportes r on r.id = c.reporte_id
  left join aseguradoras a on a.id = r.aseguradora_id
 group by 1, 2
union all
select 'TOTAL', null, count(*), round(sum(monto),2) from lineas_costo
 order by 4 desc;
