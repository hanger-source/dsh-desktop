const script = document.currentScript
if (!script) throw new Error('dsh-desktop-runtime: document.currentScript unavailable')
const pathname = decodeURIComponent(new URL(script.src).pathname)
const prefix = '/plugins/'
const suffix = '/client.js'
if (!pathname.startsWith(prefix) || !pathname.endsWith(suffix)) {
  throw new Error('dsh-desktop-runtime: unexpected bundle URL ' + pathname)
}
const moduleId = pathname.slice(prefix.length, -suffix.length)

window.__ModuleLoader__.load({
  id: moduleId,
  factory: () => {
    const inject = ['slots', 'remote', 'remote.dynamicCordisRunner', 'dynamicCordisRunner']
    const h = React.createElement
    const nativeControl = () => window.webkit?.messageHandlers?.dshAppControl

    async function api(path, options = {}) {
      const response = await fetch('/api/dsh-desktop' + path, {
        method: options.method || 'GET',
        headers: options.body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      })
      const result = await response.json().catch(() => null)
      if (!response.ok || !result || result.ok !== true) {
        throw new Error((result && result.error) || ('HTTP ' + response.status))
      }
      return result.value
    }

    function installStyles() {
      const style = document.createElement('style')
      style.id = 'dsh-desktop-runtime-styles'
      style.textContent = [
        '.dsh-desktop-root{display:flex;flex-direction:column;gap:12px;padding:4px 2px 16px;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}',
        '.dsh-desktop-card{display:flex;flex-direction:column;gap:8px;padding:14px 16px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}',
        '.dsh-desktop-title{font-size:14px;font-weight:650;color:var(--dsw-alias-label-primary)}',
        '.dsh-desktop-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
        '.dsh-desktop-grow{flex:1;min-width:120px}',
        '.dsh-desktop-muted{font-size:12px;color:var(--dsw-alias-label-tertiary)}',
        '.dsh-desktop-mono{font-family:var(--dsh-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:11px;word-break:break-all}',
        '.dsh-desktop-ok{color:var(--dsw-alias-state-success-primary)}',
        '.dsh-desktop-warn{color:var(--dsw-alias-state-warn-primary)}',
        '.dsh-desktop-error{color:var(--dsw-alias-state-error-primary)}',
        '.dsh-desktop-btn{appearance:none;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:5px 14px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;line-height:1.4}',
        '.dsh-desktop-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}',
        '.dsh-desktop-btn-primary{border-color:transparent;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}',
        '.dsh-desktop-btn-primary:hover{background:var(--dsw-alias-button-primary-hover)}',
        '.dsh-desktop-btn:disabled{opacity:.5;cursor:default}',
        '.dsh-desktop-badge{flex:none;padding:1px 8px;border-radius:999px;font-size:11px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-tertiary)}',
        '.dsh-desktop-badge-on{background:var(--dsw-alias-state-success-tertiary);color:var(--dsw-alias-state-success-primary)}',
        '.dsh-plugin-item{display:flex;align-items:center;gap:10px;padding:9px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}',
        '.dsh-plugin-name{font-weight:600;color:var(--dsw-alias-label-primary)}',
        '.dsh-plugin-purpose{flex:1;min-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--dsw-alias-label-tertiary)}',
        '.dsh-settings-nav-plugin-store>svg,.dsh-settings-nav-app>svg{display:none}',
        '.dsh-settings-nav-plugin-store::before,.dsh-settings-nav-app::before{content:"";width:16px;height:16px;flex:none;background:currentColor;-webkit-mask-image:var(--dsh-settings-nav-icon);-webkit-mask-position:center;-webkit-mask-repeat:no-repeat;-webkit-mask-size:16px 16px;mask-image:var(--dsh-settings-nav-icon);mask-position:center;mask-repeat:no-repeat;mask-size:16px 16px}',
        '.dsh-settings-nav-plugin-store{--dsh-settings-nav-icon:url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2716%27 height=%2716%27 viewBox=%270 0 16 16%27 fill=%27none%27 stroke=%27black%27 stroke-width=%271.4%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27%3E%3Crect x=%272%27 y=%272%27 width=%275%27 height=%275%27 rx=%271%27/%3E%3Crect x=%279%27 y=%272%27 width=%275%27 height=%275%27 rx=%271%27/%3E%3Crect x=%272%27 y=%279%27 width=%275%27 height=%275%27 rx=%271%27/%3E%3Cpath d=%27M11.5 9v5M9 11.5h5%27/%3E%3C/svg%3E")}',
        '.dsh-settings-nav-app{--dsh-settings-nav-icon:url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2716%27 height=%2716%27 viewBox=%270 0 16 16%27 fill=%27none%27 stroke=%27black%27 stroke-width=%271.4%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27%3E%3Crect x=%272%27 y=%272.5%27 width=%2712%27 height=%2711%27 rx=%272%27/%3E%3Cpath d=%27M2 5.5h12%27/%3E%3Cpath d=%27M4.5 4h.01M6.5 4h.01%27/%3E%3C/svg%3E")}',
        '.hHd-Xa_footArea{flex-direction:row!important;align-items:flex-end!important;justify-content:space-between!important;gap:8px!important}',
        '.hHd-Xa_footerActions{width:auto!important;flex:1 1 auto!important;min-width:0!important;display:flex!important;align-items:flex-start!important;gap:6px!important;flex-wrap:wrap!important}',
        '.hHd-Xa_settingsArea{width:auto!important;flex:none!important;margin:0!important;padding:0!important}',
        '.hHd-Xa_settingsArea>*{margin:0!important}',
        '.VOzbGW_trigger,.VOzbGW_rail{margin:0!important}',
        '.hHd-Xa_collapsed .hHd-Xa_footArea{justify-content:center!important;align-items:center!important}',
        '.mq-root{flex:0 0 100%!important;max-width:none!important;order:-1!important;padding:4px 6px!important}',
        '.Nqubda_layer{width:auto!important;margin:0!important}',
        '.Nqubda_badgeLabel{display:none!important}',
      ].join('')
      document.head.appendChild(style)
      return () => style.remove()
    }

    function installSettingsNavIcons() {
      const classes = new Map([
        ['Hang 的插件', 'dsh-settings-nav-plugin-store'],
        ['App', 'dsh-settings-nav-app'],
      ])
      const mark = () => {
        for (const button of document.querySelectorAll('[role="dialog"] nav button')) {
          const className = classes.get(button.textContent?.trim())
          if (className) button.classList.add(className)
        }
      }
      mark()
      const observer = new MutationObserver(mark)
      observer.observe(document.documentElement, { childList: true, subtree: true })
      return () => {
        observer.disconnect()
        for (const className of classes.values()) {
          for (const row of document.querySelectorAll('.' + className)) row.classList.remove(className)
        }
      }
    }

    async function activatePlugins(ctx, activations) {
      const live = new Map(ctx.dynamicCordisRunner.getSnapshot().map(row => [row.pluginId, row]))
      const errors = []
      for (const target of activations || []) {
        if (!target.pluginId || !target.packageId) continue
        const current = live.get(target.pluginId)
        if (current && current.packageId === target.packageId) continue
        try {
          await ctx.dynamicCordisRunner.startUserRun({
            agentId: target.agentId,
            pluginId: target.pluginId,
            packageId: target.packageId,
            mode: current ? 'update' : target.mode,
            hasClientHalf: target.hasClientHalf,
          })
        } catch (error) {
          errors.push({ key: target.key, error: error.message || String(error) })
        }
      }
      return errors
    }

    function AppSection() {
      const [state, setState] = React.useState({ loading: true, value: null, error: null })
      const [busy, setBusy] = React.useState(null)
      const [message, setMessage] = React.useState(null)

      const load = React.useCallback(async (force = false) => {
        setState(previous => ({ ...previous, loading: true, error: null }))
        try {
          const value = await api('/status' + (force ? '?force=1' : ''))
          setState({ loading: false, value, error: null })
        } catch (error) {
          setState({ loading: false, value: null, error: error.message || String(error) })
        }
      }, [])

      React.useEffect(() => { load(false) }, [load])

      const restart = () => nativeControl()?.postMessage('restart')
      const openExternal = url => {
        if (!url) return
        const bridge = nativeControl()
        if (bridge) bridge.postMessage({ action: 'openExternal', url })
        else window.open(url, '_blank', 'noopener,noreferrer')
      }
      const updateDsh = async () => {
        setBusy('dsh')
        setMessage(null)
        try {
          await api('/dsh/update', { method: 'POST' })
          setMessage({ kind: 'ok', text: 'dsh 已更新，正在重启 App…' })
          window.setTimeout(restart, 400)
        } catch (error) {
          setMessage({ kind: 'error', text: 'dsh 更新失败：' + (error.message || String(error)) })
          setBusy(null)
        }
      }

      if (state.loading && !state.value) return h('div', { className: 'dsh-desktop-root' }, h('span', { className: 'dsh-desktop-muted' }, '正在检查三个更新域…'))
      if (state.error) return h('div', { className: 'dsh-desktop-root' }, h('span', { className: 'dsh-desktop-error' }, state.error))
      const value = state.value
      const app = value.app
      const dsh = value.dsh
      const status = (installed, latest, available, error) => h('div', { className: 'dsh-desktop-row' }, [
        h('span', null, '当前 ' + (installed || '未知')),
        h('span', { className: 'dsh-desktop-muted' }, '最新 ' + (latest || '未知')),
        available === true
          ? h('span', { className: 'dsh-desktop-warn' }, '有更新')
          : available === false
            ? h('span', { className: 'dsh-desktop-ok' }, '已是最新')
            : null,
        error ? h('span', { className: 'dsh-desktop-error' }, error) : null,
      ])

      return h('div', { className: 'dsh-desktop-root' }, [
        h('div', { className: 'dsh-desktop-card' }, [
          h('div', { className: 'dsh-desktop-title' }, 'DSH Desktop'),
          status(app.installed, app.latest, app.updateAvailable, app.error),
          h('div', { className: 'dsh-desktop-row' }, [
            h('button', { className: 'dsh-desktop-btn', disabled: state.loading, onClick: () => load(true) }, state.loading ? '检查中…' : '检查更新'),
            app.updateAvailable
              ? h('button', { className: 'dsh-desktop-btn dsh-desktop-btn-primary', onClick: () => openExternal(app.assetUrl || app.releaseUrl) }, '下载新 App')
              : null,
            h('button', { className: 'dsh-desktop-btn', disabled: !nativeControl(), onClick: restart }, '重启 APP'),
          ]),
          h('div', { className: 'dsh-desktop-muted dsh-desktop-mono' }, app.bundlePath || ''),
        ]),
        h('div', { className: 'dsh-desktop-card' }, [
          h('div', { className: 'dsh-desktop-title' }, '@deepseek-ai/dsh'),
          status(dsh.installed, dsh.latest, dsh.updateAvailable, dsh.installedError || dsh.latestError),
          h('div', { className: 'dsh-desktop-row' }, [
            h('button', { className: 'dsh-desktop-btn dsh-desktop-btn-primary', disabled: busy === 'dsh', onClick: updateDsh }, busy === 'dsh' ? '正在更新…' : '更新并重启 APP'),
          ]),
          h('div', { className: 'dsh-desktop-muted' }, 'npm 包更新后必须重启 App，新的 dsh 进程才会生效。'),
        ]),
        message ? h('div', { className: message.kind === 'ok' ? 'dsh-desktop-ok' : 'dsh-desktop-error' }, message.text) : null,
      ])
    }

    function PluginSection(props) {
      const ctx = props.ctx
      const [state, setState] = React.useState({ loading: true, value: null, error: null })
      const [busy, setBusy] = React.useState(null)
      const [message, setMessage] = React.useState(null)

      const load = React.useCallback(async () => {
        try {
          const value = await api('/plugins')
          setState({ loading: false, value, error: null })
        } catch (error) {
          setState({ loading: false, value: null, error: error.message || String(error) })
        }
      }, [])
      React.useEffect(() => { load() }, [load])

      const sync = async () => {
        setBusy('sync')
        setMessage(null)
        try {
          const result = await api('/plugins/sync', { method: 'POST' })
          const activationErrors = await activatePlugins(ctx, result.activations)
          setMessage({
            kind: activationErrors.length > 0 ? 'error' : 'ok',
            text: activationErrors.length > 0
              ? '仓库已同步，但重载失败：' + activationErrors.map(item => item.key + ': ' + item.error).join('；')
              : '已同步到 ' + (result.commit || '最新提交') + '，插件已在当前页面重载。',
          })
          await load()
        } catch (error) {
          setMessage({ kind: 'error', text: '同步失败：' + (error.message || String(error)) })
        } finally {
          setBusy(null)
        }
      }

      const toggle = async plugin => {
        setBusy(plugin.key)
        setMessage(null)
        try {
          const result = await api('/plugins/toggle', { method: 'POST', body: { key: plugin.key } })
          const activationErrors = await activatePlugins(ctx, result.activations)
          setMessage({
            kind: activationErrors.length > 0 ? 'error' : 'ok',
            text: activationErrors.length > 0 ? activationErrors.map(item => item.error).join('；') : result.text,
          })
          await load()
        } catch (error) {
          setMessage({ kind: 'error', text: error.message || String(error) })
        } finally {
          setBusy(null)
        }
      }

      if (state.loading) return h('div', { className: 'dsh-desktop-root' }, h('span', { className: 'dsh-desktop-muted' }, '正在读取插件仓库…'))
      if (state.error) return h('div', { className: 'dsh-desktop-root' }, h('span', { className: 'dsh-desktop-error' }, state.error))
      const view = state.value
      return h('div', { className: 'dsh-desktop-root' }, [
        h('div', { className: 'dsh-desktop-card' }, [
          h('div', { className: 'dsh-desktop-row' }, [
            h('div', { className: 'dsh-desktop-title dsh-desktop-grow' }, 'Hang 的插件'),
            h('button', { className: 'dsh-desktop-btn dsh-desktop-btn-primary', disabled: busy !== null, onClick: sync }, busy === 'sync' ? '同步并重载中…' : '同步并重载'),
          ]),
          h('div', { className: 'dsh-desktop-muted dsh-desktop-mono' }, view.repoPath),
          h('div', { className: 'dsh-desktop-row' }, [
            h('span', null, view.repoExists ? 'commit ' + (view.commit || '未知') : '尚未下载插件仓库'),
            view.sync?.state === 'failed' ? h('span', { className: 'dsh-desktop-error' }, view.sync.error) : null,
          ]),
        ]),
        ...(view.packages || []).map(plugin => {
          const running = plugin.state === 'running'
          const disabled = plugin.state === 'disabled'
          const stateText = running ? '运行中' : (disabled ? '已停用' : (plugin.state === 'ready' ? '待启用' : '正在装配'))
          return h('div', { key: plugin.key, className: 'dsh-plugin-item' }, [
            h('span', { className: 'dsh-plugin-name' }, plugin.name),
            h('span', { className: 'dsh-plugin-purpose' }, plugin.purpose),
            h('span', { className: 'dsh-desktop-badge' + (running ? ' dsh-desktop-badge-on' : '') }, stateText),
            h('button', { className: 'dsh-desktop-btn', disabled: busy !== null, onClick: () => toggle(plugin) }, busy === plugin.key ? '处理中…' : (running ? '停用' : '启用')),
          ])
        }),
        message ? h('div', { className: message.kind === 'ok' ? 'dsh-desktop-ok' : 'dsh-desktop-error' }, message.text) : null,
      ])
    }

    function apply(ctx) {
      let disposed = false
      let retryTimer = null
      let retries = 30
      const scheduleReconcile = (delay = 0) => {
        if (disposed) return
        if (retryTimer !== null) clearTimeout(retryTimer)
        retryTimer = setTimeout(async () => {
          retryTimer = null
          try {
            const result = await api('/plugins/reconcile', { method: 'POST' })
            const errors = await activatePlugins(ctx, result.activations)
            if ((result.pending || result.activations.length === 0 || errors.length > 0) && retries-- > 0) scheduleReconcile(500)
          } catch (error) {
            console.error('[dsh-desktop-runtime] 插件自动挂载失败：', error)
            if (retries-- > 0) scheduleReconcile(500)
          }
        }, delay)
      }

      ctx.on('connection/reset', () => {
        retries = 30
        scheduleReconcile()
      })
      ctx.effect(() => {
        const disposeStyles = installStyles()
        const disposeIcons = installSettingsNavIcons()
        scheduleReconcile()
        const slots = ctx.get('slots')
        const disposePlugins = slots.inject('settings.section', () => slots.register(
          { name: 'settings.section', id: 'plugin-store', order: 25, label: 'Hang 的插件' },
          () => h(PluginSection, { ctx }),
        ))
        const disposeApp = slots.inject('settings.section', () => slots.register(
          { name: 'settings.section', id: 'dsh-app', order: 30, label: 'App' },
          () => h(AppSection),
        ))
        return () => {
          disposed = true
          if (retryTimer !== null) clearTimeout(retryTimer)
          if (typeof disposePlugins === 'function') disposePlugins()
          if (typeof disposeApp === 'function') disposeApp()
          disposeIcons()
          disposeStyles()
        }
      }, 'dsh-desktop-runtime: App 设置、插件同步与可信自动挂载')
    }

    return { inject, apply }
  },
})
