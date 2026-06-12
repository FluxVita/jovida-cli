import { ulid } from 'ulid'

// id 命名空间:entry=`cli_`+ULID(标明本端来源)、subtask=`sub_`、reminder=`rem_`、循环「类」=`series_`+ULID。
export const newEntryId = (): string => `cli_${ulid()}`
export const newSubtaskId = (): string => `sub_${ulid()}`
export const newReminderId = (): string => `rem_${ulid()}`
export const newRecurringId = (): string => `series_${ulid()}`
