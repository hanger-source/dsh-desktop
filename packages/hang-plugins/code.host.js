// hang-plugins —— HOST 半（当前最新版）
//
// 内容即 cordis_define 的 code.host 函数体。功能：
// 管理 ~/.dsh/hang-plugins 插件仓库（git pull + skills 同步）、列出插件，
// 统一启停：停用=runner.stop，重启=runner.run，未启用=define+run 自动激活。
return {
  inject: ['subprocess'],
  async apply(ctx) {
    const homeRaw = await runBash('printf "%s" "${DSH_HOME:-$HOME/.dsh}"')
    const home = (homeRaw.out || '').trim() || '/Users/fuhangbo/.dsh'
    const REPO = home + '/hang-plugins'
    const REMOTE = 'https://github.com/hanger-source/dsh-plugins.git'
    const HOME = '/Users/fuhangbo/.dsh'

    async function runBash(script) {
      const handle = ctx.subprocess.spawn({
        argv: ['/bin/bash', '-c', script],
        cwd: '/',
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes: 1048576 },
          stderr: { maxBytes: 8192 },
        },
        graceMs: 2000,
      })
      const outcome = await handle.done
      const out = handle.collected.stdout.readFrom(0).text
      const err = handle.collected.stderr.readFrom(0).text
      if (outcome.exitCode !== 0) {
        throw new Error('命令失败(' + outcome.exitCode + ')：' + (err || out).slice(0, 400))
      }
      return { out, err }
    }

    const esc = (s) => JSON.stringify(String(s))

    function currentAgent() {
      const agents = ctx.get('agents')
      let agent
      if (agents) {
        try { agent = agents.requireInitiator() } catch (e) { /* 无 initiator */ }
        if (!agent) {
          try {
            const roots = agents.roots()
            agent = roots && roots[0]
          } catch (e) { /* ignore */ }
        }
      }
      return agent
    }

    function allPlugins() {
      const runner = ctx.get('dynamicCordisRunner')
      const agent = currentAgent()
      if (!runner || !agent) return []
      try { return runner.listPlugins(agent) } catch (e) { return [] }
    }

    const READ_SCRIPT = (repo, name) => `
set -e
REPO=${esc(repo)}
NAME=${esc(name)}
DIR="$REPO/packages/$NAME"
if [ ! -f "$DIR/meta.json" ]; then echo "ERR=MISSING_META"; exit 0; fi
HOST64=$(base64 < "$DIR/code.host.js" | tr -d '\n')
CLIENT64=$(base64 < "$DIR/code.client.js" | tr -d '\n')
META=$(tr -d '\n' < "$DIR/meta.json")
echo "HOST64=$HOST64"
echo "CLIENT64=$CLIENT64"
echo "META=$META"
`

    const LIST_SCRIPT = (repo) => `
REPO=${esc(repo)}
if [ -d "$REPO/.git" ]; then
  echo "REPO_EXISTS=1"
  echo "COMMIT=$(git -C "$REPO" rev-parse --short HEAD 2>/dev/null || echo unknown)"
else
  echo "REPO_EXISTS=0"
fi
for dir in "$REPO"/packages/*/; do
  [ -d "$dir" ] || continue
  key=$(basename "$dir")
  META=$(tr -d '\n' < "$dir/meta.json" 2>/dev/null || echo '{}')
  echo "PKG|$key|$META"
done
`

    async function readLines(script) {
      const { out } = await runBash(script)
      return out.split('\n').filter((l) => l.length > 0)
    }

    harness.handle('pstore.list', async () => {
      const lines = await readLines(LIST_SCRIPT(REPO))
      const res = { repoPath: REPO, remote: REMOTE, repoExists: false, commit: null, packages: [] }

      const plugins = allPlugins()
      const byBase = {}
      for (const p of plugins) {
        const base = String(p.pluginId).split('-')[0]
        if (!byBase[base]) byBase[base] = p
      }

      for (const line of lines) {
        if (line.startsWith('REPO_EXISTS=')) res.repoExists = line.endsWith('=1')
        else if (line.startsWith('COMMIT=')) res.commit = line.slice('COMMIT='.length)
        else if (line.startsWith('PKG|')) {
          const parts = line.split('|')
          const key = parts[1]
          let meta = {}
          try { meta = JSON.parse(parts.slice(2).join('|')) } catch (e) { /* 空 meta */ }
          // 管理器自身不展示（存在即启用，避免与仓库实例冲突）。
          if (meta.self === true) continue
          if (meta.ui === false) continue // 声明式插件：由 install.sh 装入官方预设自动加载，管理页不列
          const matchA = Array.isArray(meta.matchPrefix) ? meta.matchPrefix : []
          let found = null
          for (const base of matchA) {
            if (byBase[base]) { found = byBase[base]; break }
          }
          res.packages.push({
            key,
            name: meta.name || key,
            purpose: meta.purpose || '',
            pluginId: found ? found.pluginId : null,
            state: found ? (found.activeRun ? 'running' : 'stopped') : null,
          })
        }
      }
      return res
    })

    // 当前管理器自身的插件记录（用于自检变更）。
    function selfPlugin(plugins) {
      const me = 'hang-plugins 管理器'
      for (const p of plugins) if (p.name === me) return p
      return null
    }

    // 管理器自身源码是否与仓库最新一致。
    async function selfChanged(agent, selfPkgId) {
      const runner = ctx.get('dynamicCordisRunner')
      if (!runner || !selfPkgId) return false
      let current = null
      try {
        current = runner.inspectPackage(agent, selfPkgId, runner.inspectPlugin(agent, selfPkgId).currentPackageId)
      } catch (e) { return false }
      const read = await readPkgSource(REPO, 'hang-plugins')
      if (!read) return false
      const curHost = (current.code && current.code.host) || ''
      const curClient = (current.code && current.code.client) || ''
      return curHost !== read.host || curClient !== read.client
    }

    // 读一个包的最新源码（返回 {host, client}）。REPO 已在 apply 中解析。
    async function readPkgSource(repo, key) {
      const lines = await readLines(READ_SCRIPT(repo, key))
      let host64 = ''
      let client64 = ''
      for (const line of lines) {
        if (line.startsWith('HOST64=')) host64 = line.slice('HOST64='.length)
        else if (line.startsWith('CLIENT64=')) client64 = line.slice('CLIENT64='.length)
      }
      if (!host64 && !client64) return null
      return { host: host64 ? atob(host64) : '', client: client64 ? atob(client64) : '' }
    }

    harness.handle('pstore.pull', async () => {
      const script = `
set -e
REPO=${esc(REPO)}
REMOTE=${esc(REMOTE)}
SKILL_DST=${esc(HOME)}/skills
if [ ! -d "$REPO/.git" ]; then
  git clone --quiet "$REMOTE" "$REPO"
  CHANGED=0
else
  BEFORE=$(git -C "$REPO" rev-parse --short HEAD 2>/dev/null || echo unknown)
  git -C "$REPO" pull --quiet
  AFTER=$(git -C "$REPO" rev-parse --short HEAD 2>/dev/null || echo unknown)
  if [ "$BEFORE" = "$AFTER" ]; then CHANGED=0; else CHANGED=1; fi
fi
COMMIT=$(git -C "$REPO" rev-parse --short HEAD 2>/dev/null || echo unknown)
if [ -d "$REPO/skills" ]; then
  mkdir -p "$SKILL_DST"
  for dir in "$REPO"/skills/*/; do
    [ -d "$dir" ] || continue
    name=$(basename "$dir")
    rm -rf "$SKILL_DST/$name"
    mkdir -p "$SKILL_DST/$name"
    cp -R "$dir"/* "$SKILL_DST/$name"/ 2>/dev/null || true
  done
fi
echo "COMMIT=$COMMIT"
echo "CHANGED=$CHANGED"
`
      const lines = await readLines(script)
      const res = { ok: true, commit: null, changed: 0, selfChanged: false }
      for (const line of lines) {
        if (line.startsWith('COMMIT=')) res.commit = line.slice('COMMIT='.length)
        else if (line.startsWith('CHANGED=')) res.changed = Number(line.slice('CHANGED='.length))
      }
      const agent = currentAgent()
      const self = agent ? selfPlugin(allPlugins()) : null
      res.selfChanged = self && self.pluginId ? await selfChanged(agent, self.pluginId) : false
      return res
    })

    // 用仓库最新源码重载管理器自身（先建新实例，成功后再移除旧实例）。
    harness.handle('pstore.reloadSelf', async () => {
      const runner = ctx.get('dynamicCordisRunner')
      const agent = currentAgent()
      if (!runner || !agent) return { ok: false, error: '运行环境不可用' }
      const self = selfPlugin(allPlugins())
      if (!self) return { ok: false, error: '未找到管理器自身实例' }
      const meta = { name: 'hang-plugins 管理器', purpose: 'Hang 的插件管理器：同步仓库、启停与状态管理、shell 入口', idPrefix: 'hang', matchPrefix: ['pstore', 'hang'], self: true }
      const src = await readPkgSource(REPO, 'hang-plugins')
      if (!src) return { ok: false, error: '读取最新源码失败' }
      let def
      try {
        def = runner.define({
          name: meta.name,
          purpose: meta.purpose,
          plugin: { kind: 'new', idPrefix: meta.idPrefix },
          code: { host: src.host || void 0, client: src.client || void 0 },
          sessionId: agent.id,
        })
      } catch (e) { return { ok: false, error: '定义失败：' + String((e && e.message) || e) } }
      try {
        const runRes = await runner.run(agent, def.pluginId, def.packageId, 'run')
        if (runRes && runRes.ok === false) return { ok: false, error: runRes.message || runRes.reason || '新实例启动失败' }
      } catch (e) { return { ok: false, error: '新实例启动失败：' + String((e && e.message) || e) } }
      try { await runner.undefine(agent, self.pluginId) } catch (e) { /* 旧实例移除失败不影响新实例 */ }
      return { ok: true, text: '已重载为最新版：' + def.pluginId }
    })

    // 启停切换：未启用→新建激活；已停用→重启；运行中→停用。
    harness.handle('pstore.toggle', async (args) => {
      const key = args && args.key
      const givenPluginId = args && args.pluginId
      if (!key) return { ok: false, error: '缺少插件标识' }
      const runner = ctx.get('dynamicCordisRunner')
      if (!runner) return { ok: false, error: '宿主插件运行器不可用' }
      const agent = currentAgent()
      if (!agent) return { ok: false, error: '取不到当前会话 Agent' }

      let meta = {}
      let hostSrc = ''
      let clientSrc = ''
      let plugin = null

      const lines = await readLines(READ_SCRIPT(REPO, key))
      let host64 = ''
      let client64 = ''
      let metaRaw = ''
      for (const line of lines) {
        if (line.startsWith('ERR=')) return { ok: false, error: line.slice('ERR='.length) === 'MISSING_META' ? '该插件缺少 meta.json' : line.slice('ERR='.length) }
        else if (line.startsWith('HOST64=')) host64 = line.slice('HOST64='.length)
        else if (line.startsWith('CLIENT64=')) client64 = line.slice('CLIENT64='.length)
        else if (line.startsWith('META=')) metaRaw = line.slice('META='.length)
      }
      try { meta = JSON.parse(metaRaw) } catch (e) { return { ok: false, error: 'meta.json 解析失败' } }
      // 管理器自身不参与启停。
      if (meta.self === true) return { ok: false, error: '管理器本身始终启用，无需操作' }
      if (meta.ui === false) return { ok: false, error: '声明式插件由 install.sh 自动加载，无需在此启用/停用' }
      if (!host64 && !client64) return { ok: false, error: '读取插件源码失败' }
      hostSrc = host64 ? atob(host64) : ''
      clientSrc = client64 ? atob(client64) : ''

      const plugins = allPlugins()
      const byBase = {}
      for (const p of plugins) {
        const base = String(p.pluginId).split('-')[0]
        if (!byBase[base]) byBase[base] = p
      }
      const matchA = Array.isArray(meta.matchPrefix) ? meta.matchPrefix : []
      if (givenPluginId) {
        for (const p of plugins) if (p.pluginId === givenPluginId) { plugin = p; break }
      }
      if (!plugin) {
        for (const base of matchA) {
          if (byBase[base]) { plugin = byBase[base]; break }
        }
      }

      // 运行中 → 停用。
      if (plugin && plugin.activeRun) {
        try {
          await runner.stop(agent, plugin.pluginId)
        } catch (e) {
          return { ok: false, error: '停用失败：' + String((e && e.message) || e) }
        }
        return { ok: true, text: '已停用 ' + plugin.pluginId }
      }

      // 已存在（停用中）→ 重启。
      if (plugin) {
        const target = plugin.currentPackageId || (plugin.packages ? plugin.packages[plugin.packages.length - 1].packageId : null)
        if (!target) return { ok: false, error: '该插件无可用版本，请移除后重新启用' }
        try {
          const runRes = await runner.run(agent, plugin.pluginId, target, 'run')
          if (runRes && runRes.ok === false) return { ok: false, error: runRes.message || runRes.reason || '启动失败' }
          if (runRes && runRes.status === 'awaiting-approval') {
            return { ok: true, text: '已在出现的位置等待确认：请点【允许】并勾选“允许此插件的后续版本”——一次确认后更新免审批。' }
          }
          return { ok: true, text: '已启用：' + plugin.pluginId }
        } catch (e) {
          return { ok: false, error: '启用失败：' + String((e && e.message) || e) }
        }
      }

      // 无实例 → 定义并激活。
      let def
      try {
        def = runner.define({
          name: meta.name,
          purpose: meta.purpose,
          plugin: { kind: 'new', idPrefix: meta.idPrefix },
          code: {
            host: hostSrc ? hostSrc : void 0,
            client: clientSrc ? clientSrc : void 0,
          },
          sessionId: agent.id,
        })
      } catch (e) {
        return { ok: false, error: '定义失败：' + String((e && e.message) || e) }
      }
      try {
        const runRes = await runner.run(agent, def.pluginId, def.packageId, 'run')
        if (runRes && runRes.ok === false) {
          return { ok: false, error: runRes.message || runRes.reason || '启动失败' }
        }
        if (runRes && runRes.status === 'awaiting-approval') {
          return { ok: true, text: '已在出现的位置等待确认：请点【允许】并勾选“允许此插件的后续版本”——一次确认后更新免审批。' }
        }
        return { ok: true, text: '已启用：' + def.pluginId }
      } catch (e) {
        return { ok: false, error: '启用失败：' + String((e && e.message) || e) }
      }
    })
  },
}