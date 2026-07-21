import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { Journey } from "@/hooks/useJourneys";
import type { Workflow } from "@/lib/workflows";

/**
 * Integración del RUTEO de la fachada (useWorkflows). El mapeo puro ya está
 * blindado en workflows.test.ts; aquí verificamos el último eslabón —que cada
 * forma pega al MOTOR correcto— porque es el vector real de "mensaje duplicado /
 * nurture roto":
 *   · reflex → POST a la tabla de reglas (automation-engine), NO toca journeys.
 *   · journey → saveJourney (journey-runner), NO toca reglas.
 *   · split → journey MANUAL primero (¡no auto-inscribe!) + regla puente después.
 * Sin red: mockeamos useJourneys, authedFetch y los endpoints.
 */

// ── Mocks (hoisted por vi.mock) ──
let journeysData: Journey[] = [];
const saveJourneyMock = vi.fn(async (j: Journey) => ({ ...j, journeyId: j.journeyId || "j-new" }));
const removeJourneyMock = vi.fn(async () => true);
const reloadJourneysMock = vi.fn(async () => {});

vi.mock("@/hooks/useJourneys", () => ({
  useJourneys: () => ({
    journeys: journeysData,
    loading: false,
    error: null,
    reload: reloadJourneysMock,
    save: saveJourneyMock,
    remove: removeJourneyMock,
    enroll: vi.fn(),
    stats: vi.fn(),
  }),
}));

vi.mock("@/lib/api", () => ({
  getApiEndpoints: () => ({
    manageAutomations: "https://api.test/rules",
    manageLeads: "https://api.test/leads",
  }),
}));

let rulesData: unknown[] = [];
const authedFetchMock = vi.fn((_url: string, opts?: { method?: string; body?: string }) => {
  const method = opts?.method || "GET";
  if (method === "POST")
    return Promise.resolve({
      ok: true,
      json: async () => ({ saved: true, rule: JSON.parse(opts?.body || "{}") }),
    });
  if (method === "DELETE")
    return Promise.resolve({ ok: true, json: async () => ({ deleted: true }) });
  return Promise.resolve({ ok: true, json: async () => ({ rules: rulesData }) });
});
vi.mock("@/lib/authedFetch", () => ({
  authedFetch: (url: string, opts?: { method?: string; body?: string }) =>
    authedFetchMock(url, opts),
}));

import { useWorkflows } from "@/hooks/useWorkflows";

async function mountReady() {
  const hook = renderHook(() => useWorkflows());
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}
function postCall() {
  const c = authedFetchMock.mock.calls.find((x) => x[1]?.method === "POST");
  return c ? { url: c[0] as string, body: JSON.parse((c[1] as { body: string }).body) } : null;
}

beforeEach(() => {
  journeysData = [];
  rulesData = [];
  authedFetchMock.mockClear();
  saveJourneyMock.mockClear();
  removeJourneyMock.mockClear();
  reloadJourneysMock.mockClear();
});

const step = (id: string, kind: string, params?: Record<string, unknown>) =>
  ({ id, kind, params }) as never;

