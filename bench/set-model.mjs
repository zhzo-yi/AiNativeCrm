// 把 bench 组织的四个内置 Agent 绑定到 DeepSeek 并发布版本。
// 幂等：重复执行只会把已发布版本再确认一遍。
import pg from '../AiNativeCrm-main/node_modules/pg/lib/index.js';
import fs from 'node:fs';

const ORG = '00000000-0000-4000-8000-000000000001';
const PROVIDER = 'deepseek';
const MODEL = 'deepseek-chat';
const MODEL_REF = `${PROVIDER}/${MODEL}`;

const env = fs.readFileSync('D:/workBoddy-pro/AiNativeCrm-main/.env.local', 'utf8');
const url = env.split(/\r?\n/).find((l) => l.startsWith('SUPABASE_DB_URL=')).slice('SUPABASE_DB_URL='.length).trim();

const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();
try {
  const agents = await c.query(
    `select id, builtin_key, published_version_id from ai_agents
      where organization_id=$1 and builtin_key is not null order by builtin_key`,
    [ORG],
  );
  if (agents.rows.length === 0) throw new Error('nenhum builtin agent na org — rode ensure-builtin-agents primeiro');

  for (const agent of agents.rows) {
    const versions = await c.query(
      `select id, version_number, status from ai_agent_versions
        where organization_id=$1 and agent_id=$2 order by version_number desc`,
      [ORG, agent.id],
    );
    if (versions.rows.length === 0) throw new Error(`agent ${agent.builtin_key} sem versão`);

    // 只改最新一版，其余标记 superseded（保持"每 agent 一个 published"的不变量）
    const target = versions.rows[0];
    for (const other of versions.rows.slice(1)) {
      await c.query(
        `update ai_agent_versions
            set status='superseded', superseded_at=coalesce(superseded_at, now())
          where id=$1`,
        [other.id],
      );
    }
    await c.query(
      `update ai_agent_versions
          set provider=$2, model=$3, status='published',
              published_at=coalesce(published_at, now()), superseded_at=null
        where id=$1`,
      [target.id, PROVIDER, MODEL],
    );
    await c.query(
      `update ai_agents
          set model=$2, published_version_id=$3, is_active=true
        where id=$1`,
      [agent.id, MODEL_REF, target.id],
    );
    console.log(`${agent.builtin_key}: v${target.version_number} -> ${MODEL_REF} (published)`);
  }

  const check = await c.query(
    `select a.builtin_key, a.model, v.status, v.provider, v.model as version_model
       from ai_agents a join ai_agent_versions v on v.id=a.published_version_id
      where a.organization_id=$1 order by a.builtin_key`,
    [ORG],
  );
  console.log('\n验证:');
  for (const r of check.rows) {
    console.log(`  ${r.builtin_key}: agent.model=${r.model} version=${r.provider}/${r.version_model} status=${r.status}`);
  }
} finally {
  await c.end();
}
