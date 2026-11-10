/**
 * 只读结果冲突检测（S4 项 4）。
 *
 * 原语义：specialist 之间对同一对象给出不同结论 → `evidence_disagreement`。
 * fold 后没有 specialist，冲突只可能来自「同一次运行里，同一实体的同一字段被读出两个
 * 不同的值」——通常是并发写入、缓存或分页边界造成的。
 *
 * 这里只做确定性比对：同一 entityId + field 出现两个以上不同值即判为冲突。
 * 不做语义判断，也不调用模型。
 */

export interface LeadObservation {
  entityId: string;
  field: "stage_id" | "value_cents" | "status";
  value: string;
}

export interface ReadConflict {
  entityId: string;
  field: string;
  values: string[];
}

const OBSERVED_FIELDS = ["stage_id", "value_cents", "status"] as const;

/**
 * 从任意工具返回结构中提取 lead 观测。宽容遍历：只要对象里有 `id`(uuid 形状)
 * 且带被观测字段，就记一条。不依赖具体工具的返回包装（`{lead}` / `{leads:[]}` 都能吃）。
 */
export function extractLeadObservations(result: unknown): LeadObservation[] {
  const out: LeadObservation[] = [];
  const seen = new Set<string>();

  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (!node || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    const id = record["id"];
    if (typeof id === "string" && id.length >= 32) {
      for (const field of OBSERVED_FIELDS) {
        const value = record[field];
        if (value === undefined || value === null) continue;
        const key = `${id}::${field}::${String(value)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ entityId: id, field, value: String(value) });
      }
    }
    for (const value of Object.values(record)) walk(value);
  };

  walk(result);
  return out;
}

/** 累积观测并在出现矛盾时立即报出（增量检测，避免运行结束后再扫一遍全量）。 */
export function createReadConflictTracker(): {
  add(observations: readonly LeadObservation[]): ReadConflict[];
} {
  const byKey = new Map<string, Set<string>>();
  return {
    add(observations: readonly LeadObservation[]): ReadConflict[] {
      const conflicts: ReadConflict[] = [];
      for (const obs of observations) {
        const key = `${obs.entityId}::${obs.field}`;
        let values = byKey.get(key);
        if (!values) {
          values = new Set<string>();
          byKey.set(key, values);
        }
        values.add(obs.value);
        if (values.size > 1) {
          conflicts.push({
            entityId: obs.entityId,
            field: obs.field,
            values: [...values].sort(),
          });
        }
      }
      return conflicts;
    },
  };
}
