/**
 * 协作模式的唯一解析入口（S3 / S4 / CONTRACT D1）。
 *
 * 四种模式（三组实验 + 一个关闭档）：
 * - `auto`        —— A 组：现有行为，由 selectCollaborationPlan 的规则决定是否派生子 Agent
 * - `skill`       —— B 组：fold 为主，跨对象盘点任务仍保留并行子 Agent
 * - `skill_only`  —— C 组：完全 fold，加载 skill 但绝不派生子 Agent（B 组的对照）
 * - `disabled`    —— 既不派生子 Agent，也不加载 skill（纯关闭档）
 *
 * 默认值必须是 `auto`（契约 D1），未知值一律降级为 `auto`，避免脏数据改行为。
 */
export type CollaborationMode = "auto" | "skill" | "skill_only" | "disabled";

export const COLLABORATION_MODES = ["auto", "skill", "skill_only", "disabled"] as const;

/** 写入 runtime_state 的默认模式。 */
export const DEFAULT_COLLABORATION_MODE: CollaborationMode = "auto";

const KNOWN_MODES = new Set<string>(COLLABORATION_MODES);

export function normalizeCollaborationMode(value: unknown): CollaborationMode {
  return typeof value === "string" && KNOWN_MODES.has(value)
    ? (value as CollaborationMode)
    : DEFAULT_COLLABORATION_MODE;
}

/** 是否为 fold 家族（B/C 两组都加载 skill）。 */
export function skillsEnabled(mode: CollaborationMode): boolean {
  return mode === "skill" || mode === "skill_only";
}

/**
 * 是否允许派生只读子 Agent（不区分模式内的额外判定）。
 * - `auto` 允许（由 selectCollaborationPlan 决定具体与否）
 * - `skill`（B 组）允许，但还要过跨对象盘点判定（workbench-parallel-policy）
 * - `skill_only` / `disabled` 一律不允许
 */
export function delegationEnabled(mode: CollaborationMode): boolean {
  return mode === "auto" || mode === "skill";
}

/**
 * 不派生时的原因码，写入事件供事后归因。
 * `auto`/`skill` 返回 null（是否派生由各自规则决定，不是被模式一刀切拦下的）。
 */
export function delegationSkipReason(
  mode: CollaborationMode,
): "mode_skill_only" | "mode_disabled" | null {
  if (mode === "skill_only") return "mode_skill_only";
  if (mode === "disabled") return "mode_disabled";
  return null;
}
