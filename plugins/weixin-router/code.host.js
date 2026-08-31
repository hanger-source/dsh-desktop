// weixin-router —— HOST 半（v5，2026-08-31）
//
// 架构：端点进程（endpoint/endpoint.mjs）负责微信协议轮询与发送，Host 只做
// 路由与处理，两者通过 jsonl 文件队列通信：
//   endpoint → host ：~/.dsh/weixin-chatroom/inbox.jsonl（入站消息）
//   host → endpoint ：~/.dsh/weixin-chatroom/outbox.jsonl（待发送回复）
//
// 对照方案（微信单窗口 · 多 Agent 交互）：
//   一 入站路由：默认管家、@ 切换焦点、焦点连续对话、@管家/主 切回、/agents —— createRouter + resolveTarget
//   二 出站：焦点内直接回；非焦点用 weixin_find_user 署名发信 —— execute 从 exec.agent 取真实调用者名
//   三 驻守：全局开关，开启后所有 Agent context 注入「联系渠道=微信」 —— createStandby + systemPrompt.context
//   四 聊天室：全量入出站 JSONL，与 dsh session 解耦 —— createChatRoom
//   五 检索：weixin_chat_search 按人员/关键词/方向 grep —— createChatRoom.searchChat（倒序取最近）
//   六 名册：人员 = ~/.agents/<名>/AGENTS.md 的工作区；找人/注册 —— createRoster + createRegistry（weixin_register_agent）
//
// v5 相对 v4 的新增与修复：
//   - 驻守开关（weixin_standby）持久化到 state.json，systemPrompt.context 以函数
//     形式按当前开关状态注入全局 context，对每个 Agent 的每次组装生效；
//   - 新增 weixin_register_agent 工具：在 ~/.agents/<名>/ 创建 AGENTS.md，注册后
//     /agents 与 @ 直接可用；
//   - weixin_find_user 署名改为真实调用者（exec.agent 的会话 id / 工作区名），
//     不再错署微信焦点；
//   - 其余沿用 v4：harness.defineTool、ctx.fs 读取、sh O_APPEND 追加、持久游标、
//     fs.stat 轮询、超时语义。
//
// 全部异步路径 try/catch，宁可失败也不崩宿主。

// ================= 配置（纯常量） =================
const ROOM = '/Users/fuhangbo/.dsh/weixin-chatroom'
const INBOX = ROOM + '/inbox.jsonl'
const OUTBOX = ROOM + '/outbox.jsonl'
const CHAT = ROOM + '/chat.jsonl'
const STATE = ROOM + '/state.json'
const AGENTS_DIR = '/Users/fuhangbo/.agents'
const ENDPOINT = '/Users/fuhangbo/.dsh/dsh-desktop/plugins/weixin-router/endpoint/endpoint.mjs'
const AGENT_TIMEOUT_MS = 120000
const POLL_MS = 800
const STANDBY_NOTE = '\n[system-reminder] 当前对话运行在微信通道：你的回复会直接发回微信用户，直接输出即可；不要使用询问/弹窗类工具。非焦点后台任务要联系用户时使用 weixin_find_user。[/system-reminder]\n'
const STANDBY_CONTEXT =
  '联系渠道=微信：你与用户的当前沟通通道是微信。焦点在微信对话内时直接输出即可，回复会发回微信；' +
  '非焦点（后台自主干活）时，需要联系用户必须用 weixin_find_user 发送署名消息，禁止只在输入框默默输出。'

// ================= 焦点路由（纯函数，无 ctx） =================
function resolveTarget(text, current) {
  const at = text.match(/^@(\S+)\s+([\s\S]+)$/)
  if (at) {
    const name = at[1]
    return {
      target: (name === '管家' || name === '主') ? '管家' : name,
      prompt: at[2].trim(),
      switched: name !== '管家' && name !== '主',
    }
  }
  return { target: current, prompt: text, switched: false }
}

