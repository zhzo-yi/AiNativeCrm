// 把当前数据库的 public schema 全量快照写入 bench/snapshot.json
import fs from 'node:fs';
import { BENCH, SNAPSHOT_PATH, TRANSIENT_TABLES, connect, publicTables, sha256 } from './lib.mjs';

const c = await connect();

// JSON 无法无损表示 bytea，用 {__buf: hex} 包装；reset.mjs 负责还原
const enc = (v) => {
  if (Buffer.isBuffer(v)) return { __buf: v.toString('hex') };
  if (Array.isArray(v)) return v.map(enc);
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = enc(x);
    return o;
  }
  return v;
};

try {
  const tables = (await publicTables(c)).filter((t) => !TRANSIENT_TABLES.has(t));
  const out = { meta: { takenAt: new Date().toISOString(), tables: tables.length }, tables: {} };
  const counts = {};
  let total = 0;
  let binaryWarn = [];

  for (const t of tables) {
    const r = await c.query(`select * from public."${t}"`);
    out.tables[t] = r.rows.map(enc);
    counts[t] = r.rows.length;
    total += r.rows.length;
    if (r.rows.some((row) => Object.values(row).some((v) => Buffer.isBuffer(v)))) binaryWarn.push(t);
  }

  out.meta.rowCounts = counts;
  out.meta.totalRows = total;
  const json = JSON.stringify(out);
  fs.mkdirSync(BENCH, { recursive: true });
  fs.writeFileSync(SNAPSHOT_PATH, json);

  console.log(`tables=${tables.length} rows=${total}`);
  console.log(`sha256=${sha256(json)}`);
  console.log(`path=${SNAPSHOT_PATH} (${(json.length / 1024).toFixed(1)} KB)`);
  const nonEmpty = Object.entries(counts).filter(([, n]) => n > 0);
  console.log(`non-empty tables (${nonEmpty.length}):`);
  for (const [t, n] of nonEmpty) console.log(`  ${t}: ${n}`);
  if (binaryWarn.length) console.log('⚠ BLOB 列（JSON 往返可能失真）:', binaryWarn.join(', '));
  console.log('SNAPSHOT OK');
} finally {
  await c.end();
}
