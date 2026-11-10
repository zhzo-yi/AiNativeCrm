/**
 * 只读工具重复调用护栏（S4 项 5 / CONTRACT D8）。
 *
 * 原 supervisor prompt 的纪律是「每类只读工具在结果充分时最多调用一次」。这条不能做成
 * 硬上限：T03/T08 这类任务会按不同过滤条件多次 crm_list_leads，硬上限会直接废掉合法解法。
 *
 * 真正要拦的反模式是「同一个工具、同一组参数再读一遍凑证据」。所以这里判定的是
 * **完全重复**（工具名 + 规范化后的参数一致），而不是次数上限。
 */

/** 稳定序列化：键排序 + 丢弃 undefined，保证 {a:1,b:2} 与 {b:2,a:1} 等价。 */
export function stableArgsKey(args: unknown): string {
  const norm = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(norm);
    if (value && typeof value === "object") {
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      const out: Record<string, unknown> = {};
      for (const [k, v] of entries) out[k] = norm(v);
      return out;
    }
    return value;
  };
  return JSON.stringify(norm(args));
}

export interface ReadCallGuard {
  /** 该次调用是否是本次运行内的完全重复。首次调用返回 false 并登记。 */
  isDuplicate(tool: string, args: unknown): boolean;
  /** 已登记的调用总数（观测用）。 */
  size(): number;
}

export function createReadCallGuard(): ReadCallGuard {
  const seen = new Set<string>();
  return {
    isDuplicate(tool: string, args: unknown): boolean {
      const key = `${tool}::${stableArgsKey(args)}`;
      if (seen.has(key)) return true;
      seen.add(key);
      return false;
    },
    size: () => seen.size,
  };
}

/** 重复调用时回给模型的提示：明确要求复用已有结果，不鼓励重试。 */
export const DUPLICATE_READ_MESSAGE =
  "Duplicate read: this exact tool call already ran in this run. Reuse the earlier result instead of reading again.";
