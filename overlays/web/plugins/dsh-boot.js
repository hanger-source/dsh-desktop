// dsh-boot —— 宿主侧启动引导钩子（web profile 内，经 launcher --patch 注入）。
// 提供 GET /api/dsh-plugins/enable?key=<key>（可重复，缺省 = 全部）：
// 从 ~/.dsh/hang-plugins/packages/* 读取 meta/code，用动态 runner 对当前首会话 agent
// define + run 启用所有带 UI 的插件（meta.ui !== false）；无会话 agent 时返回 503。
'use strict'

const Fs = require('node:fs')
const Path = require('node:path')

module.exports = {
  apply(ctx) {
    // 父进程监控：DSH.app 通过 DSH_PARENT_PID 告诉 dsh web 自己的 PID，
    // dsh web 每 2 秒检查父进程是否存活；父进程退出（⌘Q 或强杀）→ 自行关闭。
    // 这是"退出 App = 关闭服务"的兜底，不依赖 App 主线程是否响应。
    const parentPid = Number(process.env.DSH_PARENT_PID || 0)
    if (parentPid > 0) {
      const parentTimer = setInterval(() => {
        try {
          process.kill(parentPid, 0)
        } catch (e) {
          if (e && e.code === 'ESRCH') {
            ctx.logger?.info?.('[dsh-boot] 父进程(DSH.app)已退出，dsh web 自行关闭')
            process.exit(0)
          }
        }
      }, 2000)
      ctx.on('dispose', () => clearInterval(parentTimer))
      ctx.logger?.info?.('[dsh-boot] 父进程监控已开启 pid=' + parentPid)
    }

    const home = process.env.DSH_HOME || process.env.HOME
    const repo = Path.join(home, '.dsh', 'hang-plugins')
    const agents = ctx.get('agents')
    const runner = ctx.get('dynamicCordisRunner')

    // 新会话诞生 → 自动启用仓库 UI 插件（尽早挂，不依赖 webServer 是否就绪）
    ctx.on('agent/created', (payload) => {
      const agent = payload && payload.agent
      if (!agent) return
      setTimeout(async () => {
        try {
          const results = await enableAll(runner, agent, null)
          ctx.logger?.info?.('[dsh-boot] auto-enable on new session: ' + JSON.stringify(results))
        } catch (e) {
          ctx.logger?.warn?.('[dsh-boot] auto-enable failed: ' + String((e && e.message) || e))
        }
      }, 1500)
    })

    // 启动兜底：若进程启动时已恢复活动会话（恢复不触发 agent/created），主动启用一次
    setTimeout(async () => {
      try {
        const agent = pickAgent(agents)
        if (!agent) return
        const results = await enableAll(runner, agent, null)
        ctx.logger?.info?.('[dsh-boot] startup auto-enable: ' + JSON.stringify(results))
      } catch (e) {
        ctx.logger?.warn?.('[dsh-boot] startup auto-enable failed: ' + String((e && e.message) || e))
      }
    }, 3000)

    // webServer 可能晚于本插件 apply：轮询等待就绪后再注册端点，避免端点丢失
    registerEndpoint(ctx, home, agents, runner)
  },
}

function registerEndpoint(ctx, home, agents, runner) {
  const webServer = ctx.get('webServer')
  if (!webServer) {
    setTimeout(() => registerEndpoint(ctx, home, agents, runner), 500)
    return
  }
  ctx.logger?.info?.('[dsh-boot] 已挂载：/api/dsh-plugins/enable @ ' + Path.join(home, '.dsh', 'hang-plugins'))

  webServer.register({
    kind: 'exact',
    path: '/api/dsh-plugins/enable',
    handler: async (req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      try {
        const url = new URL(req.url, 'http://localhost')
        const want = url.searchParams.get('key')
        const agent = pickAgent(agents)
        if (!agent) {
          res.end(JSON.stringify({ ok: false, pending: true, error: 'no live session agent yet' }))
          return
        }
        const out = await enableAll(runner, agent, want ? want.split(',') : null)
        res.end(JSON.stringify({ ok: true, results: out }))
      } catch (e) {
        res.end(JSON.stringify({ ok: false, error: String((e && e.message) || e) }))
      }
    },
  })
}

