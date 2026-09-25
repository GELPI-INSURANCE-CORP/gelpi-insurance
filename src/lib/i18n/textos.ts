// =========================================================
// Los textos de la interfaz, en inglés y en español
// =========================================================
// El inglés es el idioma por defecto porque es el del negocio: las compañías mandan los statements
// en inglés y los términos ya se usan así en la oficina — carrier, statement, chargeback,
// endorsement. Tener media pantalla traducida y media no era lo que más confundía.
//
// El español queda como alternativa elegible en Settings, no como resto de lo anterior: la agencia
// trabaja en Miami y no todos los agentes leen inglés con la misma soltura.
//
// Las claves se leen como una dirección: `pantalla.cosa`. Cuando se agrega una pantalla se agrega
// su bloque acá y se traducen las dos columnas en el mismo commit — si una clave le falta al
// español, el sistema cae al inglés en vez de mostrar la clave cruda en la cara del usuario.

export const IDIOMAS = [
  { value: "en", label: "English" },
  { value: "es", label: "Español" },
] as const;

export type Idioma = (typeof IDIOMAS)[number]["value"];

export const IDIOMA_POR_DEFECTO: Idioma = "en";

const en = {
  // --- Navegación y marco ---
  "nav.dashboard": "Dashboard",
  "nav.commissions": "Commissions",
  "nav.book": "Book of Business",
  "nav.offices": "Offices",
  "nav.bonuses": "Bonuses",
  "nav.settings": "Settings",
  "nav.reconciliation": "Reconciliation",
  "nav.payout": "Agent payout",
  "nav.agents": "Agents",
  "nav.account": "My account",
  "nav.statementDetail": "Statement detail",
  "nav.signOut": "Sign out",

  // --- Pantalla de Commissions (la lista de statements) ---
  "statements.title": "Statements received",
  "statements.subtitle":
    "“Missing” is how many lines on that statement are still waiting on a decision from you, counted right now.",
  "statements.upload": "Upload statement",
  "statements.export": "Export to Excel",
  "statements.totalLabel": "Total received in {mes}",
  "statements.countLabel": "{n} statements · {mes}",
  "statements.missingLabel": "{n} lines waiting on you",
  "statements.allCarriers": "All carriers",
  "statements.allMonths": "All months",
  "statements.noMonth": "No month",
  "statements.empty": "No statements yet",
  "statements.emptyHint": "Upload a carrier statement and the system will split the commissions.",

  // Columnas
  "col.carrier": "Carrier",
  "col.statement": "Statement",
  "col.amount": "Amount",
  "col.lines": "Lines",
  "col.resolved": "Resolved",
  "col.missing": "Missing",
  "col.status": "Status",
  "col.uploaded": "Uploaded",
  "col.office": "Office",
  "col.agent": "Agent",

  // Estados de un statement, dichos en plata y no en jerga del sistema
  "status.reading": "Reading file…",
  "status.readyToPay": "Ready to pay",
  "status.needsWork": "Needs review",
  "status.closed": "Closed",
  "status.failed": "Failed",
  "status.blocked": "Blocked — same file already uploaded",

  // --- Comunes ---
  "common.cancel": "Cancel",
  "common.save": "Save",
  "common.close": "Close",
  "common.retry": "Retry",
  "common.reprocess": "Reprocess",
  "common.noCarrier": "No carrier",
  "common.language": "Language",
} as const;

export type ClaveTexto = keyof typeof en;

const es: Partial<Record<ClaveTexto, string>> = {
  "nav.dashboard": "Panel",
  "nav.commissions": "Comisiones",
  "nav.book": "Book of Business",
  "nav.offices": "Oficinas",
  "nav.bonuses": "Bonos",
  "nav.settings": "Configuración",
  "nav.reconciliation": "Conciliación",
  "nav.payout": "Pago a agentes",
  "nav.agents": "Agentes",
  "nav.account": "Mi cuenta",
  "nav.statementDetail": "Detalle del statement",
  "nav.signOut": "Salir",

  "statements.title": "Statements recibidos",
  "statements.subtitle":
    "“Te faltan” son las líneas de ese statement que todavía esperan una decisión tuya, contadas en este momento.",
  "statements.upload": "Subir statement",
  "statements.export": "Exportar a Excel",
  "statements.totalLabel": "Total recibido en {mes}",
  "statements.countLabel": "{n} statements · {mes}",
  "statements.missingLabel": "{n} líneas te esperan",
  "statements.allCarriers": "Todas las compañías",
  "statements.allMonths": "Todos los meses",
  "statements.noMonth": "Sin mes",
  "statements.empty": "Todavía no hay statements",
  "statements.emptyHint": "Subí el estado de cuenta de una compañía y el sistema reparte las comisiones.",

  "col.carrier": "Compañía",
  "col.statement": "Statement",
  "col.amount": "Monto",
  "col.lines": "Líneas",
  "col.resolved": "Resueltas",
  "col.missing": "Te faltan",
  "col.status": "Estado",
  "col.uploaded": "Subido",
  "col.office": "Oficina",
  "col.agent": "Agente",

  "status.reading": "Leyendo el archivo…",
  "status.readyToPay": "Listo para pagar",
  "status.needsWork": "Por resolver",
  "status.closed": "Cerrado",
  "status.failed": "Falló",
  "status.blocked": "Bloqueado — ese mismo archivo ya se subió",

  "common.cancel": "Cancelar",
  "common.save": "Guardar",
  "common.close": "Cerrar",
  "common.retry": "Reintentar",
  "common.reprocess": "Reprocesar",
  "common.noCarrier": "Sin compañía",
  "common.language": "Idioma",
};

export const DICCIONARIOS: Record<Idioma, Partial<Record<ClaveTexto, string>>> = { en, es };
