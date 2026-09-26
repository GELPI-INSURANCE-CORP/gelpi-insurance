-- =========================================================
-- GEICO: el guion del número de póliza, y la fecha que distingue
-- =========================================================
-- Medido sobre el statement de GEICO de agosto (487 líneas, $35.718,01) antes de subirlo:
--
--   Statement:  6245490328-449199073
--   Book:       6245490328
--
-- normalizar_poliza() saca los guiones, así que la línea queda como 6245490328449199073 y el
-- Book como 6245490328. No se parecen en nada: 0 de 320 pólizas del statement encontraban su
-- dueño. Cortando en el guion encuentran 264 de 320 — el 83% — y todas esas ya tienen agente
-- asignado en el Book. GEICO es la compañía más grande de la agencia (1.070 pólizas), así que
-- esto es la diferencia entre asignar el statement a mano y que se asigne solo.
--
-- Hay un segundo efecto, que es el que Arturo pidió sin saber que era el mismo problema: Thalia
-- no tiene número de productor en GEICO, así que sus líneas vienen con el nombre de Arturo. Al
-- encontrar la póliza en el Book, el agente sale del Book y no del nombre que trae el archivo:
-- la producción de Thalia deja de aparecer como de Arturo sola, sin tocar nada a mano.
--
-- La regla NO se aplica a todas las compañías. United manda "UAE-000271524", donde el guion es
-- parte del número y cortarlo rompería lo que hoy funciona. Por eso va como una propiedad de
-- cada aseguradora, en 'completo' por defecto: solo cambia el comportamiento de quien se lo
-- pida explícitamente.

-- ---------------------------------------------------------
-- Cómo lee el número cada compañía
-- ---------------------------------------------------------
alter table aseguradoras
  add column if not exists regla_numero_poliza text not null default 'completo';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'aseguradoras_regla_numero_poliza_check') then
    alter table aseguradoras add constraint aseguradoras_regla_numero_poliza_check
      check (regla_numero_poliza in ('completo', 'antes_del_guion'));
  end if;
end $$;

comment on column aseguradoras.regla_numero_poliza is
  'completo = el número de póliza es todo lo que manda la compañía (lo normal). '
  'antes_del_guion = lo que sigue al primer guion es el número interno del movimiento y no de '
  'la póliza, así que se descarta para poder cruzar contra el Book (caso GEICO).';

create or replace function normalizar_poliza_con_regla(p text, p_regla text) returns text
language plpgsql immutable as $$
begin
  if p_regla = 'antes_del_guion' then
    -- split_part con un texto sin guiones devuelve el texto entero, así que el Book de GEICO
    -- —que ya viene sin guion— pasa por acá sin cambiar.
    return normalizar_poliza(split_part(coalesce(p, ''), '-', 1));
  end if;
  return normalizar_poliza(p);
end $$;

-- ---------------------------------------------------------
-- Aplicarla al guardar líneas y pólizas
-- ---------------------------------------------------------
-- La regla vive en la aseguradora, así que el trigger tiene que ir a buscarla: en las líneas,
-- a través del reporte; en las pólizas, directo.
create or replace function lineas_comision_normalizar() returns trigger language plpgsql as $$
declare
  v_aseguradora uuid;
  v_regla text;
begin
  select r.aseguradora_id into v_aseguradora from reportes r where r.id = new.reporte_id;
  select coalesce(a.regla_numero_poliza, 'completo') into v_regla
    from aseguradoras a where a.id = v_aseguradora;

  new.numero_normalizado := normalizar_poliza_con_regla(new.numero_poliza_crudo, coalesce(v_regla, 'completo'));
  new.nombre_asegurado_normalizado := normalizar_nombre(new.nombre_asegurado_crudo);

  -- La fecha de transacción entra en la clave de duplicados.
  --
  -- GEICO reposta la misma póliza varias veces en un mes: 77 pólizas del statement de agosto
  -- aparecen en más de una línea, 240 líneas en total. Son legítimas — son movimientos de días
  -- distintos — pero la clave no miraba ninguna fecha de proceso, así que 65 de esas líneas
  -- entraban marcadas como duplicado sospechoso y había que revisarlas una por una.
  --
  -- Medido sobre el archivo real: agregando la fecha de transacción bajan de 65 a 34. Las 34 que
  -- quedan son filas idénticas de verdad —misma póliza, mismo monto, el mismo día— y esas sí
  -- merecen que alguien las mire.
  --
  -- Para las demás compañías no cambia nada: mandan una fecha de statement igual para todas las
  -- líneas del período, así que agregarla a la clave no separa nada que antes estuviera junto.
  new.clave_duplicado := md5(concat_ws('|',
    v_aseguradora::text,
    coalesce(new.numero_normalizado,''), coalesce(new.nombre_asegurado_normalizado,''),
    coalesce(new.fecha_vigencia::text,''), new.tipo_transaccion, coalesce(new.monto::text,''),
    coalesce(new.fecha_statement::text,'')));
  return new;
