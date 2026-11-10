import { describe, expect, it } from "vitest";

import { createReadConflictTracker, extractLeadObservations } from "./read-conflict";

const LEAD_A = "11111111-1111-4111-8111-111111111111";
const LEAD_B = "22222222-2222-4222-8222-222222222222";

describe("extractLeadObservations", () => {
  it("extrai de {lead: {...}}", () => {
    const obs = extractLeadObservations({
      lead: { id: LEAD_A, stage_id: "s1", value_cents: 100, title: "x" },
    });
    expect(obs).toEqual([
      { entityId: LEAD_A, field: "stage_id", value: "s1" },
      { entityId: LEAD_A, field: "value_cents", value: "100" },
    ]);
  });

  it("extrai de {leads: [...]} (lista paginada)", () => {
    const obs = extractLeadObservations({
      leads: [
        { id: LEAD_A, stage_id: "s1" },
        { id: LEAD_B, stage_id: "s2" },
      ],
    });
    expect(obs.map((o) => o.entityId)).toEqual([LEAD_A, LEAD_B]);
  });

  it("ignora campos não observados e objetos sem id", () => {
    const obs = extractLeadObservations({ lead: { id: LEAD_A, title: "só título" } });
    expect(obs).toEqual([]);
  });

  it("não duplica a mesma observação repetida na estrutura", () => {
    const obs = extractLeadObservations([
      { id: LEAD_A, status: "open" },
      { id: LEAD_A, status: "open" },
    ]);
    expect(obs).toHaveLength(1);
  });
});

describe("createReadConflictTracker", () => {
  it("mesmo valor repetido não é conflito", () => {
    const t = createReadConflictTracker();
    expect(t.add([{ entityId: LEAD_A, field: "stage_id", value: "s1" }])).toEqual([]);
    expect(t.add([{ entityId: LEAD_A, field: "stage_id", value: "s1" }])).toEqual([]);
  });

  it("valores diferentes para o mesmo campo/entidade são conflito", () => {
    const t = createReadConflictTracker();
    t.add([{ entityId: LEAD_A, field: "stage_id", value: "s1" }]);
    const conflicts = t.add([{ entityId: LEAD_A, field: "stage_id", value: "s2" }]);
    expect(conflicts).toEqual([
      { entityId: LEAD_A, field: "stage_id", values: ["s1", "s2"] },
    ]);
  });

  it("entidades diferentes não se misturam", () => {
    const t = createReadConflictTracker();
    t.add([{ entityId: LEAD_A, field: "stage_id", value: "s1" }]);
    expect(t.add([{ entityId: LEAD_B, field: "stage_id", value: "s2" }])).toEqual([]);
  });

  it("campos diferentes não se misturam", () => {
    const t = createReadConflictTracker();
    t.add([{ entityId: LEAD_A, field: "stage_id", value: "s1" }]);
    expect(t.add([{ entityId: LEAD_A, field: "value_cents", value: "s1" }])).toEqual([]);
  });
});
