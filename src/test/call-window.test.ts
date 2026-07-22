import { describe, it, expect } from "vitest";
import {
  isSlotActive,
  isWithinWindow,
  nextWindowChange,
  weeklyActiveHours,
  describeWindow,
  formatDays,
  parseDays,
  zonedInputsToUtcIso,
  utcIsoToZonedInputs,
  type CallWindow,
} from "../lib/callWindow";
import {
  isWithinWindow as isWithinWindowBackend,
  isSlotActive as isSlotActiveBackend,
  validateScheduledAt,
  isScheduleDue,
  isScheduleExpired,
} from "../../amplify/functions/_shared/callWindow";

/**
 * Red de seguridad de la ventana de atención de campañas. Lógica pura → sin AWS.
 *
 * Cubre lo que ya rompió antes en producción (el bug de medianoche) y lo que la
 * programación con fecha/hora agrega: ventanas nocturnas, conversión de huso y
 * el contrato del par front/back, que TIENE que dar el mismo veredicto.
 */

const LIMA = "America/Lima"; // UTC-5 todo el año, sin horario de verano
const MADRID = "Europe/Madrid"; // con DST, para probar el offset variable

// Lunes 2026-08-03, 14:00 en Lima = 19:00 UTC.
const LUNES_14H_LIMA = new Date("2026-08-03T19:00:00.000Z");
// Lunes 2026-08-03, 00:30 en Lima = 05:30 UTC.
const LUNES_0030_LIMA = new Date("2026-08-03T05:30:00.000Z");
// Domingo 2026-08-02, 14:00 en Lima.
const DOMINGO_14H_LIMA = new Date("2026-08-02T19:00:00.000Z");

const OFICINA: CallWindow = {
  timezone: LIMA,
  windowStartHour: 9,
  windowEndHour: 18,
  windowDaysOfWeek: [1, 2, 3, 4, 5],
};

describe("parseDays", () => {
  it("acepta array, JSON string y cae al default L-V", () => {
    expect(parseDays([1, 3, 5])).toEqual([1, 3, 5]);
    expect(parseDays("[0,6]")).toEqual([0, 6]);
    expect(parseDays(null)).toEqual([1, 2, 3, 4, 5]);
    expect(parseDays("no es json")).toEqual([1, 2, 3, 4, 5]);
  });

  it("descarta índices de día fuera de rango", () => {
    expect(parseDays([1, 9, -2, 5])).toEqual([1, 5]);
  });
});

describe("ventana diurna normal", () => {
  it("abre dentro del horario en día hábil", () => {
    expect(isWithinWindow(OFICINA, LUNES_14H_LIMA)).toBe(true);
  });

  it("cierra fuera del horario", () => {
    expect(isWithinWindow(OFICINA, LUNES_0030_LIMA)).toBe(false);
  });

  it("cierra en día no marcado aunque la hora entre", () => {
    expect(isWithinWindow(OFICINA, DOMINGO_14H_LIMA)).toBe(false);
  });

  it("la hora de fin es exclusiva", () => {
    expect(isSlotActive(OFICINA, 1, 17)).toBe(true);
    expect(isSlotActive(OFICINA, 1, 18)).toBe(false);
  });

  it("cuenta 45 horas por semana en 9-18 de lunes a viernes", () => {
    expect(weeklyActiveHours(OFICINA)).toBe(45);
  });
});

describe("bug de medianoche (regresión)", () => {
  // `hour12:false` en en-US resuelve a hourCycle h24 y formatea las 00:xx como
  // "24", así que `24 >= 0 && 24 < 24` daba false y TODA campaña con ventana
  // 24h quedaba muerta entre 00:00 y 00:59.
  const VEINTICUATRO_HORAS: CallWindow = {
    timezone: LIMA,
    windowStartHour: 0,
    windowEndHour: 24,
    windowDaysOfWeek: [0, 1, 2, 3, 4, 5, 6],
  };

  it("una ventana 0-24 marca también a las 00:30", () => {
    expect(isWithinWindow(VEINTICUATRO_HORAS, LUNES_0030_LIMA)).toBe(true);
  });

  it("la hora 0 cae dentro de una ventana que arranca a las 0", () => {
    expect(isSlotActive(VEINTICUATRO_HORAS, 1, 0)).toBe(true);
  });

  it("el backend coincide con el front en el mismo caso", () => {
    expect(isWithinWindowBackend(VEINTICUATRO_HORAS, LUNES_0030_LIMA)).toBe(true);
  });
});

