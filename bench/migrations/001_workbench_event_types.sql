-- 001_workbench_event_types.sql
-- 事件类型白名单扩展：新增 collaboration_mode（S3）与 read_conflict（S4）。
--
-- 背景：ai_agent_run_events.event_type 有 CHECK 约束，代码侧新增的事件类型
-- 必须先在这里登记，否则 appendWorkbenchEvent 会以
--   workbench_event_append_failed: ... violates check constraint
-- 让整个 job 失败（实测于 2026-11-09 冒烟）。
--
-- 幂等：先 drop 再 add。

alter table public.ai_agent_run_events
  drop constraint if exists ai_agent_run_events_event_type_check;

alter table public.ai_agent_run_events
  add constraint ai_agent_run_events_event_type_check
  check (event_type = any (array[
    'run_started','context_loaded','model_decision','tool_proposed','policy_checked',
    'tool_started','tool_completed','crm_state_changed',
    'human_confirmation_requested','human_confirmation_received',
    'run_resumed','run_completed','run_partial','run_failed','run_cancelled',
    'usage_reported',
    'collaboration_started','specialist_started','specialist_completed','specialist_failed',
    'collaboration_conflict','collaboration_completed','manager_direction_consumed',
    -- 新增（本项目 S3/S4）
    'collaboration_mode','read_conflict'
  ]));
