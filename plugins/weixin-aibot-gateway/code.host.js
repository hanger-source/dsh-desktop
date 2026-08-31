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
    // 登录编排脚本（普通 Node 环境，可自由 import dsh-weixin-gateway）
    const QR_LOGIN_SCRIPT = [
      'const { startWeixinLoginWithQr, waitForWeixinLogin } = await import("/opt/homebrew/lib/node_modules/dsh-weixin-gateway/lib/weixin/login-qr.js");',
      'const phase = process.argv[2];',
      'if (phase === "start") {',
      '  const login = await startWeixinLoginWithQr({ apiBaseUrl: "https://ilinkai.weixin.qq.com", accountId: process.argv[3] || undefined, verbose: false });',
      '  if (!login.qrcodeUrl) { console.log(JSON.stringify({ ok: false, message: login.message })); process.exit(0); }',
      '  console.log(JSON.stringify({ ok: true, sessionKey: login.sessionKey, qrcodeUrl: login.qrcodeUrl }));',
      '} else if (phase === "poll") {',
      '  const login = await waitForWeixinLogin({ sessionKey: process.argv[3], timeoutMs: Number(process.argv[4] || 480000), verbose: false });',
      '  console.log(JSON.stringify({ ok: true, sessionKey: process.argv[3], ...login }));',
      '} else { console.log(JSON.stringify({ ok: false, message: "unknown phase" })); }',
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

    // ================= 扫码登录编排 =================
    async function execQrScript(args) {
      const r = await run(['/usr/bin/env', 'node', '--input-type=module', '-e', QR_LOGIN_SCRIPT, ...args], { graceMs: 60000, maxBytes: 1048576 })
      if (r.exitCode !== 0) console.error('[weixin-aibot-gateway] qr script exit=' + r.exitCode + ' stderr=' + r.stderr.slice(0, 300))
      return r
    }

    async function startLogin() {
      const r = await execQrScript(['start'])
      // 解析 stdout 里的 JSON
      const line = r.stdout.split('\n').map((l) => l.trim()).find((l) => l.startsWith('{'))
      if (!line) return { error: '扫码启动无输出: ' + r.stdout.slice(0, 200) }
      let data
      try { data = JSON.parse(line) } catch { return { error: '扫码启动输出非 JSON: ' + line } }
      if (!data.ok) return { error: data.message }
      // 把 qrcodeUrl 渲染成 PNG dataURL（qrcode 全局包，openclaw 依赖内）
      const png = await renderQrToPng(data.qrcodeUrl)
      return { sessionKey: data.sessionKey, qrcodeUrl: data.qrcodeUrl, qrcodePng: png, message: '请用手机微信扫描二维码' }
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

    async function pollLogin(args) {
      const sessionKey = args && args.sessionKey
      if (!sessionKey) return { error: '缺少 sessionKey' }
      const r = await execQrScript(['poll', sessionKey, String(args.timeoutMs || 480000)])
      const line = r.stdout.split('\n').map((l) => l.trim()).find((l) => l.startsWith('{'))
      if (!line) return { connected: false, message: '轮询无输出: ' + r.stdout.slice(0, 200) }
      try {
        return JSON.parse(line)
      } catch { return { connected: false, message: '轮询输出非 JSON: ' + line } }
    }

    // ================= 网关启动 =================
    async function startGateway() {
      const r = await run(['/bin/sh', '-c', '/opt/homebrew/bin/dsh-weixin start 2>&1 || /opt/homebrew/bin/dsh-weixin run 2>&1'], { graceMs: 30000, maxBytes: 65536 })
      return { exitCode: r.exitCode, output: r.stdout.trim() }
    }

    // ================= RPC handlers =================
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
      try { return await startGateway() } catch (err) { return { error: String(err) } }
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

    console.log('[weixin-aibot-gateway] Host 就绪（扫码/状态/驻守 RPC）')
  },
}