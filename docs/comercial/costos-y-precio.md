# ARIA — Costos y Estrategia de Precio

**Documento comercial / interno** · v1.1 · 2026-06-07 · *by Novasys*

Resumen estratégico de **cuánto cuesta operar ARIA, cuánto cobrar y por qué**.
Para el detalle con fórmulas vivas, ver la calculadora
[`../costos/aria-costos.xlsx`](../costos/aria-costos.xlsx) y el modelo técnico
[`../tecnico/05-costos.md`](../tecnico/05-costos.md).

---

## 1. Resumen ejecutivo

- **Operar ARIA cuesta ~$3–5 por agente/mes** (infra serverless). El costo es un detalle → **el precio se fija por valor, no por costo.**
- **Cobramos dos cosas:** un **setup** (una vez, financia la implementación y da caja) + una **suscripción por agente** (el motor recurrente, donde está el valor que compone).
- **Precio sugerido:** setup **$2.5k–$15k** según complejidad · suscripción **$29–45/agente/mes** · consumo AWS **BYO a costo**.
- **No competimos contra una herramienta, sino contra el stack apilado** (Salesforce + Chattigo + Kommo + Connect ≈ **$299/agente/mes**). Ahí ganamos por amplio margen.
- **Margen bruto recurrente: 60–85%**, sano para un SaaS.

---

## 2. El modelo de costos (BYO) en 30 segundos

Por el modelo **BYO (“Bring Your Own”)**, el gasto se reparte en dos bolsillos:

| | Quién paga | Qué incluye | Magnitud |
|--|--|--|--|
| **Costo del cliente** | La empresa, en **su** cuenta AWS | Connect, telefonía, WhatsApp, IA, datos, grabaciones | ~$96–124/agente |
| **Costo de la plataforma (ARIA)** | ARIA, en su cuenta | Lambda, DynamoDB metadata, Cognito, hosting | **~$3–5/agente** |

> El uso facturable y el **dato** viven en la cuenta del cliente. ARIA solo paga la
> **orquestación**, que es barata y sin datos sensibles. Eso hace el modelo escalable,
> rentable y vendible (“tu data nunca sale de tu nube”).

---

## 3. Cómo cobramos: Setup + Suscripción

**Cobrar setup es correcto** (financia la implementación, da caja, des-riesga). Pero el
setup **no reemplaza** la suscripción: la suscripción es donde el negocio compone valor.

> Una dev-shop vale ~1× sus ingresos. Un SaaS vale **5–10× su ingreso recurrente**.
> Mismo trabajo, empresa muy distinta. La diferencia es la suscripción.

### 3.1 Setup / implementación (una vez)

| Tier | Para | Setup |
|--|--|--:|
| **Starter** | piloto, ≤10 agentes, 1 integración | $2,500 – $4,000 |
| **Pro** | 10–50 agentes, 2–3 integraciones, migración, capacitación | $6,000 – $12,000 |
| **Enterprise** | 50+, flujos a medida, SSO, multi-cuenta | desde $15,000 (cotizado) |

*Regla: ~4–6 meses de la suscripción, o ~$250–350/agente, con piso de $2,500. Cubre la
implementación de ESE cliente — **no** el desarrollo de la plataforma (eso se amortiza vía MRR).*

### 3.2 Suscripción (recurrente) — el motor

| Plan | Precio/agente/mes | Incluye |
|--|:--:|--|
| **Starter** | ~$45 | omnicanal, campañas, reportes base |
| **Pro** | ~$39 | + Contact Lens, copiloto IA, Customer Profiles |
| **Enterprise** | ~$29 *(desde)* | + SSO/roles avanzados, SLA, multi-cuenta, soporte dedicado |

El precio **baja con la escala** (tiering SaaS estándar). Margen bruto resultante: **~63–71%**.

### 3.3 Consumo y add-ons

- **Consumo AWS:** BYO, a **costo, sin markup** (argumento de venta = transparencia).
- **Add-on “AWS gestionado”:** markup 10–15% para quien no quiere tocar su nube. **El cliente sigue pagando su AWS**; ARIA solo lo opera. (No es lo mismo que ARIA *hospedar* la instancia: ver ⚠️ abajo.)
- **Palancas:** mínimo de agentes, descuento por pago anual (~15–20%), soporte premium/SLA, fee de onboarding.

> ⚠️ **Regla de cobertura.** La suscripción ($29–45/agente) cubre **nuestra** plataforma (~$3–5/agente), **no** la instancia del cliente — porque en BYO esa la paga el cliente directo a AWS. Si en un **piloto** o por error la instancia corre en **nuestra** cuenta, pagamos también la instancia (~$96–124/agente) y la suscripción **no alcanza**: hay que facturar el consumo aparte o ir **all-inclusive** (break-even ~$107–134/agente). Mantener a todos en **su** cuenta (BYO).

---

## 4. Por qué este precio (los 3 métodos)

| Método | Resultado /agente | Rol |
|--|:--:|--|
| **Costo-plus** (costo de servir ÷ margen) | $37 – $67 | **piso** — asegura margen |
| **Por valor** (lo que ya paga × % capturado) | $29 – $42 | **el método correcto acá** |
| **Competidores** (anclas de mercado) | $80 – $200 | **techo** — lo que existe hoy |

