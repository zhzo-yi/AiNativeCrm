// 直连 DeepSeek 探针：绕开应用层，测量裸 API 延迟。
// 目的：区分「模型/网络慢」与「应用层参数/重试导致慢」。
import fs from 'node:fs';

const env = fs.readFileSync('D:/workBoddy-pro/AiNativeCrm-main/.env.local', 'utf8');
const key = env.split(/\r?\n/).find((l) => l.startsWith('DEEPSEEK_API_KEY='))?.slice('DEEPSEEK_API_KEY='.length).trim();
if (!key) throw new Error('DEEPSEEK_API_KEY ausente');

const BASE = 'https://api.deepseek.com/chat/completions';
const MODEL = process.env.MODEL ?? 'deepseek-chat';

// 构造约 3k token 的输入（贴近实测的 agent_turn 输入规模）
const filler = '这是一个用于测量延迟的测试段落，内容与业务无关，只用于填充上下文。'.repeat(60);
const messages = [
  { role: 'system', content: '你是 CRM 助手。回答要简洁。' + filler.slice(0, 12000) },
  { role: 'user', content: '请用大约 800 字总结一个销售漏斗的健康状况，并给出三条改进建议。' },
];

async function callOnce(stream) {
  const body = { model: MODEL, messages, max_tokens: 2000, stream, temperature: 0.7 };
  const t0 = Date.now();
  let ttft = null;
  let text = '';
  let usage = null;

  const res = await fetch(BASE, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    return { ok: false, status: res.status, error: err.slice(0, 300), totalMs: Date.now() - t0 };
  }

  if (!stream) {
    const json = await res.json();
    usage = json.usage;
    text = json.choices?.[0]?.message?.content ?? '';
    return { ok: true, ttftMs: null, totalMs: Date.now() - t0, chars: text.length, usage };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      const s = line.trim();
      if (!s.startsWith('data:')) continue;
      const payload = s.slice(5).trim();
      if (payload === '[DONE]') continue;
      try {
        const chunk = JSON.parse(payload);
        const delta = chunk.choices?.[0]?.delta?.content ?? '';
        if (delta && ttft === null) ttft = Date.now() - t0;
        text += delta;
        if (chunk.usage) usage = chunk.usage;
      } catch {
        /* 忽略部分行 */
      }
    }
  }
  return { ok: true, ttftMs: ttft, totalMs: Date.now() - t0, chars: text.length, usage };
}

const results = [];
console.log(`模型=${MODEL}  输入约 ${Math.round(JSON.stringify(messages).length / 4)} token(估)`);

for (const stream of [false, true]) {
  for (let i = 1; i <= 2; i += 1) {
    process.stdout.write(`  ${stream ? '流式' : '非流式'} 第 ${i} 次 ... `);
    const r = await callOnce(stream);
    results.push({ stream, i, ...r });
    if (!r.ok) console.log(`失败 ${r.status} ${r.error}`);
    else
      console.log(
        `${(r.totalMs / 1000).toFixed(1)}s` +
          (r.ttftMs ? ` (首字节 ${(r.ttftMs / 1000).toFixed(1)}s)` : '') +
          ` 输出${r.chars}字 usage=${JSON.stringify(r.usage ?? null)}`,
      );
  }
}

const ok = results.filter((r) => r.ok);
if (ok.length) {
  const avg = (xs) => Math.round(xs.reduce((s, x) => s + x, 0) / xs.length);
  console.log('\n=== 对比 ===');
  console.log('单次调用平均:', (avg(ok.map((r) => r.totalMs)) / 1000).toFixed(1) + 's');
  console.log('应用内 agent_turn 实测: 321.7s（输入 3032 / 输出 1912 tok）');
}
