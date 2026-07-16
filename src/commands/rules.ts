// jovida rules — 触发器的管理面(list/add/rm/enable/disable/test)。
// 规则的「执行」在常驻守护里(嵌入式引擎,见 ../rules.ts);这里只增删查改 rules.json + 干跑预览。
import {
  loadRules,
  saveRules,
  matchRule,
  renderTemplate,
  parseWhen,
  newRuleId,
  validateRuleSpec,
  buildCreateArgv,
  buildCompleteArgv,
  TODO_EVENT_TYPES,
  TODO_DATA_FIELDS,
  RULES_FILE,
  type Rule,
  type Action,
  type Envelope,
  type NotifySpec,
  type CreateSpec,
  type DispatchSpec
} from '../core/rules'

// exec 不插值(靠 $JOVIDA_*),原样回显;create/complete 是 argv 数组(非 shell),渲染后回显安全;notify 模板渲染。
function renderActionPreview(act: Action, env: Envelope): Record<string, unknown> {
  if ('exec' in act) return { exec: act.exec }
  if ('create' in act) return { create: buildCreateArgv(act.create, env) }
  if ('complete' in act) return { complete: buildCompleteArgv(act.complete, env) }
  if ('dispatch' in act)
    return {
      dispatch: {
        prompt: renderTemplate(act.dispatch.prompt, env),
        ...(act.dispatch.cwd ? { cwd: renderTemplate(act.dispatch.cwd, env) } : {}),
        ...(act.dispatch.todo_id ? { todo_id: renderTemplate(act.dispatch.todo_id, env) } : {})
      }
    }
  return {
    notify: {
      title: act.notify.title ? renderTemplate(act.notify.title, env) : `Jovida · ${env.source}.${env.type}`,
      message: act.notify.message ? renderTemplate(act.notify.message, env) : env.title ?? '',
      subtitle: act.notify.subtitle ? renderTemplate(act.notify.subtitle, env) : undefined
    }
  }
}

export interface RulesArgs {
  action?: string // list | add | rm | enable | disable | test | spec
  positionals: string[] // rule id(rm/enable/disable)
  spec?: string // add: 整条 rule JSON(agent 友好,替代拼 flag)
  dryRun?: boolean // add: 只校验+预览,不落盘
  name?: string
  when?: string // 源.类型
  where?: string[] // field=expr(可重复)
  exec?: string[] // 动作命令(可重复→多个 exec 动作)
  notifyTitle?: string
  notifyMessage?: string
  subtitle?: string
  create?: string // create 动作:标题(模板);配 createWhen/priority/category
  createWhen?: string
  createPriority?: string
  createCategory?: string
  complete?: string // complete 动作:待办 id(模板,如 {id} / {data.entry_id})
  dispatch?: string // dispatch 动作:交给本地 agent worker 的 prompt(模板)
  dispatchCwd?: string
  dispatchTodo?: string
  cooldown?: number
  disabled?: boolean
  // test 用:合成信封
  envelope?: string // 整条信封 JSON(优先)
  source?: string
  type?: string
  title?: string
  data?: string // data JSON
  json?: boolean
}

function parseWhere(where: string[] | undefined): Record<string, string> | undefined {
  if (!where || where.length === 0) return undefined
  const out: Record<string, string> = {}
  for (const item of where) {
    const i = item.indexOf('=')
    if (i <= 0) throw new Error(`--where must be field=expr (e.g. --where title=~^feat): ${item}`)
    out[item.slice(0, i).trim()] = item.slice(i + 1)
  }
  return out
}

function buildActions(a: RulesArgs): Action[] {
  const acts: Action[] = []
  for (const cmd of a.exec ?? []) acts.push({ exec: cmd })
  if (a.notifyTitle || a.notifyMessage || a.subtitle) {
    const n: NotifySpec = {}
    if (a.notifyTitle) n.title = a.notifyTitle
    if (a.notifyMessage) n.message = a.notifyMessage
    if (a.subtitle) n.subtitle = a.subtitle
    acts.push({ notify: n })
  }
  if (a.create) {
    const c: CreateSpec = { title: a.create }
    if (a.createWhen) c.when = a.createWhen
    if (a.createPriority) c.priority = a.createPriority
    if (a.createCategory) c.category = a.createCategory
    acts.push({ create: c })
  }
  if (a.complete) acts.push({ complete: { id: a.complete } })
  if (a.dispatch) {
    const d: DispatchSpec = { prompt: a.dispatch }
    if (a.dispatchCwd) d.cwd = a.dispatchCwd
    if (a.dispatchTodo) d.todo_id = a.dispatchTodo
    acts.push({ dispatch: d })
  }
  return acts
}

