// 领域类型(Jovida 待办)。时间一律 Unix 秒(0=未设/未完成)。

export type Priority = 'none' | 'low' | 'medium' | 'high'

export interface Subtask {
  id: string
  title: string
  completedAt: number
}

export interface Reminder {
  id: string
  canAlarm: boolean
  offsetSecs: number[]
  // v2 提醒新增字段。CLI 不主动设置/消费它们,只**原样透传保留**(否则 complete/update 整条回写会抹掉
  // App 端配的渠道/启用态)。enabled 缺省(undefined)按启用处理;channels 为渠道 enum 名字符串。
  enabled?: boolean
  channels?: string[]
}

/**
 * 待办图片引用(base.v1.FilePart)。CLI 无图片命令,只**原样透传保留**服务端下发的图片,
 * 避免回写时清空 App/Agent 加的图片。上传时后端只认 objectId,其余字段回显即可。
 */
export interface TodoImage {
  objectId?: string
  url?: string
  mimeType?: string
  name?: string
  description?: string
  abstract?: string
  data?: string
  sourceText?: string
}

/** 本地 todo 副本（standalone entry；recurring 字段第一部分恒空/0 预留）。 */
export interface TodoEntry {
  entryId: string
  title: string
  description: string
  category: string
  priority: Priority
  dueAt: number
  belongAt: number
  recurringId: string
  occurrenceAt: number
  subtasks: Subtask[]
  reminder: Reminder | null
  completedAt: number
  createdAt: number
  updatedAt: number
  /** AI 提案附带的 companion 口吻短提示（本地列、不同步；无则空串）。 */
  hint: string
  /** 图片引用（v2）。CLI 只透传保留；无则省略。 */
  images?: TodoImage[]
}

// 'hour' 为 v2 小时级重复(REPEAT_UNIT_HOUR)。CLI 的展开是按「天」的,无法创建/展开小时级规则,
// 但须能**无损识别并保留**别端建的小时规则(否则会被错当成 day 误展开)。见 recurrence.ts。
export type RepeatUnit = 'day' | 'week' | 'month' | 'year' | 'hour'

export interface RepeatRule {
  unit: RepeatUnit
  interval: number // >=1
  weekdays: number[] // ISO 1=Mon..7=Sun（仅 week 用）
  dayOfMonth: number // 1-31（month/year 用；0=种子日 day）
  monthOfYear: number // 1-12（year 用；0=种子月）
  endAt: number // Unix 秒，0=永不结束
}

export interface TodoRecurring {
  recurringId: string
  title: string
  description: string
  category: string
  priority: Priority
  dueAt: number
  belongAt: number
  subtasks: Subtask[]
  reminder: Reminder | null
  repeat: RepeatRule
  createdAt: number
  updatedAt: number
  /** 图片引用（v2）。CLI 只透传保留；无则省略。 */
  images?: TodoImage[]
}

/** create/update 的完整 todo 草案（不含 entry_id）。 */
export interface TodoDraft {
  title: string
  description?: string
  category?: string
  priority?: Priority
  dueAt?: number
  belongAt?: number
  subtasks?: Subtask[]
  reminder?: Reminder
  hint?: string
  repeat?: RepeatRule
}
