---
name: jovida-cli
description: 通过 `jovida` 命令行工具捕获和管理用户的 Jovida Daily 待办——新建/查看/修改/完成/删除(改动立即生效、无确认、无撤回)。当对话中出现行动项、待跟进事项或承诺,或用户要求记录 / 记住 / 整理某件事时使用。
allowed-tools: Bash(jovida:*)
---

> 这是英文版 `SKILL.md` 的中文对照版(双语并存)。实际生效的 skill 以 `<skills 根>/jovida-cli/SKILL.md`(英文)为准;本文供中文阅读与维护参考,内容与英文版保持同步。

# Jovida Daily 待办（CLI）

通过 shell 调用 `jovida` 命令,帮用户捕获和管理 **Jovida Daily** 待办。`jovida` 是操作用户账号的接口,改动会同步到用户的其他 Jovida 设备。

本 skill 教的是**语义**——何时动手、用哪个命令、如何组合。某命令的**确切参数**请跑 `jovida <命令> --help`(如 `jovida create --help`);那才是参数真相,且与已安装版本同步。本 skill 没提到的参数,先看 `--help` 再用。

> **若 `jovida` 命令不存在**,说明本机没装 CLI——提醒用户安装(见 jovida-cli README);别假装记下了什么。
> **登录是必须的(无匿名模式),而且替用户登录是你的活——你来做,别把命令甩给用户。** 不确定是否已登录就先跑 `jovida whoami`;若未登录(或任何命令以 `2`/`NOT_SIGNED_IN` 退出),走非阻塞两步:
>  1. 跑 `jovida login --no-wait`——它打开用户的浏览器并**立即返回**(给出短码+URL,**不**阻塞)。
>  2. 告诉用户在刚弹开的浏览器里登录并批准。
>  3. 每隔几秒轮询 `jovida login --check`(如 `sleep 3; jovida login --check`),直到它报告已登录;用 `jovida whoami` 确认。
>
> 仅当浏览器开不了(远程 / headless 会话)才回退为让用户自己跑 `jovida login` 并批准。无论哪种,别默默丢掉任务。**绝不把 token 写进命令行。**

## 核心心智模型——先读这段

- **写操作立即生效。** 没有提议/确认步骤:`create / update / complete / delete` 当即落到用户账号并同步各设备。说「我**已创建 / 已完成 / 已删除**……」,绝不说「我已提议……」。`complete` 可逆(`reopen`),但 **`delete` 是永久的、无撤回**——对它尤其谨慎。
- **只在用户明确想要该改动时才写。** 当意图或要素(做什么;哪天 / 截止 / 提醒时刻)确实含糊,**先问一个简短问题**,别用猜测填空。(「提醒我明天那件事」→ 先问*那件事是什么*、大概*几点*再写。)但别矫枉过正:已清楚时(「周五下午 6 点前交报告」)直接动手。
- **改之前先读。** `update / complete / delete` 需要**真实 `entry_id`**——先用 `jovida list` / `jovida view` 拿到并解析 JSON。**绝不猜 id。**
- **输出是机器可读的。** 非交互运行时(你就是),CLI 在 **stdout 输出 JSON**(解析它);错误走 **stderr**,形如 `{"error":{"code","message"}}` 并带非零退出码(`2` 未登录 · `3` 后端/网络 · `4` 不存在 · `1` 用法)。`--json` 可强制。

## 何时用——何时别用

当上下文里有**真实、可执行**的事项再动手:明确的行动项、待跟进或承诺(「我需要……」「记得……」「上线前检查……」),或用户要求记录 / 记住 / 整理某事、标记完成 / 删除某条。

别过度捕获:忽略假设、头脑风暴、已做完的事。拿不准是不是真任务时,先问,别写噪音。

## 概念

这些决定*你往命令里填什么*——要内化;参数拼写在 `--help` 里。

- **待办的时间有两种粒度(同一个 `--when`)。** 纯**日期**(`2026-06-05`)= 归属*那天*、无硬截止;带时刻的 **datetime**(`2026-06-05T18:00:00+08:00`)= 精确**截止**。你确切知道哪个就给哪个。别把「周三做但周五截止」拆开——若周五截止,它就是周五的待办。
- **提醒与时间分开,且提醒 ≠ 截止。** 提醒是*何时来提个醒*;每条须早于或等于待办的时间。「提醒我明天 X」= 明天的待办 + 明早一条提醒,**不**让 X 在那一刻截止。一条待办可带多个提醒。
- **待办可以重复。** 给一条待办加重复规则,它就成为一条**重复待办**:`create` 返回它的 `recurring_id`(而非 `entry_id`)。用 `jovida view <recurring_id>` 看规则、`jovida update <recurring_id>` 改规则。在 `list` 里,重复待办以它的**发生**呈现——即它在你查询窗口内落到的各个日期,每条带 `recurring_id` 标注。完成某次发生(`jovida complete <该发生 id>`)只勾掉那一天、例行继续(规则照常产生后续发生)。它用于真正的例行(「每个工作日站会」);几个互相独立的日期就建多条单独待办。
- **其余:** **子任务**把一件事拆成步骤;**category** 是分组标签;**priority** 为 none/low/medium/high;**hint** 是可选的一句话提示——仅在确有帮助时加。

