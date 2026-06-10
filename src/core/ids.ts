import { ulid } from 'ulid'

// id 命名空间:entry=`dsk_`+ULID、subtask=`sub_`、reminder=`rem_`。
export const newEntryId = (): string => `dsk_${ulid()}`
export const newSubtaskId = (): string => `sub_${ulid()}`
export const newReminderId = (): string => `rem_${ulid()}`
