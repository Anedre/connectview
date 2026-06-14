# Análisis de Costos y Precio — ARIA (Connectview)

**Documento técnico / interno** · v3.0 · 2026-06-07

Acompaña a la hoja viva **[`../costos/aria-costos.xlsx`](../costos/aria-costos.xlsx)**
(fórmulas editables). Este `.md` explica el **modelo de costos**, resume los
resultados con los supuestos por defecto y desarrolla el **análisis de precio**:
cuánto cobrar, bajo qué modelo y con qué método.

> **Cambios v3 (auditoría de cobertura de costos, 2026-06-07):**
> - **Precios verificados vs AWS Price List API.** Correcciones materiales:
>   telefonía **Perú** entrante `$0.0022→$0.0075` y saliente `$0.025→$0.0067`;
>   **DynamoDB** on-demand a la mitad (`WRU $1.25→$0.625`, `RRU $0.25→$0.125`,
>   recorte AWS nov-2024); **Contact Lens chat** `$0.0045→$0.0015`; **Meta
>   WhatsApp** marketing `$0.01→$0.02` (verificar Perú).
> - **Re-modelado:** Customer Profiles por **perfil utilizado/día** ($0.005), no
>   por "solicitud"; Amazon Q in Connect por **minuto de voz** ($0.008), no por
>   "sugerencia plana".
> - **Líneas nuevas** que el sistema sí factura y faltaban: **AMD** (detección de
>   contestador, por llamada saliente), **WhatsApp EUM Social** (transporte AWS),
>   **Connect Tasks** y **egreso/reproducción de grabaciones** desde S3.
> - **Secretos/tenant** 2→4 (SF + WhatsApp + OAuth SF).
> - **Salesforce sale del TOTAL AWS** (se muestra como licencia externa aparte).
> - **Una sola definición de opex/margen:** `Resumen` y `PrecioARIA` comparten el
>   opex; `Resumen` distingue **margen bruto** (incl. opex) de **contribución**
>   (solo infra). Nueva **sección D** (cobertura si ARIA hospeda la instancia).

---

## 1. Modelo de costos: dos perspectivas (clave BYO)

Por el modelo **BYO ("Bring Your Own")**, el costo se reparte en dos bolsillos:

| Perspectiva | Quién paga | Qué incluye |
|-------------|-----------|-------------|
| **Costo del CLIENTE** | La empresa, en **su** cuenta AWS | Amazon Connect (voz, telefonía, omnicanal, **Tasks**), **AMD**, **Contact Lens** (voz **y** chat), **Customer Profiles**, **Amazon Q in Connect** (copiloto), números DID, **WhatsApp** (Connect WBM + **EUM Social** + Meta), **Bedrock** (bots/resúmenes), DynamoDB de negocio, S3 de grabaciones (**almacenamiento + egreso**). **+ aparte:** licencia **externa** de Salesforce (no es AWS). |
| **Costo de la PLATAFORMA (ARIA)** | ARIA, en la cuenta `731736972577` | Lambda (cómputo), DynamoDB de metadata, Cognito, Secrets Manager, CloudWatch, hosting Amplify, transferencia de datos. |

> **Por qué importa:** el dato y el uso facturable (telefonía, IA, mensajería,
> almacenamiento) viven en la cuenta del cliente; ARIA solo paga el **cómputo de
> orquestación**, que es barato y sin datos sensibles. El costo marginal de ARIA
> por agente es de **~$3–5** → modelo escalable y de alto margen.

> ⚠️ **Esto solo es cierto en BYO real.** El modelo BYO está **realmente cableado**
> (cada Lambda que toca Connect/WhatsApp/Bedrock asume el rol `VoxCrmConnectAccess`
> del cliente y corre en **su** cuenta). Pero el fallback **legacy** sigue activo:
> el tenant `novasys`/`default` y cualquier piloto que corra sobre la instancia de
> Novasys ejecutan **todo** en la cuenta `731736972577`. Ahí ARIA paga **también la
> instancia** y la suscripción **no alcanza** (ver §5.5).

---

