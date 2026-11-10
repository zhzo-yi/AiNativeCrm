/**
 * 工作台任务的 skill 触发信号（S4）。
 *
 * 背景：`latestInboundSignal`（lib/agent-engine/agent/skills.ts）只取最后一条 inbound
 * 消息，那是 WhatsApp 入站场景的触发器。工作台任务没有 inbound 消息，所以
 * 沿用它会得到空信号 → `matchSkills` 直接返回空 → skill 永远不会命中。
 *
 * 这里给出工作台自己的信号来源：任务文本 + 对象类型 + 内置 agent 标识。
 * 不引入模型调用，保持确定性（同一任务文本永远产出同一信号）。
 */

export interface WorkbenchSkillScope {
  contactId?: string | null;
  leadId?: string | null;
  conversationId?: string | null;
  pipelineId?: string | null;
}

export interface WorkbenchSkillSignalInput {
  task: string;
  agentKey?: string | null;
  scope?: WorkbenchSkillScope;
}

/** 信号上限：防止超长任务把匹配成本放大（匹配是 O(skills × 关键词) 的字符串包含）。 */
export const MAX_SKILL_SIGNAL_CHARS = 4000;

/**
 * 对象类型标记刻意使用 `#objeto:` 前缀：正常中文任务文本不会出现这种串，
 * 因此不会让"lead"这类泛词在业务描述里误命中。
 */
export function composeWorkbenchSkillSignal(input: WorkbenchSkillSignalInput): string {
  const parts: string[] = [];
  const task = (input.task ?? '').trim();
  if (task !== '') parts.push(task);

  if (input.agentKey) parts.push(`#agente:${input.agentKey}`);

  const objects: string[] = [];
  const scope = input.scope ?? {};
  if (scope.leadId) objects.push('#objeto:lead');
  if (scope.contactId) objects.push('#objeto:contact');
  if (scope.conversationId) objects.push('#objeto:conversation');
  if (scope.pipelineId) objects.push('#objeto:pipeline');
  if (objects.length > 0) parts.push(objects.join(' '));

  return parts.join('\n').slice(0, MAX_SKILL_SIGNAL_CHARS);
}
