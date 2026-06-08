import { fetchAuthSession } from "aws-amplify/auth";

/**
 * authedFetch — fetch que adjunta el ID token de Cognito como Bearer, para que
 * el backend resuelva el tenantId del usuario (multi-tenant). Si no hay sesión
 * (estado pre-login / rutas demo), cae a un fetch normal → el backend usa el
 * tenant "default". Reemplaza a `fetch` en los hooks que tocan datos por tenant.
 */
export async function authedFetch(
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> {
  let token: string | undefined;
  try {
    const session = await fetchAuthSession();
    token = session.tokens?.idToken?.toString();
  } catch {
    /* sin sesión → fetch sin auth */
  }
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}
