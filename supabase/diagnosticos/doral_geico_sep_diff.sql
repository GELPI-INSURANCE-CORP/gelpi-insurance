-- =========================================================
-- DIFF DEFINITIVO: GEICO septiembre, DORAL
-- DESPUES del arreglo de Mayra Lopez Herrera (8/oct, noche):
--   el sistema dice DORAL 14,554.18 y MIAMI LAKES 11,756.03  -> suma 26,310.21
--   GEICO por nombre  DORAL 14,336.45 y MIAMI LAKES 11,973.76 -> suma 26,310.21  LA SUMA YA CUADRA
--   lo que queda es un traspaso limpio de +217.73 de Miami Lakes a Doral
-- =========================================================
-- Solo LEE. No cambia nada. Pegalo entero en el SQL Editor y dale Run.
--
-- Abajo estan las 127 polizas (279 lineas, $14336.45) que GEICO
-- atribuye a Doral en septiembre, sacadas de GEICO SEP MASTER.xlsx filtrado a
-- Thalia Rodriguez + Christian Alvarez. Esa lista es exacta: cuadra con la caratula
-- del statement ($40,129.88) y con GEICO SEP DORAL.xlsx linea por linea.
--
-- La consulta compara esa lista contra lo que el sistema le cuenta a Doral y devuelve
-- SOLO las polizas donde no coinciden. La suma de la columna diferencia da los $190.52.

