-- =========================================================
-- Progressive: a las oficinas se les cobra lo del archivo
-- =========================================================
-- Arturo, viendo bajar a Miami Lakes y al Doral:
--
--   "Dejalo como estaba lo de Progressive si no estoy pagando yo de mas. Mira como bajo Miami
--    Lakes y como bajo Doral. A ellos se les cobra lo que dice el statement y punto."
--
-- Da marcha atras a 20261012000005, que multiplicaba los MVR de Progressive por 0.80.
--
-- El dato de aquella migracion sigue siendo cierto: Progressive manda la tarifa de lista
-- ($2,266.00) y descuenta el 80% ($1,812.80). Lo que cambio es quien se queda con la
-- diferencia, y eso no es un calculo, es una decision del dueno. El 20% lo perdona Progressive
-- por volumen de la AGENCIA ENTERA -- "if they do not meet their threshold" -- y el volumen lo
-- hacen todas las oficinas juntas. Cada oficina igual causo el MVR a precio de lista, asi que
-- cada oficina paga el precio de lista y el descuento se lo queda la casa, que es la que lo
-- gano. Arturo no pone un peso: paga $1,812.80 y cobra $2,266.00.
--
-- ---------------------------------------------------------
-- Devolver los montos, y que sea exacto
-- ---------------------------------------------------------
-- Volver a leer el archivo seria lo mas simple, pero borra las lineas y se perderian las
-- asignaciones hechas a mano: matchear_costo() respeta las manuales al reprocesar, pero el
-- reproceso de un archivo nuevo empieza por borrar lineas_costo. Asi que se deshace la cuenta.
--
-- Dividir entre 0.80 normalmente NO es reversible -- round(9.02*0.8,2) = 7.22 y 7.22/0.8
-- redondea a 9.03, un centavo de mas. Aca si lo es, y esta comprobado: los MVR de Progressive
-- de septiembre tienen solo cuatro montos distintos y los cuatro dan la vuelta entera:
--
--     ahora     /0.80     vuelve a dar    filas
--      6.40      8.00         6.40         272
--      0.00      0.00         0.00         104
--      5.20      6.50         5.20          12
--      9.60     12.00         9.60           1
--
--   272 x 8.00  =  2,176.00
--    12 x 6.50  =     78.00
--     1 x 12.00 =     12.00
--                 ---------
--                  2,266.00   <-- Personal $2,154.00 + Commercial $112.00 del papel. Clavado.
--
-- El update va ANTES de tocar factor_mvr y pide que siga en 0.80. Si esta migracion se corriera
-- dos veces, la segunda no encuentra nada que cambiar: por eso no infla los montos.

update lineas_costo c
   set monto = round(c.monto / a.factor_mvr, 2)
  from reportes r
  join aseguradoras a on a.id = r.aseguradora_id
 where c.reporte_id = r.id
   and r.tipo = 'mvr'
   and a.factor_mvr = 0.80;

update aseguradoras set factor_mvr = 1.0 where factor_mvr <> 1.0;

-- ---------------------------------------------------------
-- La maquinaria se queda, apagada y con el motivo escrito
-- ---------------------------------------------------------
-- La columna y el trigger no estorban en 1.0 y el dia que Arturo quiera repartir el descuento
-- entre las oficinas es un solo update. Lo que no puede pasar es que alguien la encienda sin
-- saber que no es un bug sino una decision, asi que queda dicho en el comentario.
comment on column aseguradoras.factor_mvr is
  'Que proporcion de la tarifa del archivo de MVR se le cobra a las oficinas. Vale 1 en TODAS, '
  'a proposito. Progressive manda la tarifa de lista y solo descuenta el 80%, pero ese descuento '
  'se lo gana la agencia entera por volumen y se lo queda la casa: cada oficina causo el MVR a '
  'precio de lista y paga precio de lista. Decision de Arturo, 12 de octubre de 2026 -- "a ellos '
  'se les cobra lo que dice el statement y punto". No lo bajes sin preguntarle.';

notify pgrst, 'reload schema';

-- ---------------------------------------------------------
-- Comprobacion
-- ---------------------------------------------------------
-- Progressive tiene que volver a $2,266.00 y el reparto por oficina subir en la misma
-- proporcion en que bajo.
select coalesce(o.nombre, '(pendientes)') as oficina,
       count(*)                           as cargos,
       round(sum(c.monto), 2)             as monto
  from lineas_costo c
  join reportes r on r.id = c.reporte_id
  join aseguradoras a on a.id = r.aseguradora_id
  left join oficinas o on o.id = c.oficina_id
 where a.nombre ilike '%progressive%' and r.tipo = 'mvr'
 group by 1
union all
select 'TOTAL PROGRESSIVE', count(*), round(sum(c.monto), 2)
  from lineas_costo c
  join reportes r on r.id = c.reporte_id
  join aseguradoras a on a.id = r.aseguradora_id
 where a.nombre ilike '%progressive%' and r.tipo = 'mvr'
 order by 3 desc;
