// dsh-boot —— 宿主侧启动引导钩子（web profile 内，经 launcher --patch 注入）。
// 提供 GET /api/dsh-plugins/enable?key=<key>（可重复，缺省 = 全部）：
// 从 ~/.dsh/hang-plugins/packages/* 读取 meta/code，用动态 runner 对当前首会话 agent
// define + run 启用所有带 UI 的插件（meta.ui !== false）；无会话 agent 时返回 503。
'use strict'

const Fs = require('node:fs')
const Path = require('node:path')

module.exports = {
  apply(ctx) {
    const webServer = ctx.get('webServer')
    if (!webServer) {
      ctx.logger?.info?.('[dsh-boot] webServer 不可用，跳过端点注册')
      return
    }
    const home = process.env.DSH_HOME || process.env.HOME
    const repo = Path.join(home, '.dsh', 'hang-plugins')
    const agents = ctx.get('agents')
    const runner = ctx.get('dynamicCordisRunner')
    ctx.logger?.info?.('[dsh-boot] 已挂载：/api/dsh-plugins/enable @ ' + repo)

    webServer.register({
      kind: 'exact',
      path: '/api/dsh-plugins/enable',
      handler: async (req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        try {
          const url = new URL(req.url, 'http://localhost')
          const want = url.searchParams.get('key')
          const out = []
          if (!Fs.existsSync(repo)) {
            res.end(JSON.stringify({ ok: false, error: 'repo missing: ' + repo }))
            return
          }
          const keys = want ? want.split(',') : null
          for (const dir of Fs.readdirSync(Path.join(repo, 'packages'))) {
            if (keys && !keys.includes(dir)) continue
            const pkg = Path.join(repo, 'packages', dir)
            const metaPath = Path.join(pkg, 'meta.json')
            if (!Fs.existsSync(metaPath)) continue
            let meta
            try { meta = JSON.parse(Fs.readFileSync(metaPath, 'utf8')) } catch (e) { continue }
            if (meta.ui === false) continue
            if (meta.self === true) continue
            const hostSrc = Fs.existsSync(Path.join(pkg, 'code.host.js')) ? Fs.readFileSync(Path.join(pkg, 'code.host.js'), 'utf8') : ''
            const clientSrc = Fs.existsSync(Path.join(pkg, 'code.client.js')) ? Fs.readFileSync(Path.join(pkg, 'code.client.js'), 'utf8') : ''
            if (!hostSrc && !clientSrc) continue
            const result = await enableOne(runner, agents, meta, hostSrc, clientSrc)
            out.push({ key: dir, ...result })
          }
          res.end(JSON.stringify({ ok: true, results: out }))
        } catch (e) {
          res.end(JSON.stringify({ ok: false, error: String((e && e.message) || e) }))
        }
      },
    })
  },
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
