// weixin-aibot-gateway —— CLIENT 半
//
// 设置页「微信 AI 网关」：一个完整页面（settings.section）：
//   - 状态卡：账号 / 网关状态 / dsh-weixin status 摘要
//   - 登录区：扫码登录按钮 → 二维码（Host 渲染 PNG dataURL）→ 轮询结果
//   - 驻守开关：开启/关闭（写 focus.json，headless 钩子共享生效）
// 全部走 host.call RPC，颜色只用 dsh 主题变量。
return {
  inject: ['slots', 'timer'],
  apply(ctx) {
    const slots = ctx.get('slots')
    if (slots === undefined) return

    styles.insert('\n' +
      '.wxag-root{display:flex;flex-direction:column;gap:14px;max-width:520px;padding:4px 2px 20px}' +
      '.wxag-card{display:flex;flex-direction:column;gap:10px;padding:14px 16px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}' +
      '.wxag-title{font-size:14px;font-weight:650;color:var(--dsw-alias-label-primary)}' +
      '.wxag-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}' +
      '.wxag-grow{flex:1;min-width:120px}' +
      '.wxag-muted{font-size:12px;color:var(--dsw-alias-label-tertiary)}' +
      '.wxag-mono{font-family:var(--dsh-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:11px;word-break:break-all}' +
      '.wxag-ok{color:var(--dsw-alias-state-success-primary)}' +
      '.wxag-warn{color:var(--dsw-alias-state-warn-primary)}' +
      '.wxag-err{color:var(--dsw-alias-state-error-primary)}' +
      '.wxag-btn{appearance:none;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:5px 14px;background:transparent;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.4}' +
      '.wxag-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}' +
      '.wxag-btn:disabled{opacity:.55;cursor:default}' +
      '.wxag-btn-primary{border-color:transparent;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}' +
      '.wxag-qr{width:220px;height:220px;padding:8px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;display:flex;align-items:center;justify-content:center;overflow:hidden}' +
      '.wxag-qr img{width:100%;height:100%;object-fit:contain;image-rendering:pixelated}' +
      '.wxag-badge{flex:none;padding:1px 8px;border-radius:999px;font-size:11px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-tertiary)}' +
      '.wxag-badge-on{background:var(--dsw-alias-state-success-tertiary);color:var(--dsw-alias-state-success-primary)}' +
      '.wxag-switch{appearance:none;position:relative;width:40px;height:22px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);cursor:pointer;transition:background .15s}' +
      '.wxag-switch::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-label-secondary);transition:left .15s,background .15s}' +
      '.wxag-switch[data-on="true"]{background:var(--dsw-alias-state-success-primary);border-color:transparent}' +
      '.wxag-switch[data-on="true"]::after{left:20px;background:#fff}')

    // 一个简单的状态轮询 hook
    function useStatus() {
      const [status, setStatus] = React.useState(null)
      const [error, setError] = React.useState(null)
      const refresh = React.useCallback(async () => {
        try {
          const s = await host.call('wx.status', {})
          setStatus(s)
          setError(null)
        } catch (e) {
          setError(String((e && e.message) || e))
        }
      }, [])
      React.useEffect(() => {
        void refresh()
        const stop = ctx.interval(() => void refresh(), 15000)
        return () => { stop() }
      }, [refresh])
      return { status, error, refresh }
    }

    function GatewayPage() {
      const { status, error, refresh } = useStatus()
      const [busy, setBusy] = React.useState(null)
      const [qr, setQr] = React.useState(null)          // { qrcodePng, sessionKey, message }
      const [loginMsg, setLoginMsg] = React.useState(null)
      const [standby, setStandby] = React.useState(null)

      React.useEffect(() => {
        if (status) setStandby(status.standby)
      }, [status])

      const startLogin = async () => {
        setBusy('login')
        setQr(null)
        setLoginMsg(null)
        try {
          // 空 dsh 自举：先确保 headless 依赖（dsh-weixin-gateway）就位
          const env = await host.call('wx.ensureEnv', {}).catch(() => null)
          if (env && env.ok === false) {
            setLoginMsg({ kind: 'error', text: env.message || '环境准备失败' })
            if (env.steps && env.steps.length) {
              setLoginMsg({ kind: 'error', text: env.message + '\n' + env.steps.map((s) => '· ' + s.name + ' ' + (s.message || s.output || '')).join('\n') })
            }
            return
          }
          if (env && env.steps && env.steps.length) {
            setLoginMsg({ kind: 'warn', text: '环境已自动准备：' + env.steps.map((s) => s.name).join(', ') })
          }
          const r = await host.call('wx.login', {})
          if (r && r.error) { setLoginMsg({ kind: 'error', text: r.error }); return }
          if (r && r.qrcodePng) {
            setQr({ png: r.qrcodePng, sessionKey: r.sessionKey, message: r.message })
            // 启动后轮询扫码结果（最多 8 分钟，每 4s 一次）
            setBusy('waiting')
            let connected = false
            for (let i = 0; i < 120; i++) {
              await ctx.timeout(4000)
              const poll = await host.call('wx.poll', { sessionKey: r.sessionKey, timeoutMs: 45000 }).catch(() => null)
              if (poll && poll.connected) {
                connected = true
                await host.call('wx.start', {}).catch(() => null)
                setLoginMsg({ kind: 'ok', text: '✅ 扫码成功，网关已启动' })
                break
              }
              if (poll && poll.message && poll.message.includes('验证')) {
                setLoginMsg({ kind: 'warn', text: poll.message })
              }
            }
            if (!connected) setLoginMsg({ kind: 'warn', text: '未检测到扫码（二维码可能已过期，可重新生成）' })
          } else {
            setLoginMsg({ kind: 'error', text: (r && r.message) || '扫码启动失败' })
          }
        } catch (e) {
          setLoginMsg({ kind: 'error', text: String((e && e.message) || e) })
        } finally {
          setBusy(null)
          void refresh()
        }
      }

      const toggleStandby = async () => {
        const next = !standby
        setStandby(next)
        try {
          await host.call('wx.standby', { enabled: next })
        } catch (e) {
          setStandby(!next)
          setLoginMsg({ kind: 'error', text: String((e && e.message) || e) })
        }
      }

      const accountText = status && status.accounts && status.accounts.length
        ? status.accounts.join(', ')
        : '未登录'
      const gatewayUp = status && status.cli && /网关实例/.test(status.cli.output) && !/无/.test(status.cli.output)

      // 网关启停/重启：按钮调 Host RPC，完成后刷新状态
      const opGateway = async (op, label) => {
        setBusy(op)
        setLoginMsg(null)
        try {
          const r = await host.call('wx.' + op, {})
          if (r && r.error) { setLoginMsg({ kind: 'error', text: r.error }); return }
          setLoginMsg({ kind: 'ok', text: (op === 'start' ? '✅ 网关已启动' : op === 'stop' ? '⏹ 网关已停止' : '🔄 网关已重启') + '（可在状态卡确认）' })
        } catch (e) {
          setLoginMsg({ kind: 'error', text: String((e && e.message) || e) })
        } finally {
          setBusy(null)
          void refresh()
        }
      }

      return React.createElement('div', { className: 'wxag-root' },
        // 状态卡：状态徽章 + 开启/关闭 + 重启（同一行）
        React.createElement('div', { className: 'wxag-card' },
          React.createElement('div', { className: 'wxag-title' }, '微信 AI 网关'),
          React.createElement('div', { className: 'wxag-row' },
            React.createElement('span', { className: 'wxag-muted' }, '账号'),
            React.createElement('span', { className: 'wxag-grow wxag-mono' }, accountText),
            React.createElement('span', { className: 'wxag-badge' + (gatewayUp ? ' wxag-badge-on' : '') }, gatewayUp ? '网关运行中' : '网关未运行'),
            React.createElement('button', {
              className: 'wxag-btn' + (gatewayUp ? '' : ' wxag-btn-primary'),
              disabled: busy !== null,
              onClick: () => opGateway(gatewayUp ? 'stop' : 'start', gatewayUp ? '关闭' : '开启'),
            }, busy === 'start' || busy === 'stop' ? '处理中…' : (gatewayUp ? '关闭' : '开启')),
            React.createElement('button', {
              className: 'wxag-btn',
              disabled: busy !== null || !gatewayUp,
              onClick: () => opGateway('restart', '重启'),
            }, busy === 'restart' ? '重启中…' : '重启'),
          ),
          status && status.cli
            ? React.createElement('div', { className: 'wxag-muted' },
                React.createElement('span', { className: 'wxag-mono' }, status.cli.output.split('\n').slice(0, 4).join(' · ')))
            : null,
          error ? React.createElement('div', { className: 'wxag-err' }, error) : null,
        ),

        // 登录卡
        React.createElement('div', { className: 'wxag-card' },
          React.createElement('div', { className: 'wxag-title' }, '扫码登录'),
          React.createElement('div', { className: 'wxag-row' },
            React.createElement('button', {
              className: 'wxag-btn wxag-btn-primary',
              disabled: busy === 'login' || busy === 'waiting',
              onClick: startLogin,
            }, busy === 'login' ? '正在生成二维码…' : (busy === 'waiting' ? '等待扫码…' : '扫码登录')),
            React.createElement('button', { className: 'wxag-btn', disabled: busy !== null, onClick: refresh }, '刷新状态'),
          ),
          qr
            ? React.createElement('div', { className: 'wxag-card', style: { alignItems: 'center' } },
                React.createElement('div', { className: 'wxag-qr' },
                  React.createElement('img', { src: qr.png, alt: '微信登录二维码' })),
                React.createElement('div', { className: 'wxag-muted' }, qr.message || '请用手机微信扫描二维码'))
            : null,
          loginMsg
            ? React.createElement('div', { className: loginMsg.kind === 'ok' ? 'wxag-ok' : (loginMsg.kind === 'warn' ? 'wxag-warn' : 'wxag-err') },
                loginMsg.text)
            : null,
        ),

        // 驻守开关卡
        React.createElement('div', { className: 'wxag-card' },
          React.createElement('div', { className: 'wxag-title' }, '驻守'),
          React.createElement('div', { className: 'wxag-row' },
            React.createElement('div', { className: 'wxag-grow' },
              React.createElement('div', null, '微信驻守'),
              React.createElement('div', { className: 'wxag-muted' }, '开启后所有 Agent 的 context 注入「联系渠道=微信」')),
            React.createElement('input', {
              type: 'checkbox',
              className: 'wxag-switch',
              'data-on': String(standby === true),
              checked: standby === true,
              onChange: toggleStandby,
              disabled: busy === 'login' || busy === 'waiting',
            }),
          ),
        ),
      )
    }

    slots.inject('settings.section', () => slots.register(
      { name: 'settings.section', id: 'weixin-aibot-gateway', order: 40, label: '微信 AI 网关' },
      GatewayPage,
    ))
    console.log('[weixin-aibot-gateway] 设置页已注册')
  },
}