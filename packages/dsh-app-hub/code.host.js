// DSH App Hub — Host half (v3.1: launcher only — 点开图标能显示; no autostart, no PWA).
return {
  apply(ctx) {
    const PORT = 3080
    const URL = 'http://127.0.0.1:' + PORT + '/'

    // ---------- shell ----------
    function shellService() {
      return ctx.get('shell') || ctx.get('bash')
    }
    async function runCmd(command, timeoutMs, maxBytes, stdin) {
      const sh = shellService()
      if (sh === undefined) {
        return { exitCode: null, stdout: '', stderr: 'shell service unavailable', sandbox: null }
      }
      try {
        const spec = sh.resolve({
          command,
          timeoutMs: timeoutMs || 15000,
          stdoutMaxBytes: maxBytes || 16384,
          stdin: stdin || undefined,
        })
        const r = await sh.run(spec)
        return {
          exitCode: r.exitCode,
          stdout: r.stdout && typeof r.stdout.text === 'string' ? r.stdout.text : '',
          stderr: r.stderr && typeof r.stderr.text === 'string' ? r.stderr.text : '',
          sandbox: r.sandbox ? {
            mode: r.sandbox.mode,
            denied: !!r.sandbox.denied,
            runnerFailed: !!r.sandbox.runnerFailed,
          } : null,
        }
      } catch (e) {
        return { exitCode: null, stdout: '', stderr: String((e && e.message) || e), sandbox: null }
      }
    }

    let pathsCache = null
    async function resolvePaths() {
      if (pathsCache !== null) return pathsCache
      const script = 'printf "%s\\n" "$HOME"'
      const result = await runCmd('/bin/bash -lc ' + JSON.stringify(script), 8000, 4096)
      if (result.exitCode !== 0) {
        throw new Error('无法解析 DSH 路径：' + (result.stderr || result.stdout || 'shell failed'))
      }
      const lines = result.stdout.split('\n').map((line) => line.trim()).filter(Boolean)
      const home = lines[0]
      if (!home || !home.startsWith('/')) {
        throw new Error('用户目录不是绝对路径')
      }
      pathsCache = {
        appDir: home + '/Applications/DSH.app',
      }
      return pathsCache
    }

    // ---------- version check & update ----------
    function normalizeVersion(s) {
      if (!s) return null
      const m = /\d+\.\d+\.\d+[0-9A-Za-z.-]*/.exec(s)
      return m ? m[0] : null
    }
    function cmpVersions(a, b) {
      const parse = (v) => {
        if (!v) return null
        const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(v.trim())
        if (!m) return null
        return { maj: +m[1], min: +m[2], pat: +m[3], pre: m[4] ? m[4].split('.') : [] }
      }
      const pa = parse(a)
      const pb = parse(b)
      if (!pa || !pb) return null
      if (pa.maj !== pb.maj) return pa.maj - pb.maj
      if (pa.min !== pb.min) return pa.min - pb.min
      if (pa.pat !== pb.pat) return pa.pat - pb.pat
      if (pa.pre.length === 0 && pb.pre.length === 0) return 0
      if (pa.pre.length === 0) return 1
      if (pb.pre.length === 0) return -1
      for (let i = 0; i < Math.max(pa.pre.length, pb.pre.length); i++) {
        const av = pa.pre[i]
        const bv = pb.pre[i]
        if (av === undefined) return -1
        if (bv === undefined) return 1
        const an = /^\d+$/.test(av)
        const bn = /^\d+$/.test(bv)
        if (an && bn) {
          if (+av !== +bv) return +av - +bv
        } else if (an) {
          return -1
        } else if (bn) {
          return 1
        } else {
          const c = av.localeCompare(bv)
          if (c !== 0) return c
        }
      }
      return 0
    }
    let infoCache = null
    let infoCacheAt = 0
    async function collectInfo(force) {
      const now = Date.now()
      if (!force && infoCache !== null && now - infoCacheAt < 120000) return infoCache
      const ir = await runCmd('dsh --version', 10000, 4096)
      const installed = normalizeVersion(ir.stdout)
      // 最新版本：直接 curl registry，不经过 npm（绕开 ~/.npm 缓存权限问题）
      let latest = null
      let latestError = null
      const cr = await runCmd('/usr/bin/curl -fsS --max-time 20 https://registry.npmjs.org/@deepseek-ai/dsh/latest', 25000, 65536)
      if (cr.exitCode === 0 && cr.stdout) {
        try {
          const j = JSON.parse(cr.stdout)
          latest = j && j.version ? String(j.version) : null
          if (latest === null) latestError = 'registry 返回缺少 version'
        } catch (e) {
          latestError = 'registry 解析失败: ' + String((e && e.message) || e)
        }
      } else {
        latestError = 'registry 查询失败: ' + (cr.stderr || cr.stdout || 'curl exit ' + cr.exitCode)
      }
      let updateAvailable = null
      if (installed !== null && latest !== null) {
        const c = cmpVersions(latest, installed)
        updateAvailable = c === null ? null : c > 0
      }
      if (latestError) console.error('dsh-app: info latest fetch failed ->', latestError)
      infoCache = {
        installed,
        latest,
        updateAvailable,
        latestError,
        sandbox: ir.sandbox || cr.sandbox || null,
        checkedAt: now,
      }
      infoCacheAt = now
      return infoCache
    }
    const doUpdate = async () => {
      const res = await runCmd('npm install -g @deepseek-ai/dsh@latest --registry=https://registry.npmjs.org', 180000, 65536)
      if (res.exitCode === 0) {
        infoCache = null
        infoCacheAt = 0
      }
      return res
    }

    // ---------- file writes (fs first, python-stdin fallback) ----------
    async function writeFile(path, content) {
      const fs = ctx.get('fs')
      let used = 'fs'
      if (fs !== undefined) {
        try {
          const target = await fs.resolve(path)
          await fs.writeText(target, content)
          return { ok: true, used }
        } catch (e) {
          used = 'fs:' + String((e && e.message) || e)
        }
      }
      const py = 'python3 -c "import sys;open(sys.argv[1],\'w\').write(sys.stdin.read())" ' + JSON.stringify(path)
      const res = await runCmd(py, 15000, 4096, content)
      if (res.exitCode === 0) return { ok: true, used: 'python' }
      return { ok: false, used, error: res.stderr || res.stdout || ('python exit ' + res.exitCode) }
    }

    // ---------- launcher actions ----------
    async function launcherStatus() {
      const paths = await resolvePaths()
      const portUp = await runCmd('/usr/bin/curl -sS -o /dev/null --max-time 2 ' + URL + ' && echo up || echo down', 8000, 1024)
      const appCheck = await runCmd('test -x ' + JSON.stringify(paths.appDir + '/Contents/MacOS/DSHApp') + ' && echo yes || echo no', 8000, 1024)
      return {
        appReady: (appCheck.stdout || '').trim() === 'yes',
        portUp: (portUp.stdout || '').trim() === 'up',
        appDir: paths.appDir,
        port: PORT,
      }
    }

    async function restartApp() {
      const paths = await resolvePaths()
      const relaunch = 'sleep 1; /usr/bin/open ' + JSON.stringify(paths.appDir)
      const command = '/usr/bin/nohup /bin/bash -c ' + JSON.stringify(relaunch) +
        ' >/dev/null 2>&1 & /usr/bin/osascript -e ' +
        JSON.stringify('tell application id "com.local.dsh-app" to quit')
      const res = await runCmd(command, 10000, 4096)
      return { ok: res.exitCode === 0, detail: res.stderr || res.stdout }
    }

    const launcher = async (args) => {
      const action = args && args.action ? String(args.action) : 'status'
      try {
        if (action === 'status') return { action, ...(await launcherStatus()) }
        if (action === 'restart') return { action, ...(await restartApp()) }
        return { action, ok: false, detail: 'unknown action: ' + action }
      } catch (e) {
        return { action, ok: false, detail: String((e && e.message) || e) }
      }
    }

    // ---------- package-private RPC ----------
    ctx.effect(() => harness.handle('app-info', (args) => collectInfo(!!(args && args.force))))
    ctx.effect(() => harness.handle('app-update', () => doUpdate()))
    ctx.effect(() => harness.handle('app-launcher', (args) => launcher(args)))
  },
}
