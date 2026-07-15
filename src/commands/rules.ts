// jovida rules — 待办即触发器的管理面(list/add/rm/enable/disable/test)。
// 规则的「执行」在常驻守护里(嵌入式引擎,见 ../rules.ts);这里只增删查改 rules.json + 干跑预览。
import {
  loadRules,
  saveRules,
  matchRule,
  eventContext,
  renderTemplate,
  newRuleId,
  RULES_FILE,
  ALL_EVENT_KINDS,
  type Rule,
  type RuleOn,
  type RuleEvent,
  type RuleEventKind,
  type RuleMatch
} from '../core/rules'
import type { Priority } from '../core/types'

export interface RulesArgs {
  action?: string // list | add | rm | enable | disable | test
  positionals: string[] // e.g. rule id for rm/enable/disable
  name?: string
  on?: string[] // 事件种类(可重复);add 用
  titleContains?: string
  category?: string
  priority?: string
  exec?: string
  notifyTitle?: string
  notifyMessage?: string
  subtitle?: string
  cooldown?: number
  disabled?: boolean
  // test 用:构造一个合成事件
  event?: string
  title?: string
  entryId?: string
  json?: boolean
}

const PRIORITIES = new Set<Priority>(['none', 'low', 'medium', 'high'])

function parseOn(on: string[] | undefined): RuleOn[] {
  const out: RuleOn[] = []
  for (const item of on ?? []) {
    for (const k of item.split(',').map((s) => s.trim()).filter(Boolean)) {
      if (k === '*' || (ALL_EVENT_KINDS as string[]).includes(k)) out.push(k as RuleOn)
      else throw new Error(`unknown event kind: ${k} (use ${ALL_EVENT_KINDS.join('|')} or *)`)
    }
  }
  return out
}

function buildMatch(a: RulesArgs): RuleMatch | undefined {
  const m: RuleMatch = {}
  if (a.titleContains) m.title_contains = a.titleContains
  if (a.category) m.category = a.category
  if (a.priority) {
    if (!PRIORITIES.has(a.priority as Priority)) throw new Error(`invalid priority: ${a.priority} (none|low|medium|high)`)
    m.priority = a.priority as Priority
  }
  return Object.keys(m).length ? m : undefined
}

function ruleSummary(r: Rule): string {
  const on = r.on.join(',')
  const m = r.match
  const filt = m
    ? ' where ' +
      [
        m.title_contains ? `title~"${m.title_contains}"` : '',
        m.category ? `category=${m.category}` : '',
        m.priority ? `priority=${m.priority}` : ''
      ]
        .filter(Boolean)
        .join(' ')
    : ''
  const act = [r.exec ? `exec: ${r.exec}` : '', r.notify ? 'notify' : ''].filter(Boolean).join(' + ')
  const cd = r.cooldown_sec ? ` (cooldown ${r.cooldown_sec}s)` : ''
  const flag = r.enabled ? '●' : '○'
  return `${flag} ${r.id}${r.name ? '  ' + r.name : ''}\n    on ${on}${filt} → ${act}${cd}`
}

function findRule(rules: Rule[], id: string): Rule {
  const r = rules.find((x) => x.id === id || x.id.endsWith(id))
  if (!r) throw new Error(`no rule matching id: ${id}`)
  return r
}

