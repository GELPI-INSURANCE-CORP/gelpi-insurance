"use client";
import { FormEvent, useEffect, useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { Card, CardHead } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { REGLAS_CLAVE, changePassword, clavesInvalidas, displayName } from "@/lib/auth";

const campoClase =
  "h-10 rounded-lg border border-border bg-surface px-3 text-sm text-foreground outline-none focus:border-brand";

export default function CuentaPage() {
  const [user, setUser] = useState<User | null>(null);
  const [actual, setActual] = useState("");
  const [nueva, setNueva] = useState("");
  const [repetir, setRepetir] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState(false);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setListo(false);

    const faltantes = clavesInvalidas(nueva);
    if (faltantes.length > 0) {
      setError(`La contraseña nueva no cumple: ${faltantes.join(", ").toLowerCase()}.`);
      return;
    }
    if (nueva !== repetir) {
      setError("Las dos contraseñas nuevas no coinciden.");
      return;
    }
    if (nueva === actual) {
      setError("La contraseña nueva tiene que ser distinta de la actual.");
      return;
    }

    setGuardando(true);
    try {
      await changePassword(actual, nueva);
      setActual("");
      setNueva("");
      setRepetir("");
      setListo(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cambiar la contraseña.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card className="max-w-lg">
        <CardHead
          title="Cambiar contraseña"
          subtitle={user ? `Sesión de ${displayName(user)}` : undefined}
        />
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 px-5 py-5">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted" htmlFor="actual">
              Contraseña actual
            </label>
            <input
              id="actual"
              type="password"
              required
              autoComplete="current-password"
              value={actual}
              onChange={(e) => setActual(e.target.value)}
              className={campoClase}
              placeholder="••••••••"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted" htmlFor="nueva">
              Contraseña nueva
            </label>
            <input
              id="nueva"
              type="password"
              required
              autoComplete="new-password"
              value={nueva}
              onChange={(e) => setNueva(e.target.value)}
              className={campoClase}
              placeholder="••••••••"
            />
          </div>

          <ul className="flex flex-col gap-1">
            {REGLAS_CLAVE.map((regla) => {
              const cumple = regla.ok(nueva);
              return (
                <li
                  key={regla.texto}
                  className={`flex items-center gap-1.5 text-xs ${
                    cumple ? "text-ok-fg" : "text-muted"
                  }`}
                >
                  {cumple ? <Check size={13} /> : <X size={13} />}
                  {regla.texto}
                </li>
              );
            })}
          </ul>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted" htmlFor="repetir">
              Repetir contraseña nueva
            </label>
            <input
              id="repetir"
              type="password"
              required
              autoComplete="new-password"
              value={repetir}
              onChange={(e) => setRepetir(e.target.value)}
              className={campoClase}
              placeholder="••••••••"
            />
          </div>

          {error && <p className="text-xs text-bad-fg">{error}</p>}
          {listo && (
            <p className="text-xs text-ok-fg">
              Listo, la contraseña quedó cambiada. Usá la nueva la próxima vez que entres.
            </p>
          )}

          <button
            type="submit"
            disabled={guardando}
            className="mt-1 flex h-10 items-center justify-center gap-2 rounded-lg bg-brand text-sm font-medium text-white transition hover:bg-brand-dark disabled:opacity-60"
          >
            {guardando && <Loader2 size={16} className="animate-spin" />}
            Cambiar contraseña
          </button>
        </form>
      </Card>
    </div>
  );
}
