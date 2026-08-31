// weixin-aibot-gateway —— HOST 半
//
// 职责：给 DSH Desktop 一个"微信 AI 网关"管理界面后端。
// 连接层（扫码 / 轮询 / 收发 / 媒体 / agent 会话）全部由 dsh-weixin 承担，
// 本插件只做三件事：
//   1. 编排扫码登录（调 dsh-weixin 的 login-qr 流程，把二维码渲染成 PNG 给界面）
//   2. 上报网关与账号状态（dsh-weixin status / accounts 读取）
//   3. 读写驻守开关（~/.dsh/weixin-dsh-state/focus.json，与 headless 侧钩子共享）
//
// 受限环境：无 import/process/Buffer，全部文件/进程操作走 ctx.fs / ctx.subprocess。

return {
  inject: ['fs', 'subprocess', 'timer'],
  apply(ctx) {
    // ================= 路径 =================
    const STATE_DIR = '/Users/fuhangbo/.dsh/weixin-dsh-state'
    const FOCUS_FILE = STATE_DIR + '/focus.json'
    const ACCOUNTS_DIR = '/Users/fuhangbo/.openclaw/openclaw-weixin'
    const ACCOUNTS_INDEX = ACCOUNTS_DIR + '/accounts.json'
    const NODE = '/usr/bin/env'
    // 登录编排守护（单进程常驻）：
    //   start 子命令：同一进程内 拿二维码 → 输出 QR JSON → 持续轮询 WAIT_FILE
    //   直到 connected → saveWeixinAccount 落盘 → 更新 STATE_FILE=connected →
    //   spawn /opt/homebrew/bin/dsh-weixin run 前台接管收发 → 保持进程存活。
    //   登录态在 login-qr.js 模块内存 Map 里，跨进程即失效，所以必须单进程。
    const QR_LOGIN_SCRIPT = [
      'import { writeFile, readFile } from "node:fs/promises";',
      'import { spawn } from "node:child_process";',
      'const { startWeixinLoginWithQr, waitForWeixinLogin } = await import("/opt/homebrew/lib/node_modules/dsh-weixin-gateway/lib/weixin/login-qr.js");',
      'const { saveWeixinAccount } = await import("/opt/homebrew/lib/node_modules/dsh-weixin-gateway/lib/weixin/accounts.js");',
      'const STATE_FILE = process.env.WXAG_STATE_FILE;',
      'const pending = async (patch) => { try { await writeFile(STATE_FILE, JSON.stringify(patch)); } catch {} };',
      'const dest = async (key) => { try { return JSON.parse(await readFile(STATE_FILE, "utf8"))[key]; } catch { return undefined; } };',
      'await pending({ phase: "starting" });',
      'const login = await startWeixinLoginWithQr({ apiBaseUrl: "https://ilinkai.weixin.qq.com", accountId: process.argv[1] || undefined, verbose: false });',
      'if (!login.qrcodeUrl) { await pending({ phase: "failed", message: login.message }); process.exit(0); }',
      'console.log(JSON.stringify({ ok: true, sessionKey: login.sessionKey, qrcodeUrl: login.qrcodeUrl }));',
      'await pending({ phase: "qr", sessionKey: login.sessionKey, qrcodeUrl: login.qrcodeUrl });',
      '// 同一进程持续轮询直到扫码成功（登录态在本进程内存，离开即失效）',
      'let result = await waitForWeixinLogin({ sessionKey: login.sessionKey, timeoutMs: 480000, verbose: false });',
      'if (result && !result.connected) { await pending({ phase: "failed", message: result.message || "扫码未完成" }); process.exit(0); }',
      '// 落盘账号 + 刷新微信通道',
      'try { saveWeixinAccount(result.accountId, { token: result.botToken, baseUrl: result.baseUrl, userId: result.userId }); } catch (e) { await pending({ phase: "failed", message: "落盘失败: " + e.message }); process.exit(0); }',
      'await pending({ phase: "connected", accountId: result.accountId });',
      '// 启动 dsh-weixin run（前台长轮询；与 launchd/openclaw 隔离）',
      'const child = spawn("/opt/homebrew/bin/dsh-weixin", ["run", result.accountId], { stdio: "inherit", detached: false });',
      'child.on("exit", () => process.exit(0));',
      'await new Promise(() => {});',
    ].join('\n')

    // ================= subprocess 工具（quota-monitor 同款） =================
    async function run(argv, opts) {
      const o = opts || {}
      const handle = ctx.subprocess.spawn({
        argv: argv,
        cwd: '/',
        stdio: { stdin: 'ignore', stdout: { maxBytes: o.maxBytes || 1048576 }, stderr: { maxBytes: 65536 } },
        graceMs: o.graceMs || 20000,
      })
      const outcome = await handle.done
      return {
        exitCode: outcome.exitCode,
        stdout: handle.collected.stdout.readFrom(0).text,
        stderr: handle.collected.stderr.readFrom(0).text,
      }
    }
    // spawn 常驻子进程并立即返回（不等待 done）；调用方靠状态文件轮询
    function spawnDetached(argv, env) {
      return ctx.subprocess.spawn({
        argv: argv,
        cwd: '/',
        stdio: { stdin: 'ignore', stdout: { maxBytes: 4194304 }, stderr: { maxBytes: 65536 } },
        graceMs: 60000,
        env: env,
      })
    }
    async function readText(file) {
      try {
        const target = await ctx.fs.resolve(file)
        return await ctx.fs.readText(target)
      } catch { return '' }
    }
    async function writeText(file, content) {
      try {
        const target = await ctx.fs.resolve(file)
        await ctx.fs.writeText(target, content)
      } catch (err) { console.error('[weixin-aibot-gateway] writeText: ' + String(err)) }
    }

    // ================= 驻守开关（与 headless 钩子共享 focus.json） =================
    async function loadFocus() {
      try {
        const parsed = JSON.parse(await readText(FOCUS_FILE))
        return parsed && typeof parsed === 'object' ? parsed : {}
      } catch { return {} }
    }

    // ================= 状态查询 =================
    async function gatewayStatus() {
      // dsh-weixin status 输出（launchd + 网关实例）
      const r = await run(['/bin/sh', '-c', '/opt/homebrew/bin/dsh-weixin status 2>&1'], { graceMs: 15000, maxBytes: 65536 })
      // 已登录账号
      const accountsRaw = await readText(ACCOUNTS_INDEX)
      let accounts = []
      try {
        const list = JSON.parse(accountsRaw)
        accounts = Array.isArray(list) ? list : []
      } catch { /* 无账号 */ }
      const focus = await loadFocus()
      return {
        cli: { exitCode: r.exitCode, output: r.stdout.trim() },
        accounts,
        standby: focus.standby !== false,
        focus: focus,
      }
    }

    // ================= 自举：空 dsh 也能跑（首次扫码前检查/安装 headless 依赖） =================
    const HEADLESS_LOCAL_DEPS = ['weixin-custom-tools'] // link 包：随 dsh-desktop 仓库同步
    const HEADLESS_NPM_DEPS = ['dsh-weixin-gateway']    // npm 包：dsh plugin add 自动装

    async function headlessDeps() {
      try {
        const target = await ctx.fs.resolve('/Users/fuhangbo/.dsh/profiles/headless/package.json')
        return JSON.parse(await ctx.fs.readText(target))
      } catch { return null }
    }

    async function ensureEnv() {
      const out = { ok: true, steps: [] }
      // 1. dsh 本体
      const dshCheck = await run(['/bin/sh', '-c', 'command -v dsh || echo NO_DSH'], { graceMs: 8000, maxBytes: 65536 })
      if (dshCheck.stdout.trim() === 'NO_DSH') {
        return { ok: false, message: '未找到 dsh，请先安装 DeepSeek Harness（依赖它运行微信网关）' }
      }
      // 2. headless profile
      const profileCheck = await run(['/bin/sh', '-c', 'test -f /Users/fuhangbo/.dsh/profiles/headless/package.json && echo OK || echo NO'], { graceMs: 8000, maxBytes: 65536 })
      if (profileCheck.stdout.trim() !== 'OK') {
        return { ok: false, message: 'headless profile 不存在，请先创建（dsh-weixin 需要）' }
      }
      // 3. npm 依赖自举（dsh-weixin-gateway）—— 官方 dsh plugin add，自动写 profile
      const deps = await headlessDeps()
      const missingNpm = HEADLESS_NPM_DEPS.filter((n) => !(deps && deps[n]))
      for (const name of missingNpm) {
        const r = await run(['/bin/sh', '-c', 'dsh plugin --profile headless add ' + name + ' 2>&1'], { graceMs: 180000, maxBytes: 65536 })
        out.steps.push({ name, action: 'npm-add', exitCode: r.exitCode, output: r.stdout.trim().slice(-140) })
        if (r.exitCode !== 0) out.ok = false
      }
      // 4. link 依赖（weixin-custom-tools）—— 随 dsh-desktop 仓库同步，检查存在性
      const missingLocal = HEADLESS_LOCAL_DEPS.filter((n) => !(deps && deps[n]))
      for (const name of missingLocal) {
        out.steps.push({ name, action: 'repo-sync', message: '该包随 dsh-desktop 仓库同步，请在 App「Hang 的插件」页确认已同步' })
      }
      return out
    }

    // ================= 扫码登录编排 =================
    const QR_STATE_FILE = '/tmp/wxag-login-state.json'

    async function readQrState() {
      try {
        const target = await ctx.fs.resolve(QR_STATE_FILE)
        return JSON.parse(await ctx.fs.readText(target))
      } catch { return { phase: 'idle' } }
    }

    async function spawnQrDaemon() {
      // 后台起登录守护：单进程内 二维码→轮询→落盘→跑网关，状态写 QR_STATE_FILE。
      // spawn 立即返回（不 await done），后续靠状态文件轮询。
      try {
        await ctx.fs.writeText(await ctx.fs.resolve(QR_STATE_FILE), JSON.stringify({ phase: 'starting' }))
      } catch { /* 无所谓 */ }
      spawnDetached(
        ['/usr/bin/env', 'node', '--input-type=module', '-e', QR_LOGIN_SCRIPT],
        { WXAG_STATE_FILE: QR_STATE_FILE, PATH: '/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin' },
      )
      // 等第一行 JSON（二维码就位）或失败
      const deadline = Date.now() + 30000
      for (;;) {
        const st = await readQrState()
        if (st.phase === 'qr') return { ok: true, state: st }
        if (st.phase === 'failed') return { ok: false, message: st.message }
        if (Date.now() > deadline) return { ok: false, message: '等待二维码超时' }
        await ctx.timeout(400)
      }
    }

    async function startLogin() {
      // 已有活跃登录 daemon → 直接复用二维码
      const existing = await readQrState()
      if (existing && (existing.phase === 'qr' || existing.phase === 'starting')) {
        const png = await renderQrToPng(existing.qrcodeUrl)
        return { sessionKey: existing.sessionKey, qrcodeUrl: existing.qrcodeUrl, qrcodePng: png, message: '请用手机微信扫描二维码（续）' }
      }
      const qr = await spawnQrDaemon()
      if (!qr.ok) return { error: qr.message }
      const png = await renderQrToPng(qr.state.qrcodeUrl)
      return { sessionKey: qr.state.sessionKey, qrcodeUrl: qr.state.qrcodeUrl, qrcodePng: png, message: '请用手机微信扫描二维码' }
    }

    async function pollLogin() {
      const st = await readQrState()
      if (!st || st.phase === 'connected') {
        return { connected: true, accountId: st && st.accountId }
      }
      if (st && st.phase === 'failed') return { connected: false, message: st.message }
      return { connected: false, phase: (st && st.phase) || 'idle' }
    }

    async function renderQrToPng(content) {
      if (!content) return null
      try {
        // qrcode 1.5.4（openclaw 全局依赖内）toDataURL 输出 PNG dataURL；普通 node 环境
        const r = await run([
          '/usr/bin/env', 'node', '-e',
          'const qr=require("/opt/homebrew/lib/node_modules/openclaw/node_modules/qrcode");' +
          'const c=process.argv[1];' +
          'qr.toDataURL(c,{errorCorrectionLevel:"M",margin:2,width:360},(e,u)=>{' +
          '  if(e){console.log("ERR:"+e.message);process.exit(1)}' +
          '  console.log("QR:"+u);' +
          '})',
          content,
        ], { graceMs: 15000, maxBytes: 1048576 })
        const m = r.stdout.match(/QR:(data:image\/png;base64,[^\s]+)/)
        if (m) return m[1]
        console.error('[weixin-aibot-gateway] qrcode png 失败: ' + r.stdout.slice(0, 200))
        return null
      } catch (err) {
        console.error('[weixin-aibot-gateway] renderQrToPng: ' + String(err))
        return null
      }
    }

    // ================= 网关管理（启动/停止/重启） =================
    async function gatewayOperation(action) {
      const cmd = {
        start: 'dsh-weixin restart 2>&1 || dsh-weixin start 2>&1',
        stop: 'dsh-weixin stop 2>&1',
        restart: 'dsh-weixin restart 2>&1',
      }[action]
      if (!cmd) return { error: '未知操作 ' + action }
      const r = await run(['/bin/sh', '-c', '/opt/homebrew/bin/' + cmd], { graceMs: 60000, maxBytes: 65536 })
      // 等状态稳定
      await ctx.timeout(2500)
      const fresh = await gatewayStatus()
      return { exitCode: r.exitCode, output: r.stdout.trim(), gateway: fresh }
    }

    // ================= RPC handlers =================
    harness.handle('wx.ensureEnv', async () => {
      try { return await ensureEnv() } catch (err) { return { error: String(err) } }
    })
    harness.handle('wx.status', async () => {
      try { return await gatewayStatus() } catch (err) { return { error: String(err) } }
    })
    harness.handle('wx.login', async () => {
      try { return await startLogin() } catch (err) { return { error: String(err) } }
    })
    harness.handle('wx.poll', async (args) => {
      try { return await pollLogin(args) } catch (err) { return { error: String(err) } }
    })
    harness.handle('wx.start', async () => {
      try { return await gatewayOperation('start') } catch (err) { return { error: String(err) } }
    })
    harness.handle('wx.stop', async () => {
      try { return await gatewayOperation('stop') } catch (err) { return { error: String(err) } }
    })
    harness.handle('wx.restart', async () => {
      try { return await gatewayOperation('restart') } catch (err) { return { error: String(err) } }
    })
    harness.handle('wx.standby', async (args) => {
      try {
        const focus = await loadFocus()
        if (args && typeof args.enabled === 'boolean') {
          focus.standby = args.enabled
          await writeText(FOCUS_FILE, JSON.stringify(focus, null, 2))
        }
        return { standby: focus.standby !== false }
      } catch (err) { return { error: String(err) } }
    })

    console.log('[weixin-aibot-gateway] Host 就绪（自举/扫码/启停/状态/驻守 RPC）')
  },
}