describe("ventana nocturna (cruza medianoche)", () => {
  // 22:00 → 06:00, activa lunes y martes. El tramo 00:00-06:00 del martes
  // pertenece a la sesión que abrió el lunes.
  const NOCHE: CallWindow = {
    timezone: LIMA,
    windowStartHour: 22,
    windowEndHour: 6,
    windowDaysOfWeek: [1, 2],
  };

  it("abre en el tramo previo a medianoche del día marcado", () => {
    expect(isSlotActive(NOCHE, 1, 23)).toBe(true);
  });

  it("abre en la madrugada del día siguiente al día marcado", () => {
    expect(isSlotActive(NOCHE, 2, 3)).toBe(true); // martes 03:00 ← sesión del lunes
    expect(isSlotActive(NOCHE, 3, 3)).toBe(true); // miércoles 03:00 ← sesión del martes
  });

  it("cierra en la madrugada de un día cuya víspera no está marcada", () => {
    expect(isSlotActive(NOCHE, 1, 3)).toBe(false); // lunes 03:00 ← el domingo no abre
  });

  it("cierra en el hueco diurno", () => {
    expect(isSlotActive(NOCHE, 1, 12)).toBe(false);
  });

  it("front y back dan el mismo veredicto en toda la semana", () => {
    for (let d = 0; d < 7; d++) {
      for (let h = 0; h < 24; h++) {
        expect(isSlotActiveBackend(NOCHE, d, h)).toBe(isSlotActive(NOCHE, d, h));
      }
    }
  });
});

describe("ventana de 24 horas por start === end", () => {
  const TODO_EL_DIA: CallWindow = {
    timezone: LIMA,
    windowStartHour: 9,
    windowEndHour: 9,
    windowDaysOfWeek: [1],
  };

  it("cubre las 24 horas del día marcado", () => {
    for (let h = 0; h < 24; h++) expect(isSlotActive(TODO_EL_DIA, 1, h)).toBe(true);
  });

  it("no toca los días no marcados", () => {
    expect(isSlotActive(TODO_EL_DIA, 2, 12)).toBe(false);
  });
});

describe("ventana sin días", () => {
  const VACIA: CallWindow = { ...OFICINA, windowDaysOfWeek: [] };

  it("nunca abre", () => {
    expect(isWithinWindow(VACIA, LUNES_14H_LIMA)).toBe(false);
    expect(weeklyActiveHours(VACIA)).toBe(0);
  });

  it("no reporta próximo cambio (nunca va a abrir)", () => {
    expect(nextWindowChange(VACIA, LUNES_14H_LIMA)).toBeNull();
  });
});

describe("nextWindowChange", () => {
  it("dentro de la ventana anuncia el cierre a la hora de fin", () => {
    const change = nextWindowChange(OFICINA, LUNES_14H_LIMA);
    expect(change?.opens).toBe(false);
    // 18:00 Lima = 23:00 UTC del mismo día.
    expect(change?.at.toISOString()).toBe("2026-08-03T23:00:00.000Z");
  });

  it("fuera de la ventana anuncia la apertura", () => {
    const change = nextWindowChange(OFICINA, LUNES_0030_LIMA);
    expect(change?.opens).toBe(true);
    // 09:00 Lima del lunes = 14:00 UTC.
    expect(change?.at.toISOString()).toBe("2026-08-03T14:00:00.000Z");
  });

  it("un viernes por la tarde salta al lunes", () => {
    // Viernes 2026-08-07 19:00 Lima = sábado 00:00 UTC.
    const viernesTarde = new Date("2026-08-08T00:00:00.000Z");
    const change = nextWindowChange(OFICINA, viernesTarde);
    expect(change?.opens).toBe(true);
    expect(change?.at.toISOString()).toBe("2026-08-10T14:00:00.000Z"); // lunes 09:00 Lima
  });
});

describe("formato para humanos", () => {
  it("agrupa días consecutivos", () => {
    expect(formatDays([1, 2, 3, 4, 5])).toBe("Lun a Vie");
    expect(formatDays([1, 3, 5])).toBe("Lun, Mié, Vie");
    expect(formatDays([0, 1, 2, 3, 4, 5, 6])).toBe("Todos los días");
    expect(formatDays([])).toBe("Ningún día");
  });

  it("describe la ventana en una línea", () => {
    expect(describeWindow(OFICINA)).toBe("Lun a Vie · 09:00–18:00");
    expect(describeWindow({ ...OFICINA, windowStartHour: 22, windowEndHour: 6 })).toBe(
      "Lun a Vie · 22:00–06:00 (+1 día)",
    );
    expect(describeWindow({ ...OFICINA, windowStartHour: 9, windowEndHour: 9 })).toBe(
      "Lun a Vie · 24 horas",
    );
  });
});

