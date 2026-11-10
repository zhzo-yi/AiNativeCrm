import { describe, expect, it } from "vitest";

import { shouldKeepParallelSpecialists } from "./workbench-parallel-policy";

describe("shouldKeepParallelSpecialists（B 组：小任务主循环 / 大任务并行）", () => {
  it("跨对象盘点 + 合格 agent → 并行", () => {
    const d = shouldKeepParallelSpecialists({
      agentKey: "crm_supervisor",
      task: "检查各阶段开放商机的数量，给出优先处理项",
      hasLeadScope: false,
    });
    expect(d).toEqual({ keep: true, reason: "cross_object_survey" });
  });

  it("单对象的深度复盘也要并行（调查强度优先于 scope）", () => {
    // T07：有 lead scope，但要跨客户/商机/政策三类证据
    const d = shouldKeepParallelSpecialists({
      agentKey: "crm_supervisor",
      task: "复盘商机为什么停滞，给出下一步建议和依据",
      hasLeadScope: true,
    });
    expect(d).toEqual({ keep: true, reason: "cross_object_survey" });
  });

  it("简单写操作不并行", () => {
    for (const task of [
      "把商机推进到 Proposta",
      "为商机安排三天后的跟进",
      "把金额改为 4500.00 并打标签",
    ]) {
      const d = shouldKeepParallelSpecialists({ agentKey: "sales_operations", task, hasLeadScope: true });
      expect(d.keep).toBe(false);
    }
  });

  it("非名单内 agent 永不并行", () => {
    for (const agentKey of ["crm_intelligence", "customer_communications", null, undefined]) {
      const d = shouldKeepParallelSpecialists({ agentKey, task: "复盘原因依据", hasLeadScope: false });
      expect(d).toEqual({ keep: false, reason: "agent_not_eligible" });
    }
  });

  it("判定是确定性的", () => {
    const input = { agentKey: "crm_supervisor", task: "跨漏斗汇总", hasLeadScope: false };
    expect(shouldKeepParallelSpecialists(input)).toEqual(shouldKeepParallelSpecialists(input));
  });
});
