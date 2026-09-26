// Gelpi Insurance · extraer-reporte
// Edge Function: descarga el archivo de un `reporte`, lo manda a OpenAI (Responses API,
// modelo configurable — por defecto gpt-4o-mini, usando LA LLAVE DEL CLIENTE) para extraer
// datos estructurados, y carga el resultado en lineas_comision / lineas_venta / polizas /
// bonos según `reportes.tipo`.
//
// Contrato: POST { "reporte_id": "<uuid>" }  (JWT de usuario en Authorization, verify_jwt=true)
// Modo de prueba de conexión: POST { "test_ai": true }
//   (opcionalmente { "test_ai": true, "api_key": "...", "model": "..." } para probar una
//   llave/modelo ANTES de guardarlos en Configuración).
//
// Llave y modelo de OpenAI: se leen de la tabla `configuracion` (claves `openai_api_key` y
// `openai_model`, valores jsonb string), con fallback al secreto `OPENAI_API_KEY` del
// proyecto. Ver README.md de esta carpeta.

import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import * as XLSX from "xlsx";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const OPENAI_URL = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = "gpt-4o-mini";
// Bien por debajo del wall-clock limit de la Edge Function: si OpenAI no responde en este
// tiempo, preferimos abortar y marcar el reporte en estado='error' (con mensaje claro) antes
// de que la plataforma mate el proceso y deje el reporte trabado en 'extrayendo' para siempre.
const OPENAI_FETCH_TIMEOUT_MS = 90_000;

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

type TipoTransaccion = "nueva" | "renovacion" | "endoso" | "cancelacion" | "ajuste" | "otro";
type Ramo =
  | "auto" | "hogar" | "comercial" | "motocicleta" | "bote" | "inquilinos"
  | "inundacion" | "umbrella" | "vida" | "otro" | null;

interface FilaComision {
  fila?: number;
  numero_poliza?: string | null;
  nombre_asegurado?: string | null;
  productor?: string | null;
  tipo_transaccion?: TipoTransaccion;
  ramo?: Ramo;
  prima?: number | string | null;
  tasa?: number | string | null;
  monto?: number | string | null;
  fecha_vigencia?: string | null;
  fecha_statement?: string | null;
  confianza?: number | null;
  campos_extra?: Record<string, unknown>;
}

interface FilaVenta {
  fila?: number;
  agente_nombre_crudo?: string | null;
  oficina_nombre_crudo?: string | null;
  cliente_nombre_crudo?: string | null;
  telefono?: string | null;
  email?: string | null;
  numero_poliza?: string | null;
  aseguradora_nombre_crudo?: string | null;
  ramo?: Ramo;
  fecha_venta?: string | null;
  fecha_vigencia?: string | null;
  prima?: number | string | null;
  confianza?: number | null;
  campos_extra?: Record<string, unknown>;
}

interface ExtraccionResultado {
  tipo_detectado?: string;
  aseguradora_detectada?: string | null;
  periodo?: string | null;
  mapeo_columnas?: Record<string, string>;
  columnas_sin_mapeo?: string[];
  confianza_promedio?: number | null;
  resumen?: string | null;
  filas?: (FilaComision | FilaVenta)[];
  total_filas_documento?: number | null;
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

class ReporteError extends Error {}

function coerceNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let s = String(v).trim();
  if (!s) return null;
  // Limpiar '$'/','/espacios ANTES de evaluar paréntesis/signo: en formato contable el '$'
  // puede quedar fuera del paréntesis (ej. "$(1,234.56)"), y si no se limpia primero el
  // patrón de paréntesis nunca matchea y el monto negativo se pierde (da NaN).
  //
  // El '%' se limpia igual. GEICO manda la tasa como texto — "15.00%" — y sin esto
  // Number("15.00%") es NaN: las 487 tasas del statement de agosto entraban en null. Queda 15,
  // que es la misma convención que ya usan las demás (United guarda 13 para el 13%).
  s = s.replace(/[$,%\s]/g, "");
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
  if (s.startsWith("-")) { negative = true; s = s.slice(1); }
  if (!s || s === "-") return null;
  const n = Number(s);
  if (Number.isNaN(n)) return null;
  return negative ? -Math.abs(n) : n;
}

// ---------------------------------------------------------------------------
// Secciones dentro de un mismo archivo
// ---------------------------------------------------------------------------
// GEICO manda un solo archivo con dos bloques: "First Year Commission" (329 filas) y
// "Renewal Year Commission" (158). El rótulo de cada bloque es una fila de UNA sola celda —
// exactamente la clase de fila que los parsers descartan como separador. Y el statement no
// trae ninguna columna de tipo de transacción: el rótulo ES el único lugar donde dice que
// esas 158 filas son renovaciones. Descartándolo, entraban indistinguibles de las nuevas.
//
// Se guarda en una columna sintética que viaja con cada fila. El parser todavía no sabe si el
// archivo es de comisiones o de ventas, así que acá solo se conserva; quien lo interpreta es
// el armado del lote, más abajo.
const COL_SECCION = "_seccion_del_reporte";

function tituloDeSeccion(fila: unknown[] | undefined): string | null {
  const vals = (fila ?? []).map((c) => String(c ?? "").trim()).filter((s) => s !== "");
  if (vals.length !== 1) return null;
  const s = vals[0];
  // Un rótulo es texto corto. Un subtotal suelto en su propia fila también ocupa una sola
  // celda, y ese no es una sección: por eso se exige que tenga letras y que no sea un número.
  if (s.length < 4 || s.length > 80) return null;
  if (!/[A-Za-z]{3}/.test(s)) return null;
  if (coerceNumber(s) !== null) return null;
  return s;
}

