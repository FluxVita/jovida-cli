import { ulid } from 'ulid'

// 所有 CLI 铸造的 id 统一 `cli_`+ULID —— 前缀只标本端来源(provenance),不是跨端契约:
// 后端按 (user, id) 精确匹配、不看前缀;手机端 sync 按对象类型 + 字段入库、不看前缀;
// 本端 view/update/subtask 也靠集合查找 + 完整 id 匹配区分类型,不解析前缀。
// (保留 4 个具名函数=call-site 语义清晰,同实现即可。)唯一确定性/契约 id 是 fork 发生 id
// `recurring:<recurringId>:<本地0点秒>`(见 recurrence.ts),那条跨端逐字一致,与此处无关。
export const newEntryId = (): string => `cli_${ulid()}`
export const newSubtaskId = (): string => `cli_${ulid()}`
export const newReminderId = (): string => `cli_${ulid()}`
export const newRecurringId = (): string => `cli_${ulid()}`