async function enableOne(runner, agents, meta, hostSrc, clientSrc) {
  if (!runner) return { ok: false, error: 'dynamicCordisRunner 不可用' }
  let agent = null
  try {
    if (agents) {
      try { agent = agents.requireInitiator() } catch (e) { agent = null }
      if (!agent) {
        const roots = agents.roots()
        agent = roots && roots[0] || null
      }
    }
  } catch (e) { /* ignore */ }
  if (!agent) return { ok: false, pending: true, error: '没有可用会话 agent（请打开一个会话后再试）' }

  const prefix = Array.isArray(meta.matchPrefix) ? meta.matchPrefix : []
  const existing = (() => { try { return runner.listPlugins(agent) } catch (e) { return [] } })()
  const byBase = {}
  for (const p of existing || []) {
    const base = String(p.pluginId).split('-')[0]
    if (!byBase[base]) byBase[base] = p
  }
  let plugin = null
  for (const base of prefix) { if (byBase[base]) { plugin = byBase[base]; break } }
  if (plugin && plugin.activeRun) return { ok: true, text: '已运行 ' + plugin.pluginId }
  if (plugin) {
    const target = plugin.currentPackageId || (plugin.packages && plugin.packages[plugin.packages.length - 1].packageId)
    if (target) {
      try {
        const runRes = await runner.run(agent, plugin.pluginId, target, 'run')
        if (runRes && runRes.ok === false) return { ok: false, text: runRes.message || runRes.reason || '重启失败' }
        return { ok: true, text: '已重启 ' + plugin.pluginId }
      } catch (e) { return { ok: false, text: String((e && e.message) || e) } }
    }
  }
  let def
  try {
    def = runner.define({
      name: meta.name,
      purpose: meta.purpose,
      plugin: { kind: 'new', idPrefix: meta.idPrefix },
      code: { host: hostSrc || undefined, client: clientSrc || undefined },
      sessionId: agent.id,
    })
  } catch (e) { return { ok: false, text: '定义失败：' + String((e && e.message) || e) } }
  try {
    const runRes = await runner.run(agent, def.pluginId, def.packageId, 'run')
    if (runRes && runRes.ok === false) {
      const pending = /approv|pending/i.test(String(runRes.reason || runRes.message || ''))
      return { ok: false, pending, text: runRes.message || runRes.reason || '启动失败' }
    }
    return { ok: true, text: '已启用 ' + def.pluginId }
  } catch (e) { return { ok: false, text: '启用失败：' + String((e && e.message) || e) } }
}


function pickAgent(agents) {
  if (!agents) return null
  try {
    try { return agents.requireInitiator() } catch (e) { /* ignore */ }
    const roots = agents.roots()
    return (roots && roots[0]) || null
  } catch (e) {
    return null
  }
}

async function enableAll(runner, agent, keys) {
  if (!runner || !agent) return []
  const home = process.env.DSH_HOME || process.env.HOME
  const repo = Path.join(home, '.dsh', 'hang-plugins')
  const out = []
  if (!Fs.existsSync(Path.join(repo, 'packages'))) return out
  for (const dir of Fs.readdirSync(Path.join(repo, 'packages'))) {
    if (keys && !keys.includes(dir)) continue
    const pkg = Path.join(repo, 'packages', dir)
    if (!Fs.existsSync(Path.join(pkg, 'meta.json'))) continue
    let meta
    try { meta = JSON.parse(Fs.readFileSync(Path.join(pkg, 'meta.json'), 'utf8')) } catch (e) { continue }
    if (meta.ui === false) continue
    if (meta.self === true) continue
    const hostSrc = Fs.existsSync(Path.join(pkg, 'code.host.js')) ? Fs.readFileSync(Path.join(pkg, 'code.host.js'), 'utf8') : ''
    const clientSrc = Fs.existsSync(Path.join(pkg, 'code.client.js')) ? Fs.readFileSync(Path.join(pkg, 'code.client.js'), 'utf8') : ''
    if (!hostSrc && !clientSrc) continue
    out.push({ key: dir, ...(await enableOne(runner, agent, meta, hostSrc, clientSrc)) })
  }
  return out
}
