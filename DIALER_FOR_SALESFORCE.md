# Vox Dialer — Reusable Outbound Engine

**Audiencia:** dirección + equipo de Salesforce.
**Objetivo:** demostrar que el dialer es un servicio independiente, no un componente acoplado al CRM. Salesforce puede crear campañas usando el mismo motor sin cambios al dialer.

---

## TL;DR (1 minuto)

- El dialer es un **Lambda en AWS** (`connectview-campaign-dialer`) que corre cada minuto vía EventBridge.
- Para crear una campaña, **cualquier cliente HTTP** (Vox CRM, Salesforce, Postman, cron job) llama a un endpoint `POST createCampaign` con los leads.
- El dialer hace tick cada 60 s, busca campañas RUNNING y dispara llamadas vía `StartOutboundVoiceContact` de Amazon Connect.
- El estado de cada llamada se actualiza en DynamoDB; cualquier integrador puede leerlo vía `GET listCampaigns` / `getCampaignStats`.
- Soporta **voice + WhatsApp** en un solo Lambda. Mismo payload, distinto `campaignType`.

---

## Arquitectura — diagrama de la integración

```
              Salesforce                       Vox CRM
                   \                            /
                    \                          /
                     ▼                        ▼
                ┌─────────────────────────────────┐
                │   POST createCampaign           │ ← contrato HTTP único
                │   Lambda Function URL           │
                └────────────────┬────────────────┘
                                 │
                  Escribe campaña + N filas (1 por lead)
                                 │
                                 ▼
                ┌─────────────────────────────────┐
                │   DynamoDB                      │
                │   - connectview-campaigns       │ ← metadata de la campaña
                │   - connectview-campaign-contacts │ ← 1 fila por lead
                │   - connectview-campaign-agents │ ← agentes asignados
                └────────────────┬────────────────┘
                                 │
            EventBridge rate(1 minute)
                                 │
                                 ▼
                ┌─────────────────────────────────┐
                │   campaign-dialer (Lambda)      │
                │   - Lista campañas RUNNING      │
                │   - Por cada una verifica:      │
                │     · ventana horaria           │
                │     · concurrencia (slots)      │
                │     · agentes disponibles       │
                │   - Marca rows como "dialing"   │
                │   - Llama Connect.StartOutboundVoice│
                │                                 │
                │   Para WhatsApp:                │
                │   - Llama send-whatsapp-template│
                │     (Meta Cloud API via         │
                │      Connect SocialMessaging)   │
                └────────────────┬────────────────┘
                                 │
                                 ▼
                ┌─────────────────────────────────┐
                │   Amazon Connect                │
                │   - Contact flow (AMD)          │
                │   - Cola de routing             │
                │   - Agente atiende en su CCP    │
                └────────────────┬────────────────┘
                                 │
                  Contact Events vía EventBridge
                                 │
                                 ▼
                ┌─────────────────────────────────┐
                │   process-contact-event (Lambda)│
                │   Actualiza estado de cada lead:│
                │   pending → dialing → done/failed│
                └─────────────────────────────────┘
```

**Punto clave**: cualquier sistema que sepa hacer `POST` HTTP puede ser el origen. Hoy es Vox CRM. Mañana es Salesforce. Ningún cambio al dialer.

---

## Contrato HTTP — `POST createCampaign`

**Endpoint** (production):

```
https://26bia7kkxupfzfdcsscemnftna0vwaju.lambda-url.us-east-1.on.aws/
```

**Headers**:
```
Content-Type: application/json
```

**Payload** (campos marcados con `*` son obligatorios):

