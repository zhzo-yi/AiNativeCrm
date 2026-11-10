// S5 跑批执行器（按轮次）。
// 用法：TRIAL_INDEX=1 node run-batch.mjs
//   轮次 = 同一批任务/组的第 k 次重复（trials 的语义）
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { GROUPS, TASKS } from './task-specs.mjs';
import { connect } from './lib.mjs';

const execFileP = promisify(execFile);
const REPO = 'D:/workBoddy-pro/AiNativeCrm-main';
const BENCH = 'D:/workBoddy-pro/bench';
const require = createRequire(import.meta.url);
const { chromium } = require(`${REPO}/node_modules/@playwright/test`);

const ROUND = Number(process.env.TRIAL_INDEX ?? 1);
const TASK_IDS = (process.env.TASK_IDS ?? 'T01,T05').split(',');
const MAX_RUN_MS = Number(process.env.MAX_RUN_MS ?? 20 * 60 * 1000);

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(BENCH, 'results');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `round${ROUND}-${stamp}.jsonl`);

let worker = null;
async function startWorker() {
  worker = spawn(
    process.execPath,
    ['--import', 'tsx', '--env-file=.env', '--env-file=.env.local', 'workers/agent-worker/main.ts'],
    { cwd: REPO, stdio: ['ignore', 'ignore', 'ignore'] },
  );
  await new Promise((r) => setTimeout(r, 12000));
}
async function stopWorker() {
  if (!worker) return;
  worker.kill();
  worker = null;
  await new Promise((r) => setTimeout(r, 3000));
}
async function resetDb() {
  await execFileP(process.execPath, ['reset.mjs'], { cwd: BENCH, timeout: 300000 });
}

/** 运行结束后立刻取工具轨迹 + 数据库终态（下一次重置会抹掉） */
async function collectEvidence(runId, spec) {
  // 每次采集都新建短连接：批处理要等 10-20 分钟，长连接会被服务端断开
  const db = await connect();
  try {
  const tools = await db.query(
    `select payload->>'tool' as tool from ai_agent_run_events
      where run_id=$1 and event_type='tool_started' order by sequence`,
    [runId],
  );
  const names = tools.rows.map((r) => r.tool).filter(Boolean);

  // 写操作走「提案 + 人工确认」，因此还要看 tool_proposed
  const proposals = await db.query(
    `select payload->>'tool' as tool from ai_agent_run_events
      where run_id=$1 and event_type='tool_proposed' order by sequence`,
    [runId],
  );
  const proposed = proposals.rows.map((r) => r.tool).filter(Boolean);

  // 遥测：模型轮次数与每轮间隔（解释"慢在轮次多还是每轮慢"）
  const timeline = await db.query(
    `select event_type, created_at from ai_agent_run_events
      where run_id=$1 order by sequence`,
    [runId],
  );
  const turns = timeline.rows.filter((r) => r.event_type === 'model_decision');
  const toolsSeq = timeline.rows.filter((r) => r.event_type === 'tool_started');
  const turnGaps = [];
  for (let i = 1; i < turns.length; i += 1) {
    turnGaps.push(new Date(turns[i].created_at) - new Date(turns[i - 1].created_at));
  }
  const firstAt = timeline.rows[0]?.created_at ? new Date(timeline.rows[0].created_at) : null;
  const lastAt = timeline.rows.at(-1)?.created_at ? new Date(timeline.rows.at(-1).created_at) : null;
  const spanMs = firstAt && lastAt ? lastAt - firstAt : 0;

  const childRuns = await db.query(
    `select count(*)::int n from ai_workbench_runs where parent_run_id=$1`,
    [runId],
  );

  // 遥测固化：llm_calls 里有 token / 延迟 / 缓存命中，重置前必须采集
  const calls = await db.query(
    `select purpose, provider, model, input_tokens, output_tokens,
            cache_read_tokens, latency_ms, cost_cents, status, error_code
       from llm_calls where workbench_run_id=$1 order by created_at`,
    [runId],
  );
  const llmCalls = calls.rows;
  const sumBy = (purpose, field) =>
    llmCalls.filter((c) => !purpose || c.purpose === purpose).reduce((s, c) => s + (Number(c[field]) || 0), 0);

  let stateValue = null;
  if (spec.expected_state) {
    const { table, id, column } = spec.expected_state;
    const r = await db.query(`select "${column}" as v from public."${table}" where id=$1`, [id]);
    stateValue = r.rows[0]?.v ?? null;
  }
  const forbiddenState = [];
  for (const f of spec.forbidden_state ?? []) {
    const r = await db.query(`select "${f.column}" as v from public."${f.table}" where id=$1`, [f.id]);
    forbiddenState.push({ id: f.id, column: f.column, expected: f.value, actual: r.rows[0]?.v ?? null });
  }
  return {
    tools: names, proposed, childRuns: childRuns.rows[0]?.n ?? 0,
    turns: turns.length, toolCount: toolsSeq.length, turnGaps, spanMs,
    llmCalls,
    llm_totals: {
      calls: llmCalls.length,
      input_tokens: sumBy(null, "input_tokens"),
      output_tokens: sumBy(null, "output_tokens"),
      cache_read_tokens: sumBy(null, "cache_read_tokens"),
      cost_cents: sumBy(null, "cost_cents"),
      agent_turn_latency_ms: sumBy("agent_turn", "latency_ms"),
      specialist_latency_ms: sumBy("agent_specialist", "latency_ms"),
      router_latency_ms: sumBy("collaboration_router", "latency_ms"),
    },
    stateValue, forbiddenState };
  } finally {
    await db.end();
  }
}

