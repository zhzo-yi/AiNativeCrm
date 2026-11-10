// 业务表内容哈希：用于验证「重置后数据完全一致」（契约 I2）
import { createHash } from 'node:crypto';
import { connect } from './lib.mjs';

const tables = ['crm_leads', 'crm_stages', 'crm_pipelines', 'contacts', 'conversations', 'messages', 'channel_sessions'];

const c = await connect();
try {
  const parts = tables.map((t) => `select '${t}'::text as t, to_jsonb(x)::text as j from public."${t}" x`);
  const r = await c.query(parts.join(' union all ') + ' order by t, j');
  const counts = {};
  for (const row of r.rows) counts[row.t] = (counts[row.t] ?? 0) + 1;
  const hash = createHash('sha256').update(JSON.stringify(r.rows)).digest('hex');
  console.log('rows:', JSON.stringify(counts));
  console.log('hash:', hash);
} finally {
  await c.end();
}