export function cmdRules(a: RulesArgs): void {
  const action = a.action ?? 'list'
  const json = a.json === true

  switch (action) {
    case 'list': {
      const rules = loadRules()
      if (json) {
        console.log(JSON.stringify({ rules, file: RULES_FILE }))
        return
      }
      if (rules.length === 0) {
        console.log(`no rules yet. add one:\n  jovida rules add --on completed --title-contains 跑步 --notify-title "打卡✅"\n(file: ${RULES_FILE})`)
        return
      }
      for (const r of rules) console.log(ruleSummary(r))
      return
    }

    case 'add': {
      const on = parseOn(a.on)
      if (on.length === 0) throw new Error('add needs at least one --on <event> (e.g. --on completed)')
      if (!a.exec && !a.notifyTitle && !a.notifyMessage && !a.subtitle)
        throw new Error('add needs an action: --exec <cmd> and/or --notify-title/--notify-message')
      const rule: Rule = {
        id: newRuleId(),
        name: a.name,
        on,
        match: buildMatch(a),
        exec: a.exec,
        notify:
          a.notifyTitle || a.notifyMessage || a.subtitle
            ? { title: a.notifyTitle, message: a.notifyMessage, subtitle: a.subtitle }
            : undefined,
        enabled: a.disabled !== true,
        cooldown_sec: a.cooldown && a.cooldown > 0 ? a.cooldown : undefined
      }
      const rules = loadRules()
      rules.push(rule)
      saveRules(rules)
      if (json) console.log(JSON.stringify({ added: rule }))
      else console.log(`✓ added rule ${rule.id}\n${ruleSummary(rule)}\n(takes effect on the running daemon within seconds; start one with 'jovida daemon start')`)
      return
    }

    case 'rm': {
      const id = a.positionals[0]
      if (!id) throw new Error('rm needs a rule id (see: jovida rules list)')
      const rules = loadRules()
      const r = findRule(rules, id)
      saveRules(rules.filter((x) => x.id !== r.id))
      if (json) console.log(JSON.stringify({ removed: r.id }))
      else console.log(`✓ removed rule ${r.id}`)
      return
    }

    case 'enable':
    case 'disable': {
      const id = a.positionals[0]
      if (!id) throw new Error(`${action} needs a rule id (see: jovida rules list)`)
      const rules = loadRules()
      const r = findRule(rules, id)
      r.enabled = action === 'enable'
      saveRules(rules)
      if (json) console.log(JSON.stringify({ [action + 'd']: r.id, enabled: r.enabled }))
      else console.log(`✓ ${action}d rule ${r.id}`)
      return
    }

    case 'test': {
      // 干跑:用合成事件过一遍规则,打印命中项 + 渲染后的动作,不真执行。
      const kind = (a.event ?? 'completed') as RuleEventKind
      if (!(ALL_EVENT_KINDS as string[]).includes(kind))
        throw new Error(`unknown --event: ${kind} (use ${ALL_EVENT_KINDS.join('|')})`)
      const ev: RuleEvent = {
        kind,
        todo: {
          entry_id: a.entryId ?? 'test_entry',
          title: a.title ?? '(test)',
          priority: a.priority ?? 'none',
          category: a.category ?? '',
          status: kind === 'completed' ? 'completed' : 'pending'
        }
      }
      const rules = loadRules()
      const hits = rules.filter((r) => matchRule(ev, r))
      if (json) {
        const ctx = eventContext(ev)
        console.log(
          JSON.stringify({
            event: ev,
            matched: hits.map((r) => ({
              id: r.id,
              name: r.name,
              exec: r.exec,
              notify: r.notify
                ? {
                    title: r.notify.title ? renderTemplate(r.notify.title, ctx) : `Jovida · ${ctx.event}`,
                    message: r.notify.message ? renderTemplate(r.notify.message, ctx) : ctx.title,
                    subtitle: r.notify.subtitle ? renderTemplate(r.notify.subtitle, ctx) : undefined
                  }
                : undefined
            }))
          })
        )
        return
      }
      const ctx = eventContext(ev)
      console.log(`event: ${ev.kind}  title="${ctx.title}" category="${ctx.category}" priority=${ctx.priority}`)
      if (hits.length === 0) {
        console.log('→ no rules match')
        return
      }
      for (const r of hits) {
        console.log(`→ ${r.id}${r.name ? ' (' + r.name + ')' : ''} would fire:`)
        if (r.notify) {
          const title = r.notify.title ? renderTemplate(r.notify.title, ctx) : `Jovida · ${ctx.event}`
          const message = r.notify.message ? renderTemplate(r.notify.message, ctx) : ctx.title
          console.log(`    notify: "${title}" — "${message}"`)
        }
        if (r.exec) console.log(`    exec: ${r.exec}`)
      }
      return
    }

    default:
      throw new Error(`unknown rules action: ${action} (use list|add|rm|enable|disable|test)`)
  }
}
