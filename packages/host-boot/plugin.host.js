// host-boot —— 无 UI 的声明式启动器（meta.ui=false，由 install.sh 装入官方预设目录自动加载）。
// 职责：宿主启动/新会话创建时，自动把仓库 packages/ 中所有“带 UI 的动态插件”
// （meta.ui !== false）逐个 define + run 启用；已运行的跳过、停用的重启。
// 这样带 UI 插件在宿主重启后也能自动恢复，无需 Agent/按钮。
module.exports = {
  apply(ctx) {
    console.log('[host-boot] 声明式启动器已挂载：将为仓库中的 UI 插件自动执行 define/run')
    boot(ctx).catch((e) => {
      console.error('[host-boot] 启动器失败：' + String((e && e.message) || e))
    })
  },
}

async function boot(ctx) {
  const REPO = '/Users/fuhangbo/.dsh/hang-plugins'
  const runner = ctx.get('dynamicCordisRunner')
  if (runner === undefined) {
    console.warn('[host-boot] dynamicCordisRunner 不可用，跳过')
    return
  }
  const agents = ctx.get('agents')
  let agent
  if (agents) {
    try { agent = agents.requireInitiator() } catch (e) { /* ignore */ }
    if (!agent) {
      try {
        const roots = agents.roots()
        agent = roots && roots[0]
      } catch (e) { /* ignore */ }
    }
  }
  if (!agent) {
    console.warn('[host-boot] 取不到当前会话 Agent，跳过自动启用')
    return
  }

  const sub = ctx.get('subprocess')
  if (sub === undefined) return
  const esc = (s) => JSON.stringify(String(s))
  const script = `
REPO=${esc(REPO)}
for dir in "$REPO"/packages/*/; do
  [ -d "$dir" ] || continue
  key=$(basename "$dir")
  [ -f "$dir/meta.json" ] || continue
  META=$(tr -d '\\n' < "$dir/meta.json")
  echo "PKG|$key|$META"
done
`
  const handle = sub.spawn({
    argv: ['/bin/bash', '-c', script],
    cwd: '/',
    stdio: { stdin: 'ignore', stdout: { maxBytes: 1048576 }, stderr: { maxBytes: 8192 } },
    graceMs: 2000,
  })
  const outcome = await handle.done
  const out = handle.collected.stdout.readFrom(0).text
  if (outcome.exitCode !== 0) {
    console.error('[host-boot] 枚举仓库失败：' + (out || 'exit ' + outcome.exitCode).slice(0, 300))
    return
  }

  // 当前已注册插件（按前缀索引）。
  let existing = []
  try { existing = runner.listPlugins(agent) } catch (e) { /* ignore */ }
  const byBase = {}
  for (const p of existing) {
    const base = String(p.pluginId).split('-')[0]
    if (!byBase[base]) byBase[base] = p
  }

  for (const line of out.split('\n')) {
    if (!line.startsWith('PKG|')) continue
    const parts = line.split('|')
    const key = parts[1]
    let meta = {}
    try { meta = JSON.parse(parts.slice(2).join('|')) } catch (e) { continue }
    if (meta.ui === false) continue          // 无 UI 声明式插件：已由预设自动加载，不在这管
    if (meta.self === true) continue          // 管理器由本启动器把 UI 版启起来? self=true 的包跳过 define 但应重启已有实例 → 不跳过，走下方 restart 分支

    // 读源码（base64）
    const read = await runRead(sub, esc, REPO, key)
    if (!read) continue
    const defRes = await enableOne(ctx, runner, agent, meta, read.hostSrc, read.clientSrc, byBase)
    if (defRes.ok) {
      console.log('[host-boot] ' + key + ' => ' + (defRes.text || 'ok'))
    } else if (defRes.pending) {
      console.warn('[host-boot] ' + key + ' 待批准：' + defRes.text)
    } else {
      console.error('[host-boot] ' + key + ' 失败：' + defRes.text)
    }
  }
}

async function runRead(sub, esc, repo, key) {
  const script = `
set -e
REPO=${esc(repo)}
NAME=${esc(key)}
DIR="$REPO/packages/$NAME"
[ -f "$DIR/code.host.js" ] || [ -f "$DIR/code.client.js" ] || exit 0
HOST64=''; CLIENT64=''
[ -f "$DIR/code.host.js" ] && HOST64=$(base64 < "$DIR/code.host.js" | tr -d '\\n')
[ -f "$DIR/code.client.js" ] && CLIENT64=$(base64 < "$DIR/code.client.js" | tr -d '\\n')
echo "HOST64=$HOST64"
echo "CLIENT64=$CLIENT64"
`
  const handle = sub.spawn({
    argv: ['/bin/bash', '-c', script],
    cwd: '/',
    stdio: { stdin: 'ignore', stdout: { maxBytes: 1048576 }, stderr: { maxBytes: 8192 } },
    graceMs: 2000,
  })
  const outcome = await handle.done
  const out = handle.collected.stdout.readFrom(0).text
  if (outcome.exitCode !== 0) return null
  let host64 = ''
  let client64 = ''
  for (const l of out.split('\n')) {
    if (l.startsWith('HOST64=')) host64 = l.slice('HOST64='.length)
    else if (l.startsWith('CLIENT64=')) client64 = l.slice('CLIENT64='.length)
  }
  if (!host64 && !client64) return null
  return {
    hostSrc: host64 ? atob(host64) : '',
    clientSrc: client64 ? atob(client64) : '',
  }
}

async function enableOne(ctx, runner, agent, meta, hostSrc, clientSrc, byBase) {
  const matchA = Array.isArray(meta.matchPrefix) ? meta.matchPrefix : []
  let plugin = null
  for (const base of matchA) {
    if (byBase[base]) { plugin = byBase[base]; break }
  }
  // 运行中 → 跳过
  if (plugin && plugin.activeRun) return { ok: true, text: '已运行 ' + plugin.pluginId }
  // 停用 → 重启
  if (plugin) {
    const target = plugin.currentPackageId || (plugin.packages ? plugin.packages[plugin.packages.length - 1].packageId : null)
    if (target) {
      try {
        const runRes = await runner.run(agent, plugin.pluginId, target, 'run')
        if (runRes && runRes.ok === false) return { ok: false, text: runRes.message || runRes.reason || '重启失败' }
        return { ok: true, text: '已重启 ' + plugin.pluginId }
      } catch (e) { return { ok: false, text: String((e && e.message) || e) } }
    }
  }
  // 新定义并激活
  let def
  try {
    def = runner.define({
      name: meta.name,
      purpose: meta.purpose,
      plugin: { kind: 'new', idPrefix: meta.idPrefix },
      code: { host: hostSrc || void 0, client: clientSrc || void 0 },
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