end $$;

-- El trigger tiene que dispararse también cuando cambia la fecha de statement, que ahora forma
-- parte de la clave; si no, editarla dejaría la clave vieja apuntando a otra cosa.
drop trigger if exists lineas_comision_normalizar_trg on lineas_comision;
create trigger lineas_comision_normalizar_trg
  before insert or update of numero_poliza_crudo, nombre_asegurado_crudo, fecha_vigencia,
                             fecha_statement, tipo_transaccion, monto
  on lineas_comision for each row execute function lineas_comision_normalizar();

create or replace function polizas_normalizar() returns trigger language plpgsql as $$
declare
  v_regla text;
begin
  select coalesce(a.regla_numero_poliza, 'completo') into v_regla
    from aseguradoras a where a.id = new.aseguradora_id;
  new.numero_normalizado := normalizar_poliza_con_regla(new.numero_poliza, coalesce(v_regla, 'completo'));
  return new;
end $$;

drop trigger if exists polizas_normalizar_trg on polizas;
create trigger polizas_normalizar_trg
  before insert or update of numero_poliza, aseguradora_id
  on polizas for each row execute function polizas_normalizar();

-- ---------------------------------------------------------
-- Prenderla en GEICO y recalcular lo que ya está guardado
-- ---------------------------------------------------------
update aseguradoras set regla_numero_poliza = 'antes_del_guion'
 where nombre ilike '%geico%';

-- Todas las líneas, no solo las de GEICO: la clave de duplicados cambió de fórmula para todas.
-- Tocar numero_poliza_crudo con su propio valor es lo que hace correr el trigger.
update lineas_comision set numero_poliza_crudo = numero_poliza_crudo;
update polizas set numero_poliza = numero_poliza;



-- ---------------------------------------------------------
-- Asignar a mano tiene que cortar el número igual que el resto
-- ---------------------------------------------------------
-- Esta función busca la póliza en el Book por su número normalizado y, si no la encuentra, la
-- crea. Normalizaba por su cuenta con normalizar_poliza(), sin mirar la regla de la compañía:
-- con GEICO no habría encontrado ninguna de las 1.070 pólizas que ya están en el Book y habría
-- creado una copia de cada una. Se le enseña la misma regla.

create or replace function asignar_linea_creando_poliza(
  p_linea_id uuid,
  p_agente_id uuid,
  p_motivo text default null
) returns jsonb language plpgsql security definer as $$
declare
  l lineas_comision%rowtype;
  r reportes%rowtype;
  v_of uuid;
  v_cli uuid;
  v_pol polizas%rowtype;
  v_norm text;
  v_prima numeric;
  v_regla text;
  v_creo_poliza boolean := false;
  v_creo_cliente boolean := false;
  v_usr uuid := auth.uid();
