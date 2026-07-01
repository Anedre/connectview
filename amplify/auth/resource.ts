import { defineAuth, secret } from "@aws-amplify/backend";
import { postConfirmation } from "./post-confirmation/resource";

/**
 * F4.3 — SSO SAML/OIDC (build-ahead). El bloque `externalProviders` se agrega SOLO
 * si el pipeline trae el env de SSO. Sin env → el auth queda EXACTAMENTE como antes
 * (email-only, sin dominio Cognito) y `ampx` despliega igual que hoy. Con env +
 * `npx ampx pipeline-deploy` (operacional, lo corre el usuario/CI) se crea el dominio
 * hosted-UI + el IdP + el bloque `auth.oauth` en amplify_outputs.json → recién ahí el
 * botón "Entrar con tu empresa" (signInWithRedirect) se activa en el login.
 *
 * Env a setear en el pipeline de Amplify ANTES del deploy (ver design/sso.md):
 *   SSO_PROVIDER_NAME        nombre del IdP en Cognito (ej. "UDEP") — el mismo que usa
 *                            signInWithRedirect({ provider: { custom: <name> } }).
 *   — SAML —
 *   SSO_SAML_METADATA_URL    URL pública de la metadata del IdP (o el XML si …_TYPE=FILE)
 *   SSO_SAML_METADATA_TYPE   "URL" (default) | "FILE"
 *   — OIDC (alternativa a SAML) —
 *   SSO_OIDC_ISSUER_URL      env normal (no secreto) — habilita la rama OIDC
 *   SSO_OIDC_CLIENT_ID / SSO_OIDC_CLIENT_SECRET  → como SECRETS de Amplify
 *     (`ampx sandbox secret set SSO_OIDC_CLIENT_ID …` o en la consola de Amplify),
 *     NO como env; los resuelve `secret()` al deploy.
 *   — común —
 *   SSO_CALLBACK_URLS        coma-separado (opcional; default localhost + amplifyapp)
 *   SSO_LOGOUT_URLS          coma-separado (opcional; default = callbacks)
 *
 * NOTA: `externalProviders` es estático (los IdPs se hornean al deploy). El registro
 * de IdPs por-tenant en runtime (CreateIdentityProvider) es follow-up — para el piloto
 * UDEP alcanza UN IdP configurable.
 */

const env = process.env;
const providerName = (env.SSO_PROVIDER_NAME || "").trim();

// SAML se habilita con la metadata (env normal). OIDC se habilita con el issuer
// (env normal); el clientId/secret van como SECRETS de Amplify vía secret().
const hasSaml = !!(providerName && env.SSO_SAML_METADATA_URL);
const hasOidc = !!(providerName && env.SSO_OIDC_ISSUER_URL);

const splitUrls = (v: string | undefined): string[] =>
  (v || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

// Callbacks por defecto (dev + el dominio de Amplify). El pipeline puede overridear.
const DEFAULT_CALLBACKS = [
  "http://localhost:5173/",
  "https://master.drmn5d76emst6.amplifyapp.com/",
];
const callbackUrls = splitUrls(env.SSO_CALLBACK_URLS);
const logoutUrls = splitUrls(env.SSO_LOGOUT_URLS);

// Callbacks/logouts resueltos (env override o default). Un provider de Cognito es
// SAML o OIDC (no ambos), así que ramificamos: SAML tiene precedencia si está seteado.
const cbUrls = callbackUrls.length ? callbackUrls : DEFAULT_CALLBACKS;
const loUrls = logoutUrls.length ? logoutUrls : cbUrls;

const samlProviders = {
  saml: {
    name: providerName,
    metadata: {
      metadataContent: env.SSO_SAML_METADATA_URL as string,
      metadataType: (env.SSO_SAML_METADATA_TYPE === "FILE" ? "FILE" : "URL") as "URL" | "FILE",
    },
  },
  callbackUrls: cbUrls,
  logoutUrls: loUrls,
};
const oidcProviders = {
  oidc: [
    {
      name: providerName,
      // clientId/secret son SECRETS de Amplify (no env) — resueltos al deploy.
      clientId: secret("SSO_OIDC_CLIENT_ID"),
      clientSecret: secret("SSO_OIDC_CLIENT_SECRET"),
      issuerUrl: env.SSO_OIDC_ISSUER_URL as string,
      scopes: ["openid", "email", "profile"],
    },
  ],
  callbackUrls: cbUrls,
  logoutUrls: loUrls,
};

export const auth = defineAuth({
  loginWith: {
    email: true,
    // Solo se incluye si hay SSO configurado por env (build-ahead, no-op sin env).
    // SAML tiene precedencia sobre OIDC (un único IdP configurable para el piloto).
    ...(hasSaml
      ? { externalProviders: samlProviders }
      : hasOidc
        ? { externalProviders: oidcProviders }
        : {}),
  },
  groups: ["Agents", "Supervisors", "Admins"],
  triggers: {
    postConfirmation,
  },
  access: (allow) => [allow.resource(postConfirmation).to(["addUserToGroup"])],
});