function actionSummary(act: Action): string {
  if ('exec' in act) return `exec: ${act.exec}`
  if ('create' in act) {
    const c = act.create
    const extra = [c.when && `when ${c.when}`, c.priority && `priority ${c.priority}`, c.category && `category ${c.category}`].filter(Boolean).join(', ')
    return `create: ${c.title}${extra ? '  (' + extra + ')' : ''}`
  }
  if ('complete' in act) return `complete: ${act.complete.id}`
  if ('dispatch' in act) return `dispatch: "${act.dispatch.prompt.split('\n')[0].slice(0, 60)}"${act.dispatch.todo_id ? ` (todo ${act.dispatch.todo_id})` : ''}`
  const n = act.notify
  return `notify: ${n.title ?? '(default)'}${n.message ? ' — ' + n.message : ''}`
}

function ruleSummary(r: Rule): string {
  const where = r.where
    ? ' where ' +
      Object.entries(r.where)
        .map(([k, v]) => `${k}=${v}`)
        .join(' ')
    : ''
  const cd = r.cooldown_sec ? ` (cooldown ${r.cooldown_sec}s)` : ''
  const flag = r.enabled ? '●' : '○'
  const acts = r.do.map((a) => '    → ' + actionSummary(a)).join('\n')
  return `${flag} ${r.id}${r.name ? '  ' + r.name : ''}\n    when ${r.when}${where}${cd}\n${acts}`
}

function findRule(rules: Rule[], id: string): Rule {
  const r = rules.find((x) => x.id === id || x.id.endsWith(id))
  if (!r) throw new Error(`no rule matching id: ${id}`)
  return r
}

