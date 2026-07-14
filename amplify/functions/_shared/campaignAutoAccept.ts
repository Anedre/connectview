/**
 * Auto-accept de agentes para campañas con "conexión directa": la pata del
 * agente contesta sola (sin 20 s de timbre), que es lo que hace que el
 * cliente no espere en silencio.
 *
 * UpdateUserPhoneConfig REEMPLAZA el objeto PhoneConfig completo (no hay
 * PATCH), por eso cada cambio va precedido de DescribeUser para preservar
 * PhoneType / ACW / DeskPhoneNumber. Todo best-effort: un agente que falla
 * no debe frenar la campaña (queda con timbre manual, que es el status quo).
 *
 * OJO: AutoAccept es una config GLOBAL del usuario en Connect — mientras la
 * campaña corre, también auto-contesta llamadas entrantes de otras colas.
 * Se aplica al iniciar/reanudar campaña y al agregar un agente en caliente;
 * se revierte al cancelar, completar o quitar al agente.
 */
import {
  ConnectClient,
  DescribeUserCommand,
  UpdateUserPhoneConfigCommand,
} from "@aws-sdk/client-connect";

export async function applyAutoAccept(
  client: ConnectClient,
  instanceId: string,
  userIds: string[],
  enabled: boolean,
): Promise<{ ok: number; failed: number }> {
  let ok = 0;
  let failed = 0;
  for (const userId of userIds) {
    try {
      const u = await client.send(
        new DescribeUserCommand({ InstanceId: instanceId, UserId: userId }),
      );
      const pc = u.User?.PhoneConfig;
      if (!pc?.PhoneType) {
        failed++;
        continue;
      }
      if ((pc.AutoAccept ?? false) === enabled) {
        ok++; // ya estaba en el estado deseado
        continue;
      }
      await client.send(
        new UpdateUserPhoneConfigCommand({
          InstanceId: instanceId,
          UserId: userId,
          PhoneConfig: {
            PhoneType: pc.PhoneType,
            AutoAccept: enabled,
            AfterContactWorkTimeLimit: pc.AfterContactWorkTimeLimit,
            DeskPhoneNumber: pc.DeskPhoneNumber,
          },
        }),
      );
      ok++;
    } catch (err) {
      console.warn(`applyAutoAccept(${enabled}) falló para user ${userId}:`, err);
      failed++;
    }
  }
  return { ok, failed };
}
