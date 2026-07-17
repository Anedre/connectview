/**
 * connectors/restClient — fetch REST genérico para conectores nuevos (HubSpot,
 * Zendesk, Jira, Oracle). Extraído del patrón de `salesforceClient.sfFetch`:
 * timeout duro (AbortController) + retry-on-401 con refresh de token + parseo
 * tolerante del body. Cada conector lo instancia con su base URL y su token.
 *
 * El adapter Salesforce NO usa esto (sigue con su client interno, que ya maneja
 * el JWT-bearer/OAuth per-tenant); es solo para los conectores nuevos.
 */
import type { RestClient, RestResponse } from "./types";

const DEFAULT_TIMEOUT_MS = 8000;

/** fetch con timeout duro vía AbortController (patrón de salesforceClient.ts). */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ac.signal });
  } finally {
    clearTimeout(timer);
  }
}

export interface RestClientOpts {
  baseUrl: string;
  /** Provee un access token válido; `force` fuerza refresh (para el retry-on-401). */
  token: (force?: boolean) => Promise<string>;
  timeoutMs?: number;
  defaultHeaders?: Record<string, string>;
}

/** Construye un RestClient Bearer con timeout + retry-on-401. */
export function makeRestClient(opts: RestClientOpts): RestClient {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const base = opts.baseUrl.replace(/\/+$/, "");

  const doCall = async (
    method: string,
    path: string,
    body: unknown,
    headers: Record<string, string>,
    tok: string,
  ): Promise<Response> => {
    const url = `${base}/${path.replace(/^\/+/, "")}`;
    return fetchWithTimeout(
      url,
      {
        method,
        headers: {
          Authorization: `Bearer ${tok}`,
          "Content-Type": "application/json",
          ...opts.defaultHeaders,
          ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      },
      timeoutMs,
    );
  };

  return {
    async call(method, path, body, headers = {}): Promise<RestResponse> {
      let tok = await opts.token();
      let r = await doCall(method, path, body, headers, tok);
      // Un retry en 401 con token forzado (pudo expirar).
      if (r.status === 401) {
        tok = await opts.token(true);
        r = await doCall(method, path, body, headers, tok);
      }
      const text = await r.text();
      let parsed: unknown = text;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        /* dejar como texto */
      }
      return { ok: r.ok, status: r.status, body: parsed };
    },
  };
}
