# bench · 数据库快照与重置（S2）

对应契约 `CONTRACT.md` 不变量 **I2**：每次 trial 前从同一份种子快照恢复数据库，并做一致性自检。

## 脚本

| 脚本 | 作用 | 典型耗时 |
|---|---|---|
| `seed.mjs` | 把 `tasks/seed.yaml` 写入数据库（固定 UUID，幂等） | ~3s |
| `snapshot.mjs` | 全量导出 public schema 到 `snapshot.json` | ~6s |
| `reset.mjs` | TRUNCATE 全部表 → 从快照回灌 → 行数自检 | ~6–9s |
| `check.mjs` | 结构自检（183 表 / 5 视图 / 436 函数 / 550 策略）+ 行数 + 种子记录 | ~3s |
| `hash.mjs` | 业务表内容哈希，用于证明"重置后完全一致" | ~2s |

## 标准流程

```bash
node seed.mjs        # 只在首次建快照时执行
node snapshot.mjs    # 生成 snapshot.json（此后冻结）
node reset.mjs       # 每次 trial 前执行
node check.mjs       # 自检，非 0 退出码即中止实验
```

## 已验证的事实

- **结构**：183 张基表 + 5 个视图 = 188；函数 436；RLS 策略 550
- **快照**：123 行（125 条中 2 条为空表不计）
- **确定性**：故意改脏数据（改标题、改金额、删会话消息）后执行 `reset.mjs`，
  业务表内容哈希与改脏前**完全一致**（`e7a4bd22…`）
- **耗时**：重置 6.4–8.6s（TRUNCATE 0.8s + 回灌 + 一次往返的行数自检）

## 实现要点（踩过的坑）

1. **生成列**：`contacts.email_normalized`、`channel_sessions.is_warmup_complete` 是
   `GENERATED ALWAYS`，不能显式写入 → `reset.mjs` 自动跳过全部生成列与 ALWAYS 标识列（当前 7 个）。
2. **组织触发器**：插入 `organizations` 会自动建默认漏斗 → `seed.mjs` 先清空该组织业务内容，
   再写入固定 UUID 的漏斗/阶段。
3. **`channel_session_id` 是 uuid 且有外键**：`conversations` 必须引用 `channel_sessions`，
   会话 id 需先落库。
4. **bytea**：`channel_sessions` 含二进制列，JSON 无法无损表示 → 快照用 `{__buf: hex}` 包装，重置时还原。
5. **性能**：逐表 `count(*)` 校验曾让重置耗时 37s（183 次往返）→ 合并为单次 `UNION ALL` 查询后降到 8.6s。
6. **自检不能省**：行数对不上就直接非 0 退出，不允许带病跑实验。

## 快照时效

`seed.yaml` 用相对时间锚点（`$seed_now - N days`）。快照建立后锚点冻结，
而 Agent 的"现在"持续推进 → **快照有效期 7 天**，超期必须 `seed → snapshot` 重建并作废该批数据
（`check.mjs` 会检查"停滞商机恰好 3 条"，漂移后会失败）。

## 安全边界

- 所有脚本只操作 `public` schema，不触碰 `auth.users`（测试账号不受重置影响）
- `reset.mjs` 的目标库来自 `AiNativeCrm-main/.env.local` 的 `SUPABASE_DB_URL`
- **只允许对实验专用 Supabase 项目执行**，不要指向生产库
