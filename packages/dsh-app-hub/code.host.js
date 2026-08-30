// DSH App Hub — Host half (v3.1: launcher only — 点开图标能显示; no autostart, no PWA).
return {
  apply(ctx) {
    const HOME = process.env.HOME
    const DSH_HOME = process.env.DSH_HOME || HOME + '/.dsh'
    const SOURCE_ROOT = process.env.DSH_SOURCE_ROOT || HOME + '/projects/deepseek-harness'
    const CLI = SOURCE_ROOT + '/apps/cli/lib/bin.js'
    const APP_DIR = HOME + '/Applications/DSH.app'
    const ICON_SRC = DSH_HOME + '/hang-plugins/.runtime/dsh-app-hub'
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

    // ---------- local source runtime ----------
    function normalizeVersion(s) {
      if (!s) return null
      const m = /\d+\.\d+\.\d+[0-9A-Za-z.-]*/.exec(s)
      return m ? m[0] : null
    }
    let infoCache = null
    let infoCacheAt = 0
    async function collectInfo(force) {
      const now = Date.now()
      if (!force && infoCache !== null && now - infoCacheAt < 120000) return infoCache
      const ir = await runCmd('node ' + JSON.stringify(CLI) + ' --version', 10000, 4096)
      const installed = normalizeVersion(ir.stdout)
      const gr = await runCmd('/usr/bin/git -C ' + JSON.stringify(SOURCE_ROOT) + ' rev-parse --short HEAD', 10000, 4096)
      infoCache = {
        installed,
        sourceRoot: SOURCE_ROOT,
        commit: gr.exitCode === 0 ? gr.stdout.trim() : null,
        error: ir.exitCode === 0 ? null : (ir.stderr || ir.stdout || '本地 CLI 不可用'),
        sandbox: ir.sandbox || gr.sandbox || null,
        checkedAt: now,
      }
      infoCacheAt = now
      return infoCache
    }

    // ---------- launcher app content ----------
    // 原生壳构建脚本（含 Swift 源码）放在仓库 ~/.dsh/hang-plugins/packages/dsh-app-hub/assets/DSHApp/，可单独更新
    const BUILD_SCRIPT_PATH = DSH_HOME + '/hang-plugins/packages/dsh-app-hub/assets/DSHApp/dsh-app-build.sh'

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

    const launcher = async (args) => {
      const action = args && args.action ? String(args.action) : 'status'
      try {
        if (action === 'status') return { action, ...(await launcherStatus()) }
        if (action === 'create') return { action, ...(await createApp()) }
        if (action === 'launch') return { action, ...(await launchApp()) }
        return { action, ok: false, detail: 'unknown action: ' + action }
      } catch (e) {
        return { action, ok: false, detail: String((e && e.message) || e) }
      }
    }

    // ---------- package-private RPC ----------
    ctx.effect(() => harness.handle('app-info', (args) => collectInfo(!!(args && args.force))))
    ctx.effect(() => harness.handle('app-launcher', (args) => launcher(args)))
  },
}