describe("useWorkflows · ruteo por forma", () => {
  it("reflex (evento + acciones) → guarda REGLA, no toca journeys", async () => {
    const w: Workflow = {
      id: "",
      source: "rule",
      name: "Bienvenida",
      enabled: true,
      trigger: { kind: "event", type: "lead_created", params: {} },
      nodes: [
        step("e", "entry"),
        step("a", "send_whatsapp", { templateName: "t" }),
        step("x", "exit"),
      ],
      edges: [
        { from: "e", to: "a" },
        { from: "a", to: "x" },
      ],
    };
    const { result } = await mountReady();
    await act(async () => {
      await result.current.save(w);
    });
    const post = postCall();
    expect(post?.url).toBe("https://api.test/rules");
    expect(post?.body.trigger.type).toBe("lead_created");
    expect(post?.body.actions[0].type).toBe("send_whatsapp_template");
    expect(saveJourneyMock).not.toHaveBeenCalled();
  });

  it("journey (segmento) → guarda JOURNEY, no toca reglas", async () => {
    const w: Workflow = {
      id: "",
      source: "journey",
      name: "Nurture",
      enabled: true,
      status: "active",
      trigger: { kind: "segment", segmentId: "s1" },
      nodes: [step("e", "entry"), step("s", "send_email", { subject: "hey" }), step("x", "exit")],
      edges: [
        { from: "e", to: "s" },
        { from: "s", to: "x" },
      ],
    };
    const { result } = await mountReady();
    await act(async () => {
      await result.current.save(w);
    });
    expect(saveJourneyMock).toHaveBeenCalledTimes(1);
    const jArg = saveJourneyMock.mock.calls[0][0];
    expect(jArg.entry).toEqual({ segmentId: "s1" });
    expect(jArg.status).toBe("active");
    expect(postCall()).toBeNull(); // no POST de regla
  });

  it("split (evento + espera) → journey MANUAL primero + regla puente después", async () => {
    const w: Workflow = {
      id: "",
      source: "rule",
      name: "Reacción + nurture",
      enabled: true,
      trigger: { kind: "event", type: "lead_created", params: {} },
      nodes: [
        step("e", "entry"),
        step("s", "send_whatsapp", { templateName: "t" }),
        step("w", "wait", { days: 2 }),
        step("x", "exit"),
      ],
      edges: [
        { from: "e", to: "s" },
        { from: "s", to: "w" },
        { from: "w", to: "x" },
      ],
    };
    const { result } = await mountReady();
    await act(async () => {
      await result.current.save(w);
    });
    // Journey creado MANUAL → lo inscribe la regla, NO el auto-enroll (clave anti-doble).
    expect(saveJourneyMock).toHaveBeenCalledTimes(1);
    const jArg = saveJourneyMock.mock.calls[0][0];
    expect(jArg.entry).toEqual({ manual: true });
    expect(jArg.status).toBe("active"); // debe estar activo para que start_journey enrole
    // Regla puente: 1 sola acción start_journey al journey recién creado, marcada.
    const post = postCall();
    expect(post?.body.actions).toHaveLength(1);
    expect(post?.body.actions[0].type).toBe("start_journey");
    expect(post?.body.actions[0].params.journeyId).toBe("j-new");
    expect(post?.body.actions[0].params.__wfSplit).toBe(true);
  });

  it("cambio de forma journey→reflex: borra el journey viejo y crea la regla", async () => {
    const w: Workflow = {
      id: "journey:j1",
      source: "journey",
      name: "Ahora reflejo",
      enabled: true,
      status: "active",
      trigger: { kind: "event", type: "wrapup_saved", params: {} },
      nodes: [step("e", "entry"), step("t", "tag", { op: "add", tag: "x" }), step("x", "exit")],
      edges: [
        { from: "e", to: "t" },
        { from: "t", to: "x" },
      ],
    };
    const { result } = await mountReady();
    await act(async () => {
      await result.current.save(w);
    });
    expect(removeJourneyMock).toHaveBeenCalledWith("j1"); // limpia el journey viejo
    expect(postCall()?.body.actions[0].type).toBe("apply_tag"); // crea la regla
    expect(saveJourneyMock).not.toHaveBeenCalled();
  });
});

describe("useWorkflows · merge de las 2 fuentes", () => {
  it("lista reglas, journeys y re-ensambla los splits (journey consumido no se duplica)", async () => {
    rulesData = [
      // regla reflex normal
      {
        ruleId: "r1",
        name: "Reflejo",
        enabled: true,
        trigger: { type: "lead_created", params: {} },
        conditions: [],
        actions: [{ type: "apply_tag", params: { tag: "a" } }],
      },
      // regla puente de un split
      {
        ruleId: "r2",
        name: "Combo",
        enabled: true,
        trigger: { type: "lead_created", params: {} },
        conditions: [],
        actions: [{ type: "start_journey", params: { journeyId: "jSplit", __wfSplit: true } }],
      },
    ];
    journeysData = [
      {
        journeyId: "jSplit",
        name: "Combo",
        status: "active",
        entry: { manual: true },
        nodes: [],
        edges: [],
      },
      {
        journeyId: "jPlain",
        name: "Nurture",
        status: "active",
        entry: { segmentId: "s" },
        nodes: [],
        edges: [],
      },
    ];
    const { result } = await mountReady();
    const ws = result.current.workflows;
    // 3 workflows: reflex (r1), split (r2+jSplit), journey (jPlain). jSplit NO aparte.
    expect(ws).toHaveLength(3);
    expect(ws.filter((w) => w.source === "split")).toHaveLength(1);
    expect(ws.some((w) => w.id === "journey:jSplit")).toBe(false); // consumido por el split
    expect(ws.some((w) => w.id === "journey:jPlain")).toBe(true);
    expect(ws.some((w) => w.id === "rule:r1")).toBe(true);
  });
});