## 2. Precios unitarios

Región **us-east-1**, **junio 2026**. En la hoja son **celdas editables**.
Los marcados *(verificado)* salen de la **AWS Price List API**; los de telefonía
Perú y Meta WhatsApp dependen de país/operador y deben confirmarse antes de cotizar.

### Amazon Connect — omnicanal *(verificado, efectivo 2026-05-01)*
| Concepto | Precio |
|----------|--------|
| Chat | **$0.004** / mensaje |
| Email | **$0.050** / mensaje |
| WhatsApp (WBM serviced) | **$0.010** / mensaje |
| Campañas de voz (conector) | **$0.005** / llamada |
| Tarea (Task) | **$0.040** / tarea |

### Amazon Connect — voz / telefonía *(Perú — verificar operador/destino)*
| Concepto | Precio | Nota |
|----------|--------|------|
| Uso de voz (servicio) | $0.018 / min | *(verificado, end-customer mins)* |
| Telefonía entrante (DID Perú) | **$0.0075** / min | antes se usaba la tarifa genérica EE.UU. $0.0022 |
| Telefonía saliente (Perú, DID) | **$0.0067** / min | Connect bajó Sudamérica nov-2023; **móvil mayor** |
| Número DID | $0.06 / día | rango por país |
| **Detección de contestador (AMD)** | **$0.0085** / llamada | el dialer la activa por default en salientes |

### Analítica e IA de Connect
| Concepto | Precio | Nota |
|----------|--------|------|
| **Contact Lens — voz** | $0.015 / min | *(verificado)* |
| **Contact Lens — chat** | **$0.0015** / mensaje | *(verificado; antes $0.0045, 3×)* |
| **Customer Profiles** | **$0.005** / perfil utilizado-día | 2 perfiles gratis por contacto voz/chat |
| **Amazon Q in Connect** | **$0.008** / min de voz | chat/email/task se tarifan aparte |

### WhatsApp — transporte AWS + cargo de Meta
| Concepto | Precio | Nota |
|----------|--------|------|
| **AWS End User Messaging Social** | **$0.005** / mensaje | transporte AWS; **puede solaparse con WBM** si todo va por Connect — ajustar |
| Meta WhatsApp (marketing, Perú aprox.) | **$0.020** / mensaje | Meta cobra por mensaje desde 2025; LatAm mkt $0.02–0.07 — *verificar Perú* |

### Amazon Bedrock — Claude *(verificado, on-demand)*
| Modelo | Entrada | Salida |
|--------|---------|--------|
| Claude 3.5 Haiku | $0.0008 / 1K tok ($0.80/M) | $0.004 / 1K tok ($4.00/M) |

### Otros AWS + licencia externa *(verificado salvo nota)*
| Concepto | Precio |
|----------|--------|
| Lambda | $0.20 / 1M req + $0.0000167 / GB-s |
| **DynamoDB on-demand** | **$0.625 / 1M escrituras · $0.125 / 1M lecturas** *(recorte AWS nov-2024)* |
| S3 Standard | $0.023 / GB-mes · Cognito $0.015 / MAU · Secrets $0.40 / mes |
| CloudWatch Logs $0.50 / GB · Transferencia / egreso $0.09 / GB | |
| **Salesforce — licencia (EXTERNA, no AWS)** | ~$100 / usuario-mes *(verificar plan)* |

---

## 3. Escenarios de referencia (volúmenes realistas)

> Las llamadas se ajustaron a niveles realistas: **~15–23 llamadas por agente por
> día hábil**. Un agente omnicanal no pasa la jornada entera al teléfono: también
> atiende chat, WhatsApp y email.

