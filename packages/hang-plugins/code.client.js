// hang-plugins —— CLIENT 半（当前最新版）
//
// 内容即 cordis_define 的 code.client 函数体。功能：
// 1) 设置页「Hang 的插件」：同步仓库、插件列表（运行中/已停用/未启用）+ 启停按钮；
// 2) 底部一行：cordis 按钮只显示图标+纯数字（CSS 裁掉 " running"），设置靠右同排对齐。
return {
  inject: ['slots', 'timer'],
  apply(ctx) {
    styles.insert('\n' +
      // 底部一行：左侧 footer 区（cordis 按钮自带纯数字），右侧设置，垂直居中。
      '.hHd-Xa_footArea{flex-direction:row!important;align-items:flex-end!important;justify-content:space-between!important;gap:8px!important}' +
      '.hHd-Xa_footerActions{width:auto!important;flex:1 1 auto!important;min-width:0!important;display:flex!important;align-items:flex-start!important;gap:6px!important;flex-wrap:wrap!important}' +
      '.hHd-Xa_settingsArea{width:auto!important;flex:none!important;margin:0!important;padding:0!important}' +
      '.hHd-Xa_settingsArea > *{margin-bottom:0!important}' +
      '.hHd-Xa_collapsed .hHd-Xa_footArea{justify-content:center!important;align-items:center!important}' +
      // 用量面板弹性显示，不再占满整行把设置挤开。
      '.mq-root{flex:0 0 100%!important;max-width:none!important;order:-1!important;padding:4px 6px!important}' +
      // cordis 按钮：隐藏“Cordis Plugin”文字；数字徽标只露数字部分（裁掉 “ running”）。
      '.Nqubda_layer{width:auto!important;margin:0!important}' +
      '.Nqubda_badgeLabel{display:none!important}' +
      '.Nqubda_badgeCount{max-width:18px!important;overflow:hidden!important;white-space:nowrap!important;text-overflow:clip!important}' +
      '.pstore-root{display:flex;flex-direction:column;gap:14px;padding:4px 2px 12px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}' +
      '.pstore-src{display:flex;flex-direction:column;gap:4px;padding:10px 12px;border-radius:10px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1)}' +
      '.pstore-src-main{display:flex;align-items:center;gap:8px;font-weight:600;color:var(--dsw-alias-label-primary)}' +
      '.pstore-hint{font-size:12px;color:var(--dsw-alias-label-tertiary)}' +
      '.pstore-link{color:var(--dsw-alias-state-business-primary);text-decoration:none}' +
      '.pstore-link:hover{text-decoration:underline}' +
      '.pstore-btn{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);border-radius:8px;padding:5px 12px;font-size:13px;cursor:pointer}' +
      '.pstore-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}' +
      '.pstore-btn:disabled{opacity:.5;cursor:default}' +
      '.pstore-item{display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:8px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1)}' +
      '.pstore-item + .pstore-item{margin-top:6px}' +
      '.pstore-name{font-weight:600;color:var(--dsw-alias-label-primary)}' +
      '.pstore-desc{flex:1;min-width:0;font-size:12px;color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;overflow:hidden}' +
      '.pstore-state{flex:none;font-size:11px;border-radius:999px;padding:1px 8px}' +
      '.pstore-state-on{background:var(--dsw-alias-state-success-tertiary);color:var(--dsw-alias-state-success-primary)}' +
      '.pstore-state-off{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-tertiary)}' +
      '.pstore-ok{color:var(--dsw-alias-state-success-primary)}' +
      '.pstore-warn{color:var(--dsw-alias-state-warn-primary)}' +
      '.pstore-err{color:var(--dsw-alias-state-error-primary)}' +
      '.pstore-mono{font-family:var(--dsh-font-mono,monospace);font-size:11px;word-break:break-all}')

    function StorePage() {
      const [view, setView] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [msg, setMsg] = React.useState(null)
      const [error, setError] = React.useState(null)

      const load = React.useCallback(async () => {
        try {
          const data = await host.call('pstore.list')
          setView(data)
          setError(null)
        } catch (e) {
          setError(String((e && e.message) || e))
        }
      }, [])

      React.useEffect(() => {
        load()
      }, [load])

      const pull = async () => {
        setBusy(true)
        setMsg(null)
        try {
          const res = await host.call('pstore.pull')
          setBusy(false)
          setMsg({ kind: 'ok', text: '已同步到 ' + res.commit + (res.changed > 0 ? '（更新了 ' + res.changed + ' 个提交）' : '（已是最新）') })
          await load()
        } catch (e) {
          setBusy(false)
          setError(String((e && e.message) || e))
        }
      }

      const toggle = async (k) => {
        setBusy(true)
        setMsg(null)
        try {
          const res = await host.call('pstore.toggle', { key: String(k.key), pluginId: k.pluginId || null })
          setBusy(false)
          if (res && res.ok) {
            setMsg({ kind: 'ok', text: res.text || '完成' })
          } else {
            setMsg({ kind: 'err', text: (res && (res.error || res.message)) || '操作失败' })
          }
          await load()
        } catch (e) {
          setBusy(false)
          setError(String((e && e.message) || e))
        }
      }

      if (error) {
        return React.createElement('div', { className: 'pstore-root' },
          React.createElement('span', { className: 'pstore-err' }, '出错：' + error))
      }
      if (!view) {
        return React.createElement('div', { className: 'pstore-root' },
          React.createElement('span', { className: 'pstore-hint' }, '正在读取…'))
      }

      const packages = view.packages || []

      const rows = packages.map((k) => {
        const running = k.state === 'running'
        const stopped = k.state === 'stopped'
        const stateText = running ? '运行中' : (stopped ? '已停用' : '未启用')
        const btnText = running ? '停用' : '启用'
        return React.createElement('div', { key: k.key, className: 'pstore-item' },
          React.createElement('span', { className: 'pstore-name' }, k.key),
          React.createElement('span', { className: 'pstore-desc' }, k.name || ''),
          React.createElement('span', { className: 'pstore-state ' + (running ? 'pstore-state-on' : 'pstore-state-off') }, stateText),
          React.createElement('button', { className: 'pstore-btn', disabled: busy, onClick: () => { toggle(k) } }, btnText))
      })

      const msgEl = msg
        ? React.createElement('span', { className: msg.kind === 'ok' ? 'pstore-ok' : (msg.kind === 'warn' ? 'pstore-warn' : 'pstore-err') }, msg.text)
        : null

      return React.createElement('div', { className: 'pstore-root' },
        React.createElement('div', { className: 'pstore-src' },
          React.createElement('span', { className: 'pstore-src-main' },
            React.createElement('span', null, 'Hang 的插件'),
            React.createElement('a', {
              className: 'pstore-hint pstore-link pstore-mono',
              href: view.remote,
              target: '_blank',
              rel: 'noreferrer',
              title: '在浏览器打开 GitHub 仓库',
            }, view.remote)),
          React.createElement('span', { className: 'pstore-hint' },
            '本机副本 ', view.repoPath,
            view.repoExists
              ? React.createElement('span', { className: 'pstore-ok' }, '　（commit ' + (view.commit || '?') + '）')
              : React.createElement('span', { className: 'pstore-err' }, '　尚无副本')),
          React.createElement('div', { style: { display: 'flex', gap: 8, marginTop: 6 } },
            React.createElement('button', { className: 'pstore-btn', disabled: busy, onClick: () => { pull() } },
              busy ? '处理中…' : '同步仓库')),
          msgEl),
        rows.length > 0
          ? React.createElement(React.Fragment, null, rows)
          : React.createElement('span', { className: 'pstore-hint' }, '仓库里还没有插件'))
    }

    const slots = ctx.get('slots')
    if (slots === undefined) return
    slots.inject('settings.section', () => slots.register(
      { name: 'settings.section', id: 'plugin-store', order: 25, label: 'Hang 的插件' },
      (props) => React.createElement(StorePage, props),
    ))
  },
}