function judge(spec, evidence, status) {
  // 已执行 ∪ 已提案：写操作在产品里是提案+确认，两者都算发起了正确动作
  const acted = [...evidence.tools, ...(evidence.proposed ?? [])];
  const actionsOk = spec.expected_actions.every((t) => acted.includes(t));
  const forbiddenHits = spec.forbidden_actions.filter((t) => acted.includes(t));
  const executed = evidence.stateValue === spec.expected_state?.value;
  const proposedTarget = (evidence.proposed ?? []).some((t) => spec.expected_actions.includes(t));
  const stateOk = !spec.expected_state || executed || (spec.assert_mode === 'proposal_or_execute' && proposedTarget);
  const forbiddenStateOk = evidence.forbiddenState.every((f) => f.actual === f.expected);
  const ran = status === 'completed' || status === 'partial';
  return {
    actions_ok: actionsOk,
    forbidden_ok: forbiddenHits.length === 0,
    forbidden_hits: forbiddenHits,
    state_ok: stateOk,
    forbidden_state_ok: forbiddenStateOk,
    strict_success: ran && actionsOk && forbiddenHits.length === 0 && stateOk && forbiddenStateOk,
  };
}

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
await page.goto('http://localhost:3000/login', { waitUntil: 'networkidle', timeout: 120000 });
await page.fill('input[type="email"]', 'e2e-manager@pi-native.test');
await page.fill('input[type="password"]', 'E2E!Test1234');
await page.click('button[type="submit"]');
await page.waitForTimeout(6000);
console.log(`已登录 | 轮次 ${ROUND} | 任务 ${TASK_IDS.join(',')}`);

const jobs = [];
for (const taskId of TASK_IDS) {
  const groupsSelected = (process.env.GROUPS ?? 'A,B').split(',').map((g) => g.trim());
  for (const [group, collaboration] of Object.entries(GROUPS)) {
    if (!groupsSelected.includes(group)) continue;
    jobs.push({ taskId, group, collaboration });
  }
}
console.log(`本轮 ${jobs.length} 个 trial\n`);