| Parámetro (editable) | Piloto | Pyme | Enterprise |
|----------------------|:------:|:----:|:----------:|
| Agentes | 5 | 25 | 100 |
| Llamadas **entrantes** / mes | 1 500 | 6 000 | 32 000 |
| Llamadas **salientes** / mes | 800 | 3 500 | 18 000 |
| → llamadas por agente/día | ~21 | ~17 | ~23 |
| Mensajes WhatsApp / mes | 8 000 | 30 000 | 150 000 |
| Plantillas WhatsApp (HSM) / mes | 1 500 | 6 000 | 30 000 |
| Chats web / mes | 1 000 | 5 000 | 25 000 |
| Emails / mes | 500 | 2 500 | 12 000 |
| Conversaciones de bot / mes | 1 000 | 4 500 | 22 000 |
| Resúmenes IA (Bedrock) / mes | 1 500 | 8 000 | 45 000 |
| Tareas de Connect (Tasks) / mes | 200 | 1 000 | 5 000 |
| Grabaciones almacenadas (GB) | 50 | 300 | 1 500 |
| Grabaciones reproducidas/egreso (GB) | 5 | 30 | 150 |
| Licencias Salesforce *(externo, opcional)* | 2 | 8 | 30 |

---

## 4. Resultado (USD/mes, con supuestos por defecto)

> Cifras calculadas por el verificador numérico del generador (idénticas a las de
> la hoja). Para el detalle línea por línea y para cambiar supuestos, usá
> [`aria-costos.xlsx`](../costos/aria-costos.xlsx).

| Concepto | Piloto | Pyme | Enterprise |
|----------|-------:|-----:|-----------:|
| **Costo AWS del CLIENTE (BYO, sin SF)** | **~$585** | **~$2 402** | **~$12 412** |
| · por agente | ~$117 | ~$96 | ~$124 |
| Licencia **Salesforce** *(externa, opcional)* | ~$200 | ~$800 | ~$3 000 |
| **Costo de la PLATAFORMA (ARIA)** | ~$24 | ~$84 | ~$320 |
| · por agente | ~$4.8 | ~$3.4 | ~$3.2 |
| Opex / agente *(editable)* | $12 | $8 | $6 |
| Costo de servir / agente *(infra + opex)* | ~$16.8 | ~$11.4 | ~$9.2 |
| **Tarifa ARIA / agente** *(recomendada)* | **$45** | **$39** | **$29** |
| **Ingreso ARIA / tenant** | ~$225 | ~$975 | ~$2 900 |
| **Utilidad bruta ARIA / tenant** | ~$141 | ~$691 | ~$1 980 |
| **Margen BRUTO de ARIA** *(incl. opex)* | **~63 %** | **~71 %** | **~68 %** |
| Margen de contribución *(solo infra)* | ~89 % | ~91 % | ~89 % |

### Lectura
- El gasto del **cliente** lo dominan **telefonía + Contact Lens de voz + Amazon Q**
  (voz, en conjunto ~55–65 %). WhatsApp (Connect WBM + EUM Social + Meta) es el
  segundo bloque. La IA generativa (Bedrock/Haiku) y los datos (DynamoDB/S3) son
  marginales.
- El costo de la **plataforma** por agente es **~$3–5/mes**: ARIA corre sobre
  *serverless* puro y solo paga orquestación. **No cambió** con las correcciones
  (la baja de DynamoDB se compensa con más secretos).
- El costo del **cliente** subió levemente vs. v2 (~$96–124 vs ~$87–112/agente)
  porque las líneas nuevas (AMD, EUM Social, Tasks, Q por minuto, egreso) y la
  telefonía entrante real pesan más que las bajas (telefonía saliente, DynamoDB,
  CL chat). Es una factura **más fiel**, no más cara por capricho.
- **Margen de ARIA prácticamente intacto:** ~63–71 % bruto. El precio sigue siendo
  defendible. **Dos márgenes** en la hoja: el **bruto** (con opex, el real) y el de
  **contribución** (solo infra, ~89–91 %); para precio usar siempre el **bruto**.
- **Salesforce es una licencia externa**: el cliente ya la paga (o no la usa). No
  es costo de AWS ni de ARIA; va fuera del TOTAL AWS.

---

## 5. ¿Cuánto cobrar? — Análisis de precio (hoja `PrecioARIA`)

> **Idea central:** el costo de operar ARIA es **~$3–5/agente** (infra) + opex.
> El precio **no** se fija por costo, sino por **valor**. El costo solo marca el
> **piso**; el techo lo pone lo que el cliente ya paga hoy.