begin
  select * into l from lineas_comision where id = p_linea_id for update;
  if not found then raise exception 'La línea no existe'; end if;
  if p_agente_id is null then raise exception 'Falta el agente'; end if;
  select * into r from reportes where id = l.reporte_id;
  select oficina_id into v_of from agentes where id = p_agente_id;

  -- La misma regla que usa el trigger al guardar la línea. Si acá se normalizara distinto, una
  -- póliza de GEICO que SÍ está en el Book no se encontraría y se crearía una copia al lado, con
  -- el número largo: el Book quedaría con la misma póliza dos veces y el statement del mes que
  -- viene volvería a no matchear.
  select coalesce(a.regla_numero_poliza, 'completo') into v_regla
    from aseguradoras a where a.id = r.aseguradora_id;
  v_regla := coalesce(v_regla, 'completo');
  v_norm := normalizar_poliza_con_regla(l.numero_poliza_crudo, v_regla);

  -- La prima de la línea sirve para la póliza solo si es positiva. Una cancelación trae la prima
  -- en negativo (es una devolución), y guardarla así deja el Book con pólizas de prima negativa
  -- que después el dashboard suma. Ante la duda, mejor sin prima que con una prima falsa.
  v_prima := case when coalesce(l.prima, 0) > 0 then l.prima else null end;

  -- Sin número de póliza no hay nada que aprender: un ajuste o un fee no es una póliza, y crear
  -- una con número inventado ensuciaría el Book para siempre. Se asigna solo la línea.
  if v_norm is null or r.aseguradora_id is null then
    update lineas_comision
       set estado = 'conciliado_confirmado', agente_id = p_agente_id,
           oficina_id = coalesce(oficina_id, v_of), regla_match = 'manual'
     where id = l.id;
    return jsonb_build_object('ok', true, 'poliza_creada', false, 'cliente_creado', false,
      'motivo', 'La línea no trae número de póliza, así que no se pudo guardar en el Book.');
  end if;

  select * into v_pol from polizas
   where aseguradora_id = r.aseguradora_id and numero_normalizado = v_norm;

  if not found then
    -- Se reusa el cliente si ya existe con ese nombre; si no, se crea. Crear un cliente duplicado
    -- por cada statement dejaría el Book lleno de copias del mismo asegurado.
    if coalesce(l.nombre_asegurado_crudo, '') <> '' then
      select id into v_cli from clientes
       where nombre_normalizado = normalizar_nombre(l.nombre_asegurado_crudo)
       order by created_at limit 1;
      if v_cli is null then
        insert into clientes (nombre) values (l.nombre_asegurado_crudo) returning id into v_cli;
        v_creo_cliente := true;
      end if;
    end if;

    insert into polizas (cliente_id, numero_poliza, aseguradora_id, ramo, agente_id, oficina_id,
                         fecha_vigencia, prima, origen)
    values (v_cli,
            -- Se guarda el número como lo entiende el Book, no como lo manda el archivo: para
            -- GEICO, '6245490328-449199073' entra como '6245490328'. Guardar el largo dejaría el
            -- Book con un número que no existe en ningún otro lado.
            case when v_regla = 'antes_del_guion'
                 then split_part(l.numero_poliza_crudo, '-', 1)
                 else l.numero_poliza_crudo end,
            r.aseguradora_id, coalesce(l.ramo, 'auto'), p_agente_id,
            v_of, l.fecha_vigencia, v_prima, 'alta_manual')
    returning * into v_pol;
    v_creo_poliza := true;
  else
    -- La póliza ya estaba: se le pone el agente, que es lo que faltaba para que matchee sola. La
    -- prima solo se completa si la póliza no tenía ninguna; el Book manda sobre el statement.
    update polizas
       set agente_id = p_agente_id,
           oficina_id = coalesce(oficina_id, v_of),
           prima = coalesce(prima, v_prima)
     where id = v_pol.id;
  end if;

  update lineas_comision
     set estado = 'conciliado_confirmado', agente_id = p_agente_id, oficina_id = v_of,
         poliza_id = v_pol.id, regla_match = 'manual'
   where id = l.id;

  update excepciones
     set estado = 'resuelta', accion = 'asignar_creando_poliza',
         nota = coalesce(p_motivo, 'Asignada a mano; la póliza quedó guardada en el Book.'),
         resuelta_por = v_usr, resuelta_en = now()
   where linea_comision_id = l.id and estado in ('pendiente', 'en_espera');

  insert into auditoria (entidad, entidad_id, accion, campo, valor_nuevo, usuario, motivo)
  values ('polizas', v_pol.id,
          case when v_creo_poliza then 'alta_desde_statement' else 'agente_desde_statement' end,
          'agente_id', p_agente_id::text, v_usr, p_motivo);

  return jsonb_build_object('ok', true, 'poliza_creada', v_creo_poliza,
    'cliente_creado', v_creo_cliente, 'numero_poliza', v_pol.numero_poliza);
end $$;

-- ---------------------------------------------------------
-- Qué quedó
-- ---------------------------------------------------------
select
  (select count(*) from aseguradoras where regla_numero_poliza = 'antes_del_guion')
    as companias_que_cortan_en_el_guion,
  (select string_agg(nombre, ', ') from aseguradoras where regla_numero_poliza = 'antes_del_guion')
    as cuales,
  (select count(*) from polizas p join aseguradoras a on a.id = p.aseguradora_id
    where a.regla_numero_poliza = 'antes_del_guion') as polizas_de_esas_companias,
  (select count(*) from lineas_comision) as lineas_recalculadas;

notify pgrst, 'reload schema';
