/**
 * B 组（fold 模式）下「保留并行子 Agent」的判定（CONTRACT D2：fold 可以不彻底）。
 *
 * 原则：只有**跨对象盘点**这类任务才有并行收益；单对象调查已经由 skill 内联完成，
 * 再派生子 Agent 只会付双份上下文和延迟。
 *
 * 与 A 组的区别：A 组的触发条件是 `selectCollaborationPlan`（原有中文正则 + 内置 agent
 * 白名单），A 组逻辑一行都不改；这里是 B 组独立的一套判定，两者互不影响。
 */

export type ParallelDecisionReason =
  | "cross_object_survey" // 保留并行
  | "single_object_task" // 单对象：fold 到 skill
  | "agent_not_eligible" // 该 agent 不在可并行名单
  | "not_a_survey_task"; // 没有跨对象盘点的语义

export interface ParallelPolicyInput {
  agentKey?: string | null;
  task: string;
  hasLeadScope: boolean;
}

export interface ParallelPolicyDecision {
  keep: boolean;
  reason: ParallelDecisionReason;
}

/** 只有这两个内置 agent 的职责里存在「跨对象 / 多来源调查」。 */
const ELIGIBLE_AGENTS = new Set(["crm_supervisor", "sales_operations"]);

/**
 * 需要并行子 Agent 的语义线索。
 *
 * 设计依据（用户设定）：B 组的常态是主循环处理小任务；只有「大型查资料 / 长上下文解析」
 * 这一类才派生子 Agent。因此判定看的是**调查强度**，不是有没有 lead scope——
 * 单对象的深度复盘（如 T07）同样需要跨客户/商机/政策三类证据。
 */
const RESEARCH_KEYWORDS = [
  "复盘",
  "原因",
  "依据",
  "诊断",
  "调查",
  "核对",
  "风险",
  "为什么",
  "为何",
  "评估",
  "分析",
  "漏斗",
  "各阶段",
  "全部商机",
  "所有商机",
  "批量",
  "盘点",
  "汇总",
  "跨",
];

export function shouldKeepParallelSpecialists(input: ParallelPolicyInput): ParallelPolicyDecision {
  if (!input.agentKey || !ELIGIBLE_AGENTS.has(input.agentKey)) {
    return { keep: false, reason: "agent_not_eligible" };
  }
  const text = input.task.toLowerCase();
  const isResearch = RESEARCH_KEYWORDS.some((k) => text.includes(k.toLowerCase()));
  return isResearch
    ? { keep: true, reason: "cross_object_survey" }
    : { keep: false, reason: "not_a_survey_task" };
}