### 5.1 Tres métodos para fijar el precio

| Método | Cómo se calcula | Resultado /agente | Para qué sirve |
|--------|-----------------|:-----------------:|----------------|
| **1. Costo-plus** (piso) | costo de servir ÷ (1 − margen 75 %) | $67 · $46 · $37 | asegura margen; **deja plata sobre la mesa** |
| **2. Por valor** (techo) | lo que paga hoy × % capturado (~⅓) | $42 · $39 · $29 | ancla en lo que el cliente **ya gasta** |
| **3. Por servicio** (add-on) | markup 10–15 % sobre su AWS BYO | +$14 · +$12 · +$12 | **opcional**: ARIA gestiona el AWS del cliente |

**Costo de servir / agente** (plataforma + opex de soporte/dev/ventas):
~$16.8 (Piloto) · ~$11.4 (Pyme) · ~$9.2 (Enterprise). El opex (editable: $12/$8/$6)
pesa más que la infra y **baja con la escala**.

**Techo de valor** = lo que el cliente paga **en licencias** de las herramientas que
ARIA reemplaza:

| Herramienta reemplazada | Licencia típica / usuario-mes |
|-------------------------|:-----------------------------:|
| Kommo (CRM) | $15 – $45 |
| Chattigo (omnicanal) | $30 – $60 |
| Salesforce Service/Sales Cloud | $80 – $165 |
| *(alternativa contact-center: Five9 / Genesys)* | $100 – $175 |
| **Stack combinado que ve el cliente** | **$80 – $200** |

### 5.2 ¿Cobrar "por servicio"?

**No como modelo principal.** En BYO el consumo variable (telefonía, WhatsApp, IA)
es **del cliente** y lo paga directo a AWS. El valor de ARIA es el **software** (que
reemplaza 3 herramientas, unifica canales, IA, campañas) y la **operación**. Eso se
cobra **plano por agente**; el consumo pasa a **costo, sin markup** — y eso es un
**argumento de venta** (transparencia).

> El "por servicio" se ofrece **sólo como add-on gestionado** (10–15 %) para clientes
> que **no quieren tocar AWS**. **Importante:** en ese add-on el **cliente sigue
> pagando su AWS** (BYO) y ARIA solo lo opera con un markup. No es lo mismo que ARIA
> **hospedar** la instancia (ver §5.5).

### 5.3 Recomendación: modelo **híbrido**

**Suscripción por agente** (precio plano, predecible) **+ consumo BYO a costo.**

| | Piloto | Pyme | Enterprise |
|--|:------:|:----:|:----------:|
| **Precio recomendado / agente / mes** | **$45** | **$39** | **$29** |
| Margen bruto resultante | ~63 % | ~71 % | ~68 % |
| Descuento vs. su software actual | ~63 % | ~65 % | ~69 % |
| Ingreso ARIA / tenant / mes | $225 | $975 | $2 900 |
| Utilidad bruta ARIA / tenant / mes | ~$141 | ~$691 | ~$1 980 |

**Por qué estos números:** caen **entre el piso (costo-plus) y el techo (valor)**;
son **~65 % más baratos** que el software que el cliente reemplaza; dejan **63–71 %
de margen bruto** ya contando soporte y desarrollo; y el **precio/agente baja con la
escala** (tiering SaaS estándar).

### 5.4 Empaquetado sugerido (planes)

| Plan | Precio/agente | Pensado para | Incluye |
|------|:-------------:|--------------|---------|
| **Starter** | ~$45 | pilotos / equipos chicos | omnicanal, campañas, reportes base |
| **Pro** | ~$39 | pymes en operación | + Contact Lens, copiloto IA, Customer Profiles |
| **Enterprise** | ~$29 *(desde)* | +50 agentes | + SSO/roles avanzados, SLA, multi-cuenta, soporte dedicado |

