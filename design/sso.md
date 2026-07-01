# F4.3 — SSO SAML/OIDC por-tenant · Diseño

> Login federado "Entrar con tu empresa" contra el IdP del cliente (Azure AD / ADFS /
> Shibboleth / Google Workspace). **Build-ahead:** el código queda listo; el go-live
> espera (a) la metadata/credenciales del IdP del cliente y (b) `npx ampx pipeline-deploy`
> (operacional, lo corre el usuario/CI — regenera `amplify_outputs.json`). Ver
> [[project_roadmap_v2]], design/fase-4.md §F4.3.

## Grounding (verificado 2026-07-01)

- **Gate de identidad = `<Authenticator>` de Amplify** en `VoxAuthGate`
  (`src/context/VoxAuthContext.tsx:303`). NO es hosted UI. El `vox-login` de `App.tsx:316`
  es otra cosa (conexión al **CCP de Amazon Connect**, softphone) — su footer "SSO SAML 2.0"
  (`App.tsx:449`) es claim visual, no funcional.
- **`Amplify.configure(outputs)`** (`src/main.tsx:13`) lee `amplify_outputs.json` directo.
  Hoy `auth.oauth = null` (sin dominio Cognito, sin IdPs). Cuando ampx despliegue con
  `externalProviders`, aparece `auth.oauth` → `signInWithRedirect` funciona.
- **`auth/resource.ts`** = solo `email:true` + grupos + `postConfirmation`. Sin `externalProviders`.
- **`connectview-connections`** (`manage-connections`, PK=tenantId): `configJson` es un blob
  JSON con claves por integración (`connect`, `salesforce`, `whatsapp`, `messaging`, `branding`…).
  El **save genérico REEMPLAZA todo el blob** con el `config` que manda la UI; el
  `IntegrationsManager` mantiene el config completo en estado y hace patch local + POST del todo.
  ⇒ agregar una clave **`sso`** al blob NO necesita cambios de backend.
- **`IntegrationsManager.tsx`** tiene un `ConnCard` reusable (icono + estado + form colapsable) —
  molde exacto para una tarjeta de SSO.
- **Amplify backend 1.23.0.** API (context7): `externalProviders.saml = { name, metadata:
{ metadataContent, metadataType:'URL'|'FILE' } }`; `externalProviders.oidc = { name, clientId,
clientSecret, issuerUrl }`; + `callbackUrls`, `logoutUrls`, y `domainPrefix` (obligatorio para
  hosted UI/federación).

## La tensión de fondo (por qué es build-ahead y no "hecho")

1. **Federación necesita el dominio OAuth de Cognito.** Agregar `externalProviders` obliga a un
   `domainPrefix` + `callbackUrls`. Eso solo se materializa con `ampx pipeline-deploy` (CDK-managed,
   NO `deploy-lambda.mjs`). Hasta que corra, no hay `auth.oauth` y `signInWithRedirect` no existe.
2. **`defineAuth.externalProviders` es ESTÁTICO** — los IdPs se hornean en el user pool al deploy.
   El multi-tenant self-serve real (cada tenant sube su metadata y se auto-registra un IdP) pediría
   `CreateIdentityProvider` en runtime (Cognito API) → **follow-up**. Para el piloto UDEP (una
   universidad = un IdP) alcanza con **UN IdP configurable por env**.
3. **No se puede verificar en vivo** sin la metadata real del IdP + el deploy. Por eso construimos
   el esqueleto (código listo, build verde) y dejamos el go-live como paso del cliente + operacional.

## Arquitectura elegida

**Un IdP configurable (piloto) + config por-tenant lista para el futuro + deploy gateado por env.**

- El **resource.ts** declara `externalProviders` **solo si hay env** (`SSO_SAML_METADATA_URL` ó
  `SSO_OIDC_*`). Sin env → no se agrega nada → `ampx` sigue desplegando igual que hoy (build verde,
  sin dominio). Con env (cuando UDEP dé la metadata) + `ampx pipeline-deploy` → se crea el dominio +
  el IdP + `auth.oauth` en outputs. **No rompe nada mientras el env no esté.**
- El **login** gana un botón "Entrar con tu empresa" que hace `signInWithRedirect`, **visible solo si
  `outputs.auth.oauth` existe** (feature-flag natural: aparece recién tras el deploy real).
- La **config por-tenant** (`sso` en `configJson`) guarda proveedor + metadata + mapeo
  email-dominio→tenant + el nombre del IdP de Cognito. Es forward-looking (routing + doc para el
  cliente); el registro real del IdP sigue siendo el paso ampx.