// ================= 文件队列（依赖 ctx.fs / ctx.subprocess） =================
function createFileQueue(ctx) {
  async function readLines(file) {
    try {
      const target = await ctx.fs.resolve(file)
      const text = await ctx.fs.readText(target)
      return text.split('\n').filter(Boolean)
    } catch { return [] } // 文件不存在或读取失败 → 空列表
  }
  async function appendLine(file, obj) {
    const handle = ctx.subprocess.spawn({
      argv: ['/bin/sh', '-c', 'mkdir -p "$(dirname "$WX_FILE")"; printf "%s\\n" "$WX_LINE" >> "$WX_FILE"'],
      cwd: '/',
      env: { WX_FILE: file, WX_LINE: JSON.stringify(obj) },
      stdio: { stdin: 'ignore', stdout: { maxBytes: 65536 }, stderr: { maxBytes: 65536 } },
      graceMs: 10000,
    })
    const outcome = await handle.done
    if (outcome.exitCode !== 0) {
      throw new Error('append 失败 exit=' + outcome.exitCode + ' ' + handle.collected.stderr.readFrom(0).text.slice(0, 300))
    }
  }
  return { readLines, appendLine }
}

// ================= 持久化状态（游标 + 对话用户 + 驻守开关） =================
function createState(ctx) {
  const memory = { cursor: 0, chatWith: '', standby: true }
  async function load() {
    try {
      const target = await ctx.fs.resolve(STATE)
      const saved = JSON.parse(await ctx.fs.readText(target))
      if (Number.isFinite(saved.cursor)) memory.cursor = saved.cursor
      if (typeof saved.chatWith === 'string') memory.chatWith = saved.chatWith
      if (typeof saved.standby === 'boolean') memory.standby = saved.standby
    } catch { /* 首次运行 */ }
    return memory
  }
  async function save() {
    try {
      const target = await ctx.fs.resolve(STATE)
      await ctx.fs.writeText(target, JSON.stringify(memory))
    } catch (err) { console.error('[weixin-router] saveState: ' + String(err)) }
  }
  return { memory, load, save }
}

// ================= 聊天室（记录 + 尾部倒序搜索） =================
function createChatRoom(ctx) {
  const { readLines, appendLine } = createFileQueue(ctx)
  async function logChat(entry) {
    try {
      await appendLine(CHAT, Object.assign({ ts: new Date().toISOString() }, entry))
    } catch (err) { console.error('[weixin-router] logChat: ' + String(err)) }
  }
  async function searchChat(filter) {
    const lines = await readLines(CHAT)
    const out = []
    // 倒序扫描：取最近命中的 limit 条，避免全量收集
    for (let i = lines.length - 1; i >= 0; i--) {
      let e
      try { e = JSON.parse(lines[i]) } catch { continue }
      if (filter.agent && e.route !== filter.agent && e.from !== filter.agent && e.to !== filter.agent) continue
      if (filter.dir && e.dir !== filter.dir) continue
      if (filter.query && !(e.text || '').includes(filter.query)) continue
      out.push(e)
      if (filter.limit && out.length >= filter.limit) break
    }
    return out
  }
  return { logChat, searchChat }
}

