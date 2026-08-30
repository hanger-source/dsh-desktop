// DSH App Hub — browser half (v3.2: app launcher + update banner bottom-left).
return {
  inject: ['timer'],
  apply(ctx) {
    const slots = ctx.get('slots')
    if (slots === undefined) return
    const h = React.createElement

    styles.insert(
      '.dsh-app-card{border:1px solid color-mix(in srgb, currentColor 18%, transparent);border-radius:12px;padding:14px 16px;margin:10px 0}' +
      '.dsh-app-title{margin:0 0 8px;font-weight:600;font-size:14px}' +
      '.dsh-app-row{display:flex;align-items:center;gap:10px;margin:8px 0;flex-wrap:wrap}' +
      '.dsh-app-btn{appearance:none;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);border:0;border-radius:8px;padding:6px 12px;font-size:13px;line-height:1.4}' +
      '.dsh-app-btn:hover{background:var(--dsw-alias-button-primary-hover)}' +
      '.dsh-app-btn:disabled{opacity:.55;cursor:default}' +
      '.dsh-app-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;background:color-mix(in srgb, currentColor 8%, transparent);border-radius:6px;padding:6px 8px;overflow-x:auto;white-space:pre-wrap;word-break:break-all;margin:6px 0}' +
      '.dsh-app-ok{color:var(--dsh-color-success,#2ea043)}' +
      '.dsh-app-new{color:var(--dsh-color-warning,#bf8700)}' +
      '.dsh-app-err{color:var(--dsh-color-danger,#da3633);font-size:12px;margin:6px 0}' +
      '.dsh-app-muted{opacity:.6;font-size:12px;margin:4px 0}' +
      '.dsh-app-badge{display:inline-block;font-size:11px;border-radius:999px;padding:2px 8px;border:1px solid currentColor}' +
      '.dsh-app-foot{appearance:none;border:0;background:transparent;color:inherit;cursor:pointer;font-size:12px;padding:4px 8px;border-radius:8px;line-height:1.4}' +
      '.dsh-app-foot:hover{background:color-mix(in srgb, currentColor 12%, transparent)}' +
      '.dsh-app-banner{position:fixed;left:16px;bottom:16px;z-index:99999;display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:12px;background:color-mix(in srgb, currentColor 10%, transparent);backdrop-filter:blur(10px);border:1px solid color-mix(in srgb, currentColor 25%, transparent);box-shadow:0 6px 24px rgba(0,0,0,.35);font-size:13px;max-width:min(560px,80vw);flex-wrap:wrap}' +
      '.dsh-app-banner-text{font-weight:600}' +
      '.dsh-app-banner-btn{appearance:none;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);border:0;border-radius:8px;padding:6px 12px;font-size:13px;line-height:1.4}' +
      '.dsh-app-banner-btn:hover{background:var(--dsw-alias-button-primary-hover)}' +
      '.dsh-app-banner-close{appearance:none;border:0;background:transparent;color:inherit;opacity:.55;cursor:pointer;font-size:13px;padding:2px 6px}'
    )

    function call(method, args) {
      return host.call(method, args)
    }

    function rpcPending(setState) {
      setState((s) => ({ ...s, loading: true, error: null }))
      return (promise) => promise
        .then((r) => {
          setState({ loading: false, data: r, error: null })
          return r
        })
        .catch((e) => {
          setState({ loading: false, data: null, error: String((e && e.message) || e) })
          return null
        })
    }

    // ---------- Settings page ----------
    function AppSection() {
      const [app, setApp] = React.useState({ loading: true, data: null, error: null })
      const [info, setInfo] = React.useState({ loading: true, data: null, error: null })
      const [updating, setUpdating] = React.useState(false)
      const [updateResult, setUpdateResult] = React.useState(null)
      const [working, setWorking] = React.useState(null)

      const run = rpcPending

      React.useEffect(() => {
        run(setApp)(call('app-launcher', { action: 'status' }))
        run(setInfo)(call('app-info', {}))
      }, [])

      const refreshAll = () => {
        run(setApp)(call('app-launcher', { action: 'status' }))
        run(setInfo)(call('app-info', { force: true }))
      }

      const act = (action, setBusy, done) => {
        setBusy(action)
        call('app-launcher', { action })
          .then((r) => {
            if (done) done(r)
            run(setApp)(call('app-launcher', { action: 'status' }))
          })
          .catch((e) => setApp({ loading: false, data: null, error: String((e && e.message) || e) }))
          .then(() => setBusy(null))
      }

      const doUpdate = () => {
        let okFlag = true
        try {
          if (window.confirm && !window.confirm('执行 npm install -g @deepseek-ai/dsh@latest 并更新全局 CLI？\n更新后需要重启 dsh（下次打开应用即生效）。')) okFlag = false
        } catch (e) {}
        if (!okFlag) return
        setUpdating(true)
        setUpdateResult(null)
        call('app-update', {})
          .then((r) => {
            setUpdateResult(r)
            run(setInfo)(call('app-info', { force: true }))
          })
          .catch((e) => setUpdateResult({ exitCode: null, stderr: String((e && e.message) || e) }))
          .then(() => setUpdating(false))
      }

      const a = app.data
      const d = info.data

      const appCard = h('div', { className: 'dsh-app-card' }, [
        h('div', { className: 'dsh-app-title' }, '桌面应用'),
        app.loading
          ? h('div', { className: 'dsh-app-muted' }, '检查中…')
          : app.error
            ? h('div', { className: 'dsh-app-err' }, '状态获取失败：' + app.error)
            : [
                h('div', { className: 'dsh-app-row' }, [
                  h('span', null, '启动器 ' + (a.appReady ? '已生成' : '未生成')),
                  h('span', null, '服务端口 ' + a.port + ' ' + (a.portUp ? h('span', { className: 'dsh-app-ok' }, '运行中') : h('span', { className: 'dsh-app-new' }, '未运行'))),
                ]),
                h('div', { className: 'dsh-app-row' }, [
                  h('button',
                    { className: 'dsh-app-btn', onClick: () => act('create', setWorking), disabled: working === 'create' },
                    working === 'create' ? '生成中…' : (a && a.appReady ? '重新生成 DSH.app' : '生成 DSH.app')),
                  h('button',
                    { className: 'dsh-app-btn', onClick: () => act('launch', setWorking), disabled: working === 'launch' },
                    working === 'launch' ? '打开中…' : '打开 DSH'),
                ]),
                h('div', { className: 'dsh-app-muted' }, '「打开 DSH」会确保 dsh web 在后台启动（端口 ' + (a ? a.port : 3080) + '），然后打开窗口；已装到 ' + (a ? a.appDir : '~/Applications/DSH.app') + ' 后，双击图标效果相同。'),
              ],
      ])

      const versionLine = info.loading
        ? h('div', { className: 'dsh-app-muted' }, '版本信息检查中…')
        : info.error
          ? h('div', { className: 'dsh-app-err' }, '版本信息获取失败：' + info.error)
          : h('div', { className: 'dsh-app-row' }, [
              h('span', null, '当前版本：' + (d.installed || '未知')),
              h('span', null, '最新版本：' + (d.latest || '未知')),
              d.latestError
                ? h('span', { className: 'dsh-app-muted' }, '（查询异常：' + String(d.latestError).slice(0, 140) + '）')
                : null,
              d.updateAvailable === true
                ? h('span', { className: 'dsh-app-new' }, '（有新版本）')
                : d.updateAvailable === false
                  ? h('span', { className: 'dsh-app-ok' }, '（已是最新）')
                  : null,
            ])
      const updateActions = h('div', { className: 'dsh-app-row' }, [
        h('button',
          { className: 'dsh-app-btn', onClick: refreshAll, disabled: info.loading },
          info.loading ? '检查中…' : '检查更新'),
        h('button',
          { className: 'dsh-app-btn', onClick: doUpdate, disabled: updating || !!info.error },
          updating ? '更新中…' : '立即更新全局 CLI'),
      ])

      const resultNode = updateResult
        ? updateResult.exitCode === 0
          ? h('div', { className: 'dsh-app-ok' }, '✓ 更新成功。下次打开 DSH 即用新版本。')
          : h('div', { className: 'dsh-app-err' }, [
              '更新失败（exit ' + (updateResult.exitCode === null ? '—' : updateResult.exitCode) + '）' + (updateResult.stderr ? '：' + updateResult.stderr : ''),
              updateResult.sandbox && updateResult.sandbox.denied
                ? h('div', null, '（沙箱拒绝了该命令，请手动在终端执行下面的命令）')
                : null,
            ])
        : null

      const updateCard = h('div', { className: 'dsh-app-card' }, [
        h('div', { className: 'dsh-app-title' }, '更新'),
        versionLine,
        updateActions,
        resultNode,
        h('div', { className: 'dsh-app-muted' }, '手动更新（推荐在终端执行后再重启）：'),
        h('div', { className: 'dsh-app-mono' }, 'npm install -g @deepseek-ai/dsh@latest'),
        h('div', { className: 'dsh-app-muted' }, '不安装、临时跑最新版：'),
        h('div', { className: 'dsh-app-mono' }, 'npm exec --yes --package=@deepseek-ai/dsh@latest -- dsh web'),
      ])

      return h('div', null, [appCard, updateCard])
    }

    // ---------- 左下角更新浮条 ----------
    function UpdateBanner() {
      const [info, setInfo] = React.useState({ loading: true, data: null })
      const [dismissed, setDismissed] = React.useState(false)
      const [busy, setBusy] = React.useState(null)
      const [result, setResult] = React.useState(null)

      const check = React.useCallback(() => {
        host.call('app-info', {})
          .then((d) => setInfo({ loading: false, data: d }))
          .catch(() => setInfo({ loading: false, data: null }))
      }, [])
      React.useEffect(() => {
        check()
        let dispose = null
        try { dispose = ctx.interval(check, 30 * 60 * 1000) } catch (e) {}
        return () => {
          if (dispose) { try { dispose() } catch (e) {} }
        }
      }, [check])

      const d = info.data
      const showUpdate = !info.loading && d && d.updateAvailable === true && !dismissed && busy === null
      if (!showUpdate) return null

      const doUpdate = () => {
        let okFlag = true
        try {
          if (window.confirm && !window.confirm('发现新版本 ' + d.latest + '（当前 ' + (d.installed || '?') + '）。\n执行 npm install -g @deepseek-ai/dsh@latest？')) okFlag = false
        } catch (e) {}
        if (!okFlag) return
        setBusy('updating')
        setResult(null)
        host.call('app-update', {})
          .then((r) => setResult(r))
          .catch((e) => setResult({ exitCode: null, stderr: String((e && e.message) || e) }))
          .then(() => setBusy(null))
      }

      const doRestart = () => {
        let okFlag = true
        try {
          if (window.confirm && !window.confirm('重启 dsh web 服务使新版本生效？\n当前会话会先断开，由 DSH 应用自动拉起并恢复。')) okFlag = false
        } catch (e) {}
        if (!okFlag) return
        setBusy('restart')
        host.call('app-launcher', { action: 'restart' }).catch(() => {})
      }

      const updated = result && result.exitCode === 0
      const failed = result && result.exitCode !== 0
      return h('div', { className: 'dsh-app-banner' }, [
        updated
          ? h('span', { className: 'dsh-app-banner-text dsh-app-ok' }, '更新完成，重启服务后生效')
          : h('span', { className: 'dsh-app-banner-text' }, '发现新版本 ' + d.latest),
        failed ? h('span', { className: 'dsh-app-err' }, '更新失败：' + (result.stderr || '')) : null,
        busy === 'updating' ? h('span', { className: 'dsh-app-muted' }, '更新中…') : null,
        !updated && busy === null
          ? h('button', { className: 'dsh-app-banner-btn', onClick: doUpdate }, '更新')
          : null,
        updated && busy === null
          ? h('button', { className: 'dsh-app-banner-btn', onClick: doRestart }, '重启服务生效')
          : null,
        h('button', { className: 'dsh-app-banner-close', onClick: () => setDismissed(true) }, '✕'),
      ])
    }

    slots.inject('settings.section', () => slots.register(
      { name: 'settings.section', id: 'dsh-app', order: 30, label: () => 'App' },
      (props) => h(AppSection),
    ))
    slots.inject('shell.overlay', () => slots.register(
      { name: 'shell.overlay', id: 'dsh-app-update-banner', order: 100 },
      (props) => h(UpdateBanner),
    ))
  },
}