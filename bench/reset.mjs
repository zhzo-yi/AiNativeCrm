// 把数据库恢复到快照状态：TRUNCATE 全部 public 表 → 从 snapshot.json 回灌。
// 契约 I2：每次 trial 前执行，并做一致性自检。
import fs from 'node:fs';
import { SNAPSHOT_PATH, TRANSIENT_TABLES, connect, publicTables } from './lib.mjs';

const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));

// 还原 snapshot.mjs 写的 {__buf: hex}
const dec = (v) => {
  if (Array.isArray(v)) return v.map(dec);
  if (v && typeof v === 'object') {
    if (typeof v.__buf === 'string') return Buffer.from(v.__buf, 'hex');
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = dec(x);
    return o;
  }
  return v;
};

async function insertTable(c, table, rows) {
  if (!rows.length) return 0;
  // 排除生成列与 ALWAYS 标识列：PG 不允许显式写入
  const cols = Object.keys(rows[0]).filter((x) => !GENERATED.has(`${table}.${x}`));
  if (!cols.length) return 0;
  const colSql = cols.map((x) => `"${x}"`).join(',');
  const CHUNK = 100;
  let inserted = 0;
  for (let start = 0; start < rows.length; start += CHUNK) {
    const slice = rows.slice(start, start + CHUNK);
    const values = [];
    const params = [];
    for (const row of slice) {
      const placeholders = cols.map((x) => {
        params.push(dec(row[x]));
        return `$${params.length}`;
      });
      values.push(`(${placeholders.join(',')})`);
    }
    await c.query(
      `insert into public."${table}" (${colSql}) values ${values.join(',')}`,
      params,
    );
    inserted += slice.length;
  }
  return inserted;
}

const c = await connect();
const t0 = Date.now();
// Supabase 的角色带默认 statement_timeout，事务里的批量 DDL/DML 会被它掐断
await c.query("set statement_timeout = 0");
await c.query("set lock_timeout = '30s'");
await c.query("set idle_in_transaction_session_timeout = '120s'");
const GENERATED = new Set();
try {
  const gen = await c.query(
    `select table_name, column_name from information_schema.columns
      where table_schema='public' and (is_generated='ALWAYS' or is_identity='ALWAYS')`,
  );
  for (const g of gen.rows) GENERATED.add(`${g.table_name}.${g.column_name}`);
  if (GENERATED.size) console.log(`generated/identity 列（跳过写入）: ${GENERATED.size}`);
  const tables = await publicTables(c);
  const snapshotTables = new Set(Object.keys(snapshot.tables));
  const onlyInDb = tables.filter((t) => !snapshotTables.has(t));
  if (onlyInDb.length) {
    console.log('⚠ 快照里没有的表（将保持清空）:', onlyInDb.slice(0, 10).join(', '), onlyInDb.length > 10 ? '…' : '');
  }

  await c.query('begin');

  // 1) 清空（CASCADE 处理外键）
  const list = tables.map((t) => `public."${t}"`).join(', ');
  await c.query(`truncate table ${list} cascade`);
  console.log(`truncated ${tables.length} tables`);

  // 2) 尝试关闭触发器/外键检查（Supabase 的 postgres 角色通常没有 SUPERUSER）
  let replica = false;
  try {
    await c.query("set local session_replication_role = replica");
    replica = true;
  } catch {
    console.log('⚠ 无法设置 session_replication_role，改用拓扑重试插入');
  }

  // 3) 回灌
  let total = 0;
  const pending = Object.entries(snapshot.tables).filter(([, rows]) => rows.length > 0);

  if (replica) {
    for (const [table, rows] of pending) {
      try {
        total += await insertTable(c, table, rows);
      } catch (e) {
        throw new Error(`insert ${table} (${rows.length} rows) falhou: ${e.message.split("\n")[0]}`);
      }
    }
  } else {
    // 顶层重试：外键尚未满足的表留到下一轮
    let queue = pending.slice();
    let guard = 0;
    while (queue.length && guard < 50) {
      guard += 1;
      const failed = [];
      for (const [table, rows] of queue) {
        try {
          await c.query('savepoint sp');
          total += await insertTable(c, table, rows);
          await c.query('release savepoint sp');
        } catch (e) {
          await c.query('rollback to savepoint sp');
          failed.push([table, rows]);
        }
      }
      if (failed.length === queue.length) {
        throw new Error(`无法插入: ${failed.map(([t]) => t).join(', ')}`);
      }
      queue = failed;
    }
  }

  await c.query('commit');

  // 4) 自检：行数必须与快照一致（一次往返查完所有表）
  const tablesInSnapshot = Object.keys(snapshot.tables);
  const union = tablesInSnapshot
    .map((t) => `select '${t}'::text as t, count(*)::int as n from public."${t}"`)
    .join(' union all ');
  const counted = await c.query(union);
  const actual = Object.fromEntries(counted.rows.map((r) => [r.t, r.n]));
  const mismatches = [];
  for (const t of tablesInSnapshot) {
    if (actual[t] !== snapshot.tables[t].length) mismatches.push(`${t}: ${actual[t]} != ${snapshot.tables[t].length}`);
  }
  if (mismatches.length) {
    console.log('❌ 行数不一致:');
    for (const m of mismatches) console.log('  ' + m);
    process.exitCode = 1;
  } else {
    console.log(`rows restored=${total} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    console.log('RESET OK');
  }
} catch (e) {
  await c.query('rollback').catch(() => {});
  console.log('RESET FAILED:', e.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
