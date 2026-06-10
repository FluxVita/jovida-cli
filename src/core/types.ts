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
}

export type RepeatUnit = 'day' | 'week' | 'month' | 'year'

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