## 命令速览

语义见下;确切参数跑 `jovida <命令> --help`。

- **`jovida list`** —— 列出待办(默认今天的 pending)。用 scope/status/range 放宽,或用 **`--query <文本>`(标题+描述)、`--category`、`--priority` 搜索/过滤**(带任一过滤时 scope+status 默认放开到 *all*)。JSON 带 **`total` + `has_more`**——若 `has_more` 为真说明被 `--limit` 截断了,应调大 `--limit` 或收窄查询,**别据此断定某条待办不存在**。加 `--full` 可一次拿全字段(无需再 `view`)。重复待办以带日期的**发生**呈现、带 `recurring_id` 标注:显式 `--scope range --from/--to` 列出该窗口内**每一次**发生;`today`/`upcoming` 只给每条例行的下一次发生。
- **`jovida view <entry_id>`** —— 单条待办完整详情(description、subtasks、提醒……)。改传重复待办的 `recurring_id` 则回看它的重复规则。
- **`jovida create "<标题>"`** —— 新建一条待办(**一次一条**;多条多次跑)。给它加重复规则则成为一条重复待办(返回 `recurring_id`)。
- **`jovida update <entry_id>`** —— 改待办的字段;**只改你传的字段**。`--remind` / `--subtask` 整列替换(子任务会按标题保留同名项的完成状态;单条子任务用下面的 `subtask`)。传 `recurring_id` 改重复待办(含重复规则);传**发生 id**(取自 `list`)则只改那一次发生(会把那天材料化;例行与其它发生不动)。要停掉例行的后续发生,给重复待办设 `--until`。传值只会设置/替换;要**清空**某字段(去掉时间、清空所有提醒、清空分组…)用对应的 `--clear-*`(见 `--help`)。
- **`jovida complete <id> [<id> …]`** —— 标记完成(一次传多个 id)。也可传重复待办某次发生的 id(取自 `list`)只勾掉那一天——它会把该次发生材料化,例行继续运行。
- **`jovida reopen <id> [<id> …]`** —— 重新打开已完成的待办(`complete` 的逆操作)。
- **`jovida subtask check|uncheck|add|rm <entry_id> …`** —— 勾选/取消/新增/删除单条子任务(按 id 或 `view` 里的 1-based 序号寻址)。
- **`jovida delete <id> [<id> …]`** —— 永久删除(一次传多个 id;**无撤回**)。要停掉一条例行,删它的 `recurring_id`——不能删单次发生。
- **`jovida whoami` / `login` / `logout`** —— 会话。**你自己**用非阻塞两步登录(`jovida login --no-wait` 再轮询 `jovida login --check`)——见开头登录说明;仅当开不了浏览器才回退为让用户自己跑。

## Workflows——如何组合命令

把用户的意图映射成一串操作;任何改动前先读。

- **从一条消息里捕获多个事项**(会议纪要、头脑倾倒):挑出*真正的*承诺,然后每条跑一次 `jovida create`。别把多件事塞进一条待办,也别把周边讨论记进去。
- **一个带步骤的交付物:** 给这个产出建**一条** `jovida create`,用 `--subtask` 列各步骤——当步骤同属一个结果时,别拆成多条独立待办。
- **修改或改期:** 先 `jovida list`(或 `view`)拿 `entry_id`,再 `jovida update`。挪截止改 `--when`。记住 `--remind` / `--subtask` 是整列替换。
- **勾掉某一步:** 先 `jovida view <id>` 看带序号的子任务,再 `jovida subtask check <id> <n>`(n 是序号,或子任务的 id)。
- **完成或清理:** 先 `jovida list` 看有哪些开着,再 `jovida complete`(做完)或 `jovida delete`(移除)——相关 id 一次全传。除非该项压根不是真任务,否则优先 `complete` 而非 `delete`;若误标完成,`jovida reopen` 可撤回(而 `delete` 无法撤回)。
- **例行(重复):** 给一条待办加重复规则,建一次即可。之后它在 `list` 里按各发生日期呈现(带 `recurring_id` 标注);`complete` 某次发生即勾掉那一天。几个不规则日期则建多条单独待办。
- **「我手头有啥?」** `jovida list`(今天,或放宽 scope),从 JSON 里汇总。只读——别写任何东西。

## 纪律

- 标题及含空格的值要加引号。标题/描述保持**单行纯文本**——经参数传换行或 shell 特殊字符会被破坏。
- **绝不把 token 写进命令**(会进 shell history / 进程列表)——`jovida login` 走交互式浏览器流,没有 token 要粘。
- `delete` 是幂等的:对不存在的 id 也报成功(不像 `complete`/`reopen` 会因 id 不存在而失败)。所以别因为 `delete`「成功」就断定那条待办曾经存在。
- 命令非零退出就别谎称成功——读错误并告知用户(exit `2` → 你自己走两步登录,见开头登录说明)。
