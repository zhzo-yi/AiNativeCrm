/**
 * 内置 skill 定义（S4）——把三个只读 specialist 的专长转成可内联执行的 playbook。
 *
 * 来源：lib/ai/agents/collaboration.ts 的 OPPORTUNITY_REVIEW_PLAN 三个 specialist。
 * 迁移原则（CONTRACT D8/D9）：
 * - 正文是「取证顺序 + 输出契约 + 禁止事项」，不是散文说明
 * - 正文 ≤ 200 行（MAX_SKILL_BODY_LINES），超出就拆
 * - matcher 只用有辨识度的词，避免「商机」「客户」这类泛词单独命中
 * - 平台级（organization_id = null）对所有组织生效
 */

import type { SkillMatcher } from "@/lib/agent-engine/agent/skills";

export interface BuiltinSkillDefinition {
  name: string;
  description: string;
  matcher: SkillMatcher;
  body: string;
}

const CUSTOMER_EVIDENCE_BODY = `# 客户事实分析

## 何时用
需要回答"这个客户现在是什么状况""他之前说过什么""有没有明确承诺"时。

## 取证顺序（按此顺序，不要跳步）
1. crm_get_contact —— 先确认对象是谁（姓名、电话、标签、是否被屏蔽）
2. crm_list_conversations —— 找到与该客户的会话
3. crm_get_conversation_history —— 读最近会话，找客户原话
4. 只有在上面的记录不足时，才用 crm_search_knowledge 查组织知识

## 输出契约
- 每条结论后面必须跟来源：联系人或会话的记录标识
- 明确区分三类内容：
  - **数据库事实**：记录里直接写着的内容
  - **推断**：由多条事实推出来的内容，必须标注"推断"
  - **未知**：记录里没有的，直接写"无记录"
- 客户原话要引用，不要改写成自己的话

## 禁止
- 不得修改任何 CRM 记录（本 playbook 只读）
- 不得把推断写成事实
- 不得声称"已经联系过客户"
- 找不到记录时，说"无记录"，不要用常识补全
`;

const OPPORTUNITY_DIAGNOSIS_BODY = `# 商机诊断

## 何时用
需要判断"这个商机卡在哪""风险有多大""下一步该做什么"时。

## 取证顺序
1. crm_get_lead —— 确认阶段、金额、负责人、最后活动时间
2. crm_list_followups —— 看是否已有跟进安排、是否逾期
3. crm_list_leads —— 只有在需要与该商机之外的记录做对比（例如漏斗整体）时才用
4. 需要业务限制（价格政策、审批门槛）时，才用 crm_search_knowledge

## 输出契约
- 先给**事实**：当前阶段、金额、停滞天数（用最后活动时间与实际日期的差，写明算法）
- 再给**诊断**：停滞原因按可能性排序，每条注明依据或标注"推断"
- 最后给**下一步**：具体到一个动作（改哪个字段、约哪一天跟进、找谁确认）

## 禁止
- 不得在诊断阶段直接改阶段或改金额（需要用户明确要求写入）
- 不得把"建议"说成"已经完成"
- 不得编造客户意向（记录里没有的就是没有）
`;

const POLICY_ADVISOR_BODY = `# 业务政策与依据核对

## 何时用
回答里要出现"能不能""允不允许""政策怎么规定""承诺什么"时。

## 取证顺序
1. crm_search_knowledge —— 先查组织知识库里的政策、条款、SOP
2. crm_get_org_memory —— 再查组织记忆中已确认的事实与限制
3. 两者都没有 → 明确回答"没有找到依据"

## 输出契约
- 每条政策结论必须带来源（知识条目或记忆条目）
- 区分三类：
  - **有明确依据**：引用原文
  - **部分依据**：说明缺哪一部分
  - **无依据**：明确说"知识库中没有相关内容"
- 涉及对外承诺（折扣、期限、赔付）时，必须标注"需内部确认后才能对外说明"

## 禁止
- 知识库为空或没有相关内容时，**不得编造条款、比例、期限**
- 不得把"惯例"当政策
- 不得替客户做决定
`;

export const BUILTIN_SKILLS: readonly BuiltinSkillDefinition[] = [
  {
    name: "customer_evidence",
    description: "核对联系人、会话与明确承诺，只报告可引用的事实（客户事实分析员）。",
    matcher: {
      any_keywords: [
        "客户 360", "360 摘要", "客户摘要", "客户画像",
        "他之前说过", "客户原话", "明确承诺", "异议", "最近会话",
      ],
      probe_keywords: ["客户", "会话", "#objeto:contact"],
    },
    body: CUSTOMER_EVIDENCE_BODY,
  },
  {
    name: "opportunity_diagnosis",
    description: "核对商机阶段、停滞时间与跟进记录，给出风险诊断与下一步（商机诊断员）。",
    matcher: {
      any_keywords: [
        "复盘", "为什么停滞", "停滞原因", "停滞情况", "商机诊断", "漏斗",
        "超过 7 天", "未跟进", "各阶段",
      ],
      probe_keywords: ["商机", "停滞", "跟进", "#objeto:lead"],
    },
    body: OPPORTUNITY_DIAGNOSIS_BODY,
  },
  {
    name: "policy_advisor",
    description: "从知识与组织记忆中找下一步动作的依据与限制，无依据时明确说明（业务政策顾问）。",
    matcher: {
      any_keywords: [
        "政策", "依据", "知识库", "条款", "退款", "折扣", "能不能",
        "允不允许", "承诺风险", "核对依据",
      ],
      probe_keywords: ["规定", "规则"],
    },
    body: POLICY_ADVISOR_BODY,
  },
] as const;
