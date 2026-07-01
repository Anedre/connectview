# SSO (SAML/OIDC) — Guía de activación para el cliente + runbook de deploy

> Cómo activar el login federado "Entrar con tu empresa" en ARIA para un tenant
> (ej. UDEP). Dos partes: (1) lo que hace **el cliente** en su IdP + en Configuración
> → Integraciones → SSO, y (2) el **runbook del equipo de plataforma** (deploy). Ver
> el diseño en [sso.md](sso.md).

---

## Parte 1 — El cliente (IT de la organización)

### 1.1 Elegir protocolo

- **SAML 2.0** — típico en universidades/empresas con ADFS, Shibboleth, Azure AD (SAML).
- **OpenID Connect (OIDC)** — Azure AD (OIDC), Google Workspace, Okta OIDC.

### 1.2 Datos del Service Provider (los da ARIA — Configuración → Integraciones → SSO)

En la tarjeta **SSO** de ARIA, el admin ve estos valores (botón _Copiar_) para pegarlos en el IdP:

| Dato                     | Ejemplo                                           | Dónde va en el IdP                     |
| ------------------------ | ------------------------------------------------- | -------------------------------------- |
| **Entity ID / Audience** | `urn:amazon:cognito:sp:us-east-1_csLvANyZo`       | Identifier / Audience URI del SP       |
| **ACS URL** (SAML)       | `https://<dominio-cognito>/saml2/idpresponse`     | Assertion Consumer Service / Reply URL |
| **Redirect URI** (OIDC)  | `https://<dominio-cognito>/oauth2/idpresponse`    | Redirect/Callback URI de la app OIDC   |
| **URL de la app**        | el origin de ARIA (ej. `https://…amplifyapp.com`) | (referencia; a dónde vuelve el user)   |

> El **`<dominio-cognito>`** recién existe tras el deploy del equipo de plataforma (paso 2).
> Antes de eso, ARIA muestra "(se genera al desplegar el SSO)" — el equipo se lo pasa al cliente.

### 1.3 Atributos (claim mapping)

El IdP debe enviar el **email** del usuario. Mapear:

- SAML: el `NameID` (o un atributo) con el email → se mapea a `email` en Cognito.
- OIDC: el scope `openid email profile`; el claim `email`.

> ARIA usa el email para identificar al usuario. El tenant se resuelve por el **dominio de
> email** configurado en la tarjeta SSO (paso 1.4).

### 1.4 Configurar en ARIA (Configuración → Integraciones → SSO)

1. Elegir protocolo (SAML/OIDC).
2. **Nombre del proveedor** (interno, ej. `UDEP`).
3. **SAML:** pegar la **URL de metadata** del IdP. **OIDC:** pegar **Issuer/Discovery URL** + **Client ID**
   (el _Client Secret_ NO se pega acá — se carga como secreto en el deploy).
4. **Dominios de correo** de la organización (ej. `udep.edu.pe, udep.pe`).
5. Guardar. Queda como **"Pendiente de deploy"** hasta que el equipo publique el cambio.

### 1.5 Lo que el cliente entrega al equipo de plataforma

- **SAML:** la URL de metadata (o el XML).
- **OIDC:** Issuer URL, Client ID y **Client Secret** (por un canal seguro).
- El nombre del proveedor acordado (ej. `UDEP`).

---

## Parte 2 — Runbook del equipo de plataforma (deploy)

> ⚠️ Esto NO es `deploy-lambda.mjs`. El SSO toca `amplify/auth/resource.ts` (CDK-managed) → se
> activa con **`npx ampx pipeline-deploy`** (regenera `amplify_outputs.json` con `auth.oauth`).
> Lo corre el usuario/CI. Ver [[lambda-deploy-naming]].

### 2.1 Setear el env de SSO en el pipeline (antes del deploy)

Comunes:

```
SSO_PROVIDER_NAME=UDEP           # = "Nombre del proveedor" que puso el cliente
SSO_CALLBACK_URLS=https://<app>/,http://localhost:5173/   # opcional (hay defaults)
SSO_LOGOUT_URLS=https://<app>/                            # opcional
```

**SAML:**

```
SSO_SAML_METADATA_URL=https://login.microsoftonline.com/<tenant>/federationmetadata/2007-06/federationmetadata.xml
SSO_SAML_METADATA_TYPE=URL       # o FILE si pegás el XML crudo
```

**OIDC** (el clientId/secret van como SECRETS de Amplify, no como env):

```
SSO_OIDC_ISSUER_URL=https://login.microsoftonline.com/<tenant>/v2.0
```

```
npx ampx sandbox secret set SSO_OIDC_CLIENT_ID      # pega el Client ID
npx ampx sandbox secret set SSO_OIDC_CLIENT_SECRET  # pega el Client Secret
```

(en producción, cargar los secrets en la consola de Amplify del branch correspondiente).

### 2.2 Desplegar

```
npx ampx pipeline-deploy --branch <branch> --app-id <appId>
```

Esto crea: el dominio hosted-UI de Cognito + el IdP (SAML/OIDC) + el bloque `auth.oauth` en
`amplify_outputs.json`. Si `SSO_PROVIDER_NAME` (y la metadata/issuer) NO están seteados, el deploy
sale idéntico a hoy (email-only, sin dominio) — **el scaffold es no-op sin env**.

### 2.3 Pasarle al cliente el dominio Cognito final

Tras el deploy, `amplify_outputs.json` trae `auth.oauth.domain`. Con eso, la ACS/Redirect URL real
es `https://<domain>/saml2/idpresponse` (SAML) o `https://<domain>/oauth2/idpresponse` (OIDC). La
tarjeta SSO ya la muestra sola (la deriva del outputs). El cliente termina de cargarla en su IdP.

### 2.4 Verificar

1. En el login de ARIA aparece el botón **"Entrar con tu empresa"** (solo cuando hay `auth.oauth`).
2. Click → redirige al IdP → login → vuelve autenticado.
3. El usuario entra con su email; `provision-tenant` resuelve/crea su tenant en el primer login.

### 2.5 Rollback

Quitar el env `SSO_*` (y opcionalmente los secrets) + `ampx pipeline-deploy` → vuelve a email-only.
El botón SSO desaparece (no hay `auth.oauth`). La config `sso` guardada en connections queda inerte.

---

## Notas

- **Multi-tenant:** hoy es **un IdP configurable** (piloto). Varios IdPs por-tenant en runtime
  (`CreateIdentityProvider`) es follow-up — ver [sso.md](sso.md).
- **Seguridad:** el Client Secret de OIDC nunca toca el navegador ni DynamoDB (Secrets de Amplify).
  La metadata SAML es pública (URL), no es secreto.
