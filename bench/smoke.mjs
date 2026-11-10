// 单任务冒烟：以 manager 身份登录，直接在浏览器上下文里调工作台 API，
// 依次验证 A/B/C 三种模式能否真正产出一轮执行。
// 用法：node smoke.mjs [auto|skill|skill_only]
import { createRequire } from 'node:module';

const REPO = 'D:/workBoddy-pro/AiNativeCrm-main';
const require = createRequire(import.meta.url);
const { chromium } = require(`${REPO}/node_modules/@playwright/test`);

const MODE = process.argv[2] ?? 'skill';
const EXISTING_RUN = process.argv[3] ?? null;
const BASE = 'http://localhost:3000';

const AGENTS = {
  crm_intelligence: '341bad4b-d893-4ba4-ab7c-d29d08407347',
  crm_supervisor: '450c9ace-dd98-4253-aea5-d7dba92c6c33',
  customer_communications: '2ebeb707-7afa-4192-9266-8ec2d510b7e2',
  sales_operations: '3932846e-b883-426b-a675-17ae334f718f',
};

const CONTACT = '00000000-0000-4000-8000-0000000000c1';
const LEAD = '00000000-0000-4000-8000-0000000000d1';

// T01：只读调查，适合冒烟（不写库）
const TASK =
  '请为联系人 Ana Ribeiro 做一份 360 摘要：列出她名下的商机、她最近一次会话的内容，并对每一条结论标注依据。不确定的地方请明确标为未知。';

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();

try {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 120000 });
  await page.fill('input[type="email"]', 'e2e-manager@pi-native.test');
  await page.fill('input[type="password"]', 'E2E!Test1234');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(6000);
  console.log('登录后 URL:', page.url());

  let runId = EXISTING_RUN;
  if (!runId) {
    const created = await page.evaluate(
      async ({ body }) => {
        const r = await fetch('/api/v1/ai/workbench/runs', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        return { status: r.status, json: await r.json().catch(() => null) };
      },
      {
        body: {
          agentId: AGENTS.crm_intelligence,
          task: TASK,
          mode: 'inspect',
          collaboration: MODE,
          scope: { contactId: CONTACT, leadId: LEAD },
        },
      },
    );
    console.log('创建 run:', created.status, JSON.stringify(created.json).slice(0, 300));
    runId = created.json?.data?.run_id ?? created.json?.data?.id;
  } else {
    console.log('复用已存在的 run:', runId);
  }
  if (!runId) throw new Error('没有拿到 run id，冒烟中止');

  const deadline = Date.now() + 240000;
  let last = null;
  while (Date.now() < deadline) {
    await page.waitForTimeout(5000);
    last = await page.evaluate(async ({ id }) => {
      const r = await fetch(`/api/v1/ai/workbench/runs/${id}`);
      return { status: r.status, json: await r.json().catch(() => null) };
    }, { id: runId });
    const data = last.json?.data ?? last.json;
    const st = data?.status ?? '?';
    process.stdout.write(`  status=${st}\n`);
    if (['completed', 'partial', 'failed', 'cancelled'].includes(st)) break;
  }

  const data = last?.json?.data ?? last?.json;
  console.log('\n=== 结果 ===');
  console.log('status:', data?.status);
  console.log('error_code:', data?.error_code ?? '-');
  console.log('final_text:', (data?.final_text ?? '').slice(0, 400));
} finally {
  await browser.close();
}