```jsonc
{
  "name": "Recordatorio cita febrero 2026",                  // *
  "description": "Campaña de seguimiento UDEP-Pregrado",
  "createdBy": "salesforce-user-xyz",                        // quién la creó

  // ── Canal ──
  "campaignType": "voice",                                   // "voice" | "whatsapp"

  // ── Para "voice" ──
  "sourcePhoneNumber": "+5116433467",                        // * número saliente Connect
  "contactFlowId": "a40dc527-8348-4694-a389-7b675c0ac3ac",   // * contact flow ID
  "contactFlowName": "UDEP-Outbound-Smart",
  "campaignQueueId": "9ff3b0a1-90aa-4d2a-8029-c4526a22adc8", // cola destino
  "campaignQueueName": "UDEP-Pregrado",

  // ── Para "whatsapp" ──
  "templateName": "udep_admision_emoji",                     // template aprobado en Meta
  "templateLanguage": "es",
  "templateVarColumns": ["nombre", "programa"],              // mapeo de variables

  // ── Pacing ──
  "dialMode": "progressive",                                 // "progressive" | "power" | "agentless"
  "concurrency": 5,                                          // llamadas simultáneas máx
  "maxContactsPerAgent": 5,                                  // bucket por agente
  "timezone": "America/Lima",
  "windowStartHour": 9,                                      // ventana 9am–6pm
  "windowEndHour": 18,
  "windowDaysOfWeek": [1, 2, 3, 4, 5],                       // lun a vie

  // ── Retry ──
  "retryNoAnswerMinutes": 30,
  "retryMaxAttempts": 3,

  // ── Leads ──
  "contacts": [                                              // *
    {
      "phone": "+51953730189",                               // * E.164
      "customerName": "Andre Alata",
      "attributes": {
        "nombre": "Andre",
        "programa": "Pregrado",
        "lead_source": "salesforce"
      }
    },
    {
      "phone": "+51987654321",
      "customerName": "María Pérez",
      "attributes": {
        "nombre": "María",
        "programa": "Posgrado"
      }
    }
  ],

  "startNow": true                                           // RUNNING vs DRAFT
}
```

**Respuesta** (201 Created):

```jsonc
{
  "campaignId": "c1234abcd-5678-...",
  "name": "Recordatorio cita febrero 2026",
  "status": "RUNNING",
  "totalContacts": 2,
  "createdAt": "2026-05-22T15:00:00Z",
  // Opcional: si useNativeCampaign === true se crea también
  // una campaña en AWS Outbound Campaigns V2
  "awsCampaignId": "5e25a60e-2992-4dfe-809a-cf1bb16779e1"
}
```

**Errores comunes**:

| Código | Causa | Solución |
|--------|-------|----------|
| 400 | Falta `name`, `sourcePhoneNumber`, `contactFlowId` o `contacts` | Revisa el payload |
| 400 | `phone` no es E.164 | Usa `libphonenumber-js` para normalizar |
| 403 | El `contactFlowId` no existe en el instance | Pide a Connect Admin que comparta el ID |
| 500 | DynamoDB throughput exceeded | Reintenta con exponential backoff |

---

## Endpoints relacionados (también listos para Salesforce)

| Operación | Método | Endpoint |
|-----------|--------|----------|
| Crear campaña | POST | `createCampaign` |
| Listar campañas | GET | `listCampaigns` |
| Stats de 1 campaña | GET | `getCampaignStats?campaignId=...` |
| Contactos de 1 campaña | GET | `getCampaignContacts?campaignId=...` |
| Pausar / reanudar / cancelar | POST | `controlCampaign` |
| Clonar | POST | `cloneCampaign` |
| Relanzar fallidos | POST | `relaunchCampaign` |
| Editar contactos | POST | `editCampaignContacts` |
| Agregar más contactos | POST | `addContacts` |

Todos los endpoints están listados en `amplify_outputs.json` → `custom.apiEndpoints` (JSON estringificado).

---

## Cómo lo va a usar Salesforce — pseudocódigo Apex

