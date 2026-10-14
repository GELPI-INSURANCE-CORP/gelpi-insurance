"use client";
import { FormEvent, useEffect, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { pedirCodigo, requestPasswordReset, verificarCodigo } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  // "codigo" es el segundo paso del ingreso: la contraseña ya se verificó en el servidor y está
  // esperando que el usuario demuestre que además tiene el correo.
  const [modo, setModo] = useState<"ingresar" | "codigo" | "recuperar">("ingresar");
  const [enviado, setEnviado] = useState(false);
  const [codigo, setCodigo] = useState("");
  const [reenviando, setReenviando] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        router.replace("/comisiones/resumen");
      } else {
        setChecking(false);
      }
    });
  }, [router]);

  // Paso 1: mandar correo y contraseña al servidor. Si son correctos sale el código, pero acá NO
  // queda sesión abierta: el navegador todavía no puede leer nada de la base.
  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await pedirCodigo(email, password);
      setModo("codigo");
      setCodigo("");
      // La contraseña ya cumplió su papel y no hace falta tenerla en memoria mientras el usuario
      // busca el correo.
      setPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo iniciar sesión");
    } finally {
      setLoading(false);
    }
  }

  // Paso 2: recién acá nace la sesión.
  async function handleCodigo(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await verificarCodigo(email, codigo);
      router.replace("/comisiones/resumen");
    } catch (err) {
      setError(err instanceof Error ? err.message : "El código no es correcto");
    } finally {
      setLoading(false);
    }
  }

  // Volver atrás para pedir otro código: hay que poner la contraseña de nuevo, porque el servidor
  // no guarda que ya la verificaste. Es incómodo a propósito — si alcanzara con apretar "reenviar"
  // sin la contraseña, cualquiera con tu correo abierto podría pedir códigos sin parar.
  function pedirOtro() {
    setReenviando(true);
    setModo("ingresar");
    setError(null);
    setCodigo("");
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

  function cambiarModo(nuevo: "ingresar" | "codigo" | "recuperar") {
    setModo(nuevo);
    setError(null);
    setEnviado(false);
    setPassword("");
    setCodigo("");
    setReenviando(false);
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
          {reenviando && (
            <p className="rounded-lg bg-brand-tint px-3 py-2 text-xs leading-relaxed text-foreground">
              Poné la contraseña otra vez y te mandamos un código nuevo.
            </p>
          )}
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
            Continuar
          </button>
          <p className="text-center text-[11px] leading-relaxed text-muted">
            Te vamos a mandar un código de 6 dígitos a tu correo para terminar de entrar.
          </p>
          <button
            type="button"
            onClick={() => cambiarModo("recuperar")}
            className="text-center text-xs text-muted underline-offset-2 hover:text-brand hover:underline"
          >
            ¿Olvidaste tu contraseña?
          </button>
        </form>
        ) : modo === "codigo" ? (
        <form onSubmit={handleCodigo} className="flex flex-col gap-4">
          <p className="text-xs leading-relaxed text-muted">
            Te mandamos un código de 6 dígitos a <strong className="text-foreground">{email}</strong>.
            Revisá también el correo no deseado.
          </p>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted" htmlFor="codigo">
              Código
            </label>
            {/* inputMode numérico y autocomplete one-time-code: en el teléfono sale el teclado de
                números y el sistema ofrece pegar el código apenas llega el correo. */}
            <input
              id="codigo"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              autoFocus
              maxLength={6}
              value={codigo}
              onChange={(e) => setCodigo(e.target.value.replace(/\D/g, "").slice(0, 6))}
              className="h-12 rounded-lg border border-border bg-surface px-3 text-center text-xl font-semibold tracking-[0.4em] text-foreground outline-none focus:border-brand"
              placeholder="000000"
            />
          </div>
          {error && <p className="text-xs text-bad-fg">{error}</p>}
          <button
            type="submit"
            disabled={loading || codigo.length < 6}
            className="mt-2 flex h-10 items-center justify-center gap-2 rounded-lg bg-brand text-sm font-medium text-white transition hover:bg-brand-dark disabled:opacity-60"
          >
            {loading && <Loader2 size={16} className="animate-spin" />}
            Entrar
          </button>
          <button
            type="button"
            onClick={pedirOtro}
            className="text-center text-xs text-muted underline-offset-2 hover:text-brand hover:underline"
          >
            No me llegó — mandame otro
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
