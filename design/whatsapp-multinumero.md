# WhatsApp multi-número + Ruteo número→flujo

**Problema.** `configJson.whatsapp` era **singular**: un solo número de Meta por tenant, con el
`botId` mezclado en las credenciales. Eso impedía que un tenant registrara varios números y decidiera
qué flujo atiende cada uno (lo que sí ofrecen Chattigo/ManyChat).

**Diseño (decidido con el usuario).**

- **Registrar N números** → Configuración → Integraciones → WhatsApp (solo credenciales).
- **Decidir el flujo de cada número** → sección Bots → botón **"Ruteo WhatsApp"** (vista aparte).
- **1 número = 1 flujo.** El ruteo vive en `number.botId`, no en las credenciales.
- **Retrocompat:** el número singular viejo se trata como `numbers[0]` automáticamente.

## Modelo de datos

`configJson.whatsapp` (NO sensible, en `connectview-connections`):

```jsonc
{
  "numbers": [
    {
      "id": "409805222211985",
      "label": "Número principal",
      "mode": "meta",
      "metaPhoneNumberId": "409805222211985",
      "wabaId": "…",
      "botId": "<flowId>",
      "tokenSet": true,
    },
  ],
  "flows": [
    /* WhatsApp Flows (#10), común al tenant */
  ],
}
```

Tokens (SECRETO) → Secrets Manager `connectview/tenant/<id>/whatsapp`:
`{ "numberTokens": { "<phoneNumberId>": "<token>" }, "token": "<legacy>" }`.

`_shared/whatsappNumbers.ts` (molde = `metaAccounts.ts`): `normalizeWaNumbers` (legacy→numbers[0]),
`findWaNumber`, `waTokenFor`, `readWaSecret`/`writeWaSecret`.

## Backend

- **manage-connections** — acciones aisladas: `listWaNumbers`, `saveWaNumber` (token→secret),
  `removeWaNumber`, `setWaNumberBot` (el ruteo).
- **whatsapp-meta-webhook** — `findTenantByMetaPhone(phone_number_id)` matchea sobre `numbers[]` y
  devuelve el número receptor; `pickBotId(t.number?.botId)` corre el flujo **de ese número**.

🔑 Ambos bundlean `whatsappNumbers.ts` → `node scripts/deploy-lambda.mjs manage-connections whatsapp-meta-webhook`.

## Frontend

- `useConnections`: `WhatsAppNumberRef` + `effectiveWaNumbers` (espejo de `normalizeWaNumbers`).
- `IntegrationsManager` → `WhatsAppCard`: lista + agregar + quitar (credenciales, badge Ruteado/Sin flujo).
- `src/components/bots/WaRouting.tsx`: tabla número → `<select>` de flujos publicados. Montada en
  `FlowBuilderPage` (rama `routing`, botón "Ruteo WhatsApp" en el HeroBand). Los números `aws` no
  aparecen (se rutean por el flow de Amazon Connect).

## Verificado E2E (2026-07-03, t_3176)

singular→numbers[0] · agregar 2º número · rutear a un flujo (persiste cross-view Integraciones↔Bots) ·
quitar con confirmación. Lint 0 errores.

Relacionado: `meta-multicuenta.md` (mismo patrón para IG/Messenger), Pilar 8 (agente), Pilar 4
(deliverability por número).
