import { describe, expect, it } from "vitest";

import { createReadCallGuard, DUPLICATE_READ_MESSAGE, stableArgsKey } from "./read-call-guard";

describe("stableArgsKey", () => {
  it("ordem das chaves não importa", () => {
    expect(stableArgsKey({ a: 1, b: 2 })).toBe(stableArgsKey({ b: 2, a: 1 }));
  });

  it("undefined é descartado", () => {
    expect(stableArgsKey({ a: 1, b: undefined })).toBe(stableArgsKey({ a: 1 }));
  });

  it("arrays preservam ordem (filtros diferentes são chamadas diferentes)", () => {
    expect(stableArgsKey({ tags: ["x", "y"] })).not.toBe(stableArgsKey({ tags: ["y", "x"] }));
  });
});

describe("createReadCallGuard", () => {
  it("primeira chamada não é duplicata; a segunda idêntica é", () => {
    const guard = createReadCallGuard();
    expect(guard.isDuplicate("crm_get_lead", { lead_id: "l1" })).toBe(false);
    expect(guard.isDuplicate("crm_get_lead", { lead_id: "l1" })).toBe(true);
  });

  it("mesma ferramenta com argumentos diferentes NÃO é duplicata", () => {
    // T03/T08 dependem disto: crm_list_leads com filtros diferentes é legítimo
    const guard = createReadCallGuard();
    expect(guard.isDuplicate("crm_list_leads", { stage_id: "s1" })).toBe(false);
    expect(guard.isDuplicate("crm_list_leads", { stage_id: "s2" })).toBe(false);
  });

  it("ferramentas diferentes com os mesmos argumentos não colidem", () => {
    const guard = createReadCallGuard();
    expect(guard.isDuplicate("crm_get_lead", { id: "x" })).toBe(false);
    expect(guard.isDuplicate("crm_get_contact", { id: "x" })).toBe(false);
  });

  it("conta as chamadas registradas", () => {
    const guard = createReadCallGuard();
    guard.isDuplicate("a", {});
    guard.isDuplicate("a", {});
    guard.isDuplicate("b", {});
    expect(guard.size()).toBe(2);
  });

  it("a mensagem de bloqueio orienta a reutilizar, não a tentar de novo", () => {
    expect(DUPLICATE_READ_MESSAGE).toMatch(/Reuse the earlier result/);
  });
});
