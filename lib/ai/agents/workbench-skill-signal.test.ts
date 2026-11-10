import { describe, expect, it } from "vitest";

import { composeWorkbenchSkillSignal, MAX_SKILL_SIGNAL_CHARS } from "./workbench-skill-signal";

describe("composeWorkbenchSkillSignal", () => {
  it("inclui o texto da tarefa", () => {
    const signal = composeWorkbenchSkillSignal({ task: "复盘这个商机为什么停滞" });
    expect(signal).toContain("复盘这个商机为什么停滞");
  });

  it("marca o tipo de objeto conforme o escopo", () => {
    const signal = composeWorkbenchSkillSignal({
      task: "analisar",
      scope: { leadId: "l1", conversationId: "c1" },
    });
    expect(signal).toContain("#objeto:lead");
    expect(signal).toContain("#objeto:conversation");
    expect(signal).not.toContain("#objeto:contact");
    expect(signal).not.toContain("#objeto:pipeline");
  });

  it("inclui a chave do agente quando existe", () => {
    const signal = composeWorkbenchSkillSignal({ task: "x", agentKey: "crm_supervisor" });
    expect(signal).toContain("#agente:crm_supervisor");
  });

  it("é determinístico: mesma entrada, mesma saída", () => {
    const input = { task: "t", agentKey: "sales_operations", scope: { leadId: "l" } };
    expect(composeWorkbenchSkillSignal(input)).toBe(composeWorkbenchSkillSignal(input));
  });

  it("tarefa vazia ainda produz sinal utilizável (só marcadores)", () => {
    const signal = composeWorkbenchSkillSignal({ task: "   ", scope: { leadId: "l1" } });
    expect(signal).toBe("#objeto:lead");
  });

  it("trunca tarefas muito longas para o teto do sinal", () => {
    const signal = composeWorkbenchSkillSignal({ task: "a".repeat(MAX_SKILL_SIGNAL_CHARS + 500) });
    expect(signal.length).toBe(MAX_SKILL_SIGNAL_CHARS);
  });

  it("não usa palavras genéricas que casariam por acidente", () => {
    // sem escopo, o sinal não deve conter 'lead'/'contact' soltos
    const signal = composeWorkbenchSkillSignal({ task: "resumo do cliente" });
    expect(signal).not.toMatch(/\blead\b/);
    expect(signal).not.toMatch(/\bcontact\b/);
  });
});
