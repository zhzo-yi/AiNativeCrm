// 对照：带上工具定义后，直连 DeepSeek 的吞吐会不会掉到 6 tok/s
import fs from 'node:fs';

const env = fs.readFileSync('D:/workBoddy-pro/AiNativeCrm-main/.env.local', 'utf8');
const key = env.split(/\r?\n/).find((l) => l.startsWith('DEEPSEEK_API_KEY='))?.slice('DEEPSEEK_API_KEY='.length).trim();
const BASE = 'https://api.deepseek.com/chat/completions';

const tools = [
  { type: 'function', function: { name: 'crm_get_contact', description: '获取联系人详情', parameters: { type: 'object', properties: { contact_id: { type: 'string' } }, required: ['contact_id'] } } },
  { type: 'function', function: { name: 'crm_list_leads', description: '列出商机', parameters: { type: 'object', properties: { status: { type: 'string' }, stage_id: { type: 'string' }, limit: { type: 'number' } } } } },
  { type: 'function', function: { name: 'crm_get_lead', description: '获取商机详情', parameters: { type: 'object', properties: { lead_id: { type: 'string' } }, required: ['lead_id'] } } },
  { type: 'function', function: { name: 'crm_list_followups', description: '列出跟进', parameters: { type: 'object', properties: { lead_id: { type: 'string' } } } } },
  { type: 'function', function: { name: 'crm_search_knowledge', description: '搜索知识库', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } },
];

async function run(label, body) {
  const t0 = Date.now();
  let ttft = null, chars = 0, usage = null;
  const res = await fetch(BASE, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ ...body, model: 'deepseek-chat', stream: true, temperature: 0.7 }),
  });
  if (!res.ok) return console.log(label, '失败', res.status, (await res.text()).slice(0, 200));
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n'); buf = lines.pop() ?? '';
    for (const line of lines) {
      const s = line.trim(); if (!s.startsWith('data:')) continue;
      const p = s.slice(5).trim(); if (p === '[DONE]') continue;
      try {
        const j = JSON.parse(p);
        const d = j.choices?.[0]?.delta?.content ?? '';
        if (d && ttft === null) ttft = Date.now() - t0;
        chars += d.length;
        if (j.usage) usage = j.usage;
      } catch {}
    }
  }
  const total = Date.now() - t0;
  const outTok = usage?.completion_tokens ?? Math.round(chars / 2);
  console.log(`${label}: ${(total / 1000).toFixed(1)}s 首字节 ${ttft ? (ttft / 1000).toFixed(1) : '-'}s 输出≈${outTok}tok → ${(outTok / (total / 1000)).toFixed(1)} tok/s`);
}

const messages = [
  { role: 'system', content: '你是 CRM 助手。需要数据时必须调用工具，不要编造。' },
  { role: 'user', content: '请总结客户 Ana Ribeiro 的近期情况，并给出下一步建议。要求 600 字以上，分点说明依据。' },
];

await run('无工具      ', { messages, max_tokens: 2000 });
await run('带 5 个工具 ', { messages, tools, max_tokens: 2000 });
await run('带工具+长文 ', { messages: [{ role: 'system', content: messages[0].content + '背景说明：'.repeat(300) }, messages[1]], tools, max_tokens: 2000 });