- Un **doc de setup** para el cliente (ACS URL, Entity ID, attribute mapping, callback URLs) — lo que
  UDEP necesita cargar en su IdP.

## Plan por sub-fases

- **F4.3-A — Infra scaffold (`auth/resource.ts`): ✅ HECHO.** `externalProviders` gateado por env:
  SAML (metadata URL/FILE) **o** OIDC (issuer env + `secret("SSO_OIDC_CLIENT_ID"/"…SECRET")` — los
  IDs/secrets OIDC van como **Secrets de Amplify**, no env), + `callbackUrls`/`logoutUrls` (default
  localhost:5173 + `*.amplifyapp.com`, override por env). SAML tiene precedencia (un IdP). Sin env =
  no-op (build idéntico al de hoy). El dominio hosted-UI lo auto-provisiona Amplify (no `domainPrefix`).
  Typecheck OK (solo el ruido pre-existente de `process`, que ampx sí resuelve).
- **F4.3-B — Login branch (`VoxAuthContext.tsx`): ✅ HECHO + verificado.** Botón "Entrar con tu
  empresa" en `SignIn.Footer` del `<Authenticator>`, gateado por `hasSso` (deriva de
  `outputs.auth.oauth.identity_providers`, excluyendo sociales). Llama
  `signInWithRedirect({ provider: { custom: <name> } })`. **Verificado en Browser 1:** `auth.oauth`
  ausente → botón NO aparece, app monta sin errores de consola (gate Cognito intacto).
- **F4.3-C — Config por-tenant (`IntegrationsManager.tsx` + `useConnections.ts`): ✅ HECHO +
  verificado E2E.** `SsoCard` (reusa `ConnCard`): toggle SAML/OIDC, nombre del proveedor, metadata
  URL (SAML) o issuer+clientId (OIDC, el secret va al deploy), dominios de email, y bloque **read-only**
  con Entity ID (`urn:amazon:cognito:sp:<userPoolId>`, real) + ACS/Redirect URL (derivada del dominio
  Cognito tras deploy) + callback. Persiste `config.sso` vía el `save` existente (sin backend nuevo).
  **Verificado en Browser 1:** guardado round-trip REAL al backend (manage-connections persistió `sso`
  con todos los campos, sin pisar las otras integraciones); datos de prueba **limpiados** (backend +
  localStorage).
- **F4.3-D — Doc de setup del cliente: ✅ HECHO.** `design/sso-setup-udep.md` — guía para el IdP
  (qué pegar dónde, atributos, URLs) + runbook del deploy (env/secrets + `ampx pipeline-deploy` +
  verificación + rollback). El claim del footer "SSO SAML 2.0" se vuelve real cuando se active.

## Modelo de datos (`configJson.sso`)

```ts
sso?: {
  enabled?: boolean;
  provider?: "saml" | "oidc";
  cognitoProviderName?: string;   // nombre del IdP en Cognito (= el que usa signInWithRedirect)
  saml?: { metadataUrl?: string };
  oidc?: { issuerUrl?: string; clientId?: string; clientSecretSet?: boolean };  // secret → SM, no acá
  emailDomains?: string[];        // ["udep.edu.pe","udep.pe"] → routing por dominio
  updatedAt?: string;
};
```

> El client secret de OIDC NO va en `configJson` (patrón WhatsApp/SF: va a Secrets Manager, en el
> blob solo `clientSecretSet:true`). Para el piloto SAML-por-metadata-URL no hay secreto → más simple.

## Verificación (lo que SÍ se puede hoy)

- Typecheck + build verdes con y sin el env (el scaffold no rompe el deploy actual).
- Login: el botón SSO **no aparece** (no hay `auth.oauth`) → el gate Cognito sigue intacto.
- Config: en Configuración → Integraciones, la tarjeta SSO guarda y relee `config.sso` (round-trip).
- **Diferido (cliente + ampx):** federación real, `CreateIdentityProvider` runtime multi-tenant.

## Decisiones a confirmar

1. **Protocolo del scaffold:** ¿SAML **y** OIDC en la UI + resource.ts (env elige), o solo SAML
   (lo más común en universidades)?
2. **Hogar de la tarjeta:** ¿**Integraciones** (reusa `ConnCard`, guarda en `connections`) o
   **Seguridad** (conceptualmente identidad/acceso)?
3. **Alcance multi-tenant:** ¿**un IdP configurable** para el piloto (simple, un solo ampx) y dejar
   el `CreateIdentityProvider` runtime por-tenant como follow-up? ¿O intentar el runtime ahora
   (más grande, igual sin poder verificar)?
