// Un CSV que Excel abra bien en Windows.
//
// Arturo: "cuando se exportan los archivos, los nombres arriba salen bien mal, salen en candela,
// salen bien feo. Porque en español tiene palabras como tilde y la ñ que no salen."
//
// El archivo SIEMPRE se escribió en UTF-8 -- el Blob lo dice: charset=utf-8. El problema es que
// Excel en Windows no le cree: si el archivo no empieza con la marca de orden de bytes, lo abre
// con la página de códigos del sistema y "Póliza" se vuelve "PÃ³liza". Tres caracteres invisibles
// al principio son toda la diferencia.
//
// Poner los encabezados en inglés arregla el síntoma en los títulos, y hay que hacerlo igual.
// Pero NO arregla el fondo: los datos siguen llenos de eñes y acentos -- NUÑEZ, GARCÍA,
// PEÑALVER, "Sin compañía" -- y esos no se pueden traducir. Por eso van las dos cosas.
export const BOM_CSV = "﻿";