// ================= roster（~/.agents 扫描，目录缺失容错） =================
function createRoster(ctx) {
  async function listRoster() {
    const out = [{ name: '管家', agenda: '微信默认管家：路由、找人、查聊天室' }]
    try {
      const dir = await ctx.fs.resolve(AGENTS_DIR)
      const entries = await ctx.fs.listDir(dir)
      for (const entry of entries) {
        if (entry.type !== 'directory') continue
        const name = entry.name
        let agenda = ''
        try {
          const md = await ctx.fs.readText(entry.target)
          const first = md.split('\n').find((l) => l.trim().startsWith('# '))
          if (first) agenda = first.trim().replace(/^#\s*/, '')
        } catch { /* 无 AGENTS.md */ }
        out.push({ name, agenda })
      }
    } catch { /* ~/.agents 不存在 */ }
    return out
  }
  return { listRoster }
}

// ================= 注册（六）：给一个 Agent 命名并建出 AGENTS.md 工作区 =================
function createRegistry(ctx) {
  async function registerAgent(name, agenda) {
    const safe = String(name || '').trim()
    if (!safe || !/^[\w\u4e00-\u9fa5-]{1,32}$/.test(safe)) {
      throw new Error('名字不合法：要求 1-32 位中文/字母/数字/下划线/连字符')
    }
    const dir = AGENTS_DIR + '/' + safe
    const md = '#' + safe + '\n\n' + String(agenda || '').trim() + '\n'
    const handle = ctx.subprocess.spawn({
      argv: ['/bin/sh', '-c', 'mkdir -p "$WX_DIR"; printf "%s" "$WX_MD" > "$WX_DIR/AGENTS.md"'],
      cwd: '/',
      env: { WX_DIR: dir, WX_MD: md },
      stdio: { stdin: 'ignore', stdout: { maxBytes: 65536 }, stderr: { maxBytes: 65536 } },
      graceMs: 10000,
    })
    const outcome = await handle.done
    if (outcome.exitCode !== 0) {
      throw new Error('注册失败 exit=' + outcome.exitCode + ' ' + handle.collected.stderr.readFrom(0).text.slice(0, 300))
    }
    return { name: safe, path: dir + '/AGENTS.md' }
  }
  return { registerAgent }
}

// ================= Agent runner（resume/create + followup + whenIdle） =================
function createAgentRunner(ctx) {
  async function agentOptions() {
    try {
      const dm = ctx.get('agentDefaultModel')
      const selection = dm && dm.currentSelection ? dm.currentSelection() : null
      if (selection) return { agentOptions: { provider: selection.provider, model: selection.model } }
    } catch { /* 默认模型 */ }
    return {}
  }
  async function getAgentHandle(target) {
    const agents = ctx.get('agents')
    if (!agents) throw new Error('agents 服务不可用')
    const sessionId = 'weixin~' + target
    try {
      return await agents.resume({ resumeSessionId: sessionId, ...(await agentOptions()) })
    } catch { /* 无持久会话，新建 */ }
    return agents.create({
      sessionId,
      meta: { cwd: target === '管家' ? undefined : AGENTS_DIR + '/' + target },
      ...(await agentOptions()),
    })
  }
  /**
   * 把一条微信消息交给目标 Agent，等待其处理完一轮，返回其文本回复。
   * 超时（AGENT_TIMEOUT_MS）时取消该 Agent 并明确报"处理超时"，而不是
   * 把被取消后的残缺输出当回复。
   */
  async function ask(target, prompt, note) {
    const handle = await getAgentHandle(target)
    const agent = handle.agent
    const firstSeq = agent.session.seq
    agent.followup({
      id: Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
      role: 'user',
      content: [{ type: 'text', text: note + prompt }],
      source: { kind: 'user' },
    })
    let timedOut = false
    const cancelTimer = ctx.setTimeout(() => {
      timedOut = true
      try { agent.cancel({ kind: 'user' }) } catch { /* 已结束 */ }
    }, AGENT_TIMEOUT_MS)
    try {
      await agent.whenIdle()
    } catch { /* whenIdle 自身失败 */ }
    cancelTimer()
    if (timedOut) return { text: '', error: 'Agent 处理超时（' + AGENT_TIMEOUT_MS / 1000 + 's）' }

    let text = ''
    let error
    for (const ev of agent.session.events) {
      if (ev.seq < firstSeq) continue
      if (ev.type === 'assistant/message') {
        const blocks = ev.data && ev.data.message && ev.data.message.content
        const joined = Array.isArray(blocks)
          ? blocks.filter((b) => b && b.type === 'text').map((b) => b.text).join('')
          : ''
        if (joined !== '') text = joined
      }
      if (ev.type === 'turn/end' && ev.data && ev.data.reason && ev.data.reason.kind === 'error') {
        error = JSON.stringify(ev.data.reason)
      }
    }
    return { text, error }
  }
  return { ask }
}

// ================= 驻守（三）：全局 context 注入 + 开关（持久化） =================
function createStandby(ctx, state) {
  async function set(enabled) {
    state.memory.standby = enabled === true
    await state.save()
    return state.memory.standby
  }
  // text 用函数：每次 Agent 组装 prompt 时按当前开关求值，开→注入，关→空
  function register() {
    return ctx.systemPrompt
      ? ctx.systemPrompt.context({
          name: 'weixin-router.standby',
          order: 200,
          text: () => state.memory.standby ? STANDBY_CONTEXT : '',
        })
      : null
  }
  return { get: () => state.memory.standby, set, register }
}

// ================= 路由器（入站处理 + 持久游标扫描） =================
function createRouter(ctx, chat, roster, state, standby, runner) {
  const { readLines, appendLine } = createFileQueue(ctx)
  const focus = { current: '管家' }
  let inboxSize = 0

  async function saveCursor() {
    try { await state.save() } catch (err) { console.error('[weixin-router] saveCursor: ' + String(err)) }
  }
  async function inboxSizeOf() {
    try {
      const info = await ctx.fs.stat(await ctx.fs.resolve(INBOX))
      return typeof info.size === 'number' ? info.size : -1
    } catch { return -1 }
  }

  async function handleInbound(entry) {
    const from = entry.from
    const contextToken = entry.contextToken || ''
    const trimmed = String(entry.text || '').trim()
    if (!trimmed || !from) return
    // 记住当前对话用户：weixin_find_user 需要真实收件人 id；仅当用户变化时才落盘
    if (state.memory.chatWith !== from) {
      state.memory.chatWith = from
      await state.save()
    }

    // /agents 列表
    if (trimmed === '/agents') {
      const rosterList = await roster.listRoster()
      const reply = ['🤖 人员列表（当前焦点：' + focus.current + '）：']
        .concat(rosterList.map((r) => '🤖' + r.name + (r.agenda ? '：' + r.agenda : '')))
        .join('\n')
      await chat.logChat({ dir: 'in', from: 'user', to: focus.current, text: trimmed, route: focus.current })
      await chat.logChat({ dir: 'out', from: focus.current, to: 'user', text: reply, route: focus.current })
      await appendLine(OUTBOX, { to: from, text: reply, contextToken })
      return
    }

    // /standby [on|off]：驻守开关（三）
    const standbyCmd = trimmed.match(/^\/standby\s*(\S*)$/)
    if (standbyCmd) {
      const arg = standbyCmd[1].toLowerCase()
      let reply
      if (arg === '' || arg === '?') {
        reply = '驻守当前' + (standby.get() ? '开启' : '关闭') + '：' +
          (standby.get() ? '所有 Agent context 已注入「联系渠道=微信」，非焦点必须用 weixin_find_user 联系你。' : '未注入联系渠道，后台 Agent 不强制走微信。') +
          '\n开关：/standby on 或 /standby off'
      } else if (arg === 'on') {
        await standby.set(true)
        reply = '✅ 驻守已开启：所有 Agent context 注入「联系渠道=微信」，非焦点必须用 weixin_find_user 联系你。'
      } else if (arg === 'off') {
        await standby.set(false)
        reply = '驻守已关闭：不再注入联系渠道，后台 Agent 不强制走微信。'
      } else {
        reply = '用法：/standby（查状态）、/standby on、/standby off'
      }
      await chat.logChat({ dir: 'in', from: 'user', to: focus.current, text: trimmed, route: focus.current })
      await chat.logChat({ dir: 'out', from: focus.current, to: 'user', text: reply, route: focus.current })
      await appendLine(OUTBOX, { to: from, text: reply, contextToken })
      return
    }

    const routed = resolveTarget(trimmed, focus.current)
    await chat.logChat({ dir: 'in', from: 'user', to: '@' + routed.target, text: routed.prompt, route: routed.target })
    try {
      const note = state.memory.standby ? STANDBY_NOTE : ''
      const result = await runner.ask(routed.target, routed.prompt, note)
      focus.current = routed.target
      const reply = result.error
        ? '（处理出错：' + String(result.error).slice(0, 300) + '）'
        : (result.text || '（没有产出回复）')
      await chat.logChat({ dir: 'out', from: routed.target, to: 'user', text: reply, route: routed.target })
      await appendLine(OUTBOX, { to: from, text: reply, contextToken })
    } catch (err) {
      const reply = '处理失败：' + String((err && err.message) || err).slice(0, 300)
      await appendLine(OUTBOX, { to: from, text: reply, contextToken })
      await chat.logChat({ dir: 'out', from: routed.target, to: 'user', text: reply, route: routed.target })
    }
  }

  // 轮询：先用 stat 比较字节数，没变化就不全量读文件
  async function scan() {
    const size = await inboxSizeOf()
    if (size === inboxSize) return
    inboxSize = size
    const lines = await readLines(INBOX)
    if (lines.length <= state.memory.cursor) return
    const fresh = lines.slice(state.memory.cursor)
    state.memory.cursor = lines.length
    for (const line of fresh) {
      let entry
      try { entry = JSON.parse(line) } catch { continue }
      try { await handleInbound(entry) } catch (err) {
        console.error('[weixin-router] inbound: ' + String(err))
      }
    }
    await saveCursor()
  }

  return {
    focus,
    appendLine,
    scan,
    init: async () => { await state.load() },
  }
}

// ================= endpoint 保活 =================
function createEndpointKeeper(ctx) {
  return async function ensureEndpoint() {
    try {
      const handle = ctx.subprocess.spawn({
        // [w]… 技巧避免 pgrep -f 匹配到自身 shell 的命令行
        argv: ['/bin/sh', '-c', 'mkdir -p /tmp/agent-logs; pgrep -f "[w]eixin-router/endpoint/endpoint.mjs" >/dev/null 2>&1 || { nohup node "' + ENDPOINT + '" >> /tmp/agent-logs/wxr-endpoint.log 2>&1 & }'],
        cwd: '/',
        stdio: { stdin: 'ignore', stdout: { maxBytes: 65536 }, stderr: { maxBytes: 65536 } },
        graceMs: 8000,
      })
      await handle.done
    } catch (err) { console.error('[weixin-router] ensureEndpoint: ' + String(err)) }
  }
}

// ================= 出站署名（二）：从调用者 Agent 推导显示名 =================
function agentDisplayName(exec) {
  try {
    const agent = exec && exec.agent
    if (!agent) return 'Agent'
    const id = String(agent.id || '')
    // 微信会话：weixin~名字
    const wx = id.match(/^weixin~(.+)$/)
    if (wx) return wx[1]
    // 工作区会话：取 cwd 的目录名
    const cwd = agent.session && agent.session.header && agent.session.header.cwd
    if (typeof cwd === 'string' && cwd) {
      const parts = cwd.split('/').filter(Boolean)
      if (parts.length) return parts[parts.length - 1]
    }
    return id || 'Agent'
  } catch { return 'Agent' }
}

// ================= 插件本体：apply 只做装配 =================
return {
  inject: ['fs', 'subprocess', 'tools', 'agents', 'agentDefaultModel', 'timer', 'systemPrompt'],
  apply(ctx) {
    const state = createState(ctx)
    const chat = createChatRoom(ctx)
    const roster = createRoster(ctx)
    const registry = createRegistry(ctx)
    const runner = createAgentRunner(ctx)
    const standby = createStandby(ctx, state)
    const router = createRouter(ctx, chat, roster, state, standby, runner)
    const ensureEndpoint = createEndpointKeeper(ctx)

    // ---- 工具（必须经 harness.defineTool 产出） ----
    if (ctx.tools) {
      const output = {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      }
      const toolsToRegister = [
        harness.defineTool({
          name: 'weixin_roster',
          description: '列出微信可用人员（🤖 Agent 列表）：默认管家 + ~/.agents/<名>/AGENTS.md 注册的人员。用户问"微信里能找谁/有哪些机器人"时使用。',
          parameters: { type: 'object', properties: {} },
          output: output,
          async execute() {
            try {
              const list = await roster.listRoster()
              return { current: router.focus.current, standby: standby.get(), roster: list }
            } catch (err) { return { error: String(err) } }
          },
        }),
        harness.defineTool({
          name: 'weixin_chat_search',
          description: '检索微信聊天室记录（~/.dsh/weixin-chatroom/chat.jsonl，全量入出站对白，结果按时间倒序）。参数：query 关键词；agent 限定 🤖 人员名；dir in=你发/out=回复；limit 上限。回答"我之前和 xx 说了什么"时使用。',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: '关键词' },
              agent: { type: 'string', description: '限定人员名' },
              dir: { type: 'string', description: 'in 或 out' },
              limit: { type: 'integer', description: '上限，默认 10' },
            },
          },
          output: output,
          async execute(args) {
            try {
              const matches = await chat.searchChat({
                query: args && args.query, agent: args && args.agent, dir: args && args.dir,
                limit: args && args.limit ? Number(args.limit) : 10,
              })
              return { count: matches.length, matches }
            } catch (err) { return { error: String(err) } }
          },
        }),
        harness.defineTool({
          name: 'weixin_find_user',
          description: '非焦点（后台/其他会话）的 Agent 通过微信主动联系用户，发送署名消息（🤖调用者名：内容）。只有当前不是微信焦点、且需要打扰用户时才使用；焦点对话直接输出回复，不要用本工具。发送到最近一位微信联系人。',
          parameters: {
            type: 'object',
            properties: { message: { type: 'string', description: '要发给用户的文本' } },
            required: ['message'],
          },
          output: output,
          async execute(args, exec) {
            try {
              const to = state.memory.chatWith
              if (!to) return { error: '还没有微信联系人：先让用户在微信里发一条消息，或由焦点 Agent 建立对话。' }
              const from = agentDisplayName(exec)
              const text = '🤖' + from + '：' + (args && args.message || '')
              await router.appendLine(OUTBOX, {
                to: to,
                text: text,
                contextToken: null,
                fromSelf: 'weixin~' + from,
              })
              await chat.logChat({ dir: 'out', from: from, to: 'user', text: text, route: from })
              return { ok: true, from, to, sent: text }
            } catch (err) { return { error: String(err) } }
          },
        }),
        harness.defineTool({
          name: 'weixin_standby',
          description: '驻守开关：开启后所有 Agent 的 context 注入「联系渠道=微信」（非焦点时必须用 weixin_find_user 联系你）。参数 enabled=是否开启。',
          parameters: {
            type: 'object',
            properties: { enabled: { type: 'boolean', description: 'true 开启驻守 / false 关闭' } },
            required: ['enabled'],
          },
          output: output,
          async execute(args) {
            try {
              const enabled = await standby.set(args && args.enabled === true)
              return { enabled }
            } catch (err) { return { error: String(err) } }
          },
        }),
        harness.defineTool({
          name: 'weixin_register_agent',
          description: '注册一个新 🤖 Agent 进名册：在 ~/.agents/<名>/ 创建 AGENTS.md（名字 + agenda），之后微信可直接 @它、/agents 也会列出。用于"找人后给它命名注册"。',
          parameters: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Agent 名（1-32 位中文/字母/数字/下划线/连字符）' },
              agenda: { type: 'string', description: '一句话职责描述' },
            },
            required: ['name', 'agenda'],
          },
          output: output,
          async execute(args) {
            try {
              const result = await registry.registerAgent(args && args.name, args && args.agenda)
              return { ok: true, agent: result }
            } catch (err) { return { error: String(err) } }
          },
        }),
      ]
      ctx.effect(() => {
        const stops = toolsToRegister.map((tool) => ctx.tools.register(tool))
        return () => { for (const stop of stops) { try { stop() } catch { /* 已解除 */ } } }
      })
      console.log('[weixin-router] 工具已注册（v5）')
    }

    // ---- 生命周期：恢复状态 + 注册驻守注入 + 保活 endpoint + 定时扫描 ----
    ctx.effect(() => {
      let disposeStandby = null
      void router.init().then(() => {
        disposeStandby = standby.register()
        void ensureEndpoint()
      }).catch((err) => console.error('[weixin-router] init: ' + String(err)))
      const stop = ctx.interval(() => {
        void router.scan().catch((err) => console.error('[weixin-router] scan: ' + String(err)))
      }, POLL_MS)
      return () => {
        stop()
        if (disposeStandby) { try { disposeStandby() } catch { /* 已解除 */ } }
      }
    })
  },
}