**Palancas de precio** (editables/negociables): mínimo de agentes por contrato,
descuento por pago anual (~15–20 %), fee de onboarding/setup único, soporte
premium/SLA aparte, add-on de AWS gestionado (markup 10–15 %).

### 5.5 ⚠️ Cobertura: BYO real vs. hospedar la instancia (hoja `PrecioARIA` §D)

La suscripción **solo está diseñada para cubrir la plataforma de ARIA**, no la
instancia del cliente. Eso es correcto **en BYO**, donde el cliente paga su AWS
directo. **El riesgo** aparece si la instancia corre en la **cuenta de ARIA**:

- **Caso BYO (normal):** cliente paga ~$96–124/agente a su AWS; ARIA cobra $29–45 y
  solo paga ~$3–5 de plataforma → **margen 63–71 %**. ✅
- **Caso NO-BYO (piloto sobre la instancia de Novasys, o "AWS gestionado" mal
  hecho):** ARIA paga **instancia + plataforma** = ~$107–134/agente, y cobra $29–45
  → **pérdida**. Para no perder hay que **facturar el consumo aparte** o cobrar
  **all-inclusive** (break-even ~$107–134/agente; con 75 % de margen ~$430–535).

**Recomendaciones de cobertura:**
1. **Nadie en producción sobre la instancia de Novasys** salvo el demo interno; los
   pilotos arrancan en **la cuenta del cliente** (BYO) cuanto antes.
2. **Cerrar el fallback legacy** de `resolveBedrock`/`resolveWhatsApp` para tenants
   reales (que bloqueen como ya hacen `resolveConnect`/`resolveDynamo`), para no
   absorber tokens/mensajes sin querer.
3. El add-on **"AWS gestionado"** funciona solo si el **cliente sigue pagando su
   AWS**; si alguna vez se hospeda la instancia, usar precio **all-inclusive** (§D),
   no el markup de 10–15 %.

---

## 6. Cómo usar la calculadora

1. Abrí [`../costos/aria-costos.xlsx`](../costos/aria-costos.xlsx) en Excel / Google
   Sheets / LibreOffice.
2. Editá **`Parametros`** (volúmenes) y, si hace falta, **`Precios`** (tarifas + supuestos).
3. **`CostoCliente`**, **`CostoARIA`**, **`Resumen`** y **`PrecioARIA`** recalculan solas.
4. En **`Resumen`** está el **opex/agente** y la **tarifa** (fuente única); en
   **`PrecioARIA`** ajustá margen objetivo y techo de valor. El margen, el descuento,
   el ingreso y la **sección D (cobertura NO-BYO)** se recalculan.

> Regenerar la hoja desde el modelo: `node scripts/gen-costos-xlsx.mjs` (imprime
> además la verificación numérica en consola).

---

## 7. Notas y exclusiones

- **Servicios correctamente EXCLUIDOS** (no se usan, confirmado en código): Amazon
  Lex (los bots corren en Bedrock), Step Functions, SQS, SNS, Kinesis/Firehose,
  X-Ray, VPC/NAT, Route 53/ACM/API Gateway (se usan Function URLs nativas).
- **Ítems aún a VERIFICAR antes de cotizar:** telefonía Perú (entrante/saliente,
  móvil vs. fijo), Meta WhatsApp marketing Perú, y el posible **solapamiento** entre
  *WhatsApp WBM* (Connect) y *EUM Social* (transporte AWS) — si todo va por Connect,
  bajá la línea de EUM Social.
- **Sub-modelados de bajo impacto en plataforma** (no movían el resultado, anotados
  en la auditoría): STS AssumeRole, EventBridge Scheduler, KMS, bucket de templates
  CFN, requests variables de Amplify, y el **plan de AWS Support** (~$29–100/mes,
  *overhead global*, no por-tenant → absorber en opex).
- **Salesforce** se incluye como **licencia externa** (no AWS); poné `0` usuarios si
  el cliente no la usa.
- **Free tiers** no aplicados → los costos reales iniciales suelen ser **menores**.
- El **opex por agente** es una **estimación editable**: ajustalo a la estructura
  real de Novasys para que el margen sea fiel.
