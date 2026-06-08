import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";

/**
 * kickDialer — dispara el campaign-dialer YA (async, fire-and-forget) para no
 * esperar el próximo tick de EventBridge (hasta ~60s). Lo usan control-campaign
 * (start/resume) y create-campaign (startNow) para que la PRIMERA llamada salga
 * en segundos, no en un minuto.
 *
 * Best-effort: si la invocación falla (permiso/throttle), el tick programado de
 * EventBridge agarra la campaña igual, así que NUNCA hacemos fallar la operación
 * del caller por esto.
 *
 * Requiere lambda:InvokeFunction sobre el dialer en el rol del caller.
 */
const lambda = new LambdaClient({});
const DIALER = process.env.DIALER_FUNCTION_NAME || "connectview-campaign-dialer";

export async function kickDialer(): Promise<void> {
  try {
    await lambda.send(
      new InvokeCommand({
        FunctionName: DIALER,
        InvocationType: "Event", // async — no esperamos la respuesta
        Payload: Buffer.from("{}"),
      })
    );
  } catch (err) {
    console.warn("kickDialer: no se pudo disparar el dialer (EventBridge lo tomará):", err);
  }
}
