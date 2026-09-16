"use client";
import { FormEvent, useEffect, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { requestPasswordReset, signIn } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [modo, setModo] = useState<"ingresar" | "recuperar">("ingresar");
  const [enviado, setEnviado] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        router.replace("/comisiones/resumen");
      } else {
        setChecking(false);
      }
    });
  }, [router]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await signIn(email, password);
      router.replace("/comisiones/resumen");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo iniciar sesión");
    } finally {
      setLoading(false);
    }
  }

  async function handleRecuperar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await requestPasswordReset(email);
      setEnviado(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo enviar el correo");
    } finally {
      setLoading(false);
    }
  }

  function cambiarModo(nuevo: "ingresar" | "recuperar") {
    setModo(nuevo);
    setError(null);
    setEnviado(false);
    setPassword("");
  }

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="animate-spin text-brand" size={28} />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-8">
        <div className="mb-6 flex flex-col items-center gap-2">
          <Image src={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/logo-gelpi.png`} alt="Gelpi Insurance" width={41} height={47} priority />
          <div className="flex flex-col items-center leading-none">
            <span
              className="text-[22px] font-bold tracking-wide text-brand-dark"
              style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}
            >
              GELPI
            </span>
            <span className="mt-1 text-[10px] font-medium tracking-[0.32em] text-[#7b7f86]">
              INSURANCE
            </span>
          </div>
        </div>
        <h1 className="mb-6 text-center text-sm text-muted">
          GELPI AMS
        </h1>
        {modo === "ingresar" ? (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted" htmlFor="email">
              Correo
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-10 rounded-lg border border-border bg-surface px-3 text-sm text-foreground outline-none focus:border-brand"
              placeholder="tu@correo.com"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted" htmlFor="password">
              Contraseña
            </label>
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-10 rounded-lg border border-border bg-surface px-3 text-sm text-foreground outline-none focus:border-brand"
              placeholder="••••••••"
            />
          </div>
          {error && <p className="text-xs text-bad-fg">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="mt-2 flex h-10 items-center justify-center gap-2 rounded-lg bg-brand text-sm font-medium text-white transition hover:bg-brand-dark disabled:opacity-60"
          >
            {loading && <Loader2 size={16} className="animate-spin" />}
            Entrar
          </button>
          <button
            type="button"
            onClick={() => cambiarModo("recuperar")}
            className="text-center text-xs text-muted underline-offset-2 hover:text-brand hover:underline"
          >
            ¿Olvidaste tu contraseña?
          </button>
        </form>
        ) : (
        <form onSubmit={handleRecuperar} className="flex flex-col gap-4">
          <p className="text-xs text-muted">
            Escribí tu correo y te mandamos un enlace para elegir una contraseña nueva.
          </p>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted" htmlFor="email-rec">
              Correo
            </label>
            <input
              id="email-rec"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-10 rounded-lg border border-border bg-surface px-3 text-sm text-foreground outline-none focus:border-brand"
              placeholder="tu@correo.com"
            />
          </div>
          {error && <p className="text-xs text-bad-fg">{error}</p>}
          {enviado && (
            <p className="text-xs text-ok-fg">
              Si ese correo tiene cuenta, ya salió el enlace. Revisá la bandeja y el correo no deseado.
            </p>
          )}
          <button
            type="submit"
            disabled={loading || enviado}
            className="mt-2 flex h-10 items-center justify-center gap-2 rounded-lg bg-brand text-sm font-medium text-white transition hover:bg-brand-dark disabled:opacity-60"
          >
            {loading && <Loader2 size={16} className="animate-spin" />}
            Enviar enlace
          </button>
          <button
            type="button"
            onClick={() => cambiarModo("ingresar")}
            className="text-center text-xs text-muted underline-offset-2 hover:text-brand hover:underline"
          >
            Volver al ingreso
          </button>
        </form>
        )}
      </div>
    </div>
  );
}
