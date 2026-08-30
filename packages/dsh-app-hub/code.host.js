// DSH App Hub — Host half (v3.1: launcher only — 点开图标能显示; no autostart, no PWA).
return {
  apply(ctx) {
    const HOME = '/Users/fuhangbo'
    const APP_DIR = HOME + '/Applications/DSH.app'
    const ICON_SRC = HOME + '/.dsh/hang-plugins/.runtime/dsh-app-hub'
    const LOG_DIR = HOME + '/.dsh/hang-plugins/.runtime/dsh-app-hub'
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
      const res = await runCmd('npm install -g @deepseek-ai/dsh@latest', 180000, 65536)
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

    // ---------- launcher app content ----------
    // 原生壳构建脚本（含 Swift 源码）放在磁盘 ~/.dsh/dsh-app-hub/dsh-app-build.sh，可单独更新
    const BUILD_SCRIPT_PATH = HOME + '/.dsh/hang-plugins/packages/dsh-app-hub/assets/DSHApp/dsh-app-build.sh'

    // ---------- launcher actions ----------
    async function launcherStatus() {
      const portUp = await runCmd('/usr/bin/curl -sf --max-time 2 ' + URL + ' >/dev/null 2>&1 && echo up || echo down', 8000, 1024)
      const appCheck = await runCmd('test -x ' + APP_DIR + '/Contents/MacOS/DSHApp && echo yes || echo no', 8000, 1024)
      return {
        appReady: (appCheck.stdout || '').trim() === 'yes',
        portUp: (portUp.stdout || '').trim() === 'up',
        appDir: APP_DIR,
        port: PORT,
      }
    }

    async function createApp() {
      // 调用磁盘上的构建脚本（含 Swift 源码）生成 DSH.app
      const steps = []
      const exists = await runCmd('test -f ' + BUILD_SCRIPT_PATH + ' && echo yes || echo no', 8000, 1024)
      if ((exists.stdout || '').trim() !== 'yes') {
        steps.push({ step: 'build script', ok: false, detail: '缺失 ' + BUILD_SCRIPT_PATH + '（可从 dsh-app-hub 项目目录拷贝 dsh-app-build.sh）' })
        return { ok: false, steps, status: await launcherStatus() }
      }
      const b = await runCmd('bash ' + BUILD_SCRIPT_PATH + ' ' + APP_DIR + ' ' + ICON_SRC, 120000, 8192)
      steps.push({ step: 'swift build', ok: b.exitCode === 0, detail: b.stderr || b.stdout, sandbox: b.sandbox || null })
      const st = await launcherStatus()
      return { ok: b.exitCode === 0, steps, status: st }
    }

    async function launchApp() {
      // 启动壳：壳自己负责拉起 server、打开窗口、断线重连
      const res = await runCmd('/usr/bin/open ' + APP_DIR, 20000, 2048)
      const st = await launcherStatus()
      return { ok: res.exitCode === 0, detail: res.stderr || res.stdout, status: st }
    }

    async function restartService() {
      // 递延自拉起：先安排 3 秒后自动启动新 dsh web，再杀掉旧进程——
      // 重启不依赖壳看门狗，壳开不开都能恢复（更新 CLI 后立即生效）。
      const boot = 'sleep 3; /usr/bin/nohup /opt/homebrew/bin/dsh --profile web --patch ' + HOME + '/.dsh/hang-plugins/overlays/web/web-boot.yml --no-open >>' + LOG_DIR + '/server.log 2>&1 &'
      await runCmd('/bin/bash -c ' + JSON.stringify(boot), 8000, 1024)
      const res = await runCmd('/usr/sbin/lsof -tiTCP:3080 -sTCP:LISTEN | /usr/bin/xargs /bin/kill 2>/dev/null; true', 15000, 2048)
      return {
        ok: res.exitCode === 0,
        detail: res.stderr || res.stdout,
        sandbox: res.sandbox || null,
        status: await launcherStatus(),
      }
    }

    const launcher = async (args) => {
      const action = args && args.action ? String(args.action) : 'status'
      try {
        if (action === 'status') return { action, ...(await launcherStatus()) }
        if (action === 'create') return { action, ...(await createApp()) }
        if (action === 'launch') return { action, ...(await launchApp()) }
        if (action === 'restart') return { action, ...(await restartService()) }
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