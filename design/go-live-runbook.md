# Go-live runbook — activaciones pendientes (Fase 4 + 5)

> Checklist de todo lo que el **código ya soporta** pero espera una **acción del cliente / ops**
> para prenderse. Cada ítem: qué falta, quién lo hace, y cómo se verifica. Ordenado por esfuerzo/impacto.
> Refs: design/fase-4.md, design/fase-5.md, design/sso-setup-udep.md, design/mercadolibre.md.

## Ya activado / listo (nada que hacer)

- **F5.4 — Agente IA por WhatsApp (`agent-channel-adapter`):** ✅ prendido (`DRY_RUN=false` + IAM
  `social-messaging:SendWhatsAppMessage` + número configurado). BYO envía desde el número del tenant.
- **F5.3 — Comentarios de IG:** ✅ código listo (el webhook los procesa). Falta solo lo de Meta (abajo).
- **F5.2 — Deliverability WhatsApp (pipeline):** ✅ código completo + verificado (delivered + cuarentena).
- **F5.1 — Write-back de golpes a SF (código):** ✅ desplegado (degrada si faltan los campos).

## Pendiente · acción del cliente/ops

| #   | Ítem                                  | Quién              | Acción                                                                                                                                                                                                                                                                       | Verificación                                                                                                       |
| --- | ------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 1   | **Deliverability en vivo (F5.2)**     | Ops + Meta         | Conectar el número meta-standalone `+51 908 825 660` (Configuración → Integraciones → WhatsApp, modo Meta + token) y confirmar la URL del webhook en Meta. Ventana coordinada (repuntar webhook es disruptivo).                                                              | Enviar un HSM → el reporte HSM muestra delivered/read en vivo; un número inválido → cuarentena.                    |
| 2   | **Golpes en Salesforce (F5.1)**       | Cliente (SF admin) | Crear los campos custom en el Lead: `VoxTouches__c` (Number), `VoxLastTouch__c` (Date), `VoxFirstTouch__c` (Date), `VoxConverted__c` (Checkbox), `VoxTouchesToClose__c` (Number), `VoxDaysToClose__c` (Number). También `VoxLeadId__c` (Text, External Id) si aún no existe. | Sincronizar un lead con golpes → el Lead de SF muestra los `Vox*__c` poblados.                                     |
| 3   | **Comentarios de Instagram (F5.3)**   | Cliente (Meta App) | En la Meta App: suscribir el objeto **`instagram`** (campo `comments`) + **App Review** de `instagram_manage_comments`.                                                                                                                                                      | Comentar en un post de IG → aparece en el inbox como conversación (responder público/privado).                     |
| 4   | **Mercado Libre (F4.1)**              | Cliente (ML)       | Crear la App de ML (app_id/secret → secret `connectview/mercadolibre`), pegar la URL del webhook en el panel de ML (topics `questions`/`messages`). **Falta también el callback Lambda** (token exchange).                                                                   | Una pregunta en una publicación → aparece en el inbox; responder → sale por ML.                                    |
| 5   | **Carousel a Meta (F4.2b)**           | Cliente + Meta     | Subir 2-3 imágenes reales de UDEP en el composer de carousel → Enviar a aprobación (PENDING 48-72h).                                                                                                                                                                         | Meta acepta la estructura (no rechazo inmediato) → plantilla APPROVED.                                             |
| 6   | **SSO SAML/OIDC (F4.3)**              | Cliente (IdP) + CI | Metadata/credenciales del IdP → env/secrets + `npx ampx pipeline-deploy` (regenera `auth.oauth`). Ver `design/sso-setup-udep.md`.                                                                                                                                            | El botón "Entrar con tu empresa" aparece; login federado funciona.                                                 |
| 7   | **Horario de atención desde Connect** | Cliente (Connect)  | Volver a aplicar la plantilla de conexión (Configuración → Amazon Connect, un clic de CloudFormation) para conceder `connect:DescribeHoursOfOperation`. El rol aplicado antes del 22-jul-2026 no lo tiene.                                                                   | Crear una campaña → el selector de horario muestra los Hours of Operation con su configuración, no "(sin acceso)". |

## Notas de activación clave

- **WhatsApp dual-mode:** el número legacy de UDEP está **anclado a Connect** (inbound por contact flow)
  → los `statuses[]` NO llegan (mutex con el event-destination). El estado por-mensaje/cuarentena solo
  se ilumina con el número **meta-standalone** (#1). Salud del número + analytics de Meta sí funcionan en
  ambos modos.
- **Degradación con gracia:** #2 (SF) y #4/#6 no rompen nada mientras estén pendientes — el código
  detecta lo ausente y sigue (el sync SF degrada, el canal ML/ SSO simplemente no se muestra).
- **Deploy operacional:** #6 (SSO) es el único que necesita `ampx pipeline-deploy` (lo corre el usuario/
  CI); el resto es config de cliente + (para ML) un `create-lambda.mjs` del callback.
