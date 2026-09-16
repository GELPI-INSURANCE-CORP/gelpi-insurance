"use client";
import { FormEvent, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Loader2, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { REGLAS_CLAVE, clavesInvalidas, setNewPassword } from "@/lib/auth";

const campoClase =
  "h-10 rounded-lg border border-border bg-surface px-3 text-sm text-foreground outline-none focus:border-brand";

export default function RestablecerPage() {
  const router = useRouter();
  const [estado, setEstado] = useState<"verificando" | "listo" | "sin-enlace">("verificando");
  const [nueva, setNueva] = useState("");
  const [repetir, setRepetir] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [hecho, setHecho] = useState(false);

  // El enlace del correo puede llegar de dos formas según el flujo del proyecto:
  // como ?code=... (PKCE, hay que canjearlo) o como #access_token=... (implícito,
  // lo levanta solo detectSessionInUrl). Contemplamos las dos.
  useEffect(() => {
    let activo = true;

    async function preparar() {
      const code = new URLSearchParams(window.location.search).get("code");
      if (code) {
        const { error: err } = await supabase.auth.exchangeCodeForSession(code);
        if (err && activo) {
          setEstado("sin-enlace");
          return;
        }
      }
      const { data } = await supabase.auth.getSession();
      if (!activo) return;
      setEstado(data.session ? "listo" : "sin-enlace");
    }

    preparar();
    return () => {
      activo = false;
    };
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const faltantes = clavesInvalidas(nueva);
    if (faltantes.length > 0) {
      setError(`La contraseña no cumple: ${faltantes.join(", ").toLowerCase()}.`);
      return;
    }
    if (nueva !== repetir) {
      setError("Las dos contraseñas no coinciden.");
      return;
    }

    setGuardando(true);
    try {
      await setNewPassword(nueva);
      setHecho(true);
      setTimeout(() => router.replace("/comisiones/resumen"), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cambiar la contraseña.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-8">
        <div className="mb-6 flex justify-center">
          <Image
            src={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/logo-gelpi.png`}
            alt="Gelpi Insurance"
            width={41}
            height={47}
            priority
          />
        </div>

        {estado === "verificando" && (
          <div className="flex justify-center py-4">
            <Loader2 className="animate-spin text-brand" size={24} />
          </div>
        )}

        {estado === "sin-enlace" && (
          <div className="flex flex-col gap-4 text-center">
            <h1 className="text-sm text-foreground">El enlace no sirve o ya venció</h1>
            <p className="text-xs text-muted">
              Los enlaces de recuperación duran poco y se usan una sola vez. Pedí uno nuevo
              desde la pantalla de ingreso.
            </p>
            <Link
              href="/login/"
              className="flex h-10 items-center justify-center rounded-lg bg-brand text-sm font-medium text-white transition hover:bg-brand-dark"
            >
              Volver al ingreso
            </Link>
          </div>
        )}

        {estado === "listo" && (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <h1 className="text-center text-sm text-muted">Elegí tu contraseña nueva</h1>

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
                Repetir contraseña
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
            {hecho && (
              <p className="text-xs text-ok-fg">Listo. Entrando…</p>
            )}

            <button
              type="submit"
              disabled={guardando || hecho}
              className="mt-1 flex h-10 items-center justify-center gap-2 rounded-lg bg-brand text-sm font-medium text-white transition hover:bg-brand-dark disabled:opacity-60"
            >
              {guardando && <Loader2 size={16} className="animate-spin" />}
              Guardar contraseña
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