**Anclas de competencia (licencia/usuario-mes):** Kommo $15–45 · Chattigo ~$30–60 ·
Salesforce $80–165 · Five9/Genesys $100–175. **Stack combinado: $80–200.**
ARIA captura ~⅓ de ese valor y sigue siendo mucho más barato.

---

## 5. Competimos contra el STACK, no contra una herramienta

El cliente tipo (UDEP y similares) **apila** varias herramientas que se pisan:

| Herramienta | $/agente/mes | $/mes (25 ag.) |
|--|--:|--:|
| Salesforce (CRM) | ~$100 | $2,500 |
| Chattigo (omnicanal) | ~$45 | $1,125 |
| Kommo (venta WhatsApp) | ~$18 | $450 |
| Amazon Connect + AWS (consumo) | ~$96 | $2,400 |
| Integración / middleware / dev | ~$40 | $1,000 |
| **TOTAL hoy** | **~$299** | **~$7,475** |

**Con ARIA:**

- **Opción A — conservan Salesforce:** ARIA reemplaza Chattigo + Kommo + capa de contact center → **~$235/agente**, ahorro **~21%** (~$19k/año).
- **Opción B — ARIA reemplaza todo (incl. Salesforce):** **~$135/agente**, ahorro **~55%** (~$49k/año).

> El consumo de AWS (~$96/agente) lo pagan **con o sin ARIA**, así que se cancela en el ahorro: lo que baja es el **software** (Chattigo+Kommo+middleware → ARIA). Por eso el ahorro recurrente se mantiene aunque el consumo AWS suba.

> Comparación justa: el **software** ARIA ($29–39) se compara contra la **licencia** del software
> que reemplaza ($80–200), no contra el total. La telefonía se paga con cualquiera — con ARIA, a costo.

---

## 6. Caso ancla: UDEP (trato especial)

UDEP es el **cliente ancla** → trato especial a cambio de **caso de éxito + referencia + feedback**.
Detalle visual en [`ARIA-Propuesta-UDEP.pdf`](ARIA-Propuesta-UDEP.pdf). Estimado a 25 agentes:

| | Estándar | **UDEP** |
|--|--:|--:|
| Setup (una vez) | $8,000 | **$4,500** |
| Suscripción/agente/mes *(congelada 12 m)* | $39 | **$29** |
| Inversión año 1 | $19,700 | **$13,200** |

- **3 integraciones incluidas** (Salesforce, Amazon Connect, WhatsApp) + todo (canales, IA, Contact Lens, Customer Profiles, campañas, soporte año 1).
- **Ahorro UDEP ~$22,200/año** conservando Salesforce; el **setup se recupera en ~2 meses**.
- **Para ARIA:** aun con descuento, el recurrente deja **~60% de margen**; el setup cubre la implementación. El descuento lo financia el valor del logo, no la caja.

---

## 7. Objeciones frecuentes (y respuestas)

- **“¿Por qué no son baratos como Kommo ($15)?”** → Kommo es un CRM de venta social, no un contact center. ARIA trae voz real, IA, analítica y omnicanal. Distinto producto, distinta liga.
- **“Queremos quedarnos con Salesforce.”** → Perfecto: ARIA **se integra** con Salesforce y reemplaza el resto. Igual ahorran ~$22k/año (Opción A).
- **“El consumo de AWS suena caro.”** → Es el mismo que pagarían con cualquier plataforma — con ARIA lo pagan **a costo**, sin el markup que esconden los demás.
- **“No queremos administrar AWS.”** → Add-on **AWS gestionado** (markup 10–15%): ARIA opera la nube por ellos.
- **“No los conocemos / riesgo.”** → BYO: su data nunca sale de su cuenta; el acceso es revocable. Sin lock-in. Y arrancamos con un piloto.

---

## 8. Supuestos y notas

- Precios us-east-1, jun-2026, **verificados vs AWS Price List API** (auditoría v3, 2026-06-07). Connect omnicanal, voz, Contact Lens, Bedrock, Lambda, S3, DynamoDB, etc. = confirmados. **A verificar por país antes de cotizar:** telefonía Perú (entrante/saliente), Meta WhatsApp marketing Perú, y el posible solapamiento WhatsApp WBM vs EUM Social.
- El costo del cliente subió de ~$87–112 a **~$96–124/agente** al incorporar cargos que faltaban (AMD, WhatsApp EUM Social, Connect Tasks, Amazon Q por minuto, egreso de grabaciones, telefonía entrante real) — es una factura más fiel. El margen de ARIA queda **intacto (~63–71%)**.
- Chattigo es cotizado (precio no público); Salesforce varía por plan/descuento edu.
- El **opex por agente** (soporte, dev, ventas) es estimación editable — ajustar a la estructura real de Novasys. El plan de **AWS Support** (~$29–100/mes, overhead global) se absorbe en opex.
- Todos los números recalculan en [`aria-costos.xlsx`](../costos/aria-costos.xlsx) (hojas `Resumen` y `PrecioARIA`); el detalle del modelo en [`../tecnico/05-costos.md`](../tecnico/05-costos.md).
