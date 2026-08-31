// dsh-boot —— 宿主侧启动引导钩子（web profile 内，经 App overlay --patch 的 insert 注入）。
// 首个可用 Agent 出现时定义一组进程级仓库 UI 插件；后续 agent/created 由进程级幂等挡住。
// 浏览器半由静态 dsh-client-bootstrap 通过 startUserRun 自动挂载：启动、服务重启与
// 页面重载都走同一条可信 Client 生命周期，不生成动态插件审批请求。
'use strict'

const Fs = require('node:fs')
const Path = require('node:path')

// 进程级幂等：每个包 key 只 define+run 一次。dsh web 启动可能发布多个 agent
// （恢复会话/前端激活各触发一次 agent/created），没有这个去重会重复定义插件，
// 同一 UI 被注入两份（曾出现两个 dsh-app-hub）。
const enabledKeys = new Set()
const enablingKeys = new Set()

function logFile(dshHome, line) {
  try {
    const p = Path.join(dshHome, 'hang-plugins', '.runtime', 'dsh-app-hub', 'dsh-boot.log')
    Fs.mkdirSync(Path.dirname(p), { recursive: true })
    Fs.appendFileSync(p, new Date().toISOString() + ' ' + line + '\n')
  } catch (e) { /* ignore */ }
}

module.exports = {
  inject: ['webServer'],
  apply(ctx) {
    const dshHome = process.env.DSH_HOME || Path.join(process.env.HOME, '.dsh')
    const repo = process.env.DSH_PLUGIN_REPO || Path.join(dshHome, 'hang-plugins')

    const parentPid = Number(process.env.DSH_PARENT_PID)
    if (Number.isSafeInteger(parentPid) && parentPid > 1) {
      const timer = setInterval(() => {
        try {
          process.kill(parentPid, 0)
        } catch (error) {
          logFile(dshHome, '[dsh-boot] parent exited -> SIGTERM web process pid=' + process.pid)
          process.kill(process.pid, 'SIGTERM')
        }
      }, 1000)
      ctx.effect(() => () => clearInterval(timer))
    }

    // 首个 Agent 诞生 → 定义进程级仓库 UI 插件（agent 只提供动态 registry 所需的 owner）
    ctx.on('agent/created', (payload) => {
      const agent = payload && payload.agent
      if (!agent) return
      setTimeout(() => enableAll(ctx, agent, null, repo, dshHome), 1500)
    })

    // 手动启用端点（webServer 经 inject 保证已就绪）
    const webServer = ctx.get('webServer')
    webServer.register({
      kind: 'exact',
      path: '/api/dsh-plugins/enable',
      handler: async (req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        try {
          const url = new URL(req.url, 'http://localhost')
          const want = url.searchParams.get('key')
          const agents = ctx.get('agents')
          let agent = null
          try { agent = agents ? agents.requireInitiator() : null } catch (e) { agent = null }
          if (!agent) {
            res.end(JSON.stringify({ ok: false, pending: true, error: 'no initiator agent' }))
            return
          }
          const out = await enableAll(ctx, agent, want ? want.split(',') : null, repo, dshHome)
          res.end(JSON.stringify({ ok: true, results: out }))
        } catch (e) {
          res.end(JSON.stringify({ ok: false, error: String((e && e.message) || e) }))
        }
      },
    })
  },
}

async function enableOne(runner, agent, meta, hostSrc, clientSrc) {
  if (!runner) return { ok: false, error: 'dynamicCordisRunner 不可用' }
  if (!agent) return { ok: false, pending: true, error: '没有可用会话 agent' }

  const prefix = Array.isArray(meta.matchPrefix) ? meta.matchPrefix : []
  const existing = (() => { try { return runner.listPlugins(agent) } catch (e) { return [] } })()
  const byBase = {}
  for (const p of existing || []) {
    const base = String(p.pluginId).split('-')[0]
    if (!byBase[base]) byBase[base] = p
  }
  let plugin = null
  for (const base of prefix) { if (byBase[base]) { plugin = byBase[base]; break } }
  if (plugin) {
    const target = plugin.currentPackageId || (plugin.packages && plugin.packages[plugin.packages.length - 1].packageId)
    if (target) {
      try {
        const current = runner.inspectPackage(agent, plugin.pluginId, target)
        const currentHost = (current.code && current.code.host) || ''
        const currentClient = (current.code && current.code.client) || ''
        if (currentHost !== hostSrc || currentClient !== clientSrc) {
          const def = runner.define({
            name: meta.name,
            purpose: meta.purpose,
            plugin: { kind: 'existing', pluginId: plugin.pluginId },
            code: { host: hostSrc || undefined, client: clientSrc || undefined },
            sessionId: agent.id,
          })
          return { ok: true, text: '已定义更新 ' + plugin.pluginId + '/' + def.packageId }
        }
        return { ok: true, text: '已定义 ' + plugin.pluginId }
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
    return { ok: true, text: '已定义 ' + def.pluginId + '/' + def.packageId }
  } catch (e) { return { ok: false, text: '启用失败：' + String((e && e.message) || e) } }
}

async function enableAll(ctx, agent, keys, repo, dshHome) {
  const runner = ctx.get('dynamicCordisRunner')
  if (!runner || !agent) return []
  const out = []
  if (!Fs.existsSync(Path.join(repo, 'packages'))) return out
  for (const dir of Fs.readdirSync(Path.join(repo, 'packages'))) {
    if (keys && !keys.includes(dir)) continue
    if (enabledKeys.has(dir) || enablingKeys.has(dir)) {
      out.push({ key: dir, ok: true, text: enabledKeys.has(dir) ? '已定义' : '定义中' })
      continue
    }
    const pkg = Path.join(repo, 'packages', dir)
    if (!Fs.existsSync(Path.join(pkg, 'meta.json'))) continue
    let meta
    try { meta = JSON.parse(Fs.readFileSync(Path.join(pkg, 'meta.json'), 'utf8')) } catch (e) { continue }
    if (meta.ui === false) continue
    const hostSrc = Fs.existsSync(Path.join(pkg, 'code.host.js')) ? Fs.readFileSync(Path.join(pkg, 'code.host.js'), 'utf8') : ''
    const clientSrc = Fs.existsSync(Path.join(pkg, 'code.client.js')) ? Fs.readFileSync(Path.join(pkg, 'code.client.js'), 'utf8') : ''
    if (!hostSrc && !clientSrc) continue
    enablingKeys.add(dir)
    let r
    try {
      r = await enableOne(runner, agent, meta, hostSrc, clientSrc)
    } finally {
      enablingKeys.delete(dir)
    }
    out.push({ key: dir, ...r })
    if (r && r.ok === true) enabledKeys.add(dir)
  }
  logFile(dshHome, '[dsh-boot] enableAll -> ' + JSON.stringify(out))
  return out
}
