import { describe, expect, it } from "vitest";

import {
  COLLABORATION_MODES,
  DEFAULT_COLLABORATION_MODE,
  delegationEnabled,
  delegationSkipReason,
  normalizeCollaborationMode,
  skillsEnabled,
} from "./collaboration-mode";

describe("normalizeCollaborationMode", () => {
  it("aceita os quatro modos conhecidos", () => {
    expect(normalizeCollaborationMode("auto")).toBe("auto");
    expect(normalizeCollaborationMode("skill")).toBe("skill");
    expect(normalizeCollaborationMode("skill_only")).toBe("skill_only");
    expect(normalizeCollaborationMode("disabled")).toBe("disabled");
  });

  it("cai para auto quando o valor é desconhecido ou ausente", () => {
    for (const value of [undefined, null, "", "AUTO", "off", "fold", 0, {}, []]) {
      expect(normalizeCollaborationMode(value)).toBe(DEFAULT_COLLABORATION_MODE);
    }
  });

  it("o padrão é auto (contrato D1)", () => {
    expect(DEFAULT_COLLABORATION_MODE).toBe("auto");
    expect(COLLABORATION_MODES).toEqual(["auto", "skill", "skill_only", "disabled"]);
  });
});

describe("skillsEnabled (família fold: B e C)", () => {
  it("apenas skill e skill_only carregam skills", () => {
    expect(skillsEnabled("skill")).toBe(true);
    expect(skillsEnabled("skill_only")).toBe(true);
    expect(skillsEnabled("auto")).toBe(false);
    expect(skillsEnabled("disabled")).toBe(false);
  });
});

describe("delegationEnabled", () => {
  it("auto e skill permitem delegação; skill_only e disabled não", () => {
    expect(delegationEnabled("auto")).toBe(true);
    // B: permitido em termos de modo — a decisão fina é do parallel policy
    expect(delegationEnabled("skill")).toBe(true);
    // C: fold completo, nunca delega
    expect(delegationEnabled("skill_only")).toBe(false);
    expect(delegationEnabled("disabled")).toBe(false);
  });
});

describe("delegationSkipReason", () => {
  it("distingue skill_only de disabled na telemetria", () => {
    expect(delegationSkipReason("skill_only")).toBe("mode_skill_only");
    expect(delegationSkipReason("disabled")).toBe("mode_disabled");
  });

  it("auto e skill não têm motivo de bloqueio (quem decide é a regra)", () => {
    expect(delegationSkipReason("auto")).toBeNull();
    expect(delegationSkipReason("skill")).toBeNull();
  });
});
