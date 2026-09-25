"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  DICCIONARIOS,
  IDIOMA_POR_DEFECTO,
  type ClaveTexto,
  type Idioma,
} from "@/lib/i18n/textos";

const CLAVE_GUARDADA = "gelpi-idioma";

interface Contexto {
  idioma: Idioma;
  cambiarIdioma: (i: Idioma) => void;
  t: (clave: ClaveTexto, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<Contexto | null>(null);

// El idioma vive en el navegador y no en la base: es una preferencia de quien está mirando la
// pantalla, no un dato de la agencia. Guardarlo en el servidor obligaría a esperar una consulta
// antes de poder dibujar la primera palabra.
function leerGuardado(): Idioma {
  if (typeof window === "undefined") return IDIOMA_POR_DEFECTO;
  try {
    const v = window.localStorage.getItem(CLAVE_GUARDADA);
    return v === "es" || v === "en" ? v : IDIOMA_POR_DEFECTO;
  } catch {
    // Navegador con el almacenamiento bloqueado. No es motivo para romper la pantalla.
    return IDIOMA_POR_DEFECTO;
  }
}

export function I18nProvider({ children }: { children: ReactNode }) {
  // Arranca siempre en el idioma por defecto y recién después de montar lee lo guardado. El sitio
  // se exporta estático: si el primer render dependiera de localStorage, el HTML servido y el que
  // arma React no coincidirían y React tiraría el árbol entero para rehacerlo.
  const [idioma, setIdioma] = useState<Idioma>(IDIOMA_POR_DEFECTO);

  useEffect(() => {
    const guardado = leerGuardado();
    if (guardado !== IDIOMA_POR_DEFECTO) setIdioma(guardado);
  }, []);

  const cambiarIdioma = useCallback((i: Idioma) => {
    setIdioma(i);
    try {
      window.localStorage.setItem(CLAVE_GUARDADA, i);
    } catch {
      // Si no se puede guardar, al menos vale para esta sesión.
    }
    document.documentElement.lang = i;
  }, []);

  const t = useCallback(
    (clave: ClaveTexto, vars?: Record<string, string | number>) => {
      // Si al español le falta una clave se usa el inglés, que está completo por construcción.
      // Mostrar la clave cruda ("statements.title") sería peor que mostrarla en el otro idioma.
      const texto = DICCIONARIOS[idioma]?.[clave] ?? DICCIONARIOS.en[clave] ?? clave;
      if (!vars) return texto;
      return texto.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
    },
    [idioma]
  );

  const valor = useMemo(() => ({ idioma, cambiarIdioma, t }), [idioma, cambiarIdioma, t]);
  return <I18nContext.Provider value={valor}>{children}</I18nContext.Provider>;
}

export function useI18n(): Contexto {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n necesita estar dentro de <I18nProvider>.");
  return ctx;
}

/** Atajo para el caso más común: solo traducir. */
export function useT() {
  return useI18n().t;
}
