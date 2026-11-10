// 一致性自检（契约 I2）：结构计数 + 快照行数 + 种子关键记录存在性
import fs from 'node:fs';
import { SNAPSHOT_PATH, connect } from './lib.mjs';

const EXPECT = { baseTables: 183, views: 5, functions: 436, policies: 550 };

const snapshot = fs.existsSync(SNAPSHOT_PATH) ? JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8')) : null;
const c = await connect();
let failures = 0;
const fail = (m) => { failures += 1; console.log('  ❌ ' + m); };
const ok = (m) => console.log('  ✅ ' + m);

try {
  const t = await c.query("select count(*)::int n from information_schema.tables where table_schema='public' and table_type='BASE TABLE'");
  const v = await c.query("select count(*)::int n from information_schema.views where table_schema='public'");
  const f = await c.query("select count(*)::int n from information_schema.routines where routine_schema='public'");
  const p = await c.query("select count(*)::int n from pg_policies where schemaname='public'");

  console.log('结构自检:');
  const got = { baseTables: t.rows[0].n, views: v.rows[0].n, functions: f.rows[0].n, policies: p.rows[0].n };
  for (const [k, v] of Object.entries(EXPECT)) {
    if (got[k] === v) ok(`${k} = ${v}`);
    else fail(`${k} = ${got[k]}，期望 ${v}（schema 漂移，禁止继续实验）`);
  }

  if (!snapshot) {
    fail('缺少 snapshot.json，请先执行 snapshot.mjs');
  } else {
    console.log('快照行数自检:');
    const names = Object.keys(snapshot.tables);
    const union = names
      .map((t) => `select '${t}'::text as t, count(*)::int as n from public."${t}"`)
      .join(' union all ');
    const counted = await c.query(union);
    const actual = Object.fromEntries(counted.rows.map((r) => [r.t, r.n]));
    let mismatch = 0;
    for (const t of names) {
      if (actual[t] !== snapshot.tables[t].length) { mismatch += 1; fail(`${t}: ${actual[t]} != ${snapshot.tables[t].length}`); }
    }
    if (!mismatch) ok(`${names.length} 张表行数全部一致`);
  }

  console.log('种子记录自检:');
  const leads = await c.query(
    `select id, stage_id, value_cents, tags, last_activity_at
       from public.crm_leads
      where id in ('00000000-0000-4000-8000-0000000000d1','00000000-0000-4000-8000-0000000000d2',
                   '00000000-0000-4000-8000-0000000000d3','00000000-0000-4000-8000-0000000000d4',
                   '00000000-0000-4000-8000-0000000000d5')`,
  );
  if (leads.rows.length === 5) ok('5 条商机存在');
  else fail(`商机数量 ${leads.rows.length} != 5`);

  const d3 = leads.rows.find((r) => r.id === '00000000-0000-4000-8000-0000000000d3');
  if (d3 && d3.stage_id === '00000000-0000-4000-8000-0000000000b2') ok('d3 处于 Qualificação（未漂移）');
  else fail(`d3 stage_id = ${d3?.stage_id}，期望 b2`);

  const d4 = leads.rows.find((r) => r.id === '00000000-0000-4000-8000-0000000000d4');
  if (d4 && Number(d4.value_cents) === 300000) ok('d4 金额为 300000（未漂移）');
  else fail(`d4 value_cents = ${d4?.value_cents}，期望 300000`);

  const stale = leads.rows.filter((r) => r.last_activity_at && (Date.now() - new Date(r.last_activity_at).getTime()) > 7 * 86400e3);
  if (stale.length === 3) ok('停滞商机恰好 3 条（阈值 7 天）');
  else fail(`停滞商机 ${stale.length} 条，期望 3 条（快照可能已超过 7 天有效期）`);

  console.log(failures === 0 ? '\nCHECK OK' : `\nCHECK FAILED (${failures})`);
  process.exitCode = failures === 0 ? 0 : 1;
} finally {
  await c.end();
}
