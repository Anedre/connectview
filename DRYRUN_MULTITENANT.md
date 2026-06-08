# Dry-run multi-tenant (ARIA) — `novasys-dev` como "tenant 2"

Objetivo: probar **en la app real** que ARIA resuelve un tenant distinto a una
**instancia de Connect distinta** (`novasys-dev`, no la de Novasys), aislado — el
mismo flujo que hará UDEP, **sin tocar producción** y sin una cuenta nueva.

---

## ✅ Ya hecho (automático)
- **Backend probado**: 2 tenants → 2 instancias aisladas (`novasys` 14 colas vs `novasys-dev` 10 colas) + provisión de flows OK.
- **Config del tenant de prueba creada**: `t_aria_drytest` → `novasys-dev`
  (verificada, branding `ARIA · DRY-RUN`). NO afecta a Novasys (`t_3176`): es otra fila, otra instancia.

## ⚠️ Lo único que falta lo hacés vos (creación de cuenta = tu acción)

### Paso 1 — Crear el usuario Cognito de prueba
> Elegí tu propia contraseña donde dice `<TU-CONTRASEÑA>` (ej. algo tipo `DryRun-2026!`).

```bash
# 1a) crear el usuario (email = username; sin mandar email)
aws cognito-idp admin-create-user \
  --user-pool-id us-east-1_csLvANyZo \
  --username drytest@aria.test \
  --user-attributes Name=email,Value=drytest@aria.test Name=email_verified,Value=true "Name=custom:tenantId,Value=t_aria_drytest" \
  --message-action SUPPRESS \
  --region us-east-1

# 1b) ponerle una contraseña permanente (la elegís vos)
aws cognito-idp admin-set-user-password \
  --user-pool-id us-east-1_csLvANyZo \
  --username drytest@aria.test \
  --password '<TU-CONTRASEÑA>' --permanent \
  --region us-east-1

# 1c) hacerlo Admin de su org (para ver Integraciones)
aws cognito-idp admin-add-user-to-group \
  --user-pool-id us-east-1_csLvANyZo \
  --username drytest@aria.test \
  --group-name Admins \
  --region us-east-1
```

### Paso 2 — (recomendado) Deployar el frontend
El frontend **buildea limpio** y está listo. Deployalo para probar también el botón
**"⚡ Provisionar flows"** y el white-label. *(Sin deployar, igual podés probar la
RESOLUCIÓN/aislamiento — eso es backend y ya está vivo.)*

### Paso 3 — Entrar y verificar el aislamiento
Entrá a ARIA con `drytest@aria.test` + tu contraseña. Mirá:
- **Datos de `novasys-dev`, no de Novasys** (lo clave, funciona ya): el tablero / las
  colas muestran las **10 colas STANDARD de novasys-dev**, NO las 14 de Novasys.
  Integraciones → "Estado de la integración" debe correr contra `novasys-dev`.
- **(Si deployaste)** la **sidebar dice `ARIA · DRY-RUN`** → confirma que tomó la
  config del tenant de prueba.

### Paso 4 — (si deployaste) Provisionar flows
- Integraciones → Amazon Connect → **⚡ Provisionar flows**.
- Verificá en la consola de Connect de `novasys-dev` que aparezcan
  `ARIA-Inbound` / `ARIA-Outbound` / `ARIA-Disconnect`.

---

## 🧹 Limpieza (cuando termines el dry-run)
```bash
aws cognito-idp admin-delete-user --user-pool-id us-east-1_csLvANyZo --username drytest@aria.test --region us-east-1
aws dynamodb delete-item --table-name connectview-connections --key '{"tenantId":{"S":"t_aria_drytest"}}' --region us-east-1
```
*(Si en el Paso 4 creaste flows en novasys-dev, borralos desde la consola de Connect.)*

---

## Qué prueba este dry-run — y qué NO
**Prueba (en la app real):** resolución por tenant → instancia correcta, **aislamiento**
de datos/colas/flows entre tenants, y la provisión de flows en la instancia del tenant.
Es el 90% de lo que hará UDEP.

**NO cubre:**
- **Cross-account real** (UDEP en SU cuenta): `novasys-dev` está en la misma cuenta. El
  `sts:AssumeRole` es **idéntico**, solo cambia el número de cuenta (el rol ya permite `arn:aws:iam::*:role/VoxCrmConnectAccess`).
- **Aislamiento de data plane** (misma cuenta = mismas tablas pooled). Para eso sí hace
  falta una 2da cuenta con su propio data plane.