function buildTestEnvelope(a: RulesArgs): Envelope {
  if (a.envelope) {
    const env = JSON.parse(a.envelope) as Envelope
    if (!env.source || !env.type) throw new Error('--envelope must have source and type')
    return env
  }
  if (!a.source || !a.type)
    throw new Error('test needs --source and --type (or a full --envelope <json>)')
  let data: Record<string, unknown> | undefined
  if (a.data) data = JSON.parse(a.data) as Record<string, unknown>
  return { source: a.source, type: a.type, title: a.title, data }
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
        console.log(
          `no rules yet. add one:\n  jovida rules add --when todo.completed --where category==健身 --notify-title "打卡✅"\n(file: ${RULES_FILE})`
        )
        return
      }
      for (const r of rules) console.log(ruleSummary(r))
      return
    }

    case 'add': {
      // 两种入口:--spec 传整条 rule JSON(agent 友好,校验后落),或拼 flag(人友好)。
      let rule: Rule
      if (a.spec) {
        rule = validateRuleSpec(a.spec)
        if (a.disabled) rule.enabled = false
      } else {
        if (!a.when) throw new Error('add needs --when <source.type> (or --spec <rule-json>)')
        parseWhen(a.when) // 校验形状
        const actions = buildActions(a)
        if (actions.length === 0)
          throw new Error('add needs an action: --exec <cmd>, --notify-title, --create <title>, --complete <id>, and/or --dispatch <prompt>')
        rule = {
          id: newRuleId(),
          name: a.name,
          when: a.when,
          where: parseWhere(a.where),
          do: actions,
          enabled: a.disabled !== true,
          cooldown_sec: a.cooldown && a.cooldown > 0 ? a.cooldown : undefined
        }
      }
      if (a.dryRun) {
        // 只校验+预览,不落盘(agent 上线前自检)。
        if (json) console.log(JSON.stringify({ valid: true, dryRun: true, rule }))
        else console.log(`✓ valid (dry-run, not saved)\n${ruleSummary(rule)}`)
        return
      }
      const rules = loadRules()
      rules.push(rule)
      saveRules(rules)
      if (json) console.log(JSON.stringify({ added: rule }))
      else
        console.log(
          `✓ added rule ${rule.id}\n${ruleSummary(rule)}\n(the running daemon picks it up within seconds; start one with 'jovida daemon start')`
        )
      return
    }

    case 'spec': {
      // 协议自描述(供 agent grounding):信封形状、内置 todo 源词汇、规则 schema、动作环境/模板。
      const spec = {
        envelope: { source: 'string', type: 'string', title: 'string?', id: 'string?', at: 'unix-seconds?', data: 'object?' },
        sources: {
          todo: { note: 'built-in; the daemon emits these', types: TODO_EVENT_TYPES, dataFields: TODO_DATA_FIELDS },
          push: { note: "any `jovida emit <source> <type> [--title] [--id] [--data <json>]` — a hook/cron/script becomes a source" },
          poll: { note: "`jovida poll add …` runs a check on an interval and emits <source>.<type> on its false→true edge (weather/CI/file conditions); see 'jovida poll spec'" },
          stream: { note: "`jovida stream add …` supervises a long-lived command that prints one envelope JSON per line; see 'jovida stream spec'" }
        },
        rule: {
          when: '"<source>.<type>" | "<source>.*" | "<source>"',
          where: '{ "<field>": "<matcher>" } — AND-ed; field resolves top-level then data (bare "category" works); matcher: "~regex" | "=exact" | "substring"',
          do: '[ actions ] — run in order. one of: {"exec":"sh -c command"} | {"notify":{"title":"…","message":"…","subtitle":"…"}} | {"create":{"title":"…","when":"…","priority":"…","category":"…","desc":"…","hint":"…"}} | {"complete":{"id":"…"}} | {"dispatch":{"prompt":"…","cwd":"…","todo_id":"…"}} (queue a task for the local agent worker; see: jovida worker --help)',
          enabled: 'boolean (default true)',
          cooldown_sec: 'number? — min seconds between fires'
        },
        execEnv: ['JOVIDA_SOURCE', 'JOVIDA_TYPE', 'JOVIDA_TITLE', 'JOVIDA_ID', 'JOVIDA_AT', 'JOVIDA_TODAY', 'JOVIDA_TOMORROW', 'JOVIDA_<DATA_KEY>', 'JOVIDA_DATA'],
        templatePlaceholders: { where: 'notify + create + complete fields (NOT exec)', tokens: ['{title}', '{source}', '{type}', '{id}', '{data.x}', '{today}', '{tomorrow}'] },
        safety: 'exec is NOT string-interpolated (injection-safe): pass data via $JOVIDA_* env vars + the envelope JSON on stdin. notify/create/complete ARE {…}-templated but never touch a shell (create/complete run the CLI via argv array), so their templates are safe. Prefer create over `exec jovida create …` — it needs no shell-quoting.',
        apply: "jovida rules add --spec '<rule-json>' [--dry-run]"
      }
      if (json) {
        console.log(JSON.stringify(spec))
        return
      }
      console.log(JSON.stringify(spec, null, 2))
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
      // 干跑:用合成信封过一遍规则,打印命中项 + 渲染后的动作,不真执行。
      const env = buildTestEnvelope(a)
      const rules = loadRules()
      const hits = rules.filter((r) => matchRule(env, r))
      if (json) {
        console.log(
          JSON.stringify({
            envelope: env,
            matched: hits.map((r) => ({
              id: r.id,
              name: r.name,
              do: r.do.map((act) => renderActionPreview(act, env))
            }))
          })
        )
        return
      }
      console.log(`envelope: ${env.source}.${env.type}  title="${env.title ?? ''}"${env.data ? '  data=' + JSON.stringify(env.data) : ''}`)
      if (hits.length === 0) {
        console.log('→ no rules match')
        return
      }
      for (const r of hits) {
        console.log(`→ ${r.id}${r.name ? ' (' + r.name + ')' : ''} would fire:`)
        for (const act of r.do) {
          if ('exec' in act) console.log(`    exec: ${act.exec}`)
          else if ('create' in act) console.log(`    create → jovida ${buildCreateArgv(act.create, env).join(' ')}`)
          else if ('complete' in act) console.log(`    complete → jovida ${buildCompleteArgv(act.complete, env).join(' ')}`)
          else if ('dispatch' in act) console.log(`    dispatch → worker task: "${renderTemplate(act.dispatch.prompt, env)}"`)
          else {
            const title = act.notify.title ? renderTemplate(act.notify.title, env) : `Jovida · ${env.source}.${env.type}`
            const message = act.notify.message ? renderTemplate(act.notify.message, env) : env.title ?? ''
            console.log(`    notify: "${title}" — "${message}"`)
          }
        }
      }
      return
    }

    default:
      throw new Error(`unknown rules action: ${action} (use list|add|rm|enable|disable|test|spec)`)
  }
}
