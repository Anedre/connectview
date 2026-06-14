# Runbook Interno — ARIA (Connectview)

**Documento técnico interno** · v1.0 · 2026-06-04
Para: equipo de desarrollo / operaciones. Contiene nombres reales de recursos.

> Complementa (no reemplaza) a `SAAS_MIGRATION_STATE.md` y `UNIFY_ROADMAP.md` en la
> raíz del repo, y a la memoria del proyecto.

---

## 1. Cuenta y recursos reales

| Recurso | Identificador |
|---------|---------------|
| Cuenta AWS (plataforma) | `731736972577` (Novasys / ARIA) |
| Región | `us-east-1` |
| Cognito User Pool | `us-east-1_csLvANyZo` · client `6qfs8onjto75i9cckl1vns80f9` |
| Grupos Cognito | `Agents`, `Supervisors`, `Admins` |
| Instancia Connect (fundador/Novasys) | `2345d564-4bd4-4318-9cf0-75649bad5197` |
| Bucket de templates CFN (público) | `vox-cfn-templates-731736972577` |
| Bucket de grabaciones (Novasys) | `amazon-connect-6750b4c497ec` |

### Roles IAM relevantes
| Rol | Usado por | Permisos clave |
|-----|-----------|----------------|
| `connectview-campaign-lambda-role` | bot-runtime, agent-channel-adapter, campaign-dialer, etc. | `AssumeTenantConnect` (sts), `ConnectionsAccess` (ddb), `BedrockInvoke`, `WhatsAppSend`, + tablas |
| `connectview-admin-lambda-role` | admin-*, list-whatsapp-templates, etc. | `AdminAccess`, `SocialMessagingAccess`, + (nuevo) `VoxCrmTenantResolve` (assume + connections) |
| `amplify-...-generatecallsummarylambda-Pd0cQZem9aLr` | generate-call-summary (amplify-managed) | Bedrock + ContactLens + (nuevo) `VoxCrmTenantResolve` |
| `VoxCrmConnectAccess` | **lo asume ARIA en la cuenta del CLIENTE** | ReadOnly + Outbound + Recording + Diagnostics + **WhatsApp** + **Bedrock** |

---

## 2. Despliegue de Lambdas

Convención: `amplify/functions/<dir>/handler.ts` → función `connectview-<dir>`.

```bash
# Una o varias funciones hand-managed:
node scripts/deploy-lambda.mjs <dir> [<dir2> ...]

# Funciones amplify-managed (nombre largo). Buscar el nombre real:
aws lambda list-functions --query "Functions[].FunctionName" --output text \
  | tr '\t' '\n' | grep -i <pista>
node scripts/deploy-lambda.mjs <dir>=<nombre-largo>

# Ejemplo real (generate-call-summary es amplify-managed):
node scripts/deploy-lambda.mjs \
  generate-call-summary=amplify-connectview-andre-generatecallsummarylambd-QQg0vX5mSl1s

# Crear una función nueva (+ Function URL + 2 permisos públicos):
node scripts/create-lambda.mjs <dir> [KEY=VAL]
# Luego inyectar el endpoint en amplify_outputs.json (custom.apiEndpoints).
```

> ⚠️ **No** correr `npx ampx deploy` para las hand-managed: sobrescribiría el código.

## 3. Verificación

```bash
npx tsc --noEmit          # typecheck de TODO el proyecto (debe dar 0)
# El front está detrás del SSO de Connect + login Cognito → el camino legacy se
# verifica con curl al Function URL SIN token (debe degradar igual que antes).
# Overlay de Vite en dev: localhost:5173 (preview_eval).
```

---

## 4. Multi-tenant BYO — cómo extender

Núcleo: `amplify/functions/_shared/tenantConnect.ts`. Resolutores disponibles:

| Helper | Devuelve | Para Lambdas que tocan… |
|--------|----------|-------------------------|
| `resolveConnect(headers, legacyClient, legacyInstanceId)` | `{ client, instanceId, dynamo?, s3?, customerProfiles? }` | Amazon Connect |
| `resolveDynamo(headers, legacyDynamo)` | `{ dynamo }` | solo DynamoDB de negocio |
| `resolveWhatsApp(headers, legacy, legacyPhone, tenantId?)` | `{ client, phoneNumberId }` | envío WhatsApp |
| `resolveWhatsAppWaba(headers, legacy, legacyWaba, tenantId?)` | `{ client, wabaId }` | listar plantillas WhatsApp |
| `resolveBedrock(headers, legacy, tenantId?)` | `{ client }` | Bedrock (bots/resúmenes) |

Patrón en el handler (mutable module var, igual que `dynamo`):
```ts
let bedrock = legacyBedrock;
({ client: bedrock } = await resolveBedrock(event?.headers, legacyBedrock, body?.tenantId));
```

Reglas: anónimo → bloqueado/vacío; tenant fundador (`default`/`novasys`) → recursos
legacy de ARIA; tenant real → assume-role cross-account (`VoxCrmConnectAccess` +
`ExternalId`), credenciales cacheadas ~50 min.

**Si agregás un Lambda que use un resolver cross-account**, su rol de ejecución
necesita `sts:AssumeRole` sobre `arn:aws:iam::*:role/VoxCrmConnectAccess` y
`dynamodb:GetItem` sobre `connectview-connections` (política `VoxCrmTenantResolve`).

---

## 5. Onboarding operativo de un tenant

1. El cliente aplica `connect-role.yaml` (1-clic) → crea `VoxCrmConnectAccess`.
   - Políticas: `VoxCrmConnectReadOnly`, `VoxCrmConnectOutbound`,
     `VoxCrmRecordingAccess`, `VoxCrmDiagnostics`, `VoxCrmWhatsApp`, `VoxCrmBedrock`.
2. (Recomendado) `data-plane.yaml` → 14 tablas DynamoDB en su cuenta + permisos.
3. Config guardada en `connectview-connections` (`tenantId` = del JWT Cognito).
4. `diagnose-connection` valida: assume-role, instancia, tablas, S3, Contact Lens.

**Mantener sync los templates:** si editás `src/components/admin/cfnTemplates.ts`,
regenerá/re-subí los YAML:
```bash
aws s3 cp infra/cfn/connect-role.yaml \
  s3://vox-cfn-templates-731736972577/connect-role.yaml --content-type text/yaml
```

---

## 6. Costo de la plataforma (lado ARIA)

Lo que paga ARIA por operar (no incluye el AWS del cliente, que es BYO):
Lambda + DynamoDB metadata + Cognito + Secrets Manager + CloudWatch + hosting +
transferencia. Por agente ronda **$3-5/mes** (ver
[calculadora](../tecnico/05-costos.md) y `scripts/gen-costos-xlsx.mjs`).

Monitoreo sugerido: CloudWatch (invocaciones/errores por función), Cost Explorer
filtrado por los tags/servicios de la cuenta `731736972577`.

---

## 7. Inventario rápido

- **76** funciones Lambda (`amplify/functions/*/handler.ts`).
- **68** Function URLs (`amplify_outputs.json` → `custom.apiEndpoints`).
- **17** tablas DynamoDB (`connectview-*`): 3 de metadata SaaS + 14 de negocio (BYO).
- Frontend: React 19 + Vite 8 + TS 6 + Tailwind 4; softphone `amazon-connect-streams`.
- Triggers programados: `campaign-dialer`, `callback-dispatcher` (~1 min, EventBridge
  + tick-loop sub-minuto dentro de la invocación).
