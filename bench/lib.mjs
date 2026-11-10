// 共享工具：连接池、表枚举、环境读取
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

export const ROOT = 'D:/workBoddy-pro';
export const REPO = path.join(ROOT, 'AiNativeCrm-main');
export const TASKS = path.join(ROOT, 'tasks');
export const BENCH = path.join(ROOT, 'bench');
export const SNAPSHOT_PATH = path.join(BENCH, 'snapshot.json');

/**
 * 不参与快照/还原的表：纯运行期产物（每次 run 由系统自己生成/回收）。
 * 放进快照没有价值，还原时反而会因为二进制列往返而失败。
 */
export const TRANSIENT_TABLES = new Set(['api_tokens']);

const require = createRequire(import.meta.url);
const { Client, Pool } = require(path.join(REPO, 'node_modules', 'pg'));
export const YAML = require(path.join(REPO, 'node_modules', 'yaml'));

export function databaseUrl() {
  const env = fs.readFileSync(path.join(REPO, '.env.local'), 'utf8');
  const line = env.split(/\r?\n/).find((l) => l.startsWith('SUPABASE_DB_URL='));
  if (!line) throw new Error('SUPABASE_DB_URL ausente em .env.local');
  return line.slice('SUPABASE_DB_URL='.length).trim();
}

export async function connect() {
  const c = new Client({
    connectionString: databaseUrl(),
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 30000,
    statement_timeout: 0,
  });
  await c.connect();
  return c;
}

/** 连接池：reset 时并用多个连接并行回灌 */
export function pool(max = 8) {
  return new Pool({
    connectionString: databaseUrl(),
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 30000,
    statement_timeout: 0,
    max,
  });
}

export async function publicTables(c) {
  const r = await c.query(
    `select table_name from information_schema.tables
      where table_schema='public' and table_type='BASE TABLE' order by 1`,
  );
  return r.rows.map((x) => x.table_name);
}

export function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

/** 解析 "$seed_now - 12 days" / "$seed_now - 3 days + 10 minutes" 这类锚点 */
export function resolveAnchor(value, seedNow) {
  if (typeof value !== 'string' || !value.startsWith('$seed_now')) return value;
  let t = seedNow.getTime();
  const rest = value.slice('$seed_now'.length).trim();
  if (rest === '') return new Date(t).toISOString();
  const re = /([+-])\s*(\d+)\s*(days?|hours?|minutes?|seconds?)/g;
  let m;
  let consumed = 0;
  while ((m = re.exec(rest)) !== null) {
    const sign = m[1] === '-' ? -1 : 1;
    const n = Number(m[2]);
    const unit = m[3];
    const ms = unit.startsWith('day') ? 86400e3 : unit.startsWith('hour') ? 3600e3 : unit.startsWith('minute') ? 60e3 : 1e3;
    t += sign * n * ms;
    consumed += m[0].length;
  }
  if (consumed === 0) throw new Error(`anchor inválido: ${value}`);
  return new Date(t).toISOString();
}
