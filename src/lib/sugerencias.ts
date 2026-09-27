// ¿Vale la pena ofrecer esta sugerencia?
//
// El motor de conciliación guarda un agente sugerido junto con un score. Cuando no encuentra a
// nadie deja el score en 0, pero igual puede quedar un agente anotado — y las tres pantallas que
// muestran excepciones ofrecían "Confirmar" mirando solo si había un nombre, sin mirar el score.
//
// El resultado era un botón verde invitando a confirmar un agente que el sistema no tiene ningún
// motivo para proponer. En el dashboard llegaba a contradecirse solo: "Sugerencia: Isabel Diaz
// Castillo (0%) — No se encontró ningún candidato". Y lo peor no era el botón suelto sino la
// confirmación en lote, que se lleva por delante todo lo seleccionado de una vez.
//
// La regla vive acá y no repetida en cada pantalla porque si las tres no coinciden, una termina
// ofreciendo confirmar lo que otra esconde.
//
// El umbral es cero y no un número inventado como 50: score 0 significa que el motor no encontró
// nada, y eso es una afirmación del propio sistema. Poner 50 sería yo decidiendo, sin datos, que
// una coincidencia del 40% no sirve — y esas sí se pueden mirar y aceptar a mano.
export function hayQueOfrecerSugerencia(
  agenteSugeridoId: string | null | undefined,
  score: number | null | undefined
): boolean {
  return Boolean(agenteSugeridoId) && (score ?? 0) > 0;
}
