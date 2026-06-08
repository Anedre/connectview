import { fetchAuthSession } from "aws-amplify/auth";

/**
 * installApiAuthInterceptor — adjunta el ID token de Cognito (Bearer) a TODA
 * llamada a nuestra API (Function URLs: *.lambda-url.*.on.aws), en un solo
 * lugar, para que el backend resuelva el tenantId del usuario. Así no hay que
 * migrar hook por hook.
 *
 * Seguro por diseño:
 *  · Solo toca requests a nuestros hosts de Lambda — NO a S3 presigned, Connect,
 *    Cognito ni terceros (pasan tal cual).
 *  · No pisa un Authorization ya seteado (compone con authedFetch).
 *  · No hay recursión: fetchAuthSession() pega a cognito-idp (otro host) → pasa
 *    por el branch de passthrough sin volver a pedir sesión.
 */
let installed = false;

function isOurApi(url: string): boolean {
  return url.includes(".lambda-url.") && url.includes(".on.aws");
}

export function installApiAuthInterceptor(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  const native = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    let url = "";
    try {
      url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    } catch {
      /* ignore */
    }
    if (!isOurApi(url)) return native(input, init);

    let token: string | undefined;
    try {
      token = (await fetchAuthSession()).tokens?.idToken?.toString();
    } catch {
      /* sin sesión → sin token */
    }
    if (!token) return native(input, init);

    const headers = new Headers(
      init?.headers || (input instanceof Request ? input.headers : undefined)
    );
    if (!headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);
    return native(input, { ...init, headers });
  };
}
