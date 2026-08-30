// dsh-boot —— 宿主侧启动引导钩子（web profile 内，经 App overlay --patch 的 insert 注入）。
// 新会话（agent/created）时自动 define+run 启用仓库 packages/ 下带 UI 的插件，
// 并提供 GET /api/dsh-plugins/enable 手动启用端点。
'use strict'

const Fs = require('node:fs')
const Path = require('node:path')

// 进程级幂等：每个包 key 只 define+run 一次。dsh web 启动可能发布多个 agent
// （恢复会话/前端激活各触发一次 agent/created），没有这个去重会重复定义插件，
// 同一 UI 被注入两份（曾出现两个 dsh-app-hub）。
const enabledKeys = new Set()

function logFile(home, line) {
  try {
    const p = Path.join(home, '.dsh', 'hang-plugins', '.runtime', 'dsh-app-hub', 'dsh-boot.log')
    Fs.mkdirSync(Path.dirname(p), { recursive: true })
    Fs.appendFileSync(p, new Date().toISOString() + ' ' + line + '\n')
  } catch (e) { /* ignore */ }
}

module.exports = {
  inject: ['webServer'],
  apply(ctx) {
    const home = process.env.DSH_HOME || process.env.HOME

    // 新会话诞生 → 自动启用仓库 UI 插件（agent 直接来自事件 payload）
    ctx.on('agent/created', (payload) => {
      const agent = payload && payload.agent
      if (!agent) return
      setTimeout(() => enableAll(ctx, agent, null, home), 1500)
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
          const out = await enableAll(ctx, agent, want ? want.split(',') : null, home)
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

async function enableAll(ctx, agent, keys, home) {
  const repo = Path.join(home, '.dsh', 'hang-plugins')
  const runner = ctx.get('dynamicCordisRunner')
  if (!runner || !agent) return []
  const out = []
  if (!Fs.existsSync(Path.join(repo, 'packages'))) return out
  for (const dir of Fs.readdirSync(Path.join(repo, 'packages'))) {
    if (keys && !keys.includes(dir)) continue
    if (enabledKeys.has(dir)) {
      out.push({ key: dir, ok: true, text: '已启用' })
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
    const r = await enableOne(runner, agent, meta, hostSrc, clientSrc)
    out.push({ key: dir, ...r })
    if (r && r.ok === true) enabledKeys.add(dir)
  }
  logFile(home, '[dsh-boot] enableAll -> ' + JSON.stringify(out))
  return out
}
