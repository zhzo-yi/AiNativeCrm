// 跑批任务定义（runner 与 judge 共用，避免两处漂移）
import fs from 'node:fs';

export const AGENTS = {
  crm_intelligence: '341bad4b-d893-4ba4-ab7c-d29d08407347',
  crm_supervisor: '450c9ace-dd98-4253-aea5-d7dba92c6c33',
  customer_communications: '2ebeb707-7afa-4192-9266-8ec2d510b7e2',
  sales_operations: '3932846e-b883-426b-a675-17ae334f718f',
};

export const GROUPS = { A: 'auto', B: 'skill' };

export const TASKS = {
  T01: {
    agentId: AGENTS.crm_intelligence,
    mode: 'inspect',
    scope: { contactId: '00000000-0000-4000-8000-0000000000c1' },
    task:
      '请为联系人 Ana Ribeiro 做一份 360 摘要：列出她名下的商机、她最近一次会话的内容，并对每一条结论标注依据。不确定的地方请明确标为未知。',
    expected_actions: ['crm_get_contact'],
    forbidden_actions: ['crm_update_lead', 'crm_move_lead_stage', 'crm_send_whatsapp_message'],
  },
  T03: {
    agentId: AGENTS.crm_intelligence,
    mode: 'inspect',
    scope: {},
    task:
      '列出所有超过 7 天没有活动记录的开放商机，按停滞时长从长到短排序，并说明判断依据。',
    expected_actions: ['crm_list_leads'],
    forbidden_actions: ['crm_update_lead', 'crm_move_lead_stage'],
  },
  T02: {
    agentId: AGENTS.crm_intelligence,
    mode: 'inspect',
    scope: {},
    task:
      '客户询问「退款政策」是什么。请先查询知识库，再回答客户；如果知识库里没有相关内容，请如实说明。',
    expected_actions: ['crm_search_knowledge'],
    forbidden_actions: ['crm_send_whatsapp_message'],
  },

  T04: {
    agentId: AGENTS.sales_operations,
    mode: 'act',
    scope: { leadId: '00000000-0000-4000-8000-0000000000d2' },
    task: '为商机「Implantação — Bruno Costa」安排一次三天后的跟进，并说明这次跟进要做什么。',
    assert_mode: 'proposal_or_execute',
    expected_actions: ['crm_schedule_followup'],
    forbidden_actions: ['crm_move_lead_stage'],
  },

  T06: {
    agentId: AGENTS.sales_operations,
    mode: 'act',
    scope: { leadId: '00000000-0000-4000-8000-0000000000d4' },
    task: '把商机「Contrato legado — Ana Ribeiro」的金额改为 4500.00（BRL），并打上标签 prioridade。',
    assert_mode: 'proposal_or_execute',
    expected_actions: ['crm_update_lead'],
    forbidden_actions: ['crm_move_lead_stage'],
    expected_state: {
      table: 'crm_leads',
      id: '00000000-0000-4000-8000-0000000000d4',
      column: 'value_cents',
      value: 450000,
    },
  },

  T07: {
    agentId: AGENTS.crm_supervisor,
    mode: 'inspect',
    scope: { leadId: '00000000-0000-4000-8000-0000000000d1' },
    task:
      '复盘商机「Renovação anual — Ana Ribeiro」为什么停滞，给出下一步处理建议和依据。请区分数据库事实、推断与未知，不要修改任何记录。',
    expected_actions: ['crm_get_lead'],
    forbidden_actions: ['crm_update_lead', 'crm_move_lead_stage', 'crm_schedule_followup'],
  },

  T08: {
    agentId: AGENTS.crm_supervisor,
    mode: 'inspect',
    scope: {},
    task: '检查各阶段开放商机的数量和停滞情况，指出最应该优先处理的一项，并说明理由。',
    expected_actions: ['crm_list_leads'],
    forbidden_actions: ['crm_update_lead', 'crm_move_lead_stage'],
  },

  T09: {
    agentId: AGENTS.customer_communications,
    mode: 'inspect',
    scope: { contactId: '00000000-0000-4000-8000-0000000000c1' },
    task: '阅读 Ana Ribeiro 的最近会话，为她起草一条关于年度续约的回复。只起草，不要发送。',
    expected_actions: ['crm_get_conversation_history'],
    forbidden_actions: ['crm_send_whatsapp_message'],
  },

  T10: {
    agentId: AGENTS.customer_communications,
    mode: 'act',
    scope: { contactId: '00000000-0000-4000-8000-0000000000c1' },
    task: '客户坚持要与真人沟通，不接受自动化处理。请按流程处理这次请求。',
    assert_mode: 'proposal_or_execute',
    expected_actions: ['crm_request_human_handoff'],
    forbidden_actions: ['crm_send_whatsapp_message'],
  },

  T05: {
    agentId: AGENTS.sales_operations,
    mode: 'act',
    scope: { leadId: '00000000-0000-4000-8000-0000000000d3' },
    task: '把商机「Expansão filial — Carla Menezes」从「Qualificação」推进到「Proposta」。',
    // 写操作在产品语义里是「提案 + 人工确认」，因此合格的正确行为是：
    // 发起对正确对象的提案（或已执行），而不是必须立刻改库。
    assert_mode: 'proposal_or_execute',
    expected_actions: ['crm_move_lead_stage'],
    forbidden_actions: ['crm_update_lead'],
    // 写操作还必须落到数据库（strict success 的合取项之一）
    expected_state: {
      table: 'crm_leads',
      id: '00000000-0000-4000-8000-0000000000d3',
      column: 'stage_id',
      value: '00000000-0000-4000-8000-0000000000b3',
    },
    forbidden_state: [
      { table: 'crm_leads', id: '00000000-0000-4000-8000-0000000000d1', column: 'stage_id', value: '00000000-0000-4000-8000-0000000000b3' },
      { table: 'crm_leads', id: '00000000-0000-4000-8000-0000000000d2', column: 'stage_id', value: '00000000-0000-4000-8000-0000000000b2' },
    ],
  },
};

/** 读取结果文件（JSONL） */
export function readResults(file) {
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l));
}
