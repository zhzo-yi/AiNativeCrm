import { describe, expect, it } from "vitest";

import {
  extractRouterFeatures,
  fallbackClassify,
  planForDomains,
  structuralGate,
} from "./collaboration-router";

const leadScope = { leadId: "l1" };

describe("extractRouterFeatures", () => {
  it("推导 scope 类型", () => {
    expect(extractRouterFeatures({ agentKey: "crm_supervisor", task: "x", scope: leadScope }).scopeKind).toBe("lead");
    expect(extractRouterFeatures({ agentKey: "crm_supervisor", task: "x", scope: { pipelineId: "p" } }).scopeKind).toBe("pipeline");
    expect(extractRouterFeatures({ agentKey: "crm_supervisor", task: "x", scope: {} }).scopeKind).toBe("none");
  });

  it("识别调查与直接编辑线索", () => {
    const research = extractRouterFeatures({ agentKey: "crm_supervisor", task: "复盘这个商机为什么停滞", scope: leadScope });
    expect(research.researchCue).toBe(true);

    const edit = extractRouterFeatures({ agentKey: "sales_operations", task: "把金额改为 4500", scope: leadScope });
    expect(edit.directEditCue).toBe(true);
    expect(edit.researchCue).toBe(false);
  });

  it("「理由」也算调查线索（旧正则只认「原因」）", () => {
    const f = extractRouterFeatures({ agentKey: "crm_supervisor", task: "说明理由", scope: {} });
    expect(f.researchCue).toBe(true);
  });
});

describe("structuralGate", () => {
  it("非白名单 agent 直接拒绝", () => {
    for (const agentKey of ["crm_intelligence", "customer_communications", null]) {
      expect(structuralGate(extractRouterFeatures({ agentKey, task: "复盘原因", scope: leadScope }))).toEqual({
        allow: false,
        reason: "agent_not_eligible",
      });
    }
  });

  it("简单编辑（无调查语义）拒绝", () => {
    const gate = structuralGate(extractRouterFeatures({ agentKey: "sales_operations", task: "安排三天后的跟进", scope: leadScope }));
    expect(gate).toEqual({ allow: false, reason: "simple_edit" });
  });

  it("调查类任务放行（不再要求 lead scope）", () => {
    const gate = structuralGate(extractRouterFeatures({ agentKey: "crm_supervisor", task: "检查各阶段停滞情况", scope: {} }));
    expect(gate).toEqual({ allow: true, reason: "passed" });
  });
});

describe("fallbackClassify + planForDomains", () => {
  it("多域调查 → delegate，且 plan 只含需要的 specialist", () => {
    const features = extractRouterFeatures({
      agentKey: "crm_supervisor",
      task: "复盘商机为什么停滞，核对客户会话与政策依据",
      scope: leadScope,
    });
    expect(structuralGate(features).allow).toBe(true);
    const decision = fallbackClassify(features, "复盘商机为什么停滞，核对客户会话与政策依据");
    expect(decision.action).toBe("delegate");
    const plan = planForDomains(decision.domains);
    expect(plan).not.toBeNull();
    expect(plan!.specialists.length).toBe(decision.domains.length);
    expect(plan!.specialists.length).toBeLessThanOrEqual(3);
  });

  it("单域调查 → direct（主循环足够）", () => {
    const task = "看看这个商机的阶段";
    const features = extractRouterFeatures({ agentKey: "crm_supervisor", task, scope: leadScope });
    expect(fallbackClassify(features, task).action).toBe("direct");
  });

  it("没有 domain 时不产生空 plan", () => {
    expect(planForDomains([])).toBeNull();
  });
});
