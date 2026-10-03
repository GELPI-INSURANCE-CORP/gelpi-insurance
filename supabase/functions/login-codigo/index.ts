// Gelpi Insurance · login-codigo
// Edge Function: primer paso del login en dos pasos.
//
// Contrato: POST { "email": "...", "password": "..." }  →  { ok: true }
//
// verify_jwt tiene que estar APAGADO en esta función: se la llama antes de que exista sesión.
//
// Por qué esto vive en el servidor y no en la pantalla:
//
// La forma obvia de hacer "contraseña + código" en el navegador es entrar con la contraseña y
// después pedir el código. No sirve: en el momento en que signInWithPassword responde, el
// navegador YA tiene una sesión válida y puede leer toda la base. El código quedaría de adorno —
// cualquiera que sepa abrir la consola del navegador entra igual sin el correo.
//
// Acá la contraseña se verifica del lado del servidor y la sesión que eso crea se descarta en el
// acto. Al navegador no le vuelve ningún token: solo un "ok". La sesión recién nace cuando el
// usuario prueba que también tiene el correo, verificando el código. Los dos factores son reales.

import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anon) return json({ error: "Falta la configuración del proyecto." }, 500);

  let email = "";
  let password = "";
  try {
    const body = await req.json();
    email = String(body?.email ?? "").trim().toLowerCase();
    password = String(body?.password ?? "");
  } catch {
    return json({ error: "Pedido inválido." }, 400);
  }
  if (!email || !password) return json({ error: "Faltan el correo o la contraseña." }, 400);

  // Cliente descartable, sin persistir nada: la sesión que salga de acá muere con este request.
  const efimero = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await efimero.auth.signInWithPassword({ email, password });

  if (error || !data.session) {
    // Mismo mensaje para "no existe" y "clave equivocada": decir cuál de las dos es le regala a
    // quien está probando la mitad de la respuesta.
    return json({ error: "Correo o contraseña incorrectos." }, 401);
  }

  // La sesión se cierra antes de mandar el código. Si algo falla más abajo, no queda una sesión
  // viva colgando de una contraseña que nadie terminó de confirmar.
  await efimero.auth.signOut();

  // shouldCreateUser en false: este endpoint nunca da de alta a nadie, solo manda el código a una
  // cuenta que ya existe y cuya contraseña acaba de ser verificada.
  const { error: errCodigo } = await efimero.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false },
  });

  if (errCodigo) {
    const msg = errCodigo.message ?? "";
    // El proyecto tiene un techo de correos por hora. Si se pasa, el usuario tiene que entender
    // que no hizo nada mal y que esperar es la salida, en vez de reintentar y agotarlo más.
    if (/rate limit|too many/i.test(msg)) {
      return json(
        { error: "Se alcanzó el límite de correos por hora. Esperá unos minutos y volvé a intentar." },
        429,
      );
    }
    return json({ error: "No se pudo enviar el código. Intentá de nuevo en un momento." }, 502);
  }

  return json({ ok: true });
});
