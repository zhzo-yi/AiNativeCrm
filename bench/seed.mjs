// 写入确定性种子数据（tasks/seed.yaml）到数据库。
// 幂等：按固定 UUID upsert，重复执行不会产生重复行。
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, REPO, TASKS, YAML, connect, resolveAnchor } from './lib.mjs';

const seed = YAML.parse(fs.readFileSync(path.join(TASKS, 'seed.yaml'), 'utf8'));
const seedNow = new Date();               // 快照锚点：一次性计算，之后冻结
const orgId = seed.organization.id;

const credsPath = path.join(REPO, '.e2e-creds.json');
const creds = fs.existsSync(credsPath) ? JSON.parse(fs.readFileSync(credsPath, 'utf8')) : null;
const memberIds = [];
if (creds?.users) {
  for (const key of ['admin', 'manager', 'agent']) {
    if (creds.users[key]?.id) memberIds.push({ id: creds.users[key].id, role: creds.users[key].role });
  }
}

const val = (v) => resolveAnchor(v, seedNow);

async function upsert(c, table, row, conflict = 'id') {
  const cols = Object.keys(row);
  const params = cols.map((_, i) => `$${i + 1}`);
  const sql = `insert into public."${table}" (${cols.map((x) => `"${x}"`).join(',')})
               values (${params.join(',')})
               on conflict (${conflict}) do update set ${cols
                 .filter((x) => x !== conflict)
                 .map((x) => `"${x}"=excluded."${x}"`)
                 .join(',')}`;
  await c.query(sql, cols.map((x) => row[x]));
}

const c = await connect();
try {
  console.log('seed_now =', seedNow.toISOString());

  await upsert(c, 'organizations', {
    id: orgId,
    slug: seed.organization.slug,
    legal_name: seed.organization.name,
    display_name: seed.organization.name,
    status: 'active',
    timezone: 'America/Sao_Paulo',
    locale: 'pt-BR',
  });

  for (const m of memberIds) {
    await c.query(
      `insert into public.user_organizations (user_id, organization_id, role)
       values ($1,$2,$3) on conflict do nothing`,
      [m.id, orgId, m.role],
    );
  }
  console.log(`memberships: ${memberIds.length}`);

  // 组织创建时数据库触发器会自动建一个默认漏斗（含阶段）。
  // 为了拿到固定 UUID，先清空本组织的业务内容，再按 seed.yaml 写入。
  await c.query('delete from public.messages where organization_id=$1', [orgId]);
  await c.query('delete from public.conversations where organization_id=$1', [orgId]);
  await c.query('delete from public.channel_sessions where organization_id=$1', [orgId]);
  await c.query('delete from public.crm_leads where organization_id=$1', [orgId]);
  await c.query('delete from public.crm_stages where organization_id=$1', [orgId]);
  await c.query('delete from public.crm_pipelines where organization_id=$1', [orgId]);
  await c.query('delete from public.contacts where organization_id=$1', [orgId]);

  for (const p of seed.pipelines) {
    await upsert(c, 'crm_pipelines', {
      id: p.id,
      organization_id: orgId,
      name: p.name,
      slug: p.slug,
      is_default: p.is_default,
      position: p.position,
    });
  }

  for (const s of seed.stages) {
    await upsert(c, 'crm_stages', {
      id: s.id,
      organization_id: orgId,
      pipeline_id: seed.pipelines[0].id,
      name: s.name,
      slug: s.slug,
      position: s.position,
      is_won: s.is_won,
      is_lost: s.is_lost,
    });
  }

  for (const ct of seed.contacts) {
    await upsert(c, 'contacts', {
      id: ct.id,
      organization_id: orgId,
      name: ct.name,
      display_name: ct.name,
      email: ct.email,
      phone_number: ct.phone_e164,
      created_at: new Date(seedNow.getTime() - 90 * 86400e3).toISOString(),
    });
  }

  for (const l of seed.leads) {
    // created_at 必须早于 last_activity_at，否则 Agent 会以"时间戳倒挂"为由拒绝执行
    const lastActivity = new Date(val(l.last_activity_at));
    const createdAt = new Date(lastActivity.getTime() - 24 * 3600 * 1000).toISOString();
    await upsert(c, 'crm_leads', {
      id: l.id,
      organization_id: orgId,
      pipeline_id: seed.pipelines[0].id,
      stage_id: l.stage_id,
      contact_id: l.contact_id,
      title: l.title,
      status: l.status,
      value_cents: l.value_cents,
      currency: l.currency,
      last_activity_at: val(l.last_activity_at),
      created_at: createdAt,
      updated_at: val(l.last_activity_at),
      tags: l.tags ?? [],
    });
  }

  let msgCount = 0;
  for (const cv of seed.conversations) {
    // channel_session_id 是 uuid 列：由会话 id 确定性派生（...e1 → ...f1）
    const sessionId = cv.id.replace(/([0-9a-f]{2})$/, (_m, p1) => 'f' + p1[1]);
    await upsert(c, 'channel_sessions', {
      id: sessionId,
      organization_id: orgId,
      waha_session_name: `bench-${cv.id.slice(-2)}`,
      provider: 'waha',
      webhook_path_token: `bench-token-${cv.id.slice(-2)}`,
      webhook_secret_encrypted: 'bench-not-a-real-secret',
      status: 'WORKING',
      phone_number: seed.contacts.find((x) => x.id === cv.contact_id)?.phone_e164 ?? null,
    });
    await upsert(c, 'conversations', {
      id: cv.id,
      organization_id: orgId,
      contact_id: cv.contact_id,
      channel_session_id: sessionId,
      channel: cv.channel,
      status: 'open',
      last_inbound_at: val(cv.last_inbound),
      last_message_at: val(cv.last_inbound),
      is_group: false,
      created_at: new Date(seedNow.getTime() - 30 * 86400e3).toISOString(),
    });
    let i = 0;
    for (const msg of cv.messages) {
      i += 1;
      await upsert(c, 'messages', {
        id: `00000000-0000-4000-8000-00000000${cv.id.slice(-2)}${String(i).padStart(2, '0')}`,
        organization_id: orgId,
        conversation_id: cv.id,
        channel_session_id: sessionId,
        contact_id: cv.contact_id,
        external_id: `seed-${cv.id}-${i}`,
        type: 'text',
        direction: msg.direction,
        status: msg.direction === 'inbound' ? 'received' : 'sent',
        body: msg.body,
        sent_at: val(msg.at),
        sent_via: 'system',
      });
      msgCount += 1;
    }
  }

  console.log(`org=${orgId}`);
  console.log(`pipelines=${seed.pipelines.length} stages=${seed.stages.length} contacts=${seed.contacts.length}`);
  console.log(`leads=${seed.leads.length} conversations=${seed.conversations.length} messages=${msgCount}`);
  console.log('SEED OK');
} finally {
  await c.end();
}
