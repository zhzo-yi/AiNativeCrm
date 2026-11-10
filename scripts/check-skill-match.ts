/**
 * 临时校验工具：用真实任务集验证 skill matcher 的命中情况。
 * 运行：node --import tsx --env-file=.env.local scripts/check-skill-match.ts
 */
import { readFileSync } from "node:fs";
import { parse } from "yaml";

import { createPool } from "../lib/agent-engine/db/pool";
import { loadSkills, matchSkills } from "../lib/agent-engine/agent/skills";
import { composeWorkbenchSkillSignal } from "../lib/ai/agents/workbench-skill-signal";

interface TaskDef {
  id: string;
  agent: string;
  instruction: string;
  scope?: { contact_id?: string; lead_id?: string; conversation_id?: string };
}

async function main(): Promise<void> {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) throw new Error("SUPABASE_DB_URL ausente");
  const pool = createPool(url);
  try {
    const tasksFile = parse(
      readFileSync("D:/workBoddy-pro/tasks/tasks.yaml", "utf8"),
    ) as { tasks: TaskDef[] };
    const skills = await loadSkills(pool, "00000000-0000-4000-8000-000000000001");
    console.info(`[skills] carregadas=${skills.length}: ${skills.map((s) => s.name).join(", ")}\n`);

    let hits = 0;
    for (const task of tasksFile.tasks) {
      const signal = composeWorkbenchSkillSignal({
        task: task.instruction,
        agentKey: task.agent,
        scope: {
          contactId: task.scope?.contact_id ?? null,
          leadId: task.scope?.lead_id ?? null,
          conversationId: task.scope?.conversation_id ?? null,
        },
      });
      const match = matchSkills(skills, signal);
      const matched = match.matched.map((s) => s.name);
      const probes = match.missCandidates.map((m) => m.skill);
      if (matched.length > 0) hits += 1;
      console.info(
        `${task.id} [${task.agent}] -> matched=[${matched.join(", ") || "-"}] probe=[${probes.join(", ") || "-"}]`,
      );
    }
    console.info(`\n[resumo] tarefas=${tasksFile.tasks.length} com_match=${hits}`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`falhou: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
