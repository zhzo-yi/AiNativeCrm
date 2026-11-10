// 结果汇总与 pass^k 计算。可对任意一批 results/*.jsonl 重复执行。
// 用法：node judge.mjs [结果文件或目录...]
import fs from 'node:fs';
import path from 'node:path';

const BENCH = 'D:/workBoddy-pro/bench';
const arg = process.argv.slice(2);

function collect(inputs) {
  const files = [];
  for (const input of inputs) {
    const p = path.resolve(BENCH, input);
    if (!fs.existsSync(p)) continue;
    if (fs.statSync(p).isDirectory()) {
      for (const f of fs.readdirSync(p)) if (f.endsWith('.jsonl')) files.push(path.join(p, f));
    } else files.push(p);
  }
  return files;
}

const files = collect(arg.length ? arg : ['results']);
if (files.length === 0) {
  console.log('没有结果文件');
  process.exit(0);
}

const records = [];
for (const f of files) {
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      /* 忽略半截行（跑批中断时可能留下） */
    }
  }
}

// 去重：同一 task/group/round 只保留最后一条（重跑覆盖）
const byKey = new Map();
for (const r of records) {
  // 跳过旧版记录（没有断言字段），否则会污染通过率
  if (typeof r.strict_success !== "boolean" || !Array.isArray(r.tools)) continue;
  byKey.set(`${r.taskId}|${r.group}|r${r.round}`, r);
}
const rows = [...byKey.values()].sort(
  (a, b) => a.taskId.localeCompare(b.taskId) || a.group.localeCompare(b.group) || a.round - b.round,
);

console.log(`结果文件 ${files.length} 个，记录 ${rows.length} 条\n`);

const header = ['任务', '组', '轮次', '状态', 'strict', 'actions', 'forbidden', 'state', '耗时s'];
const table = rows.map((r) => [
  r.taskId,
  r.group,
  String(r.round ?? '-'),
  r.status,
  r.strict_success ? 'PASS' : 'FAIL',
  r.actions_ok ? 'ok' : 'X',
  r.forbidden_ok ? 'ok' : 'X',
  r.state_ok ? 'ok' : 'X',
  String(Math.round((r.duration_ms ?? 0) / 1000)),
]);
const widths = header.map((h, i) => Math.max(h.length, ...table.map((t) => t[i].length)));
const fmt = (cells) => cells.map((c, i) => c.padEnd(widths[i])).join('  ');
console.log(fmt(header));
console.log(widths.map((w) => '-'.repeat(w)).join('  '));
for (const t of table) console.log(fmt(t));

// 分组统计：strict 通过率 + pass^k
const groups = new Map();
for (const r of rows) {
  const key = `${r.taskId}|${r.group}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(r);
}

console.log('\n=== 分组统计 ===');
for (const [key, list] of [...groups.entries()].sort()) {
  const sorted = list.sort((a, b) => a.round - b.round);
  const total = sorted.length;
  const passed = sorted.filter((r) => r.strict_success).length;
  const avg = Math.round(sorted.reduce((s, r) => s + (r.duration_ms ?? 0), 0) / total / 1000);

  // pass^k：前 k 轮必须全部通过
  const passK = [];
  for (let k = 1; k <= total; k += 1) {
    const firstK = sorted.slice(0, k);
    passK.push(firstK.every((r) => r.strict_success) ? `pass^${k}=PASS` : `pass^${k}=fail`);
  }

  console.log(`${key}: ${passed}/${total} (${Math.round((passed / total) * 100)}%) 平均 ${avg}s | ${passK.join(' ')}`);
}

console.log('\n=== 组间对比 ===');
for (const taskId of [...new Set(rows.map((r) => r.taskId))]) {
  const line = [];
  for (const group of ['A', 'B']) {
    const list = rows.filter((r) => r.taskId === taskId && r.group === group);
    if (list.length === 0) continue;
    const passed = list.filter((r) => r.strict_success).length;
    const avg = Math.round(list.reduce((s, r) => s + (r.duration_ms ?? 0), 0) / list.length / 1000);
    line.push(`${group}: ${passed}/${list.length} strict, 平均 ${avg}s`);
  }
  console.log(`${taskId} → ${line.join('  |  ')}`);
}