```apex
public class VoxDialer {
  public static String createCampaign(
    String name,
    String sourcePhoneNumber,
    String contactFlowId,
    List<Lead> leads
  ) {
    HttpRequest req = new HttpRequest();
    req.setEndpoint('https://26bia7kkxupfzfdcsscemnftna0vwaju.lambda-url.us-east-1.on.aws/');
    req.setMethod('POST');
    req.setHeader('Content-Type', 'application/json');

    Map<String, Object> body = new Map<String, Object>{
      'name' => name,
      'sourcePhoneNumber' => sourcePhoneNumber,
      'contactFlowId' => contactFlowId,
      'campaignType' => 'voice',
      'dialMode' => 'progressive',
      'concurrency' => 5,
      'timezone' => 'America/Lima',
      'startNow' => true,
      'contacts' => mapLeads(leads)
    };
    req.setBody(JSON.serialize(body));

    HttpResponse resp = new Http().send(req);
    if (resp.getStatusCode() != 201) {
      throw new VoxDialerException(resp.getBody());
    }
    Map<String, Object> data = (Map<String, Object>) JSON.deserializeUntyped(resp.getBody());
    return (String) data.get('campaignId');
  }

  private static List<Map<String, Object>> mapLeads(List<Lead> leads) {
    List<Map<String, Object>> out = new List<Map<String, Object>>();
    for (Lead l : leads) {
      out.add(new Map<String, Object>{
        'phone' => formatE164(l.Phone),
        'customerName' => l.Name,
        'attributes' => new Map<String, String>{
          'lead_id' => l.Id,
          'lead_source' => l.LeadSource
        }
      });
    }
    return out;
  }
}
```

---

## Seguridad

**Hoy:** las Lambda Function URLs son `AuthType=NONE` (públicas con CORS abierto).

**Antes del go-live con Salesforce:**
1. Cambiar `AuthType=AWS_IAM` y firmar requests con SigV4 desde un IAM role asumido por Salesforce.
2. O migrar a API Gateway con un API Key + WAF + rate limiting.
3. Idealmente: un endpoint dedicado para Salesforce con un secret rotado vía AWS Secrets Manager.

---

## Garantías de comportamiento

- **At-least-once dispatch**: si el dialer falla mid-tick, en el siguiente minuto retoma. Un lead nunca se queda dialing perpetuamente.
- **Idempotencia**: cada `StartOutboundVoiceContact` lleva `ClientToken = rowId-attempts-timestamp`. Reintentos no generan duplicados dentro de los 5 minutos del token TTL.
- **Window enforcement**: si el reloj cae fuera de `windowStartHour..windowEndHour` o no es uno de `windowDaysOfWeek`, el dialer skipea esa campaña ese tick.
- **Retry exponencial**: `retryNoAnswerMinutes` por intento, hasta `retryMaxAttempts`. Después de eso → `failed`.
- **AMD**: cuando hay `AMD_FLOW_ID` configurado, el flow filtra voicemails antes de llegar al agente.
- **Per-agent bucket**: cada agente Available tiene su cola personal de `maxContactsPerAgent` leads pre-asignados. Cuando se vacía, se rellena desde el pool general.

---

## Monitoreo

| Métrica | Dónde verla |
|---------|------------|
| Invocaciones del dialer | CloudWatch → Lambda `connectview-campaign-dialer` → Invocations |
| Llamadas disparadas | CloudWatch → Lambda → Logs (busca `StartOutboundVoiceContact`) |
| Estado de campañas | UI Vox CRM `/campaigns` o API `GET listCampaigns` |
| Métricas reales por cola | Connect → Real-time metrics o `/queue` en el CRM |

---

## Cambios futuros sin tocar el dialer

Estos cambios se hacen agregando capas alrededor, no modificando `campaign-dialer/handler.ts`:

- **Nuevo canal (SMS, e-mail bulk)**: agregar `campaignType: "sms"` y delegar a un nuevo Lambda dispatcher (espejo de `send-whatsapp-template`).
- **Webhooks de Salesforce**: enviar callbacks cuando un lead cambia de estado (subscribir a EventBridge `aws.connect` o a DynamoDB Streams).
- **Lead scoring previo**: insertar un Lambda intermedio entre `createCampaign` y la insert en DynamoDB.
- **Suppression list**: agregar checks en el dialer (lee de una nueva tabla `connectview-suppression`).
