/**
 * 幂等地把内置 skill 发布成平台级 skill（organization_id = null，对所有组织生效）。
 *
 * 行为：
 * - 若当前指针指向的版本正文与定义一致 → 跳过（不制造无意义的新版本）
 * - 否则插入新版本并把指针移过去（版本不可变，更新即新增）
 *
 * 运行：node --import tsx --env-file=.env.local scripts/ensure-builtin-skills.ts
 */
import { createHash } from "node:crypto";

import { createPool } from "../lib/agent-engine/db/pool";
import {
  insertSkillVersion,
  loadSkills,
  setSkillPointer,
} from "../lib/agent-engine/agent/skills";
import { BUILTIN_SKILLS } from "../lib/ai/agents/builtin-skills";

const hash = (s: string): string => createHash("sha256").update(s).digest("hex");
/** 版本比较必须覆盖正文 + matcher + 描述，否则改了 matcher 会被误判为"无变化" */
const fingerprint = (s: {
  body: string;
  description: string;
  matcher: unknown;
}): string =>
  hash(
    JSON.stringify({
      body: s.body,
      description: s.description,
      matcher: s.matcher,
    }),
  );

async function main(): Promise<void> {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) throw new Error("SUPABASE_DB_URL ausente");
  const pool = createPool(url);

  try {
    const current = await loadSkills(pool, "00000000-0000-0000-0000-000000000000");
    const byName = new Map(current.map((s) => [s.name, s]));

    let created = 0;
    let unchanged = 0;

    for (const definition of BUILTIN_SKILLS) {
      const existing = byName.get(definition.name);
      if (existing && fingerprint(existing) === fingerprint(definition)) {
        unchanged += 1;
        console.info(`[builtin-skills] ${definition.name}: inalterado (v=${existing.versionId})`);
        continue;
      }

      const row = await insertSkillVersion(pool, {
        tenantId: null,
        name: definition.name,
        description: definition.description,
        body: definition.body,
        matcher: definition.matcher,
        manifest: [],
      });
      await setSkillPointer(pool, {
        tenantId: null,
        name: definition.name,
        versionId: row.id,
      });
      created += 1;
      console.info(
        `[builtin-skills] ${definition.name}: publicado v=${row.id} (linhas=${definition.body.split("\n").length})`,
      );
    }

    console.info(
      `[builtin-skills] 完成：publicados=${created} inalterados=${unchanged} total=${BUILTIN_SKILLS.length}`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `ensure-builtin-skills falhou: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