describe("conversión de huso para los selectores", () => {
  it("interpreta la hora en el huso de la campaña, no en el del navegador", () => {
    // Las 09:00 en Lima (UTC-5) son las 14:00 UTC.
    expect(zonedInputsToUtcIso("2026-08-03", "09:00", LIMA)).toBe("2026-08-03T14:00:00.000Z");
  });

  it("aplica el horario de verano cuando corresponde", () => {
    // Madrid en agosto es UTC+2 (CEST); en enero es UTC+1 (CET).
    expect(zonedInputsToUtcIso("2026-08-03", "09:00", MADRID)).toBe("2026-08-03T07:00:00.000Z");
    expect(zonedInputsToUtcIso("2026-01-15", "09:00", MADRID)).toBe("2026-01-15T08:00:00.000Z");
  });

  it("va y vuelve sin perder el valor", () => {
    const iso = zonedInputsToUtcIso("2026-12-24", "18:30", LIMA);
    expect(utcIsoToZonedInputs(iso, LIMA)).toEqual({ date: "2026-12-24", time: "18:30" });
  });

  it("devuelve null ante entradas incompletas o basura", () => {
    expect(zonedInputsToUtcIso("", "09:00", LIMA)).toBeNull();
    expect(zonedInputsToUtcIso("2026-08-03", "", LIMA)).toBeNull();
    expect(zonedInputsToUtcIso("no-es-fecha", "09:00", LIMA)).toBeNull();
    expect(utcIsoToZonedInputs(null, LIMA)).toBeNull();
    expect(utcIsoToZonedInputs("basura", LIMA)).toBeNull();
  });
});

describe("validación de la fecha programada (backend)", () => {
  const AHORA = new Date("2026-08-03T12:00:00.000Z");

  it("acepta una fecha futura y la normaliza a UTC", () => {
    const r = validateScheduledAt("2026-08-04T09:00:00-05:00", { now: AHORA });
    expect(r.ok).toBe(true);
    expect(r.iso).toBe("2026-08-04T14:00:00.000Z");
  });

  it("rechaza el pasado", () => {
    const r = validateScheduledAt("2026-08-01T09:00:00-05:00", { now: AHORA });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/pasado/);
  });

  it("tolera un desfase de segundos entre el reloj del cliente y el del servidor", () => {
    const casiAhora = new Date(AHORA.getTime() - 30_000).toISOString();
    expect(validateScheduledAt(casiAhora, { now: AHORA }).ok).toBe(true);
  });

  it("rechaza fechas absurdamente lejanas", () => {
    const r = validateScheduledAt("2999-01-01T00:00:00Z", { now: AHORA });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/365/);
  });

  it("rechaza basura y tipos que no son string", () => {
    expect(validateScheduledAt("mañana", { now: AHORA }).ok).toBe(false);
    expect(validateScheduledAt(12345, { now: AHORA }).ok).toBe(false);
    expect(validateScheduledAt(null, { now: AHORA }).ok).toBe(false);
    expect(validateScheduledAt("", { now: AHORA }).ok).toBe(false);
  });
});

describe("vencimiento de la programación (backend)", () => {
  const AHORA = new Date("2026-08-03T12:00:00.000Z");

  it("detecta que ya llegó el momento de arrancar", () => {
    expect(isScheduleDue("2026-08-03T11:59:00.000Z", AHORA)).toBe(true);
    expect(isScheduleDue("2026-08-03T12:01:00.000Z", AHORA)).toBe(false);
  });

  it("un valor vacío o corrupto nunca dispara el arranque", () => {
    expect(isScheduleDue(undefined, AHORA)).toBe(false);
    expect(isScheduleDue("", AHORA)).toBe(false);
    expect(isScheduleDue("basura", AHORA)).toBe(false);
  });

  it("detecta el fin de vigencia sin romperse con valores vacíos", () => {
    expect(isScheduleExpired("2026-08-03T11:00:00.000Z", AHORA)).toBe(true);
    expect(isScheduleExpired("2026-08-04T00:00:00.000Z", AHORA)).toBe(false);
    expect(isScheduleExpired(undefined, AHORA)).toBe(false);
    expect(isScheduleExpired("basura", AHORA)).toBe(false);
  });
});