function coerceDate(v: unknown): string | null {
  if (!v) return null;
  // parseXlsx lee las hojas con cellDates, así que las celdas de fecha llegan como Date. Su
  // String() es "Wed Sep 09 2026 00:00:00 GMT…", que no matchea ninguno de los patrones de abajo
  // y se perdería la fecha.
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, "0");
    const d = String(v.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const s = String(v).trim();
  if (!s) return null;
  // ISO ya
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // MM/DD/YYYY o M/D/YY
  const m1 = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m1) {
    let [, mm, dd, yy] = m1;
    let year = yy.length === 2 ? Number(yy) + 2000 : Number(yy);
    return `${year}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }
  // Excel serial date
  if (/^\d{4,6}(\.\d+)?$/.test(s)) {
    const serial = Number(s);
    if (serial > 20000 && serial < 60000) {
      const epoch = new Date(Date.UTC(1899, 11, 30));
      const d = new Date(epoch.getTime() + serial * 86400000);
      return d.toISOString().slice(0, 10);
    }
  }
  // AAAAMM: Progressive trae la columna "Month End" como 202608 — el mes al que corresponde el
  // statement, no una fecha completa. Sin este caso caía en el new Date() de abajo.
  const aaaamm = s.match(/^(\d{4})(\d{2})$/);
  if (aaaamm) {
    const anio = Number(aaaamm[1]);
    const mes = Number(aaaamm[2]);
    if (anio >= 1900 && anio <= 2200 && mes >= 1 && mes <= 12) return `${aaaamm[1]}-${aaaamm[2]}-01`;
  }

  const d = new Date(s);
  // El rango es la parte importante, no el isNaN. new Date("202608") NO es inválida: JavaScript la
  // lee como el año 202608, y toISOString() devuelve "+202608-01-01…". Postgres rechaza eso con
  // "time zone displacement out of range" y, como las líneas se insertan por lote, una sola fila
  // así voltea el statement entero — pasó con Progressive: 178 líneas perdidas por una celda.
  if (!Number.isNaN(d.getTime()) && d.getUTCFullYear() >= 1900 && d.getUTCFullYear() <= 2200) {
    return d.toISOString().slice(0, 10);
  }
  return null;
}

const TIPO_TRANSACCION_CODES: Record<string, TipoTransaccion> = {
  NB: "nueva", NBS: "nueva", NEW: "nueva", N: "nueva", NUEVA: "nueva",
  RWL: "renovacion", REN: "renovacion", RN: "renovacion", RENEWAL: "renovacion", RENOVACION: "renovacion",
  END: "endoso", ENDT: "endoso", XLC: "endoso", ENDORSEMENT: "endoso", ENDOSO: "endoso",
  CAN: "cancelacion", CNL: "cancelacion", CXL: "cancelacion", CANCEL: "cancelacion", CANCELLATION: "cancelacion",
  CANCELACION: "cancelacion", CB: "cancelacion", CHARGEBACK: "cancelacion",
  ADJ: "ajuste", ADJUSTMENT: "ajuste", AJUSTE: "ajuste",
};

// La fila de referencia del período anterior. Se reconoce SOLO por el nombre que el prompt le pide
// a la IA que le ponga ("Pago período anterior (referencia)"), y no por "no tiene número de póliza"
// — porque los cargos de MVR tampoco lo tienen y esos SÍ son plata de este mes que hay que restar.
function esReferenciaPeriodoAnterior(f: Record<string, unknown>): boolean {
  const nombre = String(f.nombre_asegurado ?? "");
  return /per[ií]odo\s+anterior|previous\s+period|prior\s+period/i.test(nombre);
}

function coerceTipoTransaccion(v: unknown): TipoTransaccion {
  if (!v) return "otro";
  const s = String(v).trim().toUpperCase();
  if (["nueva", "renovacion", "endoso", "cancelacion", "ajuste", "otro"].includes(s.toLowerCase())) {
    return s.toLowerCase() as TipoTransaccion;
  }
  return TIPO_TRANSACCION_CODES[s] ?? "otro";
}

// Cuando el statement no trae columna de tipo de transacción, el rótulo de la sección es la
// única fuente que hay. GEICO parte el archivo en "First Year Commission" y "Renewal Year
// Commission" y no lo dice en ningún otro lado. Es solo un respaldo: si la fila trae su propio
// tipo, ese manda siempre — la sección nunca pisa un dato explícito del archivo.
function tipoDeTransaccion(f: Record<string, unknown>): TipoTransaccion {
  const propio = coerceTipoTransaccion(f.tipo_transaccion);
  if (propio !== "otro") return propio;
  const extra = f.campos_extra as Record<string, unknown> | undefined;
  const seccion = String(extra?.[COL_SECCION] ?? "").toLowerCase();
  if (!seccion) return propio;
  if (/renewal|renovaci/.test(seccion)) return "renovacion";
  if (/first year|new business|nuevo negocio/.test(seccion)) return "nueva";
  if (/cancel/.test(seccion)) return "cancelacion";
  if (/endorse|endoso/.test(seccion)) return "endoso";
  return propio;
}

// En el Book, el ramo no siempre llega mapeado: el modelo ve "LOB Class" y "Line of Business" y
// no tiene por qué saber que la segunda es el ramo. Medido sobre el Book de septiembre, 2.305 de
// 2.363 pólizas quedaron en "otro" — o sea, sin clasificar — y por eso las comerciales no se
// podían encontrar como comerciales en la pantalla.
//
// El orden importa. "Line of Business" trae el ramo de verdad ("Commercial Auto", "Condo",
// "Dwelling Fire"); "LOB Class" trae solo la familia ("Personal Lines", "Commercial Lines"), que
// alcanza para separar comercial de personal pero mandaría las 2.165 personales a "otro". Por eso
// la clase se mira última, como red de seguridad.
const COLUMNAS_RAMO = [/line\s*of\s*business/i, /coverage|producto|product/i, /\blob\b|clase|class/i];
function ramoDelLibro(f: Record<string, unknown>): Ramo {
  const directo = coerceRamo(f.ramo);
  if (directo && directo !== "otro") return directo;
  const extra = (f.campos_extra as Record<string, unknown>) ?? {};
  for (const patron of COLUMNAS_RAMO) {
    for (const [col, valor] of Object.entries(extra)) {
      if (!patron.test(col)) continue;
      const r = coerceRamo(valor);
      if (r && r !== "otro") return r;
    }
  }
  return directo ?? "otro";
}

const RAMOS: Ramo[] = ["auto", "hogar", "comercial", "motocicleta", "bote", "inquilinos", "inundacion", "umbrella", "vida", "otro"];
function coerceRamo(v: unknown): Ramo {
  if (!v) return null;
  const s = String(v).trim().toLowerCase();
  if ((RAMOS as string[]).includes(s)) return s as Ramo;
  if (/home|hogar|dwelling|ho[- ]?3/.test(s)) return "hogar";
  if (/comm|business|negocio|comercial/.test(s)) return "comercial";
  if (/moto/.test(s)) return "motocicleta";
  if (/boat|bote|marine/.test(s)) return "bote";
  if (/renter|inquilino/.test(s)) return "inquilinos";
  if (/flood|inundacion/.test(s)) return "inundacion";
  if (/umbrella/.test(s)) return "umbrella";
  if (/life|vida/.test(s)) return "vida";
  if (/auto|car|vehic/.test(s)) return "auto";
  return "otro";
}

// El nombre de un cliente se normaliza distinto que el resto de los textos: la base le saca las
// palabras de forma societaria. Tiene que ser IDÉNTICA a normalizar_nombre() de SQL, que es la que
// escribe clientes.nombre_normalizado desde un trigger.
//
// Cuando no coincidían pasaba esto, medido en el Book de septiembre: la base guardaba
// "AIR TECHNIK INC" como "AIR TECHNIK", el importador la buscaba como "AIR TECHNIK INC" y no la
// encontraba nunca. Dos daños por el mismo error. Uno: creaba un cliente nuevo en cada subida del
// Book, así que las empresas terminaron con 3 y 4 copias mientras las personas tenían una sola.
// Otro, peor: como la búsqueda fallaba, la póliza se guardaba con cliente_id en null — 101 pólizas
// sin dueño y con el nombre en blanco en la pantalla del Book. Eran justo las comerciales, porque
// son las únicas que llevan INC, LLC o CORP en el nombre.
const FORMAS_SOCIETARIAS = /\b(LLC|INC|CORP|LTD|CO)\b/g;
function normalizarNombreCliente(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(FORMAS_SOCIETARIAS, " ")
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizarTexto(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function base64FromBytes(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  // @ts-ignore btoa está disponible en Deno
  return btoa(binary);
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ---------------------------------------------------------------------------
// Dejar el reporte vacío antes de volver a cargarlo
// ---------------------------------------------------------------------------

// Reglas cuyo agente lo puso una persona, no el motor. Tiene que coincidir con REGLAS_MANUALES de
// src/lib/queries/subir.ts: son las decisiones que no se pueden perder al recargar.
const REGLAS_MANUALES = new Set(["manual", "override_manual", "alta_manual", "cuenta_casa", "no_es_de_este_mes"]);

// Extraer no agrega líneas: las reemplaza. Pero el borrado vivía solo en la pantalla que llama a
// esta función, así que cualquier otra forma de dispararla — un reintento, un clic doble que
// esquive el freno, o una llamada directa a la función — insertaba encima de lo que ya estaba y
// dejaba el statement cargado dos veces. Pasó de verdad con United: 189 líneas viejas + 219
// nuevas = 408, y la mitad marcada como duplicado sospechoso.
//
// Ahora limpia la propia función, que es la única que sabe con certeza que está por insertar. Va
// pegado al insert y no al principio: si la extracción falla a mitad de camino, los datos viejos
// siguen ahí en vez de quedar el reporte en cero.
async function limpiarLineasPrevias(admin: SupabaseClient, reporteId: string): Promise<void> {
  const { data: comision } = await admin
    .from("lineas_comision")
    .select("id, poliza_id, agente_id, oficina_id, regla_match")
    .eq("reporte_id", reporteId);
  const { data: venta } = await admin.from("lineas_venta").select("id").eq("reporte_id", reporteId);

  const idsComision = (comision ?? []).map((l) => l.id as string);
  const idsVenta = (venta ?? []).map((l) => l.id as string);
  if (idsComision.length === 0 && idsVenta.length === 0) return;

  // Antes de borrar, lo decidido a mano se guarda en el Book. Sin esto, borrar sería una forma
  // nueva de perder el trabajo del usuario: las líneas nuevas salen del archivo y no tienen cómo
  // saber qué se había resuelto. Con el agente escrito en la póliza, el motor lo vuelve a
  // encontrar solo por número de póliza.
  for (const l of comision ?? []) {
    if (!REGLAS_MANUALES.has((l.regla_match as string) ?? "") || !l.agente_id || !l.poliza_id) continue;
    await admin
      .from("polizas")
      .update({ agente_id: l.agente_id, oficina_id: l.oficina_id })
      .eq("id", l.poliza_id as string);
  }

  // Las excepciones apuntan a las líneas, así que se van primero.
  for (const ids of chunk(idsComision, 200)) {
    await admin.from("excepciones").delete().in("linea_comision_id", ids);
  }
  for (const ids of chunk(idsVenta, 200)) {
    await admin.from("excepciones").delete().in("linea_venta_id", ids);
  }
  await admin.from("lineas_comision").delete().eq("reporte_id", reporteId);
  await admin.from("lineas_venta").delete().eq("reporte_id", reporteId);
}

// ---------------------------------------------------------------------------
// Capa de texto de un PDF
// ---------------------------------------------------------------------------

// Pedirle a la IA que "mire" un PDF y transcriba la tabla es la parte más frágil de todo el
// proceso. Medido sobre el statement de United: el documento tiene 218 filas y suma $13,611.70;
// la IA devolvía 188 y $11,859.02 — se perdían $1,752.68 — y cada reproceso devolvía un
// subconjunto distinto, así que ni siquiera daba el mismo número dos veces.
//
// Pero ese PDF no es un escaneo: trae su propia capa de texto, exacta. Leyéndola y pasándole a la
// IA el texto ya armado, deja de transcribir y solo tiene que mapear columnas, que es lo que sí
// hace bien. Si el PDF no tiene capa de texto (un escaneo de verdad), esto devuelve páginas
// vacías y el llamador vuelve a mandar el archivo como antes.
//
// Lo enredado es que el texto de un PDF viene suelto, sin renglones: cada pedacito trae su
// coordenada y hay que reagruparlos. Y en un statement apaisado como el de United las páginas
// vienen rotadas, así que dentro de un renglón lo que se mantiene constante es la X, no la Y —
// agrupar por Y ahí devuelve las columnas mezcladas entre sí en vez de las filas.
async function textoDePaginasPdf(bytes: Uint8Array): Promise<string[]> {
  const { getDocumentProxy } = await import("unpdf");
  // Copia: pdf.js se queda con el buffer y lo deja inutilizable, y el original todavía hace
  // falta por si hay que caer al modo archivo.
  const pdf = await getDocumentProxy(bytes.slice());
  const paginas: string[] = [];

  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const contenido = await page.getTextContent();
    // deno-lint-ignore no-explicit-any
    const items = (contenido.items as any[]).filter((i) => typeof i.str === "string" && i.str.trim());
    if (items.length === 0) {
      paginas.push("");
      continue;
    }

    // La matriz del texto dice si está rotado: en vertical el desplazamiento cae en b, no en a.
    const rotado = items.filter((i) => Math.abs(i.transform[1]) > Math.abs(i.transform[0])).length >
      items.length / 2;
    // deno-lint-ignore no-explicit-any
    const claveDe = (i: any) => Math.round(rotado ? i.transform[4] : i.transform[5]);
    // deno-lint-ignore no-explicit-any
    const ordenDe = (i: any) => (rotado ? -i.transform[5] : i.transform[4]);

    let min = Infinity;
    let max = -Infinity;
    let anchoTotal = 0;
    let charsTotal = 0;
    for (const i of items) {
      const o = ordenDe(i);
      if (o < min) min = o;
      if (o > max) max = o;
      if (typeof i.width === "number" && i.width > 0) {
        anchoTotal += i.width;
        charsTotal += i.str.length;
      }
    }
    // Las columnas se conservan con espacios en vez de juntar todo con un separador: así la tabla
    // le llega a la IA alineada igual que en el papel, y las filas de continuación (un endoso que
    // cuelga de la póliza de arriba) se ven arrancando a mitad de renglón. La escala se calibra
    // sola con el ancho real de los caracteres de esta página, para que un carácter del PDF sea
    // más o menos un carácter de texto en cualquier tamaño de letra.
    const anchoChar = charsTotal > 0 && anchoTotal > 0 ? anchoTotal / charsTotal : 5;
    const escala = Math.min(1 / anchoChar, 400 / Math.max(1, max - min));

    // deno-lint-ignore no-explicit-any
    const grupos = new Map<number, any[]>();
    for (const i of items) {
      const k = claveDe(i);
      const g = grupos.get(k);
      if (g) g.push(i);
      else grupos.set(k, [i]);
    }

    const lineas: string[] = [];
    for (const k of [...grupos.keys()].sort((a, b) => b - a)) {
      const fila = grupos.get(k)!.sort((a, b) => ordenDe(a) - ordenDe(b));
      let linea = "";
      for (const i of fila) {
        const col = Math.round((ordenDe(i) - min) * escala);
        if (col > linea.length) linea += " ".repeat(col - linea.length);
        linea += i.str;
      }
      const limpia = linea.replace(/\s+$/, "");
      if (limpia.trim()) lineas.push(limpia);
    }
    paginas.push(lineas.join("\n"));
  }

  return paginas;
}

// ---------------------------------------------------------------------------
// Parsers CSV / XLSX
// ---------------------------------------------------------------------------

function parseCsv(text: string): Record<string, string>[] {
  // Parser CSV simple con soporte de comillas.
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const cleaned = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < cleaned.length; i++) {
    const c = cleaned[i];
    if (inQuotes) {
      if (c === '"') {
        if (cleaned[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else field += c;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  // Igual que parseXlsx: algunos reportes (ej. "Active Book of Business by Class") traen
  // varias filas de título/filtros ("POLICY CLASS (All)", "AGENT (All)", ...) antes de la
  // fila real de encabezados, y subtítulos de sección intercalados entre los datos. Se
  // detecta el encabezado real como la primera fila con varias celdas no vacías (las de
  // metadata traen una sola), no simplemente la primera fila no vacía.
  const MIN_CELDAS_ENCABEZADO = 4;
  const MIN_CELDAS_FILA = 3;
  const contarNoVacias = (fila: string[] | undefined) =>
    (fila ?? []).filter((c) => c.trim() !== "").length;
  const idxEncabezado = rows.findIndex((fila) => contarNoVacias(fila) >= MIN_CELDAS_ENCABEZADO);
  if (idxEncabezado === -1) return [];
  const headers = rows[idxEncabezado].map((h) => h.trim());
  const out: Record<string, string>[] = [];
  // Igual que parseXlsx: el rótulo de sección es una fila de una sola celda y hasta ahora se
  // perdía. Se rastrea desde el principio porque el primero suele estar arriba del encabezado.
  let seccion: string | null = null;
  for (let i = 0; i < idxEncabezado; i++) seccion = tituloDeSeccion(rows[i]) ?? seccion;
  const firmaEncabezado = rows[idxEncabezado].map((h) => h.trim()).join("|");
  for (let i = idxEncabezado + 1; i < rows.length; i++) {
    const r = rows[i];
    const rotulo = tituloDeSeccion(r);
    if (rotulo) { seccion = rotulo; continue; }
    if (contarNoVacias(r) < MIN_CELDAS_FILA) continue; // fila vacía o separador
    if (r.map((h) => h.trim()).join("|") === firmaEncabezado) continue; // encabezado repetido por sección
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => { obj[h || `col_${idx}`] = (r[idx] ?? "").trim(); });
    // Fila con más columnas que encabezados (típicamente una coma sin escapar en un campo de
    // texto): en vez de descartar los valores sobrantes en silencio, preservarlos con una
    // clave marcada — quedan sin mapeo y caen en campos_extra para poder diagnosticarlos.
    for (let extraIdx = headers.length; extraIdx < r.length; extraIdx++) {
      obj[`_csv_col_extra_${extraIdx}`] = (r[extraIdx] ?? "").trim();
    }
    if (seccion) obj[COL_SECCION] = seccion;
    out.push(obj);
  }
  return out;
}

function parseXlsx(bytes: Uint8Array): Record<string, unknown>[] {
  // cellDates: las celdas de fecha llegan como Date en vez de serial, y coerceDate las entiende.
  const wb = XLSX.read(bytes, { type: "array", cellDates: true });
  const porHoja: { nombre: string; headers: string[]; filas: Record<string, unknown>[] }[] = [];
  const MIN_CELDAS_ENCABEZADO = 4;
  const MIN_CELDAS_FILA = 3;
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    // Algunos reportes (ej. "Active Book of Business by Class") traen varias filas de
    // título/filtros ("POLICY CLASS (All)", "AGENT (All)", ...) antes de la fila real de
    // encabezados, y a veces subtítulos de sección intercalados entre los datos ("LOB
    // Class: Personal Lines (228 records)"). Si se asume que la fila 1 siempre es el
    // encabezado, esas filas de metadata terminan tratadas como datos y las columnas
    // quedan corridas. Se lee la hoja como matriz cruda, se detecta la fila de
    // encabezados como la primera con varias celdas no vacías (las de metadata traen
    // una sola), y se descartan como filas de metadata/separador las que después
    // tengan muy pocas celdas llenas.
    // raw: true devuelve el valor real de la celda en vez del texto que Excel muestra. Con
    // raw:false, un statement cuyas celdas traen formato de porcentaje (el .xls de Responsive)
    // llegaba como "16682%" donde el valor es 166.82 y "2170%" donde son $21.70: coerceNumber
    // no puede parsear eso, devuelve null, y las 52 filas quedaron con monto 0 — el statement
    // entero sin un peso. El valor crudo no miente; el formato es cosa de la planilla.
    const matriz = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true }) as unknown[][];
    const contarNoVacias = (fila: unknown[] | undefined) =>
      (fila ?? []).filter((c) => String(c ?? "").trim() !== "").length;
    const idxEncabezado = matriz.findIndex((fila) => contarNoVacias(fila) >= MIN_CELDAS_ENCABEZADO);
    if (idxEncabezado === -1) continue; // hoja sin datos reconocibles
    const headers = matriz[idxEncabezado].map((h, i) => {
      const s = String(h ?? "").trim();
      return s || `col_${i}`;
    });
    const filas: Record<string, unknown>[] = [];
    // El rótulo de la PRIMERA sección está arriba del encabezado (GEICO: "First Year
    // Commission" en la fila 7, encabezado en la 8), así que se lo busca desde el principio
    // del archivo y no desde donde arrancan los datos.
    let seccion: string | null = null;
    for (let i = 0; i < idxEncabezado; i++) seccion = tituloDeSeccion(matriz[i]) ?? seccion;
    const comoEncabezado = (fila: unknown[]) =>
      fila.map((h, idx) => String(h ?? "").trim() || `col_${idx}`).join("|");
    const firmaEncabezado = comoEncabezado(matriz[idxEncabezado]);
    for (let i = idxEncabezado + 1; i < matriz.length; i++) {
      const fila = matriz[i];
      const rotulo = tituloDeSeccion(fila);
      if (rotulo) { seccion = rotulo; continue; }
      if (contarNoVacias(fila) < MIN_CELDAS_FILA) continue; // fila vacía o separador
      // Cada sección vuelve a repetir el encabezado. Sin esto entraría como una fila de datos
      // cuyos valores son los nombres de las columnas: una línea de comisión en cero por
      // sección, con el texto "Policy #" donde debería ir un número de póliza.
      if (comoEncabezado(fila) === firmaEncabezado) continue;
      const obj: Record<string, unknown> = {};
      headers.forEach((h, idx) => { obj[h] = fila[idx] ?? ""; });
      if (seccion) obj[COL_SECCION] = seccion;
      filas.push(obj);
    }
    porHoja.push({ nombre: sheetName, headers, filas });
  }

  // Muchos statements traen una hoja de resumen junto a la de detalle. El de Progressive tiene
  // "Detailed" (178 transacciones) y "Summary" (14 filas: AGENT TOTAL, AUTO, BOAT…). Juntarlas
  // mete 14 filas basura con columnas que no significan nada, que terminan como lineas de
  // comision en cero. Se toma la hoja con mas datos como la buena, y de las otras solo se suman
  // las que tengan EXACTAMENTE los mismos encabezados — ese es el caso legitimo de un libro
  // partido en varias hojas (enero, febrero...), y deja afuera los resumenes, que por definicion
  // tienen otras columnas.
  if (porHoja.length === 0) return [];
  porHoja.sort((a, b) => b.filas.length - a.filas.length);
  const principal = porHoja[0];
  const firma = (h: string[]) => h.join("|").toLowerCase();
  const out = [...principal.filas];
  for (const hoja of porHoja.slice(1)) {
    if (firma(hoja.headers) === firma(principal.headers)) out.push(...hoja.filas);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Schema de salida estructurada para OpenAI
// ---------------------------------------------------------------------------

const CAMPOS_COMISION = [
  "numero_poliza", "nombre_asegurado", "productor", "tipo_transaccion", "ramo",
  "prima", "tasa", "monto", "fecha_vigencia", "fecha_statement",
] as const;

const CAMPOS_VENTA = [
  "agente_nombre_crudo", "oficina_nombre_crudo", "cliente_nombre_crudo", "telefono", "email",
  "numero_poliza", "aseguradora_nombre_crudo", "ramo", "fecha_venta", "fecha_vigencia", "prima",
] as const;

// El modelo devuelve el mapeo como texto libre y a veces inventa un nombre descriptivo en vez del
// campo exacto. Pasó con el Book: mapeó la columna "Current Premium" a `prima_actual`, que no
// existe, así que la prima se tiraba a campos_extra y 2.281 de las 2.331 pólizas quedaron sin
// prima — con el dashboard mostrando un "premium total" armado con 50 pólizas. Traducir los
// alias obvios recupera el dato en vez de perderlo.
//
// Deliberadamente NO está "prima_anualizada": el Book trae las dos columnas y la que vale para una
// póliza vigente es la actual. Si las dos apuntaran a `prima`, ganaría la última del archivo.
const ALIAS_CAMPOS: Record<string, string> = {
  prima_actual: "prima",
  prima_vigente: "prima",
  premium: "prima",
  monto_comision: "monto",
  tasa_comision: "tasa",
  porcentaje_comision: "tasa",
  numero_de_poliza: "numero_poliza",
  poliza: "numero_poliza",
  asegurado: "nombre_asegurado",
};

// OpenAI structured outputs (json_schema, strict:true) exige que TODO objeto tenga
// additionalProperties:false y que TODAS sus properties estén en "required" (los campos
// "opcionales" se modelan como nullable). Además no soporta objetos de forma libre
// (additionalProperties:true), así que `mapeo_columnas` y `campos_extra` -que son mapas de
// forma variable- viajan como STRING con JSON codificado y se parsean después
// (normalizarExtraccion) para reconstruir exactamente el mismo `ExtraccionResultado` que
// antes devolvía la tool-use original.

function buildFilaSchema(esVenta: boolean): Record<string, unknown> {
  const campoExtraProp = {
    type: "string",
    description: "JSON codificado (objeto plano) con las columnas sin mapeo de esta fila. Usar '{}' si no hay ninguna.",
  };
  const filaProps: Record<string, unknown> = esVenta
    ? {
        fila: { type: ["integer", "null"] },
        agente_nombre_crudo: { type: ["string", "null"] },
        oficina_nombre_crudo: { type: ["string", "null"] },
        cliente_nombre_crudo: { type: ["string", "null"] },
        telefono: { type: ["string", "null"] },
        email: { type: ["string", "null"] },
        numero_poliza: { type: ["string", "null"] },
        aseguradora_nombre_crudo: { type: ["string", "null"] },
        ramo: { type: ["string", "null"], enum: [...RAMOS, null] },
        fecha_venta: { type: ["string", "null"], description: "YYYY-MM-DD" },
        fecha_vigencia: { type: ["string", "null"], description: "YYYY-MM-DD" },
        prima: { type: ["number", "string", "null"] },
        confianza: { type: ["number", "null"] },
        campos_extra: campoExtraProp,
      }
    : {
        fila: { type: ["integer", "null"] },
        numero_poliza: { type: ["string", "null"] },
        nombre_asegurado: { type: ["string", "null"] },
        productor: { type: ["string", "null"] },
        tipo_transaccion: { type: "string", enum: ["nueva", "renovacion", "endoso", "cancelacion", "ajuste", "otro"] },
        ramo: { type: ["string", "null"], enum: [...RAMOS, null] },
        prima: { type: ["number", "string", "null"] },
        tasa: { type: ["number", "string", "null"] },
        monto: { type: ["number", "string", "null"] },
        fecha_vigencia: { type: ["string", "null"], description: "YYYY-MM-DD" },
        fecha_statement: { type: ["string", "null"], description: "YYYY-MM-DD" },
        confianza: { type: ["number", "null"] },
        campos_extra: campoExtraProp,
      };

  return {
    type: "object",
    properties: filaProps,
    required: Object.keys(filaProps),
    additionalProperties: false,
  };
}

function buildJsonSchema(esVenta: boolean): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      tipo_detectado: {
        type: "string",
        description:
          "Tipo de reporte detectado: comision_aseguradora, chargebacks, produccion, cancelaciones, renovaciones, resumen_anual, venta_interna, bono_contingencia, actualizacion_abb u otro.",
      },
      aseguradora_detectada: { type: ["string", "null"] },
      periodo: { type: ["string", "null"], description: "Ej: 2026-08 o 'Agosto 2026'" },
      mapeo_columnas: {
        type: "string",
        description:
          "JSON codificado (objeto plano) columna_origen -> campo_destino. El campo_destino tiene que ser EXACTAMENTE " +
          `uno de estos: ${(esVenta ? CAMPOS_VENTA : CAMPOS_COMISION).join(", ")}. ` +
          "No inventes nombres ni les agregues adjetivos: una columna que no encaje exactamente en uno de esos " +
          "campos va en columnas_sin_mapeo, no en el mapeo. Usar '{}' si no aplica.",
      },
      columnas_sin_mapeo: { type: "array", items: { type: "string" } },
      confianza_promedio: { type: ["number", "null"] },
      resumen: { type: ["string", "null"] },
      filas: {
        type: "array",
        description:
          "Dejar vacío ([]) cuando sólo se pide mapeo de columnas (CSV/XLSX); completar todas las filas cuando el documento es PDF/imagen.",
        items: buildFilaSchema(esVenta),
      },
      total_filas_documento: {
        type: ["integer", "null"],
        description:
          "Solo para PDF/imagen: si el documento indica en algún resumen/pie de página cuántas transacciones o filas tiene en total (ej. 'Transactions processed: 219'), poné ese número acá para poder verificar que 'filas' las incluya todas. Si el documento no trae ese total, dejar null.",
      },
    },
    required: [
      "tipo_detectado",
      "aseguradora_detectada",
      "periodo",
      "mapeo_columnas",
      "columnas_sin_mapeo",
      "confianza_promedio",
      "resumen",
      "filas",
      "total_filas_documento",
    ],
    additionalProperties: false,
  };
}

function safeJsonParse<T>(s: unknown, fallback: T): T {
  if (typeof s !== "string" || !s.trim()) return fallback;
  try {
    const v = JSON.parse(s);
    return (v ?? fallback) as T;
  } catch {
    return fallback;
  }
}

// Reconstruye el mismo shape de `ExtraccionResultado` que se usaba con la tool-use original,
// deshaciendo la codificación a string de mapeo_columnas/campos_extra.
function normalizarExtraccion(raw: any): ExtraccionResultado {
  const filas = Array.isArray(raw?.filas)
    ? raw.filas.map((f: any) => ({
        ...f,
        campos_extra: safeJsonParse<Record<string, unknown>>(f?.campos_extra, {}),
      }))
    : [];
  return {
    tipo_detectado: raw?.tipo_detectado,
    aseguradora_detectada: raw?.aseguradora_detectada ?? null,
    periodo: raw?.periodo ?? null,
    mapeo_columnas: safeJsonParse<Record<string, string>>(raw?.mapeo_columnas, {}),
    columnas_sin_mapeo: Array.isArray(raw?.columnas_sin_mapeo) ? raw.columnas_sin_mapeo : [],
    confianza_promedio: raw?.confianza_promedio ?? null,
    resumen: raw?.resumen ?? null,
    filas,
    total_filas_documento: typeof raw?.total_filas_documento === "number" ? raw.total_filas_documento : null,
  };
}

const SYSTEM_PROMPT = `Sos el motor de extracción de datos de Gelpi Insurance, una agencia de seguros de Florida (auto, hogar, comercial).
Vas a recibir uno de estos tipos de documentos:
- Statements de comisión de aseguradoras (Progressive, GEICO, Citizens, Bristol West, National General, Travelers, Infinity, Kemper, United Automobile, Universal Property, Heritage, Tower Hill, Foremost, Safeco, Liberty Mutual, Allstate, State Farm, Mercury, Direct Auto, Assurance America, etc.): filas de comisión por póliza, con nuevo negocio (NB/NBS), renovación (RWL), endoso (END/XLC), cancelación/chargeback (CAN/CNL, montos negativos), ajustes.
- Reportes de producción, cancelaciones, renovaciones o resúmenes anuales de la misma naturaleza.
- Reportes de ventas internas de la agencia (venta_interna): cada fila es una venta hecha por un agente/oficina de Gelpi.
- Statements de bono o contingencia de una aseguradora (bono_contingencia): un monto total, a veces desglosado por agente/productor.
- El "Active Business Book" (actualizacion_abb): el libro maestro de pólizas vigentes con cliente, aseguradora, agente y oficina asignados.

Tu trabajo es mapear las columnas del archivo a los campos destino que te pide la herramienta "registrar_extraccion" y devolver metadatos (tipo de reporte, aseguradora, período). Cuando se te indique explícitamente, también devolvés cada fila ya extraída.
Reglas:
- Fechas siempre en formato ISO YYYY-MM-DD.
- Montos como número; los chargebacks/cancelaciones son montos NEGATIVOS.
- tipo_transaccion: traducí códigos de aseguradora (NB/NBS/NEW->nueva, RWL/REN->renovacion, END/ENDT/XLC->endoso, CAN/CNL/CXL/CB->cancelacion, ADJ->ajuste) o dejá "otro".
- monto cuando hay VARIAS columnas de comisión (ej. Progressive trae "Gross Comm" y "Net Due Agent", o "Agency Due"): elegí SIEMPRE la NETA, la que la aseguradora realmente deposita después de sus descuentos, porque es la que tiene que cuadrar contra el cheque. En la mayoría de las filas las dos coinciden; donde difieren, la neta es la correcta. Caso real: la fila "MVR FEE" de Progressive tiene Gross Comm = 0 y Net Due Agent = -1534, que es el cargo que la aseguradora le descuenta a la agencia — tomando la bruta ese descuento desaparecía y el total no cuadraba con el depósito.
- Algunas aseguradoras (ej. United Automobile) incluyen en el statement una fila de referencia con el total ya pagado en el período anterior, sin póliza real asociada (número de póliza en ceros como "00000000000", o vacío). Esa fila no es una transacción nueva de este período: clasificala como tipo_transaccion="ajuste" y poné en nombre_asegurado EXACTAMENTE "Pago período anterior (referencia)" — ese texto es la señal que usa el sistema para dejarla fuera del total, porque no es plata de este período. No inventes un número de póliza. OJO: esto NO aplica a cargos como "MVR FEE" o fees administrativos, que sí son plata que la aseguradora descuenta este mes y tienen que sumar.
- numero_poliza: incluí SIEMPRE el prefijo de letras del número de póliza. Si la referencia viene como "01 UAD -610794900", el número de póliza es "UAD-610794900" (el "01" inicial es un código de línea, no parte de la póliza); nunca devuelvas solo "-610794900".
- fecha_vigencia vs fecha_statement: fecha_vigencia es cuándo la PÓLIZA empieza a cubrir ("Policy Effective Date", "Eff Date", "Vigencia"); fecha_statement es cuándo la aseguradora PROCESÓ ese movimiento ("Transaction Date", "Processed Date", "Paid Date"). Si el archivo trae las dos, mapeá cada una a la suya y no las mezcles: el sistema usa la de transacción para distinguir dos comisiones iguales de la misma póliza pagadas en días distintos, que son legítimas, de un duplicado real.
- CRÍTICO al extraer filas de un PDF/imagen con una tabla larga: transcribí TODAS las filas de TODAS las páginas, una por una, sin resumir, sin muestrear ni saltear ninguna aunque haya decenas o cientos. No es aceptable devolver solo una parte de la tabla. Si el documento trae en algún resumen/pie de página cuántas transacciones tiene en total (ej. "Transactions processed: 219"), reportá ese número en total_filas_documento — se usa para verificar que no falte ninguna fila.
- Cualquier columna que no tenga un campo destino claro, listala en columnas_sin_mapeo y, si te piden las filas completas, guardá su valor en campos_extra.
- Sé conservador con la confianza (0-100): bajala si el archivo es ambiguo o está mal escaneado.`;

// ---------------------------------------------------------------------------
// Llamada a OpenAI (Responses API)
// ---------------------------------------------------------------------------

async function callOpenAIRaw(opts: {
  apiKey: string;
  model: string;
  content: unknown[];
  schema: Record<string, unknown>;
  maxTokens: number;
}): Promise<string> {
  const body = {
    model: opts.model,
    instructions: SYSTEM_PROMPT,
    input: [{ role: "user", content: opts.content }],
    text: {
      format: {
        type: "json_schema",
        name: "registrar_extraccion",
        strict: true,
        schema: opts.schema,
      },
    },
    max_output_tokens: opts.maxTokens,
  };

  let resp: Response;
  try {
    resp = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(OPENAI_FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
      throw new ReporteError("OpenAI no respondió a tiempo (timeout). Probá de nuevo o con un archivo más chico.");
    }
    throw err;
  }

  if (!resp.ok) {
    const errText = await resp.text().catch(() => resp.statusText);
    throw new ReporteError(`OpenAI API error ${resp.status}: ${errText.slice(0, 500)}`);
  }
  const data = await resp.json();

  if (data.status === "failed") {
    throw new ReporteError(`OpenAI: la respuesta falló (${data.error?.message ?? "desconocido"}).`);
  }
  if (data.status === "incomplete") {
    // La respuesta se cortó antes de terminar (típicamente por max_output_tokens con un
    // documento de muchas filas). No tiene sentido reintentar con el mismo contenido y el
    // mismo límite de tokens -truncaría en el mismo punto-, así que cortamos acá con un
    // mensaje explícito en vez de dejar que el JSON parcial falle como "JSON inválido".
    const reason = data.incomplete_details?.reason;
    if (reason === "max_output_tokens") {
      throw new ReporteError(
        "El documento tiene demasiadas filas para extraer en una sola pasada (la respuesta de OpenAI se truncó por el límite de tokens). Probá dividir el archivo en partes más chicas.",
      );
    }
    throw new ReporteError(`OpenAI: la respuesta quedó incompleta (${reason ?? "motivo desconocido"}).`);
  }

  let outputText: string | undefined;
  for (const item of data.output ?? []) {
    if (item.type !== "message") continue;
    for (const c of item.content ?? []) {
      if (c.type === "refusal") {
        throw new ReporteError(`OpenAI rechazó procesar el documento: ${c.refusal}`);
      }
      if (c.type === "output_text" && typeof c.text === "string") {
        outputText = c.text;
      }
    }
  }
  if (!outputText && typeof data.output_text === "string") outputText = data.output_text;
  if (!outputText) {
    throw new ReporteError("OpenAI no devolvió contenido de texto en la respuesta.");
  }
  return outputText;
}

async function callOpenAI(opts: {
  apiKey: string;
  model: string;
  esVenta: boolean;
  content: unknown[];
  maxTokens?: number;
}): Promise<ExtraccionResultado> {
  const schema = buildJsonSchema(opts.esVenta);
  const maxTokens = opts.maxTokens ?? 8192;

  let raw = await callOpenAIRaw({ apiKey: opts.apiKey, model: opts.model, content: opts.content, schema, maxTokens });
  let parsed = safeJsonParse<any>(raw, null);

  if (!parsed) {
    // Reintento único: pedirle solo JSON válido (defensa extra; con json_schema strict esto
    // no debería pasar salvo truncamiento por max_output_tokens u otra rareza del modelo).
    const retryContent = [
      ...opts.content,
      {
        type: "input_text",
        text:
          "Tu respuesta anterior no era JSON válido. Respondé ÚNICAMENTE con el JSON que cumple " +
          "exactamente el schema indicado, sin texto adicional, sin bloques de código ni comentarios.",
      },
    ];
    raw = await callOpenAIRaw({ apiKey: opts.apiKey, model: opts.model, content: retryContent, schema, maxTokens });
    parsed = safeJsonParse<any>(raw, null);
    if (!parsed) {
      throw new ReporteError("OpenAI no devolvió JSON válido tras un reintento.");
    }
  }

  return normalizarExtraccion(parsed);
}

async function testOpenAIConnection(
  apiKey: string,
  model: string,
): Promise<{ ok: boolean; model: string; latency_ms?: number; error?: string }> {
  const start = Date.now();
  try {
    const resp = await fetch(OPENAI_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        input: [{ role: "user", content: [{ type: "input_text", text: "Respondé solo OK" }] }],
        max_output_tokens: 16,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const latency_ms = Date.now() - start;
    if (!resp.ok) {
      const errText = await resp.text().catch(() => resp.statusText);
      return { ok: false, model, error: `OpenAI API error ${resp.status}: ${errText.slice(0, 300)}` };
    }
    await resp.json().catch(() => null);
    return { ok: true, model, latency_ms };
  } catch (err) {
    return { ok: false, model, error: err instanceof Error ? err.message : String(err) };
  }
}

// Lee la llave/modelo de OpenAI de la tabla `configuracion` (claves openai_api_key /
// openai_model, valores jsonb — a veces viajan como STRING con JSON codificado, hay que
// parsearlos), con fallback al secreto OPENAI_API_KEY del proyecto. `overrideKey`/`overrideModel`
// permiten probar una llave/modelo antes de guardarlos (botón "Probar conexión").
function parseConfigValor(v: unknown): unknown {
  if (typeof v === "string") {
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  }
  return v;
}

async function getOpenAIConfig(
  admin: SupabaseClient,
  overrideKey?: string,
  overrideModel?: string,
): Promise<{ apiKey: string | null; model: string }> {
  let apiKey = overrideKey ?? null;
  let model = overrideModel ?? null;

  if (!apiKey || !model) {
    const { data } = await admin
      .from("configuracion")
      .select("clave, valor")
      .in("clave", ["openai_api_key", "openai_model"]);
    for (const row of data ?? []) {
      const val = parseConfigValor(row.valor);
      if (row.clave === "openai_api_key" && !apiKey && typeof val === "string" && val.trim()) apiKey = val.trim();
      if (row.clave === "openai_model" && !model && typeof val === "string" && val.trim()) model = val.trim();
    }
  }

  if (!apiKey) apiKey = Deno.env.get("OPENAI_API_KEY") ?? null;
  if (!model) model = DEFAULT_MODEL;
  return { apiKey, model };
}

// ---------------------------------------------------------------------------
// Handler principal
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return json({ error: "Método no permitido, usá POST." }, 405);
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return json({ error: "Falta configuración de Supabase en el entorno de la función." }, 500);
  }
  const admin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Verificación de identidad: verify_jwt=true (default de la plataforma, sin override en
  // config.toml) sólo valida que el JWT esté firmado con el secreto del proyecto — la anon key
  // pública (embebida en el bundle estático de GitHub Pages) también cumple eso. Hay que
  // resolver el usuario real detrás del token ANTES de tocar `configuracion`/`reportes` o de
  // llamar a OpenAI, y cubrir esto también en la rama test_ai (no requiere reporte_id).
  const authHeader = req.headers.get("authorization") ?? "";
  const authToken = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!authToken) {
    return json({ error: "No autenticado." }, 401);
  }
  const { data: authData, error: authErr } = await admin.auth.getUser(authToken);
  if (authErr || !authData?.user) {
    return json({ error: "No autenticado." }, 401);
  }

  let bodyJson: any = null;
  try {
    bodyJson = await req.json().catch(() => null);
  } catch {
    return json({ error: "Body inválido, se espera JSON { reporte_id }." }, 400);
  }

  // Modo de prueba de conexión (botón "Probar conexión" en Configuración → Conexión de IA).
  // No toca ningún reporte; si vienen api_key/model en el body, se prueban ESOS valores en
  // vez de los guardados (para validar antes de guardar).
  if (bodyJson?.test_ai === true) {
    const overrideKey =
      typeof bodyJson.api_key === "string" && bodyJson.api_key.trim() ? bodyJson.api_key.trim() : undefined;
    const overrideModel =
      typeof bodyJson.model === "string" && bodyJson.model.trim() ? bodyJson.model.trim() : undefined;
    const { apiKey, model } = await getOpenAIConfig(admin, overrideKey, overrideModel);
    if (!apiKey) {
      return json({ ok: false, error: "Falta configurar la llave de OpenAI en Configuración → Conexión de IA" }, 200);
    }
    const result = await testOpenAIConnection(apiKey, model);
    return json(result, 200);
  }

  let reporteId: string | undefined = bodyJson?.reporte_id;
  if (!reporteId || typeof reporteId !== "string") {
    return json({ error: "Falta reporte_id (uuid) en el body." }, 400);
  }

  try {
    // 1. Leer reporte y marcar extrayendo
    const { data: reporte, error: repErr } = await admin
      .from("reportes")
      .select("*")
      .eq("id", reporteId)
      .single();
    if (repErr || !reporte) {
      return json({ error: `Reporte no encontrado: ${repErr?.message ?? reporteId}` }, 404);
    }

    const { apiKey: OPENAI_API_KEY, model: OPENAI_MODEL } = await getOpenAIConfig(admin);
    if (!OPENAI_API_KEY) {
      const msg = "Falta configurar la llave de OpenAI en Configuración → Conexión de IA";
      await admin.from("reportes").update({ estado: "error", error: msg }).eq("id", reporteId);
      return json({ error: msg }, 500);
    }

    await admin.from("reportes").update({ estado: "extrayendo", error: null }).eq("id", reporteId);

    // 2. Descargar archivo
    const { data: fileBlob, error: dlErr } = await admin.storage.from("reportes").download(reporte.storage_path);
    if (dlErr || !fileBlob) {
      throw new ReporteError(`No se pudo descargar el archivo del storage: ${dlErr?.message ?? "desconocido"}`);
    }
    const arrayBuffer = await fileBlob.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    const sizeMb = bytes.byteLength / (1024 * 1024);
    if (sizeMb > 30) {
      throw new ReporteError(`Archivo demasiado grande (${sizeMb.toFixed(1)} MB, máx ~30 MB).`);
    }

    const nombreArchivo = (reporte.nombre_archivo || reporte.storage_path || "").toLowerCase();
    const mime = (reporte.mime || "").toLowerCase();
    const ext = nombreArchivo.split(".").pop() || "";

    const esCsv = ext === "csv" || mime.includes("csv");
    const esXlsx = ["xlsx", "xls"].includes(ext) || mime.includes("spreadsheet") || mime.includes("excel");
    const esPdf = ext === "pdf" || mime.includes("pdf");
    const esImagen = ["png", "jpg", "jpeg", "webp", "gif"].includes(ext) || mime.startsWith("image/");

    if (!esCsv && !esXlsx && !esPdf && !esImagen) {
      throw new ReporteError(`Tipo de archivo no soportado (mime=${mime || "?"}, ext=${ext || "?"}).`);
    }

    // El tipo 'venta_interna' determina qué variante de tool usar; si el reporte
    // vino como 'otro' recién sabremos con certeza después de leer tipo_detectado,
    // pero para CSV/XLSX igual necesitamos elegir la tool ANTES de llamar al modelo,
    // así que usamos el tipo declarado como mejor estimación.
    // 'actualizacion_abb' también necesita el schema de venta: son los únicos campos
    // (aseguradora/cliente/agente/oficina por fila) que procesarAbb() puede consumir; sin
    // ellos, un ABB en PDF/imagen no tiene forma de resolver aseguradora por fila y
    // termina procesando 0 pólizas.
    const esVentaEsperada = reporte.tipo === "venta_interna" || reporte.tipo === "actualizacion_abb";

    let extraccion: ExtraccionResultado;
    let filasCrudas: Record<string, unknown>[] = [];
    let headers: string[] = [];

    if (esCsv || esXlsx) {
      filasCrudas = esCsv ? parseCsv(new TextDecoder("utf-8").decode(bytes)) : parseXlsx(bytes);
      if (filasCrudas.length === 0) {
        throw new ReporteError("El archivo no tiene filas de datos.");
      }
      headers = Object.keys(filasCrudas[0]);
      const muestra = filasCrudas.slice(0, 30);
      const textoMuestra =
        `Encabezados (${headers.length}): ${JSON.stringify(headers)}\n\n` +
        `Primeras ${muestra.length} filas (de ${filasCrudas.length} totales) en JSON:\n` +
        JSON.stringify(muestra, null, 0);

      extraccion = await callOpenAI({
        apiKey: OPENAI_API_KEY,
        model: OPENAI_MODEL,
        esVenta: esVentaEsperada,
        maxTokens: 4096,
        content: [
          {
            type: "input_text",
            text:
              `Archivo: ${reporte.nombre_archivo} (tipo declarado: ${reporte.tipo}).\n` +
              `Es una hoja de cálculo/CSV de ${filasCrudas.length} filas. NO necesito las filas completas: dejá "filas": [] ` +
              `y completá solamente tipo_detectado, aseguradora_detectada, periodo, mapeo_columnas (columna_origen -> campo_destino), ` +
              `columnas_sin_mapeo, confianza_promedio y resumen.\n\n${textoMuestra}`,
          },
        ],
      });
    } else {
      const mediaType = esPdf
        ? "application/pdf"
        : ext === "png"
        ? "image/png"
        : ext === "webp"
        ? "image/webp"
        : ext === "gif"
        ? "image/gif"
        : "image/jpeg";

      // Con un PDF largo (statements de aseguradora con decenas/cientos de filas
      // repetitivas) el modelo tiende a dejar de transcribir a mitad de camino sin avisar —
      // no es un límite de tokens (eso ya se detecta como "incomplete" más arriba), simplemente
      // deja de leer. Partir el PDF en páginas individuales y pedirle a la IA una extracción
      // por página reduce mucho ese problema: cada llamada solo tiene que leer una página, no
      // el documento entero. Import dinámico + try/catch a propósito: si pdf-lib no puede
      // partir este PDF en particular (estructura rara, PDF encriptado, etc.) o directamente no
      // carga en este runtime, seguimos con el documento entero en un solo llamado — el mismo
      // comportamiento que había antes de este cambio — en vez de romper toda la extracción.
      let paginasBytes: Uint8Array[] = [bytes];
      if (esPdf) {
        try {
          const { PDFDocument } = await import("pdf-lib");
          const pdfDoc = await PDFDocument.load(bytes);
          const numPaginas = pdfDoc.getPageCount();
          if (numPaginas > 1) {
            const partes: Uint8Array[] = [];
            for (let i = 0; i < numPaginas; i++) {
              const nuevoPdf = await PDFDocument.create();
              const [pagina] = await nuevoPdf.copyPages(pdfDoc, [i]);
              nuevoPdf.addPage(pagina);
              partes.push(await nuevoPdf.save());
            }
            paginasBytes = partes;
          }
        } catch (splitErr) {
          console.error("No se pudo partir el PDF en páginas, se procesa entero:", splitErr);
        }
      }

      const totalPaginas = paginasBytes.length;

      // Capa de texto del PDF: si sale, la IA recibe la tabla ya transcrita y solo tiene que
      // mapear columnas. Es la diferencia entre leer 188 filas de United y leer las 218.
      let textoPaginas: string[] | null = null;
      if (esPdf) {
        try {
          const t = await textoDePaginasPdf(bytes);
          // Un escaneo devuelve la capa vacía o cuatro caracteres sueltos: ahí el texto no sirve
          // y hay que mandarle el archivo a la IA igual que antes. Se tolera una página flaca
          // (una carátula, un pie suelto) sin descartar todo el documento.
          const utiles = t.filter((p) => p.trim().length > 80).length;
          if (utiles > 0 && utiles >= t.length - 1) {
            // Si pdf-lib no pudo partir el PDF, va todo el texto en un solo llamado.
            textoPaginas = t.length === totalPaginas ? t : [t.join("\n\n")];
          }
        } catch (txtErr) {
          console.error("No se pudo leer la capa de texto del PDF, se manda el archivo:", txtErr);
        }
      }

      const extraerPagina = (paginaBytes: Uint8Array, i: number) => {
        const sufijoPagina = totalPaginas > 1 ? ` (página ${i + 1} de ${totalPaginas})` : "";
        const dondeEsta = totalPaginas > 1 ? "esta página" : "el documento";
        const texto = textoPaginas ? textoPaginas[i] ?? "" : null;

        if (texto) {
          return callOpenAI({
            apiKey: OPENAI_API_KEY,
            model: OPENAI_MODEL,
            esVenta: esVentaEsperada,
            maxTokens: 16384,
            content: [{
              type: "input_text",
              text: `Archivo: ${reporte.nombre_archivo}${sufijoPagina} (tipo declarado: ${reporte.tipo}).\n` +
                `Abajo va el texto de ${dondeEsta}, sacado de la capa de texto del propio PDF: un renglón por línea, ` +
                `y las columnas alineadas con espacios en la misma posición que en el papel. Es el texto exacto, ` +
                `no hay que adivinar ni transcribir nada — pasá TODAS las filas de datos al array "filas", una por ` +
                `renglón, sin saltear ninguna ni resumir.\n` +
                `Ojo con los renglones de continuación: arrancan a mitad de línea, sin número de póliza, y pertenecen ` +
                `a la póliza del renglón de arriba — copiales ese número.\n` +
                `Ignorá encabezados, pies de página y renglones de totales. Si en el documento aparece cuántas ` +
                `transacciones tiene, reportalo en total_filas_documento.\n` +
                `Completá también tipo_detectado, aseguradora_detectada, periodo, mapeo_columnas, columnas_sin_mapeo, ` +
                `confianza_promedio y resumen.\n\n${texto}`,
            }],
          });
        }

        const b64 = base64FromBytes(paginaBytes);
        const dataUrl = `data:${mediaType};base64,${b64}`;
        const instructionText =
          `Archivo: ${reporte.nombre_archivo}${sufijoPagina} (tipo declarado: ${reporte.tipo}). ` +
          `Extraé TODAS las filas/registros que encuentres en ${dondeEsta}, ` +
          `completando el array "filas" por completo — no resumas ni muestrees, aunque tenga muchas filas repetitivas. ` +
          `Si acá aparece un total de transacciones en el resumen/pie de página, reportalo en total_filas_documento. ` +
          `Completá también tipo_detectado, aseguradora_detectada, periodo, mapeo_columnas, columnas_sin_mapeo, confianza_promedio y resumen.`;
        const block = esPdf
          ? { type: "input_file", filename: reporte.nombre_archivo || "reporte.pdf", file_data: dataUrl }
          : { type: "input_image", image_url: dataUrl };

        return callOpenAI({
          apiKey: OPENAI_API_KEY,
          model: OPENAI_MODEL,
          esVenta: esVentaEsperada,
          // Techo real de salida de gpt-4o-mini (Responses API); con 8192 un statement con
          // ~100+ filas ya truncaba el array "filas" a mitad de camino.
          maxTokens: 16384,
          content: [{ type: "input_text", text: instructionText }, block],
        });
      };

      const combinar = (paginas: ExtraccionResultado[]): ExtraccionResultado => {
        if (paginas.length === 1) return paginas[0];
        // Combinar las filas de todas las páginas en un solo resultado. El resto de los
        // metadatos (tipo, aseguradora, período, mapeo) se toman de la primera página porque
        // son los mismos en todo el documento. total_filas_documento normalmente solo viene en
        // la página que trae el resumen final (no necesariamente la primera).
        const filasCombinadas: Record<string, unknown>[] = [];
        for (const r of paginas) {
          for (const f of (r.filas ?? []) as Record<string, unknown>[]) {
            filasCombinadas.push({ ...f, fila: filasCombinadas.length + 1 });
          }
        }
        const totalReportado = paginas.map((r) => r.total_filas_documento).find((n) => n != null) ?? null;
        return { ...paginas[0], filas: filasCombinadas, total_filas_documento: totalReportado } as ExtraccionResultado;
      };

      let porPagina = await Promise.all(paginasBytes.map(extraerPagina));
      extraccion = combinar(porPagina);

      // Segunda pasada cuando el documento dice tener más filas de las que se extrajeron. El
      // modelo no es determinístico: una página que en un intento se corta, en otro suele salir
      // completa. Se reintenta todo el documento una sola vez y, página por página, se conserva
      // el intento que trajo MÁS filas (nunca menos que lo que ya teníamos).
      const esperadasDoc = extraccion.total_filas_documento;
      const filasPrimeraPasada = (extraccion.filas ?? []).length;
      if (totalPaginas > 1 && esperadasDoc != null && esperadasDoc > 0 && filasPrimeraPasada < esperadasDoc) {
        try {
          const segunda = await Promise.all(paginasBytes.map(extraerPagina));
          const mejores = porPagina.map((p, i) => {
            const a = (p.filas ?? []).length;
            const b = (segunda[i]?.filas ?? []).length;
            return b > a ? segunda[i] : p;
          });
          const combinadoMejor = combinar(mejores);
          if ((combinadoMejor.filas ?? []).length > filasPrimeraPasada) {
            porPagina = mejores;
            extraccion = combinadoMejor;
          }
        } catch (segundaErr) {
          // Si la segunda pasada falla (rate limit, timeout), nos quedamos con la primera.
          console.error("Segunda pasada de extracción falló, se usa la primera:", segundaErr);
        }
      }
    }

    const tipoDetectado = extraccion.tipo_detectado || reporte.tipo;
    const tipoEfectivo = reporte.tipo && reporte.tipo !== "otro" ? reporte.tipo : tipoDetectado;

    // Resolver aseguradora_id si falta
    let aseguradoraId: string | null = reporte.aseguradora_id ?? null;
    if (!aseguradoraId && extraccion.aseguradora_detectada) {
      const { data: asegMatch } = await admin
        .from("aseguradoras")
        .select("id, nombre")
        .ilike("nombre", `%${extraccion.aseguradora_detectada}%`)
        .limit(1);
      if (asegMatch && asegMatch.length > 0) aseguradoraId = asegMatch[0].id;
    }

    // Actualización base de metadatos del reporte (se termina de completar según el tipo)
    const metaUpdate: Record<string, unknown> = {
      mapeo_columnas: extraccion.mapeo_columnas ?? null,
      columnas_detectadas: headers.length ? headers : extraccion.columnas_sin_mapeo ?? null,
      confianza_promedio: extraccion.confianza_promedio ?? null,
      resumen_ia: extraccion.resumen ?? null,
      periodo: reporte.periodo ?? extraccion.periodo ?? null,
    };
    if (aseguradoraId && !reporte.aseguradora_id) metaUpdate.aseguradora_id = aseguradoraId;

    // -----------------------------------------------------------------------
    // Construir filas finales aplicando el mapeo (para CSV/XLSX) o usando las
    // filas que ya devolvió el modelo (PDF/imagen).
    // -----------------------------------------------------------------------
    function filasDesdeMapeo(): Record<string, unknown>[] {
      const mapeo = extraccion.mapeo_columnas ?? {};
      return filasCrudas.map((raw, idx) => {
        const out: Record<string, unknown> = { fila: idx + 1, campos_extra: {} as Record<string, unknown> };
        for (const [colOrigen, valor] of Object.entries(raw)) {
          // La sección no es una columna del archivo sino una marca que puso el parser. Se
          // guarda siempre en campos_extra: si el modelo decidiera mapearla a tipo_transaccion
          // llegaría el texto "Renewal Year Commission" donde va un código, y el dato real se
          // perdería. Acá la lee tipoDeTransaccion(), que sabe qué hacer con ella.
          if (colOrigen === COL_SECCION) {
            (out.campos_extra as Record<string, unknown>)[colOrigen] = valor;
            continue;
          }
          const crudo = mapeo[colOrigen];
          const campoDestino = crudo ? ALIAS_CAMPOS[crudo] ?? crudo : crudo;
          if (campoDestino && (CAMPOS_COMISION as readonly string[]).concat(CAMPOS_VENTA).includes(campoDestino)) {
            out[campoDestino] = valor;
          } else {
            (out.campos_extra as Record<string, unknown>)[colOrigen] = valor;
          }
        }
        return out;
      });
    }

    const usarFilasDelModelo = (esPdf || esImagen) && Array.isArray(extraccion.filas) && extraccion.filas.length > 0;
    const filasFinal: Record<string, unknown>[] = usarFilasDelModelo
      ? (extraccion.filas as Record<string, unknown>[]).map((f, idx) => ({ fila: f.fila ?? idx + 1, ...f }))
      : filasDesdeMapeo();

    // Freno de seguridad: en documentos PDF/imagen largos y repetitivos, el modelo a veces
    // devuelve una respuesta "completa" (sin error de OpenAI) pero con solo una fracción de
    // las filas reales — no es un truncamiento por límite de tokens (eso ya se detecta arriba
    // como incomplete), sino que el modelo deja de transcribir antes de terminar. Cuando el
    // documento reporta su propio total de transacciones, lo comparamos y preferimos fallar
    // con un mensaje claro antes que guardar un statement a medias como si estuviera completo.
    // Dos umbrales a propósito: por debajo del 75% falta tanto que guardar sería peor que no
    // hacer nada (el caso real fue 7 de 219). Entre 75% y 95% puede ser una diferencia de
    // criterio sobre qué cuenta como "transacción" en el resumen del documento, y bloquear todo
    // por eso deja al usuario sin ver un centavo de su statement: se guarda, pero con un aviso
    // visible en el resumen para que sepa que puede faltar algo.
    if (usarFilasDelModelo && extraccion.total_filas_documento != null && extraccion.total_filas_documento > 0) {
      const esperadas = extraccion.total_filas_documento;
      const extraidas = filasFinal.length;
      if (extraidas < esperadas * 0.75) {
        throw new ReporteError(
          `La IA extrajo solo ${extraidas} de ${esperadas} filas que el documento dice tener — probablemente se salteó filas de un documento largo. No se guardó nada para evitar un statement incompleto. Reintentá la extracción.`,
        );
      }
      if (extraidas < esperadas * 0.95) {
        metaUpdate.resumen_ia =
          `⚠ Revisar: se extrajeron ${extraidas} de las ${esperadas} filas que el documento dice tener. ` +
          `Puede faltar alguna transacción. ${metaUpdate.resumen_ia ?? ""}`.trim();
      }
    }

    // -----------------------------------------------------------------------
    // Ramas por tipo de reporte
    // -----------------------------------------------------------------------
    if (tipoEfectivo === "venta_interna") {
      const batch = filasFinal.map((f) => ({
        reporte_id: reporteId,
        fila: f.fila ?? null,
        agente_nombre_crudo: f.agente_nombre_crudo ?? null,
        oficina_nombre_crudo: f.oficina_nombre_crudo ?? null,
        cliente_nombre_crudo: f.cliente_nombre_crudo ?? null,
        telefono: f.telefono ?? null,
        email: f.email ?? null,
        numero_poliza: f.numero_poliza ?? null,
        aseguradora_nombre_crudo: f.aseguradora_nombre_crudo ?? null,
        ramo: coerceRamo(f.ramo),
        fecha_venta: coerceDate(f.fecha_venta),
        fecha_vigencia: coerceDate(f.fecha_vigencia),
        prima: coerceNumber(f.prima),
        campos_extra: f.campos_extra ?? {},
        confianza: f.confianza ?? extraccion.confianza_promedio ?? null,
      }));

      await limpiarLineasPrevias(admin, reporteId!);
      await limpiarLineasPrevias(admin, reporteId!);
      for (const b of chunk(batch, 500)) {
        const { error: insErr } = await admin.from("lineas_venta").insert(b);
        if (insErr) throw new ReporteError(`Insertando lineas_venta: ${insErr.message}`);
      }

      await admin.from("reportes").update({ ...metaUpdate, total_lineas: batch.length }).eq("id", reporteId);
      const { error: rpcErr } = await admin.rpc("procesar_ventas", { p_reporte_id: reporteId });
      if (rpcErr) throw new ReporteError(`procesar_ventas: ${rpcErr.message}`);
    } else if (tipoEfectivo === "actualizacion_abb") {
      await procesarAbb(admin, reporteId!, reporte, filasFinal, aseguradoraId, metaUpdate);
    } else if (tipoEfectivo === "bono_contingencia") {
      await procesarBono(admin, reporteId!, reporte, filasFinal, aseguradoraId, extraccion, metaUpdate);
    } else {
      // comision_aseguradora / chargebacks / produccion / cancelaciones / renovaciones / resumen_anual

      // Reparar números de póliza sin prefijo alfabético usando el Book de la misma aseguradora.
      // En statements tipo "01 UAD -610794900" el extractor a veces se queda solo con
      // "-610794900" y pierde el "UAD"; el Book tiene "UAD610794900", así que el match exacto
      // por numero_normalizado nunca cruza. Si el bloque numérico coincide con UNA sola póliza
      // de esta aseguradora en el Book, usamos ese número completo.
      if (aseguradoraId) {
        const soloDigitos = (v: unknown) => String(v ?? "").replace(/\D/g, "").replace(/^0+/, "");
        const sinPrefijo = filasFinal.filter((f) => f.numero_poliza && !/[A-Za-z]/.test(String(f.numero_poliza)) && soloDigitos(f.numero_poliza));
        if (sinPrefijo.length > 0) {
          const { data: polizasAseg } = await admin.from("polizas").select("numero_normalizado").eq("aseguradora_id", aseguradoraId);
          const porDigitos = new Map<string, string[]>();
          for (const p of polizasAseg ?? []) {
            const d = soloDigitos(p.numero_normalizado);
            if (!d) continue;
            if (!porDigitos.has(d)) porDigitos.set(d, []);
            porDigitos.get(d)!.push(p.numero_normalizado);
          }
          let reparadas = 0;
          for (const f of sinPrefijo) {
            const candidatos = porDigitos.get(soloDigitos(f.numero_poliza));
            if (candidatos && candidatos.length === 1) {
              f.numero_poliza = candidatos[0];
              reparadas++;
            }
          }
          if (reparadas > 0) {
            metaUpdate.resumen_ia = `${metaUpdate.resumen_ia ?? ""} (${reparadas} número(s) de póliza completados con el prefijo del Book)`.trim();
          }
        }
      }

      // Normalizar el signo de las comisiones. Algunas aseguradoras (ej. United Automobile)
      // muestran la comisión ganada como NEGATIVA (es "lo que te debemos" desde su contabilidad)
      // y el chargeback como positivo — exactamente al revés de la convención del sistema
      // (positivo = ganado, negativo = chargeback). Si las líneas del statement son
      // mayoritariamente negativas, es esa convención invertida: se da vuelta el signo de todas.
      // Solo aplica al statement general de comisiones; un reporte de tipo "chargebacks" es
      // legítimamente todo negativo.
      if (tipoEfectivo === "comision_aseguradora") {
        const montos = filasFinal.map((f) => coerceNumber(f.monto) ?? 0).filter((m) => m !== 0);
        const negativos = montos.filter((m) => m < 0).length;
        if (montos.length >= 10 && negativos / montos.length >= 0.75) {
          for (const f of filasFinal) {
            const m = coerceNumber(f.monto);
            if (m != null && m !== 0) f.monto = -m;
          }
          metaUpdate.resumen_ia = `${metaUpdate.resumen_ia ?? ""} (Signos normalizados: esta aseguradora muestra las comisiones ganadas como negativas; se invirtieron para que positivo = ganado)`.trim();
        }
      }

      // Hay aseguradoras que guardan la tasa como fracción: Progressive pone 0.1 donde son 10% y
      // 0.09 donde son 9%. Guardarla tal cual hace que la pantalla diga "0.1%". No alcanza con
      // "si es menor que 1, multiplicá": una comisión real del 0.5% existe. Se comprueba contra
      // los números de la propia fila — si monto/prima da ese mismo valor, la fracción es la
      // lectura correcta y recién ahí se convierte.
      const tasaNormalizada = (f: Record<string, unknown>): number | null => {
        const tasa = coerceNumber(f.tasa);
        const prima = coerceNumber(f.prima);
        const monto = coerceNumber(f.monto);
        if (tasa === null || tasa <= 0 || tasa >= 1) return tasa;
        if (!prima || prima === 0 || monto === null) return tasa;
        return Math.abs(Math.abs(monto / prima) - tasa) < 0.005 ? tasa * 100 : tasa;
      };

      const batch = filasFinal.map((f) => ({
        reporte_id: reporteId,
        fila: f.fila ?? null,
        numero_poliza_crudo: f.numero_poliza ?? null,
        nombre_asegurado_crudo: f.nombre_asegurado ?? null,
        productor_crudo: f.productor ?? null,
        tipo_transaccion: tipoDeTransaccion(f),
        ramo: coerceRamo(f.ramo),
        prima: coerceNumber(f.prima),
        tasa: tasaNormalizada(f),
        monto: coerceNumber(f.monto) ?? 0,
        fecha_vigencia: coerceDate(f.fecha_vigencia),
        fecha_statement: coerceDate(f.fecha_statement) ?? coerceDate(reporte.periodo),
        campos_extra: esReferenciaPeriodoAnterior(f)
          ? { ...((f.campos_extra as Record<string, unknown>) ?? {}), categoria_ajuste: "referencia" }
          : f.campos_extra ?? {},
        confianza: f.confianza ?? extraccion.confianza_promedio ?? null,
        // United pone arriba del statement cuánto pagó el mes ANTERIOR. No es plata de este mes,
        // pero se sumaba al total: un statement de $13,611.70 se mostraba como $9,111.38.
        // Marcarla a mano no alcanzaba, porque reprocesar borra las líneas y la marca se perdía —
        // el usuario la marcó tres veces y volvió tres veces. Entra ya descartada, y como
        // procesar_matching solo toca las 'pendiente', el motor ni la mira: sobrevive al reproceso.
        // Las dos columnas van SIEMPRE, aunque sea en null. PostgREST arma el INSERT con la union
        // de las claves de todo el lote: si una sola fila trae `estado` y las demas no, a esas les
        // manda NULL en vez de dejar correr el default, y la columna es NOT NULL. El lote entero se
        // cae. Paso tal cual con United: una sola fila de referencia tumbo las 189.
        estado: esReferenciaPeriodoAnterior(f) ? "descartado" : "pendiente",
        regla_match: esReferenciaPeriodoAnterior(f) ? "no_es_de_este_mes" : null,
      }));

      await limpiarLineasPrevias(admin, reporteId!);
      await limpiarLineasPrevias(admin, reporteId!);
      for (const b of chunk(batch, 500)) {
        const { error: insErr } = await admin.from("lineas_comision").insert(b);
        if (insErr) throw new ReporteError(`Insertando lineas_comision: ${insErr.message}`);
      }

      await admin.from("reportes").update({ ...metaUpdate, estado: "extraido", total_lineas: batch.length }).eq("id", reporteId);
      const { error: rpcErr } = await admin.rpc("procesar_matching", { p_reporte_id: reporteId });
      if (rpcErr) throw new ReporteError(`procesar_matching: ${rpcErr.message}`);
    }

    const { data: finalReporte } = await admin.from("reportes").select("*").eq("id", reporteId).single();
    return json({ ok: true, reporte: finalReporte });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("extraer-reporte error:", msg);
    if (reporteId) {
      await admin.from("reportes").update({ estado: "error", error: msg.slice(0, 500) }).eq("id", reporteId).then(
        () => {},
        () => {},
      );
    }
    return json({ error: msg.slice(0, 500) }, 500);
  }
});

// ---------------------------------------------------------------------------
// actualizacion_abb: nueva versión del Active Business Book
// ---------------------------------------------------------------------------

async function procesarAbb(
  admin: SupabaseClient,
  reporteId: string,
  reporte: any,
  filas: Record<string, unknown>[],
  aseguradoraIdReporte: string | null,
  metaUpdate: Record<string, unknown>,
) {
  // Cachear agentes/oficinas para resolución por similitud en JS.
  const [{ data: agentes }, { data: oficinas }, { data: aseguradoras }] = await Promise.all([
    admin.from("agentes").select("id, nombre, oficina_id").eq("activo", true),
    admin.from("oficinas").select("id, nombre"),
    admin.from("aseguradoras").select("id, nombre"),
  ]);
  const agentesNorm = (agentes ?? []).map((a: any) => ({ ...a, n: normalizarTexto(a.nombre) }));
  const oficinasNorm = (oficinas ?? []).map((o: any) => ({ ...o, n: normalizarTexto(o.nombre) }));
  const aseguradorasNorm = (aseguradoras ?? []).map((a: any) => ({ ...a, n: normalizarTexto(a.nombre) }));
  // Nombres alternativos de aseguradora: la misma compañía llega escrita distinto según la fuente
  // ("Response Ins Co" en el Book, "Responsive" en el statement). Sin esto se crean duplicadas y
  // las pólizas quedan bajo una mientras el statement busca contra la otra.
  const { data: aliasAseg } = await admin.from("aseguradora_alias").select("aseguradora_id, texto");
  const aliasAseguradoraPorTexto = new Map<string, string>(
    (aliasAseg ?? []).map((a: any) => [normalizarTexto(a.texto), a.aseguradora_id as string]),
  );

  function resolverAgente(nombre: string | null | undefined) {
    if (!nombre) return { agenteId: null as string | null, oficinaId: null as string | null };
    const n = normalizarTexto(nombre);
    const exact = agentesNorm.find((a) => a.n === n);
    if (exact) return { agenteId: exact.id, oficinaId: exact.oficina_id };
    const partial = agentesNorm.find((a) => a.n.includes(n) || n.includes(a.n));
    if (partial) return { agenteId: partial.id, oficinaId: partial.oficina_id };
    return { agenteId: null, oficinaId: null };
  }
  function resolverOficina(nombre: string | null | undefined) {
    if (!nombre) return null;
    const n = normalizarTexto(nombre);
    const exact = oficinasNorm.find((o) => o.n === n) ?? oficinasNorm.find((o) => o.n.includes(n) || n.includes(o.n));
    return exact ? exact.id : null;
  }
  function resolverAseguradora(nombre: string | null | undefined) {
    if (!nombre) return aseguradoraIdReporte;
    const n = normalizarTexto(nombre);
    // Los alias primero y por igualdad exacta: son nombres que alguien mapeó a mano a una
    // aseguradora concreta, así que valen más que cualquier parecido que podamos adivinar.
    const alias = aliasAseguradoraPorTexto.get(n);
    if (alias) return alias;
    const exact = aseguradorasNorm.find((a) => a.n === n) ?? aseguradorasNorm.find((a) => a.n.includes(n) || n.includes(a.n));
    return exact ? exact.id : aseguradoraIdReporte;
  }

  // Tiene que ser IDÉNTICA a la función SQL normalizar_poliza() (la usa el trigger
  // polizas_normalizar_trg antes de cada insert/update): separa letras/dígitos y recorta los
  // ceros a la izquierda del bloque numérico. Antes esta función hacía solo
  // toUpperCase()+quitar símbolos, sin tocar los ceros — entonces "UAE000279928" (como viene
  // en el statement) y "UAE279928" (como quedó guardado, ya normalizado por el trigger) no
  // coincidían nunca en la búsqueda de abajo, y cada reimportación creaba una póliza duplicada
  // en vez de actualizar la que ya existía.
  function normalizarPoliza(p: string | null | undefined): string | null {
    const s = String(p ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!s) return null;
    const letras = s.match(/^[A-Z]*/)?.[0] ?? "";
    const digitos = s.slice(letras.length);
    if (digitos === "") return letras || null;
    return letras + (digitos.replace(/^0+/, "") || "0");
  }

  // 1. Marcar versiones anteriores como históricas y crear la nueva.
  await admin.from("abb_versiones").update({ estado: "historica" }).eq("estado", "vigente");
  const { data: nuevaVersion, error: versErr } = await admin
    .from("abb_versiones")
    .insert({ archivo_path: reporte.storage_path, subido_por: reporte.subido_por, estado: "vigente" })
    .select()
    .single();
  if (versErr || !nuevaVersion) throw new ReporteError(`Creando abb_versiones: ${versErr?.message}`);

  // 2. Resolver cada fila en memoria (sin ir a la base todavía). Antes esto se hacía fila por
  // fila con 3-4 idas y vueltas a la base por fila (buscar/crear cliente, buscar/crear
  // póliza): con un libro real de ~2000 pólizas son miles de llamadas secuenciales, y la
  // función se queda sin tiempo de ejecución de la plataforma a mitad de camino — corta en un
  // número arbitrario de filas sin ningún error, porque nunca llega a la actualización final
  // de `reportes` (quedaba en "extrayendo" para siempre). Ahora se resuelve todo en memoria y
  // se lee/escribe la base en lotes chicos, sin importar cuántas filas traiga el archivo.
  interface FilaAbb {
    numeroPoliza: string;
    numeroNormalizado: string;
    aseguradoraId: string;
    nombreAsegurado: string;
    nombreNorm: string;
    telefono: string | null;
    email: string | null;
    agenteId: string | null;
    oficinaId: string | null;
    ramo: string;
    fechaVigencia: string | null;
    fechaVencimiento: string | null;
    prima: number | null;
  }
  const prepPorClave = new Map<string, FilaAbb>();
  let sinNumeroPoliza = 0;
  let sinAseguradora = 0;
  // Nombres de agente que el archivo trae pero que no matchean con ningún agente cargado. Antes se
  // descartaban en silencio y el usuario terminaba con cientos de pólizas sin dueño sin ninguna
  // pista de por qué; ahora se cuentan para poder nombrarlos al final.
  const agentesNoReconocidos = new Map<string, number>();

  // Aseguradoras que el Book trae y que todavía no existen: se dan de alta solas. Antes, cada fila
  // de una compañía nueva se descartaba en silencio (fueron 199 de un archivo de 2208), y después
  // su statement no conciliaba nada porque sus pólizas nunca habían entrado. Crear la aseguradora
  // no compromete nada — es apenas un nombre — y es la única forma de que el libro entre completo
  // sin tener que acordarse de darlas de alta a mano antes de subirlo.
  const asegFaltantes = new Map<string, string>(); // normalizado -> nombre tal cual viene
  for (const f of filas) {
    const nom = (f.aseguradora_nombre_crudo as string) ?? (f.campos_extra as any)?.aseguradora ?? null;
    const limpio = String(nom ?? "").trim();
    if (!limpio) continue;
    if (resolverAseguradora(limpio)) continue;
    asegFaltantes.set(normalizarTexto(limpio), limpio);
  }
  const aseguradorasCreadas: string[] = [];
  if (asegFaltantes.size > 0) {
    const { data: creadas, error: errAseg } = await admin
      .from("aseguradoras")
      .insert(Array.from(asegFaltantes.values()).map((nombre) => ({ nombre })))
      .select("id, nombre");
    if (errAseg) throw new ReporteError(`Creando aseguradoras nuevas del libro: ${errAseg.message}`);
    for (const a of creadas ?? []) {
      aseguradorasNorm.push({ ...a, n: normalizarTexto(a.nombre) } as any);
      aseguradorasCreadas.push(a.nombre);
    }
  }

  for (const f of filas) {
    const numeroPoliza = (f.numero_poliza as string) ?? null;
    const numeroNormalizado = numeroPoliza ? normalizarPoliza(numeroPoliza) : null;
    if (!numeroPoliza || !numeroNormalizado) {
      sinNumeroPoliza++;
      continue;
    }

    const asegNombre = (f.aseguradora_nombre_crudo as string) ?? (f.campos_extra as any)?.aseguradora ?? null;
    const aseguradoraId = resolverAseguradora(asegNombre as string | null);
    if (!aseguradoraId) {
      sinAseguradora++;
      continue; // sin aseguradora no podemos respetar la unique (aseguradora_id, numero_normalizado)
    }

    const nombreAsegurado = (f.nombre_asegurado as string) ?? (f.cliente_nombre_crudo as string) ?? "Sin nombre";
    const agenteNombre = (f.productor as string) ?? (f.agente_nombre_crudo as string) ?? (f.campos_extra as any)?.agente ?? null;
    const oficinaNombre = (f.oficina_nombre_crudo as string) ?? (f.campos_extra as any)?.oficina ?? null;
    const { agenteId, oficinaId: oficinaPorAgente } = resolverAgente(agenteNombre as string | null);
    const oficinaId = resolverOficina(oficinaNombre as string | null) ?? oficinaPorAgente;
    if (agenteNombre && !agenteId) {
      const crudo = String(agenteNombre).trim();
      if (crudo) agentesNoReconocidos.set(crudo, (agentesNoReconocidos.get(crudo) ?? 0) + 1);
    }

    // Si dos filas del mismo archivo son la misma póliza (misma aseguradora + número), se
    // queda con la última — igual que antes, cuando se procesaba fila por fila y la segunda
    // terminaba actualizando el registro que había dejado la primera.
    prepPorClave.set(`${aseguradoraId}|${numeroNormalizado}`, {
      numeroPoliza,
      numeroNormalizado,
      aseguradoraId,
      nombreAsegurado,
      nombreNorm: normalizarNombreCliente(nombreAsegurado),
      telefono: (f.telefono as string) ?? null,
      email: (f.email as string) ?? null,
      agenteId,
      oficinaId,
      ramo: ramoDelLibro(f),
      fechaVigencia: coerceDate(f.fecha_vigencia),
      fechaVencimiento: coerceDate((f as any).fecha_vencimiento),
      prima: coerceNumber(f.prima),
    });
  }
  const prep = Array.from(prepPorClave.values());

  const LOOKUP_CHUNK = 150; // conservador para no pasarse del largo de URL en filtros .in()
  const WRITE_CHUNK = 500;
  async function enLotes<T>(items: T[], size: number, fn: (trozo: T[]) => Promise<void>) {
    for (let i = 0; i < items.length; i += size) await fn(items.slice(i, i + size));
  }

  // 3. Resolver clientes en lote: buscar por nombre_normalizado, crear los que falten.
  const nombresUnicos = Array.from(new Set(prep.map((p) => p.nombreNorm).filter(Boolean)));
  const clienteIdPorNombre = new Map<string, string>();
  await enLotes(nombresUnicos, LOOKUP_CHUNK, async (trozo) => {
    const { data, error } = await admin.from("clientes").select("id, nombre_normalizado").in("nombre_normalizado", trozo);
    if (error) throw new ReporteError(`Buscando clientes: ${error.message}`);
    for (const c of data ?? []) if (c.nombre_normalizado) clienteIdPorNombre.set(c.nombre_normalizado, c.id);
  });
  const primeraPorNombre = new Map<string, FilaAbb>();
  for (const p of prep) if (p.nombreNorm && !primeraPorNombre.has(p.nombreNorm)) primeraPorNombre.set(p.nombreNorm, p);
  const nombresNuevos = nombresUnicos.filter((n) => !clienteIdPorNombre.has(n));
  await enLotes(nombresNuevos, WRITE_CHUNK, async (trozo) => {
    const filasNuevas = trozo.map((n) => {
      const ref = primeraPorNombre.get(n)!;
      return { nombre: ref.nombreAsegurado, telefono: ref.telefono, email: ref.email };
    });
    const { data, error } = await admin.from("clientes").insert(filasNuevas).select("id, nombre_normalizado");
    if (error) throw new ReporteError(`Creando clientes: ${error.message}`);
    for (const c of data ?? []) if (c.nombre_normalizado) clienteIdPorNombre.set(c.nombre_normalizado, c.id);
  });

  // 4. Resolver pólizas ya existentes en lote (misma clave que la unique de la tabla).
  const numerosUnicos = Array.from(new Set(prep.map((p) => p.numeroNormalizado)));
  const existentePorClave = new Map<string, string>();
  await enLotes(numerosUnicos, LOOKUP_CHUNK, async (trozo) => {
    const { data, error } = await admin.from("polizas").select("id, aseguradora_id, numero_normalizado").in("numero_normalizado", trozo);
    if (error) throw new ReporteError(`Buscando pólizas existentes: ${error.message}`);
    for (const p of data ?? []) existentePorClave.set(`${p.aseguradora_id}|${p.numero_normalizado}`, p.id);
  });

  // 5. Armar filas a guardar y separarlas: nuevas (insert) vs existentes (upsert por id). No
  // se mezclan en un mismo lote porque `id` es NOT NULL — mandar esa columna vacía en una fila
  // nueva del mismo lote rompe el insert de todo el lote, no solo el de esa fila.
  const nuevas: Record<string, unknown>[] = [];
  const actualizaciones: Record<string, unknown>[] = [];
  // Pólizas que ya existían y cuyo agente el archivo NO trae reconocible. Van en su propio lote,
  // SIN las columnas agente_id/oficina_id, para que el upsert no las toque y quede el agente que
  // ya tenían. Antes iban en el mismo lote con agente_id = null y cada subida del Book borraba en
  // silencio las asignaciones hechas a mano en Conciliación — el trabajo del mes anterior.
  // Van aparte y no con una columna menos dentro del mismo lote porque PostgREST arma el UPDATE
  // con el juego de claves del lote: una fila con menos columnas no se salta, se manda como null.
  const actualizacionesSinAgente: Record<string, unknown>[] = [];
  let creadas = 0;
  let actualizadas = 0;
  let agenteRespetado = 0;
  for (const p of prep) {
    const idExistente = existentePorClave.get(`${p.aseguradoraId}|${p.numeroNormalizado}`);
    const fila: Record<string, unknown> = {
      cliente_id: clienteIdPorNombre.get(p.nombreNorm) ?? null,
      numero_poliza: p.numeroPoliza,
      aseguradora_id: p.aseguradoraId,
      ramo: p.ramo,
      fecha_vigencia: p.fechaVigencia,
      fecha_vencimiento: p.fechaVencimiento,
      prima: p.prima,
      origen: "import",
      abb_version_id: nuevaVersion.id,
    };
    if (idExistente) {
      if (p.agenteId) {
        actualizaciones.push({ id: idExistente, ...fila, agente_id: p.agenteId, oficina_id: p.oficinaId });
      } else {
        actualizacionesSinAgente.push({ id: idExistente, ...fila });
        agenteRespetado++;
      }
      actualizadas++;
    } else {
      // En una póliza nueva no hay nada que preservar: si no se reconoció el agente queda vacía y
      // el nombre sale en la lista de no reconocidos para que el usuario lo enseñe una vez.
      nuevas.push({ ...fila, agente_id: p.agenteId, oficina_id: p.oficinaId });
      creadas++;
    }
  }

  await enLotes(nuevas, WRITE_CHUNK, async (trozo) => {
    const { error } = await admin.from("polizas").insert(trozo);
    if (error) throw new ReporteError(`Creando pólizas: ${error.message}`);
  });
  await enLotes(actualizaciones, WRITE_CHUNK, async (trozo) => {
    const { error } = await admin.from("polizas").upsert(trozo, { onConflict: "id" });
    if (error) throw new ReporteError(`Actualizando pólizas: ${error.message}`);
  });
  await enLotes(actualizacionesSinAgente, WRITE_CHUNK, async (trozo) => {
    const { error } = await admin.from("polizas").upsert(trozo, { onConflict: "id" });
    if (error) throw new ReporteError(`Actualizando pólizas (sin tocar el agente): ${error.message}`);
  });

  // Si había filas pero ninguna se pudo cargar, no lo marquemos como 'cerrado' exitoso: eso
  // oculta el problema (ver "Libro actualizado: 0 pólizas procesadas." sin ningún error visible).
  // La causa dominante puede ser falta de numero_poliza o aseguradora no resuelta: contamos
  // cada una por separado (sinNumeroPoliza / sinAseguradora) y elegimos el mensaje según cuál
  // explica más filas salteadas, en vez de asumir siempre que fue la aseguradora.
  const sinResultados = filas.length > 0 && creadas + actualizadas === 0;
  const errorMsg = sinNumeroPoliza >= sinAseguradora
    ? "No se pudo resolver el número de póliza de ninguna fila del libro. Revisá que el archivo incluya el número de póliza por fila."
    : "No se pudo resolver la aseguradora de ninguna fila del libro. Revisá que el archivo incluya la aseguradora por póliza.";

  // Los nombres que no se reconocieron se dicen por su nombre y ordenados por cuántas pólizas
  // arrastra cada uno: esa es la lista corta que hay que mapear una sola vez para que dejen de
  // caer pólizas sin dueño todos los meses. Decir sólo "260 pólizas sin agente" no sirve de nada.
  // Las aseguradoras que se dieron de alta solas se nombran: el usuario tiene que enterarse de que
  // aparecieron compañías nuevas en su libro, aunque no haya tenido que hacer nada.
  // Las filas que no entraron se dicen con su motivo. La pantalla ya mostraba "13 filas sin cuadrar
  // (ni OK ni en excepción)", que deja al usuario con un número y ninguna forma de saber qué pasó ni
  // qué revisar. El motivo es dato que ya teníamos contado y nos lo estábamos guardando.
  const salteadas = sinNumeroPoliza + sinAseguradora;
  const motivosSalteadas = [
    sinNumeroPoliza > 0 ? `${sinNumeroPoliza} sin número de póliza` : null,
    sinAseguradora > 0 ? `${sinAseguradora} sin aseguradora en la fila` : null,
  ].filter(Boolean);
  const avisoSalteadas = salteadas > 0
    ? ` No entraron ${salteadas} fila(s): ${motivosSalteadas.join(" y ")}. Sin esos datos no se puede identificar la póliza.`
    : "";

  const avisoAseguradoras = aseguradorasCreadas.length
    ? ` Se dieron de alta ${aseguradorasCreadas.length} aseguradora(s) que no existían: ${aseguradorasCreadas.join(", ")}.`
    : "";

  const noReconocidos = Array.from(agentesNoReconocidos.entries()).sort((a, b) => b[1] - a[1]);
  const avisoAgentes = noReconocidos.length
    ? ` ⚠ No se reconocieron ${noReconocidos.length} nombre(s) de agente del archivo: ` +
      noReconocidos.slice(0, 10).map(([n, c]) => `"${n}" (${c} póliza${c === 1 ? "" : "s"})`).join(", ") +
      (noReconocidos.length > 10 ? `, y ${noReconocidos.length - 10} más` : "") +
      `. Revisá que estén cargados en Agentes con ese mismo nombre.` +
      (agenteRespetado > 0
        ? ` Se conservó el agente que ya tenían ${agenteRespetado} póliza(s) en vez de dejarlas sin dueño.`
        : "")
    : "";

  await admin
    .from("reportes")
    .update({
      ...metaUpdate,
      estado: sinResultados ? "error" : "cerrado",
      error: sinResultados ? errorMsg : null,
      total_lineas: filas.length,
      total_ok: creadas + actualizadas,
      resumen_ia:
        `${metaUpdate.resumen_ia ?? ""} (ABB: ${creadas} pólizas nuevas, ${actualizadas} actualizadas)${avisoSalteadas}${avisoAseguradoras}${avisoAgentes}`.trim(),
    })
    .eq("id", reporteId);
}

// ---------------------------------------------------------------------------
// bono_contingencia
// ---------------------------------------------------------------------------

async function procesarBono(
  admin: SupabaseClient,
  reporteId: string,
  reporte: any,
  filas: Record<string, unknown>[],
  aseguradoraId: string | null,
  extraccion: ExtraccionResultado,
  metaUpdate: Record<string, unknown>,
) {
  const montos = filas.map((f) => coerceNumber(f.monto) ?? coerceNumber(f.prima) ?? 0);
  const montoTotal = montos.reduce((a, b) => a + b, 0);

  const { data: bono, error: bonoErr } = await admin
    .from("bonos")
    .insert({
      tipo: aseguradoraId ? "contingencia_aseguradora" : "otro",
      nombre: extraccion.resumen ?? reporte.nombre_archivo,
      aseguradora_id: aseguradoraId,
      periodo: reporte.periodo ?? extraccion.periodo ?? null,
      monto_total: montoTotal,
      regla_reparto: "manual",
      estado: "pendiente",
      reporte_id: reporteId,
    })
    .select()
    .single();
  if (bonoErr || !bono) throw new ReporteError(`Creando bono: ${bonoErr?.message}`);

  // Si el statement trae detalle por productor, intentamos repartir por agente.
  const { data: agentes } = await admin.from("agentes").select("id, nombre").eq("activo", true);
  const agentesNorm = (agentes ?? []).map((a: any) => ({ ...a, n: normalizarTexto(a.nombre) }));

  const porAgente = new Map<string, number>();
  filas.forEach((f, idx) => {
    const nombre = (f.productor as string) ?? (f.nombre_asegurado as string) ?? null;
    if (!nombre) return;
    const n = normalizarTexto(nombre);
    const match = agentesNorm.find((a) => a.n === n) ?? agentesNorm.find((a) => a.n.includes(n) || n.includes(a.n));
    if (!match) return;
    const monto = montos[idx] ?? 0;
    porAgente.set(match.id, (porAgente.get(match.id) ?? 0) + monto);
  });

  if (porAgente.size > 0) {
    const repartoBatch = Array.from(porAgente.entries()).map(([agente_id, monto]) => ({
      bono_id: bono.id,
      agente_id,
      monto,
      motivo: "Detalle por productor del statement de bono/contingencia.",
    }));
    const { error: repErr } = await admin.from("bono_reparto").insert(repartoBatch);
    if (repErr) throw new ReporteError(`Creando bono_reparto: ${repErr.message}`);
    await admin.from("bonos").update({ estado: "repartido" }).eq("id", bono.id);
  }

  await admin
    .from("reportes")
    .update({ ...metaUpdate, estado: "cerrado", total_lineas: filas.length, total_ok: filas.length })
    .eq("id", reporteId);
}
