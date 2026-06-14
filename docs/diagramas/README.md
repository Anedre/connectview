# Diagramas (draw.io) — Vox CRM / Connectview

Versiones **editables en draw.io** de los diagramas de arquitectura y flujo del
proyecto, dibujadas con los **iconos oficiales de AWS** (set `mxgraph.aws4`).

Cada diagrama viene en dos archivos con el mismo nombre:

- **`.drawio`** — fuente editable. Ábrelo en [app.diagrams.net](https://app.diagrams.net)
  o en draw.io Desktop (`Archivo → Abrir`). Los iconos de AWS se cargan solos.
- **`.png`** — vista previa de alta resolución (render directo del `.drawio`).

Los diagramas en **Mermaid** siguen viviendo dentro de los `.md` de `docs/tecnico/`
(no se tocaron); esto es una capa visual paralela, lista para presentaciones y para
editar a mano.

---

## Índice

| Archivo | Qué muestra | Fuente |
|---------|-------------|--------|
| `01-arquitectura-logica` | Vista lógica por capas: Cliente · Identidad (Cognito) · API (Function URLs) · 76 Lambdas por dominio · núcleo compartido · datos y servicios | `tecnico/01-arquitectura-aplicacion.md` §3 |
| `01-byo-secuencia` | Secuencia multi-tenant **BYO**: `assume-role` cross-account con `ExternalId` y las tres ramas (fundador / real / bloqueado) | `tecnico/01-arquitectura-aplicacion.md` §6 |
| `02-arquitectura-fisica` | Topología de despliegue AWS: **cuenta Vox** (cómputo, identidad, metadata) vs **cuenta del cliente** (Connect, Bedrock, WhatsApp, S3, datos) | `tecnico/02-arquitectura-fisica.md` §1 |
| `02-onboarding-flujo` | Onboarding 1-clic con CloudFormation y la bifurcación **BYO Data Plane** | `tecnico/02-arquitectura-fisica.md` §3 |
| `03-autenticacion` | Autenticación e identidad: sesión Cognito + arranque del softphone (federación / popup) | `tecnico/03-flujo-procesos.md` §1 |
| `03-onboarding-secuencia` | Secuencia de alta de un tenant: Admin · Vox · CloudFormation · `connections` | `tecnico/03-flujo-procesos.md` §2 |
| `03-campana-outbound` | Campaña de salida: creación (Supervisor/Admin) y ejecución automática (EventBridge → dialer → voz/WhatsApp) | `tecnico/03-flujo-procesos.md` §3 |
| `03-contacto-entrante` | Atención de un contacto entrante por el agente, con copiloto de IA (Bedrock) | `tecnico/03-flujo-procesos.md` §4 |
| `03-bot-whatsapp` | Bot de WhatsApp entrante de punta a punta (EUM · Contact Flow · adapter · bot-runtime · Bedrock) | `tecnico/03-flujo-procesos.md` §5 |
| `03-resumen-ia` | Resumen de llamada con IA (Contact Lens / transcripción → Bedrock → sugerencia) | `tecnico/03-flujo-procesos.md` §6 |

---

## Cómo editar

1. Abre el `.drawio` en draw.io (web o escritorio).
2. Para añadir más servicios AWS: panel izquierdo → **Más formas** → marca **AWS 2019/2025**.
   Los iconos usan el estilo `shape=mxgraph.aws4.resourceIcon`.
3. Para volver a exportar un PNG/SVG: `Archivo → Exportar como → PNG…` (escala 2x, fondo blanco).

## Nota sobre los iconos

El set `aws4` de draw.io no trae un icono dedicado para cada servicio nuevo. Donde
no existe, se usa el icono oficial más cercano de la misma familia, siempre con
etiqueta explícita:

| Servicio real | Icono usado |
|---------------|-------------|
| Amazon Bedrock | Machine Learning (categoría IA/ML) |
| AWS End User Messaging (WhatsApp) | Amazon Pinpoint (servicio antecesor) |
| Amazon Connect Customer Profiles | Customer Engagement |
| AWS STS · IAM Role | Identity & Access Management (IAM) |

El resto de servicios (Lambda, DynamoDB, S3, Cognito, Amazon Connect, EventBridge,
CloudFront, CloudFormation, CloudWatch, Amplify, Secrets Manager) usan su icono
oficial exacto.