with geico as (
  select a.id from aseguradoras a
   where a.nombre ilike '%geico%'
      or exists (select 1 from aseguradora_alias al
                  where al.aseguradora_id = a.id and al.texto ilike '%geico%')
),
rep as (
  select r.* from reportes r
   where r.aseguradora_id in (select id from geico)
     and coalesce(mes_del_periodo(r.periodo), r.created_at::date) >= date '2026-09-01'
     and coalesce(mes_del_periodo(r.periodo), r.created_at::date) <  date '2026-10-01'
),
doral as (select id from oficinas where nombre ilike '%doral%'),
-- lo que el sistema le cuenta a Doral, poliza por poliza
sis as (
  select l.numero_normalizado as poliza,
         round(sum(l.monto), 2) as com_sistema,
         count(*) as lineas_sistema,
         string_agg(distinct l.estado, '+') as estados
    from lineas_comision l
    left join agentes ag on ag.id = l.agente_id
   where l.reporte_id in (select id from rep)
     and coalesce(l.oficina_id, ag.oficina_id) in (select id from doral)
     and l.estado in ('conciliado_auto', 'conciliado_confirmado')
   group by l.numero_normalizado
),
-- lo que GEICO pago por Doral, poliza por poliza
geo (poliza, com_geico, lineas_geico, asegurado) as (values
  ('6222490226', 0, 4, 'MAYLEN GONZALEZ BARRIOS'),
  ('6222503697', 159.72, 1, 'CARLOS GAVILONDO RODRIGUEZ'),
  ('6222506393', 124.7, 1, 'ADRIAN BROCHE TOLEDO'),
  ('6222513324', 0, 6, 'JONATHAN BRAVO'),
  ('6222553403', 95.16, 1, 'JUSTO FARINAS SANCHEZ'),
  ('6222599026', 178.8, 1, 'ROBERLANDO BROCHE'),
  ('6222653898', 67.5, 1, 'DENISSE LA CARIDAD'),
  ('6222723014', 88.56, 3, 'CHRISTIAN ALVAREZ DEL'),
  ('6222911320', 101, 1, 'JAVIER MARTINEZ'),
  ('6222935931', 54.96, 1, 'MIGUEL MARTINEZ SANCHEZ'),
  ('6222985316', 0, 2, 'AMANDA COMELLAS'),
  ('6223640910', 225.31, 19, 'RAIDEL CARBONELL REYES'),
  ('6223818466', 93.84, 1, 'CARLOS JAIME ALONSO'),
  ('6224043445', 101.28, 1, 'ZULAY LANTIGUA RUANO'),
  ('6224166618', 95.76, 1, 'FELIX HODELIN STUART'),
  ('6224200847', -8.49, 5, 'RAMON OLIVA'),
  ('6224347382', 9.97, 5, 'FRANCISCO SARMIENTO ANGULO'),
  ('6224365012', 354.36, 16, 'JOSE REYES MONTEAGUDO'),
  ('6224541075', 63, 5, 'IVIS TIA GONZALEZ'),
  ('6224639721', 131.76, 1, 'JUDITH FLEITES'),
  ('6225172847', 102.48, 1, 'YAN KEMELL BARRERA CRESPO'),
  ('6225298469', 249.12, 1, 'REINALDO VALLEJO ARIAS'),
  ('6225704557', 279.36, 1, 'ANGEL HERNANDEZ URRUTIA'),
  ('6225967816', 227.23, 5, 'ALEJANDRO CSERNATH LOPEZ'),
  ('6226071030', -3.8, 15, 'JAVIER FIGUEREDO SANCHEZ'),
  ('6226200787', -10.82, 5, 'LAZARA SANCHEZ CERVERA'),
  ('6226304043', 0, 2, 'ALFREDO BORGES ROMERO'),
  ('6226456686', 88.32, 1, 'MIGUEL SEVERIANO BATISTA SAO'),
  ('6226696448', 119.3, 1, 'JEISON AMADOR DIAZ'),
  ('6227122204', -0.18, 1, 'IDALMIS OJEDA GONZALEZ'),
  ('6242546809', 0, 2, 'MARVIN RAMOS MONTANO'),
  ('6243324859', 1.24, 1, 'NORIS NIEVES RODRIGUEZ'),
  ('6245590754', 277.92, 12, 'PETTERS REINA HUNTER'),
  ('6245602021', 10.52, 1, 'JEAN CASTRO LOUZADO'),
  ('6247532218', 136.08, 12, 'RAYKEL PINEIRO CORONA'),
  ('6247563346', -1.07, 5, 'JOSE PRESNO PANTOJA'),
  ('6248815463', 106.6, 1, 'FRANCISCO DEL CAMPO'),
  ('6249493203', 0, 6, 'MAYRA LOPEZ HERRERA'),
  ('6249960128', 142.68, 1, 'MARCOS CARABALLO'),
  ('6251847783', 5.26, 1, 'CARLOS CANTARERO MIRANDA'),
  ('6252723488', 3.49, 1, 'MARIENNID OLIVERA'),
  ('6254726638', 0.92, 1, 'KEVIN HERNANDEZ'),
  ('6255747179', -98.66, 1, 'YONAR BARZAGA LEMUS'),
  ('6256252765', -50.65, 1, 'ROBERTO FIGUEREDO MASABO'),
  ('6257054285', -26.93, 1, 'LUIS BERRU'),
  ('6259535133', -0.46, 2, 'YUSMARA CASTILLO DIAZ'),
  ('6259834981', 2.27, 1, 'YASEL CORDOVI MIRO'),
  ('6260726465', 8.56, 1, 'JORGE BUENO'),
  ('6261198276', 2.5, 1, 'RENE PEDRAZA CONTRERAS'),
  ('6262230581', -29.72, 1, 'CLAUDIA KOWALSKI'),
  ('6262258723', 47.49, 2, 'MANUEL LUGO MURCIA'),
  ('6262967018', -158.14, 1, 'JUAN HERNANDEZ MORALES'),
  ('6263790252', 0.85, 1, 'EUCARIS PEREZ LINARES'),
  ('6264575587', -124.94, 1, 'ANGEL AVEGNO PARRAGA'),
  ('6265088606', -100.11, 1, 'JHOAN CENTENO RODRIGUEZ'),
  ('6266153748', 1.47, 1, 'DIANA CASAS TIZA'),
  ('6267179015', -100.28, 1, 'DIANA PEREZ DOMINGUEZ'),
  ('6267997697', -117.85, 2, 'IRAIMA INFANTE FUENTES'),
  ('6268063846', 3.21, 3, 'YOANNIA REMON RICARDO'),
  ('6269419229', 128.82, 2, 'MILEDYS GARCIA MARTINEZ'),
  ('6270346619', 2.02, 1, 'MIGUEL ARCIS CAPO'),
  ('6270410688', 0.02, 2, 'GABRIEL BRULL MATOS'),
  ('6270500538', -233.27, 1, 'OSVALDO RODRIGUEZ GARCIA'),
  ('6270589630', -1.05, 1, 'GUNJAN ARORA'),
  ('6271057504', -7.5, 1, 'LARISSA CLAUDINE B'),
  ('6271329747', 149.25, 1, 'ANGEL GARCIA'),
  ('6271593961', 6.59, 1, 'MARLON ALVAREZ PRADERES'),
  ('6272063535', 6.57, 5, 'DIONNIS GARCIA MUNIZ'),
  ('6272812261', -184.09, 2, 'HECTOR RIVERO CLIMENT'),
  ('6273239597', 98.2, 1, 'OSMEL TOLEDO VELIZ'),
  ('6273345030', 102.3, 1, 'JUAN CORDERO LEZCANO'),
  ('6273360609', 415.8, 2, 'ROBERTO MUNOZ'),
  ('6273821527', 105.86, 2, 'SAMIR SUAREZ GAMBOA'),
  ('6273938537', 368.3, 4, 'PEDRO MORALES VALDIVIA'),
  ('6273995503', 249.15, 1, 'TYLER BRUNSON'),
  ('6274007241', 211.04, 2, 'BARBARA LAS MERCEDES'),
  ('6274059077', 216.6, 1, 'RACIEL FELIPE VALDES'),
  ('6274070975', 158.26, 5, 'ALEXIS NODAL GARCIA'),
  ('6274086740', 25.86, 4, 'RAUBEL BERNAL CRUZ'),
  ('6274115911', 102.15, 1, 'CHACON GOURGUET'),
  ('6274117818', 91.35, 1, 'ENILDO MACHADO RODRIGUEZ'),
  ('6274202784', 437.55, 1, 'BRYANT JAMES'),
  ('6274211157', 192.15, 1, 'YOHAIRA CORDERO GONZALEZ'),
  ('6274246021', 592.47, 2, 'FELIX RODRIGUEZ ARMAS'),
  ('6274293023', 345.9, 1, 'HENRY GUERRERO CONCEPCION'),
  ('6274379665', 241.2, 1, 'BORIS MOYA MONTEAGUDO'),
  ('6274419248', 234.45, 1, 'HAROLD OLIVERA CASTEX'),
  ('6274442877', 204.3, 1, 'ADLIH MORALES BAEZ'),
  ('6274482998', 233.07, 2, 'JHONNY ZAHLANI ZAMBRANO'),
  ('6274560512', 289.35, 1, 'JORGE DEBROSSE'),
  ('6274636221', 86.4, 1, 'JOHAN ALEXANDER ALVARADO'),
  ('6274763694', 366.75, 2, 'YURI HECHAVARRIA TORRES'),
  ('6274766150', 342.1, 1, 'SEBASTIAN CASTELLANOS'),
  ('6274835567', 272.1, 1, 'YUSNIER MARTINEZ ALMORA'),
  ('6274914032', 132.15, 1, 'MICHAEL LISTA'),
  ('6274922902', 184.95, 1, 'WILLIAM DIAZ SANCHEZ'),
  ('6274977799', 167.7, 1, 'IDALBERTO SAVON PEREZ'),
  ('6275004684', 58.95, 1, 'JORGE ABREU SOSA'),
  ('6275144456', 229.61, 2, 'RUBIEL ALVAREZ ROMAN'),
  ('6275222450', 168.9, 1, 'MARIO LOPEZ'),
  ('6275244165', 102.45, 1, 'ERICK MEJIA ACEITUNO'),
  ('6275254727', 314.1, 1, 'JHONY GARCIA LONDONO'),
  ('6275258140', 141.94, 2, 'EUNICY DIAZ'),
  ('6275269675', 87.75, 1, 'MISHA MALDONADO'),
  ('6275453832', 173.85, 1, 'ROBERTO FALCON FLORES'),
  ('6275640941', 194.25, 1, 'ELVIS LOPEZ QUERALES'),
  ('6275862644', 187.65, 1, 'JEAN GONZALEZ'),
  ('6276031009', 129.6, 1, 'JIMMY ORTEGA'),
  ('6276034946', 188.9, 1, 'SHELLSEA SERNA-QUIROZ'),
  ('6276148829', 137.7, 1, 'ALEJANDRO SARJEANT-ELBITTAR'),
  ('6276152755', 330.08, 5, 'DANAY REYES'),
  ('6276439160', 196.65, 1, 'JUAN ESCALONA GONZALEZ'),
  ('6276439970', 36, 1, 'JUAN ESCALONA BATISTA'),
  ('6276478135', 112.95, 1, 'YAILENE GUERRA FIGUEREDO'),
  ('6276732887', 256.8, 1, 'DANIEL DIAZ ULLOA'),
  ('6276796478', 114.5, 1, 'DIANELIS LOPEZ DIAZ'),
  ('6276825152', 140.4, 1, 'FRANCISCO SARMIENTO ANGULO'),
  ('6276891899', 359.4, 1, 'JAVIER FIGUEREDO SANCHEZ'),
  ('6277041080', 147.3, 1, 'MELANIE FERNANDEZ SONORA'),
  ('6277246267', 98.85, 1, 'LIZ NAVARRO MORENO'),
  ('6277272370', 178.65, 1, 'MARIA SIERRA'),
  ('6277283203', 164.55, 1, 'ROLANDO PINO'),
  ('6277286438', 117.45, 1, 'YUNIEL RUIZ'),
  ('6277314958', 260.1, 1, 'JOSE HERNANDEZ GONZALEZ'),
  ('6277546310', 145.95, 1, 'PAZ GONZALEZ LEON'),
  ('9300213742', 295.9, 5, 'G & J ALUMINUM SERVICES CORP'),
  ('9300294646', 0, 4, 'PUMI PRESTIGE LLC')
)
select
  coalesce(g.poliza, s.poliza)                              as poliza,
  g.asegurado,
  g.com_geico,
  s.com_sistema,
  round(coalesce(s.com_sistema, 0) - coalesce(g.com_geico, 0), 2) as diferencia,
  g.lineas_geico,
  s.lineas_sistema,
  s.estados,
  case
    when s.poliza is null then 'el sistema NO le cuenta esta poliza a Doral'
    when g.poliza is null then 'el sistema le cuenta a Doral una poliza que GEICO atribuye a otro'
    else 'misma poliza, monto distinto'
  end as que_pasa
from geo g
full outer join sis s on s.poliza = g.poliza
where round(coalesce(s.com_sistema, 0) - coalesce(g.com_geico, 0), 2) <> 0
order by abs(round(coalesce(s.com_sistema, 0) - coalesce(g.com_geico, 0), 2)) desc;