for (const [index, job] of jobs.entries()) {
  const spec = TASKS[job.taskId];
  console.log(`\n=== ${index + 1}/${jobs.length} ${job.taskId}-${job.group} (round ${ROUND}) ===`);

  await stopWorker();
  const tReset = Date.now();
  await resetDb();
  await startWorker();
  const resetMs = Date.now() - tReset;

  const t0 = Date.now();
  const created = await page.evaluate(
    async ({ body }) => {
      const r = await fetch('/api/v1/ai/workbench/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      return { status: r.status, json: await r.json().catch(() => null) };
    },
    {
      body: {
        agentId: spec.agentId,
        task: spec.task,
        mode: spec.mode,
        collaboration: job.collaboration,
        scope: spec.scope,
      },
    },
  );

  const runId = created.json?.data?.run_id;
  let final = null;
  if (!runId) {
    console.log('创建失败', created.status, JSON.stringify(created.json).slice(0, 160));
  } else {
    const deadline = Date.now() + MAX_RUN_MS;
    while (Date.now() < deadline) {
      await page.waitForTimeout(5000);
      const r = await page.evaluate(async ({ id }) => {
        const res = await fetch(`/api/v1/ai/workbench/runs/${id}`);
        return { json: await res.json().catch(() => null) };
      }, { id: runId });
      const data = r.json?.data ?? r.json;
      if (['completed', 'partial', 'failed', 'cancelled'].includes(data?.status)) { final = data; break; }
    }
  }

  const durationMs = Date.now() - t0;
  const status = final?.status ?? (runId ? 'timeout' : 'create_failed');
  const emptyEvidence = { tools: [], proposed: [], childRuns: 0, stateValue: null, forbiddenState: [] };
  let evidenceError = null;
  let evidence = emptyEvidence;
  if (runId) {
    try {
      evidence = await collectEvidence(runId, spec);
    } catch (e) {
      // 采集失败必须显式记录：静默吞掉会让"采不到证据"看起来像"模型没调工具"
      evidenceError = e instanceof Error ? e.message.split("\n")[0] : String(e);
      console.log(`⚠ 证据采集失败: ${evidenceError}`);
    }
  }
  const verdict = judge(spec, evidence, status);

  const record = {
    round: ROUND,
    taskId: job.taskId,
    group: job.group,
    collaboration: job.collaboration,
    runId: runId ?? null,
    status,
    error_code: final?.error_code ?? null,
    duration_ms: durationMs,
    reset_ms: resetMs,
    tools: evidence.tools,
    proposed: evidence.proposed ?? [],
    evidence_error: evidenceError,
    child_runs: evidence.childRuns ?? 0,
    turns: evidence.turns ?? 0,
    tool_count: evidence.toolCount ?? evidence.tools?.length ?? 0,
    turn_gaps_ms: evidence.turnGaps ?? [],
    span_ms: evidence.spanMs ?? 0,
    llm_totals: evidence.llm_totals ?? null,
    llm_calls: (evidence.llmCalls ?? []).map((c) => ({
      purpose: c.purpose, model: c.model, in: c.input_tokens, out: c.output_tokens,
      cache_read: c.cache_read_tokens, latency_ms: c.latency_ms, status: c.status, error_code: c.error_code,
    })),
    executed: evidence.stateValue === spec.expected_state?.value,
    state_value: evidence.stateValue,
    ...verdict,
    final_text: (final?.final_text ?? '').slice(0, 2000),
  };
  fs.appendFileSync(outFile, JSON.stringify(record) + '\n');
  console.log(
    `status=${status} ${Math.round(durationMs / 1000)}s | tools=${evidence.tools.length} | strict=${verdict.strict_success ? 'PASS' : 'FAIL'}` +
      ` (actions=${verdict.actions_ok} forbidden=${verdict.forbidden_ok} state=${verdict.state_ok})`,
  );
}

await stopWorker();
await browser.close();
console.log('\n=== 本轮汇总 ===');
const rows = fs.readFileSync(outFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
for (const r of rows) {
  console.log(`${r.taskId}-${r.group}: ${r.status} strict=${r.strict_success ? 'PASS' : 'FAIL'} ${Math.round(r.duration_ms / 1000)}s`);
}
console.log('结果文件:', outFile);
