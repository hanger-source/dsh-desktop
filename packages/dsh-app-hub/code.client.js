// DSH App Hub — browser half: local source runtime status and native app launcher.
return {
  inject: ['slots'],
  apply(ctx) {
    const slots = ctx.get('slots')
    if (slots === undefined) return
    const h = React.createElement

    styles.insert(
      '.dsh-app-root{display:flex;flex-direction:column;gap:12px;padding:4px 2px 12px}' +
      '.dsh-app-card{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:14px 16px;background:var(--dsw-alias-bg-layer-1)}' +
      '.dsh-app-title{margin:0 0 8px;font-weight:600;font-size:14px;color:var(--dsw-alias-label-primary)}' +
      '.dsh-app-row{display:flex;align-items:center;gap:10px;margin:8px 0;flex-wrap:wrap}' +
      '.dsh-app-btn{appearance:none;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);border:0;border-radius:8px;padding:6px 12px;font-size:13px;line-height:1.4}' +
      '.dsh-app-btn:hover{background:var(--dsw-alias-button-primary-hover)}' +
      '.dsh-app-btn:disabled{opacity:.55;cursor:default}' +
      '.dsh-app-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;background:var(--dsw-alias-bg-layer-2);border-radius:6px;padding:6px 8px;overflow-x:auto;white-space:pre-wrap;word-break:break-all;margin:6px 0}' +
      '.dsh-app-ok{color:var(--dsw-alias-state-success-primary)}' +
      '.dsh-app-warn{color:var(--dsw-alias-state-warn-primary)}' +
      '.dsh-app-err{color:var(--dsw-alias-state-error-primary);font-size:12px;margin:6px 0}' +
      '.dsh-app-muted{color:var(--dsw-alias-label-tertiary);font-size:12px;margin:4px 0}'
    )

    function AppSection() {
      const [app, setApp] = React.useState(null)
      const [info, setInfo] = React.useState(null)
      const [error, setError] = React.useState(null)
      const [working, setWorking] = React.useState(null)

      const refresh = React.useCallback(() => {
        Promise.all([
          host.call('app-launcher', { action: 'status' }),
          host.call('app-info', { force: true }),
        ]).then(([appState, runtime]) => {
          setApp(appState)
          setInfo(runtime)
          setError(null)
        }).catch((e) => setError(String((e && e.message) || e)))
      }, [])

      React.useEffect(() => { refresh() }, [refresh])

      const act = (action) => {
        setWorking(action)
        host.call('app-launcher', { action })
          .then(() => refresh())
          .catch((e) => setError(String((e && e.message) || e)))
          .then(() => setWorking(null))
      }

      if (error) return h('div', { className: 'dsh-app-err' }, '状态读取失败：' + error)
      if (!app || !info) return h('div', { className: 'dsh-app-muted' }, '正在读取 DSH.app 状态…')

      return h('div', { className: 'dsh-app-root' }, [
        h('div', { className: 'dsh-app-card' }, [
          h('div', { className: 'dsh-app-title' }, '桌面应用'),
          h('div', { className: 'dsh-app-row' }, [
            h('span', null, '启动器 ' + (app.appReady ? '已生成' : '未生成')),
            h('span', null, ['服务端口 ' + app.port + ' ', app.portUp
              ? h('span', { className: 'dsh-app-ok' }, '运行中')
              : h('span', { className: 'dsh-app-warn' }, '未运行')]),
          ]),
          h('div', { className: 'dsh-app-row' }, [
            h('button', {
              className: 'dsh-app-btn',
              disabled: working !== null,
              onClick: () => act('create'),
            }, working === 'create' ? '生成中…' : (app.appReady ? '重新生成 DSH.app' : '生成 DSH.app')),
            h('button', {
              className: 'dsh-app-btn',
              disabled: working !== null,
              onClick: () => act('launch'),
            }, working === 'launch' ? '打开中…' : '打开 DSH'),
          ]),
          h('div', { className: 'dsh-app-muted' }, '服务重启由原生 App 单独持有：使用菜单 DSH → 重启 DSH 服务。'),
          h('div', { className: 'dsh-app-mono' }, app.appDir),
        ]),
        h('div', { className: 'dsh-app-card' }, [
          h('div', { className: 'dsh-app-title' }, '本地运行时'),
          info.error
            ? h('div', { className: 'dsh-app-err' }, info.error)
            : h('div', { className: 'dsh-app-row' }, [
                h('span', { className: 'dsh-app-ok' }, 'CLI 可用'),
                h('span', null, '版本 ' + (info.installed || '未知')),
                h('span', null, 'commit ' + (info.commit || '未知')),
              ]),
          h('div', { className: 'dsh-app-mono' }, info.sourceRoot),
          h('div', { className: 'dsh-app-muted' }, 'DSH.app 直接运行这个 checkout 的 apps/cli/lib/bin.js；不会在后台执行 npm install。'),
        ]),
      ])
    }

    slots.inject('settings.section', () => slots.register(
      { name: 'settings.section', id: 'dsh-app', order: 30, label: () => 'App' },
      () => h(AppSection),
    ))
  },
}
