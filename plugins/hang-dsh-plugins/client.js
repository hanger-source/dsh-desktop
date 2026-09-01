window.__ModuleLoader__.load({
  id: '@hanger-source/hang-dsh-plugins',
  factory: (require) => {
    const React = require('react')
    const inject = ['slots']
    const h = React.createElement
    const nativeControl = () => window.webkit?.messageHandlers?.dshAppControl
    let appStatusSnapshot = null

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
      style.id = 'hang-dsh-plugins-styles'
      style.textContent = [
        '.dsh-desktop-root{display:flex;flex-direction:column;gap:12px;padding:4px 2px 16px;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}',
        '.dsh-desktop-card{display:flex;flex-direction:column;gap:8px;padding:14px 16px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}',
        '.dsh-desktop-app-root{gap:0;padding:0 14px 16px}',
        '.dsh-desktop-version-card{display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"header actions" "detail detail";align-items:center;column-gap:16px;row-gap:6px;padding:14px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}',
        '.dsh-desktop-version-card.dsh-version-last{border-bottom:0}',
        '.dsh-version-header{grid-area:header;display:flex;align-items:center;gap:10px;min-width:0;white-space:nowrap}',
        '.dsh-version-status{display:flex;align-items:center;gap:10px;min-width:0;white-space:nowrap;overflow:hidden}',
        '.dsh-version-actions{grid-area:actions;justify-self:end}',
        '.dsh-version-detail{grid-area:detail}',
        '.dsh-desktop-title{font-size:14px;font-weight:650;color:var(--dsw-alias-label-primary)}',
        '.dsh-desktop-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
        '.dsh-desktop-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;min-height:32px}',
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
        '.dsh-desktop-btn-ok{border-color:transparent;background:var(--dsw-alias-state-success-tertiary);color:var(--dsw-alias-state-success-primary)}',
        '.dsh-desktop-btn:disabled{opacity:.5;cursor:default}',
        '.dsh-desktop-badge{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;flex:none;height:26px;padding:0 10px;border-radius:999px;font-size:11px;line-height:1;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-tertiary)}',
        '.dsh-plugin-channel{appearance:none!important;box-sizing:border-box!important;flex:none!important;width:86px!important;min-width:86px!important;max-width:86px!important;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:4px 22px 4px 9px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit}',
        '.dsh-plugin-origin-local{background:var(--dsw-alias-state-warn-tertiary);color:var(--dsw-alias-state-warn-primary)}',
        '.dsh-plugin-item{position:relative;display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-rows:auto auto;grid-template-areas:"summary actions" "purpose purpose";align-content:center;align-items:center;column-gap:20px;row-gap:12px;padding:10px 18px 16px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);overflow:hidden}',
        '.dsh-plugin-summary{grid-area:summary;display:flex;align-items:center;gap:10px;min-width:0}',
        '.dsh-plugin-actions{grid-area:actions;display:flex;align-items:center;justify-content:flex-end;gap:10px;min-width:0;padding-right:42px}',
        '.dsh-plugin-name{font-weight:600;color:var(--dsw-alias-label-primary)}',
        '.dsh-plugin-purpose{grid-area:purpose;min-width:0;white-space:normal;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}',
        '.dsh-plugin-version{flex:none;font-size:12px;color:var(--dsw-alias-label-tertiary)}',
        '.dsh-plugin-state-dot{width:8px;height:8px;flex:none;border-radius:50%;background:var(--dsw-alias-label-quaternary);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-label-quaternary) 14%,transparent)}',
        '.dsh-plugin-state-dot[data-enabled]{background:var(--dsw-alias-state-success-primary);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-success-primary) 14%,transparent)}',
        '.dsh-plugin-channel-tag{position:absolute;z-index:1;top:11px;right:-34px;width:108px;padding:2px 0;text-align:center;font-size:11px;font-weight:600;line-height:17px;letter-spacing:.2px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-tertiary);transform:rotate(45deg);transform-origin:center;pointer-events:none}',
        '.dsh-plugin-channel-tag[data-beta]{background:var(--dsw-alias-state-warn-tertiary);color:var(--dsw-alias-state-warn-primary)}',
        '.hHd-Xa_root:not(.hHd-Xa_collapsed){padding-bottom:4px!important}',
        '.hHd-Xa_footArea{display:grid!important;grid-template-columns:auto minmax(0,1fr)!important;align-items:center!important;column-gap:8px!important}',
        '.hHd-Xa_footerActions{display:contents!important}',
        '.hHd-Xa_settingsArea{grid-column:2!important;grid-row:2!important;width:100%!important;margin:0!important;padding:0!important}',
        '.hHd-Xa_settingsArea>*{width:100%!important;margin:0!important}',
        '.hHd-Xa_settingsArea>div>.VOzbGW_trigger{justify-content:flex-end!important}',
        '.hHd-Xa_collapsed .hHd-Xa_footArea{display:flex!important;justify-content:center!important;align-items:center!important}',
        '.mq-root{grid-column:1/-1!important;grid-row:1!important}',
        '.Nqubda_layer{grid-column:1!important;grid-row:2!important;width:auto!important;margin:0!important}',
        '.Nqubda_badgeLabel{display:none!important}',
        '.dsh-cordis-empty{grid-column:1;grid-row:2;position:relative;min-width:0}',
        '.dsh-cordis-empty-button{appearance:none;display:inline-flex;align-items:center;gap:8px;height:42px;padding:0 8px;border:0;border-radius:10px;background:transparent;color:var(--dsw-alias-label-secondary);font:12px/16px inherit;cursor:pointer}',
        '.hHd-Xa_collapsed .dsh-cordis-empty-button{width:36px;height:36px;padding:0;justify-content:center;border-radius:50%}',
        '.dsh-cordis-empty-button:hover,.dsh-cordis-empty-button[data-active]{background:var(--dsw-alias-interactive-bg-hover)}',
        '.dsh-cordis-empty-popover{position:absolute;left:0;bottom:44px;z-index:30;width:240px;padding:14px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 12px 32px rgb(0 0 0 / 14%)}',
        '.dsh-cordis-empty-title{font-size:13px;font-weight:650;color:var(--dsw-alias-label-primary)}',
        '.dsh-settings-nav-plugin-store>svg,.dsh-settings-nav-app>svg{display:none}',
        '.dsh-settings-nav-plugin-store::before,.dsh-settings-nav-app::before{content:"";width:16px;height:16px;flex:none;background:currentColor;-webkit-mask-image:var(--dsh-settings-nav-icon);-webkit-mask-position:center;-webkit-mask-repeat:no-repeat;-webkit-mask-size:16px 16px;mask-image:var(--dsh-settings-nav-icon);mask-position:center;mask-repeat:no-repeat;mask-size:16px 16px}',
        '.dsh-settings-nav-plugin-store{--dsh-settings-nav-icon:url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2716%27 height=%2716%27 viewBox=%270 0 16 16%27 fill=%27none%27 stroke=%27black%27 stroke-width=%271.4%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27%3E%3Crect x=%272%27 y=%272%27 width=%275%27 height=%275%27 rx=%271%27/%3E%3Crect x=%279%27 y=%272%27 width=%275%27 height=%275%27 rx=%271%27/%3E%3Crect x=%272%27 y=%279%27 width=%275%27 height=%275%27 rx=%271%27/%3E%3Cpath d=%27M11.5 9v5M9 11.5h5%27/%3E%3C/svg%3E")}',
        '.dsh-settings-nav-app{--dsh-settings-nav-icon:url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2716%27 height=%2716%27 viewBox=%270 0 16 16%27 fill=%27none%27 stroke=%27black%27 stroke-width=%271.4%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27%3E%3Crect x=%272%27 y=%272.5%27 width=%2712%27 height=%2711%27 rx=%272%27/%3E%3Cpath d=%27M2 5.5h12%27/%3E%3Cpath d=%27M4.5 4h.01M6.5 4h.01%27/%3E%3C/svg%3E")}',
      ].join('')
      document.head.appendChild(style)
      return () => style.remove()
    }

    function CordisEmptyAction(props) {
      const [nativePresent, setNativePresent] = React.useState(() => Boolean(document.querySelector('[data-cordis-badge]')))
      const [open, setOpen] = React.useState(false)
      React.useEffect(() => {
        const inspect = () => setNativePresent(Boolean(document.querySelector('[data-cordis-badge]')))
        const observer = new MutationObserver(inspect)
        observer.observe(document.body, { childList: true, subtree: true })
        inspect()
        return () => observer.disconnect()
      }, [])

      if (nativePresent) return null
      const wide = !props || props.wide !== false
      return h('div', { className: 'dsh-cordis-empty' }, [
        h('button', {
          key: 'button',
          type: 'button',
          className: 'dsh-cordis-empty-button',
          'data-active': open || undefined,
          'aria-label': 'Cordis 插件',
          'aria-expanded': open,
          onClick: () => setOpen(value => !value),
        }, [
          h('svg', { key: 'icon', width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4 }, [
            h('path', { key: 'a', d: 'M8 1.8v3M8 11.2v3M1.8 8h3M11.2 8h3' }),
            h('path', { key: 'b', d: 'm6.8 3-1.2-1.2M9.2 3l1.2-1.2M6.8 13l-1.2 1.2M9.2 13l1.2 1.2M3 6.8 1.8 5.6M3 9.2l-1.2 1.2M13 6.8l1.2-1.2M13 9.2l1.2 1.2' }),
          ]),
          wide ? h('span', { key: 'count' }, '0 running') : null,
        ]),
        open ? h('div', { key: 'popover', className: 'dsh-cordis-empty-popover' }, [
          h('div', { key: 'title', className: 'dsh-cordis-empty-title' }, 'Cordis 插件'),
          h('div', { key: 'empty', className: 'dsh-desktop-muted' }, '还没有定义任何插件'),
        ]) : null,
      ])
    }

    function installSettingsNavIcons() {
      const classes = new Map([
        ['Hang 的插件', 'dsh-settings-nav-plugin-store'],
        ['Desktop App', 'dsh-settings-nav-app'],
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

    function AppSection() {
      const [state, setState] = React.useState({
        loading: !appStatusSnapshot,
        value: appStatusSnapshot,
        error: null,
      })
      const [checking, setChecking] = React.useState({})
      const [checkFeedback, setCheckFeedback] = React.useState({})
      const [busy, setBusy] = React.useState(null)
      const [message, setMessage] = React.useState(null)
      const feedbackTimers = React.useRef({})

      const flashLatest = React.useCallback(key => {
        if (feedbackTimers.current[key]) window.clearTimeout(feedbackTimers.current[key])
        setCheckFeedback(previous => ({ ...previous, [key]: true }))
        feedbackTimers.current[key] = window.setTimeout(() => {
          delete feedbackTimers.current[key]
          setCheckFeedback(previous => ({ ...previous, [key]: false }))
        }, 2500)
      }, [])

      React.useEffect(() => () => {
        for (const timer of Object.values(feedbackTimers.current)) window.clearTimeout(timer)
      }, [])

      const load = React.useCallback(async () => {
        setState(previous => ({ ...previous, loading: true, error: null }))
        try {
          const value = await api('/status')
          appStatusSnapshot = value
          setState({ loading: false, value, error: null })
        } catch (error) {
          setState(previous => ({ loading: false, value: previous.value, error: error.message || String(error) }))
        }
      }, [])

      React.useEffect(() => { load() }, [load])

      const check = async (key, endpoint) => {
        setChecking(previous => ({ ...previous, [key]: true }))
        try {
          const result = await api('/status/' + endpoint)
          setState(previous => {
            const value = { ...(previous.value || {}), [key]: result }
            appStatusSnapshot = value
            return { loading: false, value, error: null }
          })
          const error = key === 'dsh' ? result.latestError : result.error
          if (!error && result.updateAvailable === false) flashLatest(key)
        } catch (error) {
          setState(previous => ({ ...previous, error: error.message || String(error) }))
        } finally {
          setChecking(previous => ({ ...previous, [key]: false }))
        }
      }

      React.useEffect(() => {
        const receiveUpdate = event => {
          const detail = event.detail || {}
          if (detail.state === 'failed') {
            setBusy(null)
            setMessage({ kind: 'error', text: 'App 更新失败：' + (detail.message || '未知错误') })
            return
          }
          setBusy('app')
          setMessage({ kind: 'ok', text: detail.message || '正在更新 APP…' })
        }
        window.addEventListener('dsh-app-update', receiveUpdate)
        return () => window.removeEventListener('dsh-app-update', receiveUpdate)
      }, [])

      React.useEffect(() => {
        const receiveUpdate = event => {
          const detail = event.detail || {}
          if (detail.state === 'failed') {
            setBusy(null)
            setMessage({ kind: 'error', text: '基础插件更新失败：' + (detail.message || '未知错误') })
            return
          }
          setBusy('plugin-manager')
          setMessage({ kind: 'ok', text: detail.message || '正在更新基础插件…' })
        }
        window.addEventListener('dsh-plugin-manager-update', receiveUpdate)
        return () => window.removeEventListener('dsh-plugin-manager-update', receiveUpdate)
      }, [])

      const restart = () => nativeControl()?.postMessage('restart')
      const updateApp = () => {
        const bridge = nativeControl()
        if (!bridge || !app.assetUrl || !app.checksumUrl || !app.latest) return
        setBusy('app')
        setMessage({ kind: 'ok', text: '正在准备 App 更新…' })
        bridge.postMessage({
          action: 'updateApp',
          url: app.assetUrl,
          checksumUrl: app.checksumUrl,
          version: app.latest,
        })
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
      const updatePluginManager = () => {
        const bridge = nativeControl()
        if (!bridge || !pluginManager.latest) return
        setBusy('plugin-manager')
        setMessage({ kind: 'ok', text: '正在准备基础插件更新…' })
        bridge.postMessage({
          action: 'updatePluginManager',
          version: pluginManager.latest,
        })
      }

      const value = state.value || {}
      const app = value.app || {}
      const pluginManager = value.pluginManager || {}
      const dsh = value.dsh || {}
      const status = (key, installed, latest, available, error) => h('div', { className: 'dsh-version-status' }, [
        installed ? h('span', null, installed) : null,
        !checking[key] && latest && available === true
          ? h('span', { className: 'dsh-desktop-muted' }, '最新 ' + latest)
          : null,
        !checking[key] && available === true
          ? h('span', { className: 'dsh-desktop-warn' }, '有更新')
          : null,
        !checking[key] && error ? h('span', { className: 'dsh-desktop-error' }, error) : null,
      ])

      return h('div', { className: 'dsh-desktop-root dsh-desktop-app-root' }, [
        h('div', { className: 'dsh-desktop-version-card' }, [
          h('div', { className: 'dsh-version-header' }, [
            h('span', { className: 'dsh-desktop-title' }, 'DSH Desktop'),
            status('app', app.installed, app.latest, app.updateAvailable, app.error),
          ]),
          h('div', { className: 'dsh-desktop-row dsh-version-actions' }, [
            h('button', {
              className: 'dsh-desktop-btn' + (checkFeedback.app ? ' dsh-desktop-btn-ok' : ''),
              disabled: state.loading || checking.app,
              onClick: () => check('app', 'app'),
            }, checking.app ? '检查中…' : (checkFeedback.app ? '已是最新' : '检查更新')),
            app.updateAvailable
              ? h('button', {
                  className: 'dsh-desktop-btn dsh-desktop-btn-primary',
                  disabled: busy === 'app' || !nativeControl() || !app.assetUrl || !app.checksumUrl,
                  onClick: updateApp,
                }, busy === 'app' ? '正在更新…' : '更新 APP')
              : null,
            h('button', { className: 'dsh-desktop-btn', disabled: !nativeControl(), onClick: restart }, '重启 APP'),
          ]),
          app.bundlePath ? h('div', { className: 'dsh-desktop-muted dsh-desktop-mono dsh-version-detail' }, app.bundlePath) : null,
        ]),
        h('div', { className: 'dsh-desktop-version-card' }, [
          h('div', { className: 'dsh-version-header' }, [
            h('span', {
              className: 'dsh-plugin-state-dot',
              'data-enabled': (!state.loading && pluginManager.enabled) || undefined,
              title: pluginManager.enabled ? '已启用' : '未启用',
              'aria-label': pluginManager.enabled ? '已启用' : '未启用',
            }),
            h('span', { className: 'dsh-desktop-title' }, 'Hang DSH Plugins'),
            state.loading && !state.value
              ? h('span', { className: 'dsh-desktop-muted' }, '正在读取基础插件状态…')
              : status('pluginManager', pluginManager.installed, pluginManager.latest, pluginManager.updateAvailable, pluginManager.error),
          ]),
          h('div', { className: 'dsh-desktop-actions dsh-version-actions' }, [
            h('span', { className: 'dsh-desktop-badge' }, '基础插件'),
            pluginManager.updateAvailable
              ? h('button', {
                  className: 'dsh-desktop-btn dsh-desktop-btn-primary',
                  disabled: busy === 'plugin-manager' || !nativeControl() || !pluginManager.latest,
                  onClick: updatePluginManager,
                }, busy === 'plugin-manager' ? '正在更新…' : '更新')
              : h('button', {
                  className: 'dsh-desktop-btn' + (checkFeedback.pluginManager ? ' dsh-desktop-btn-ok' : ''),
                  disabled: state.loading || busy === 'plugin-manager' || checking.pluginManager,
                  onClick: () => check('pluginManager', 'plugin-manager'),
                }, checking.pluginManager ? '检查中…' : (checkFeedback.pluginManager ? '已是最新' : '检查更新')),
          ]),
          h('div', { className: 'dsh-desktop-muted dsh-version-detail' }, '由 Desktop App 安装、更新和修复，不经过插件自身的管理链路。'),
        ]),
        h('div', { className: 'dsh-desktop-version-card dsh-version-last' }, [
          h('div', { className: 'dsh-version-header' }, [
            h('span', { className: 'dsh-desktop-title' }, '@deepseek-ai/dsh'),
            status('dsh', dsh.installed, dsh.latest, dsh.updateAvailable, dsh.installedError || dsh.latestError),
          ]),
          h('div', { className: 'dsh-desktop-row dsh-version-actions' }, [
            h('button', {
              className: 'dsh-desktop-btn' + (checkFeedback.dsh ? ' dsh-desktop-btn-ok' : ''),
              disabled: state.loading || checking.dsh,
              onClick: () => check('dsh', 'dsh'),
            }, checking.dsh ? '检查中…' : (checkFeedback.dsh ? '已是最新' : '检查更新')),
            dsh.updateAvailable ? h('button', {
              className: 'dsh-desktop-btn dsh-desktop-btn-primary',
              disabled: busy === 'dsh',
              onClick: updateDsh,
            }, busy === 'dsh' ? '正在更新…' : '更新并重启 APP') : null,
          ]),
          h('div', { className: 'dsh-desktop-muted dsh-version-detail' }, 'npm 包更新后必须重启 App，新的 dsh 进程才会生效。'),
        ]),
        state.error ? h('div', { className: 'dsh-desktop-error' }, '检查更新失败：' + state.error) : null,
        message ? h('div', { className: message.kind === 'ok' ? 'dsh-desktop-ok' : 'dsh-desktop-error' }, message.text) : null,
      ])
    }

    function PluginSection() {
      const [state, setState] = React.useState({ loading: true, value: null, error: null })
      const [busy, setBusy] = React.useState(null)
      const [channels, setChannels] = React.useState({})
      const [message, setMessage] = React.useState(null)
      const [checked, setChecked] = React.useState(false)
      const messageTimer = React.useRef(null)

      const flashMessage = React.useCallback(text => {
        if (messageTimer.current) window.clearTimeout(messageTimer.current)
        setMessage({ kind: 'ok', text })
        messageTimer.current = window.setTimeout(() => {
          messageTimer.current = null
          setMessage(null)
        }, 2500)
      }, [])

      React.useEffect(() => () => {
        if (messageTimer.current) window.clearTimeout(messageTimer.current)
      }, [])

      const load = React.useCallback(async (force = false) => {
        setState(previous => ({ ...previous, loading: true, error: null }))
        if (force) setMessage({ kind: 'info', text: '正在检查插件更新…' })
        try {
          const value = await api('/plugins' + (force ? '?force=1' : ''))
          setState({ loading: false, value, error: null })
          setChannels(current => Object.fromEntries(value.plugins.map(plugin => [
            plugin.key,
            current[plugin.key] || plugin.channel,
          ])))
          if (force) {
            setChecked(true)
            const count = value.plugins.filter(plugin => plugin.updateAvailable).length
            flashMessage(count > 0 ? `检查完成，${count} 个插件可以更新。` : '检查完成，所有插件已是最新。')
          }
        } catch (error) {
          const text = error.message || String(error)
          setState(previous => ({ loading: false, value: previous.value, error: text }))
          if (force) setMessage({ kind: 'error', text: '检查更新失败：' + text })
        }
      }, [flashMessage])
      React.useEffect(() => { load(false) }, [load])

      const mutate = async (plugin, action) => {
        const channel = channels[plugin.key] || plugin.channel
        setBusy(plugin.key + ':' + action)
        setMessage(null)
        try {
          await api('/plugins/mutate', { method: 'POST', body: { key: plugin.key, action, channel } })
          const bridge = nativeControl()
          if (bridge) {
            setMessage({ kind: 'ok', text: '插件已处理，正在应用…' })
            window.setTimeout(() => bridge.postMessage({ action: 'reloadService' }), 150)
          } else {
            setMessage({ kind: 'ok', text: '插件已处理，重启 dsh 后生效。' })
            await load(true)
          }
        } catch (error) {
          setMessage({ kind: 'error', text: error.message || String(error) })
          setBusy(null)
        }
      }

      if (state.loading && !state.value) {
        return h('div', { className: 'dsh-desktop-root' }, h('span', { className: 'dsh-desktop-muted' }, '正在读取插件版本…'))
      }
      const view = state.value || { plugins: [] }
      return h('div', { className: 'dsh-desktop-root' }, [
        h('div', { className: 'dsh-desktop-row' }, [
          h('span', { className: 'dsh-desktop-muted dsh-desktop-grow' }, '每个插件独立安装、更新和停用，变更后自动应用。'),
          h('button', { className: 'dsh-desktop-btn', disabled: busy !== null || state.loading, onClick: () => load(true) }, state.loading ? '检查中…' : '检查更新'),
        ]),
        ...view.plugins.map(plugin => {
          const channel = channels[plugin.key] || plugin.channel
          const release = plugin.releases[channel]
          const channelChanged = channel !== plugin.channel
          const showUpdate = plugin.installed && (channelChanged || (checked && plugin.updateAvailable))
          const toggleAction = plugin.enabled ? 'disable' : 'enable'
          return h('div', { key: plugin.key, className: 'dsh-plugin-item' }, [
            h('div', { className: 'dsh-plugin-summary' }, [
              h('span', {
                className: 'dsh-plugin-state-dot',
                'data-enabled': plugin.enabled || undefined,
                title: plugin.enabled ? '运行中' : '未启用',
                'aria-label': plugin.enabled ? '运行中' : '未启用',
              }),
              h('span', { className: 'dsh-plugin-name' }, plugin.name),
              h('span', { className: 'dsh-plugin-version' }, plugin.installedVersion
                ? plugin.installedVersion + (checked && plugin.updateAvailable && release ? ' · 最新 ' + release.version : '')
                : '未安装'),
            ]),
            h('span', {
              className: 'dsh-plugin-channel-tag',
              'data-beta': channel === 'beta' || undefined,
            }, channel === 'beta' ? 'Beta' : '正式版'),
            h('div', { className: 'dsh-plugin-purpose' }, plugin.purpose),
            h('div', { className: 'dsh-plugin-actions' }, [
              h('select', {
                className: 'dsh-plugin-channel',
                value: channel,
                disabled: busy !== null,
                'aria-label': plugin.name + ' 版本频道',
                onChange: event => setChannels(value => ({ ...value, [plugin.key]: event.currentTarget.value })),
              }, [
                h('option', { key: 'stable', value: 'stable' }, '正式版'),
                h('option', { key: 'beta', value: 'beta' }, 'Beta'),
              ]),
              showUpdate ? h('button', {
                className: 'dsh-desktop-btn dsh-desktop-btn-primary',
                disabled: busy !== null,
                onClick: () => mutate(plugin, 'update'),
              }, busy === plugin.key + ':update' ? '处理中…' : (channelChanged ? '切换' : '更新')) : null,
              h('button', {
                className: 'dsh-desktop-btn',
                disabled: busy !== null,
                onClick: () => mutate(plugin, toggleAction),
              }, busy === plugin.key + ':' + toggleAction ? '处理中…' : (plugin.enabled ? '停用' : '启用')),
            ]),
          ])
        }),
        state.error ? h('div', { className: 'dsh-desktop-error' }, state.error) : null,
        message ? h('div', {
          className: message.kind === 'error'
            ? 'dsh-desktop-error'
            : message.kind === 'ok' ? 'dsh-desktop-ok' : 'dsh-desktop-muted',
        }, message.text) : null,
      ])
    }

    function apply(ctx) {
      ctx.effect(() => {
        const disposeStyles = installStyles()
        const disposeIcons = installSettingsNavIcons()
        const slots = ctx.get('slots')
        const disposePlugins = slots.inject('settings.section', () => slots.register(
          { name: 'settings.section', id: 'plugin-store', order: 25, label: 'Hang 的插件' },
          () => h(PluginSection),
        ))
        const disposeApp = slots.inject('settings.section', () => slots.register(
          { name: 'settings.section', id: 'dsh-app', order: 30, label: 'Desktop App' },
          () => h(AppSection),
        ))
        const disposeCordisEmpty = slots.inject('sidebar.footer.action', () => slots.register(
          { name: 'sidebar.footer.action', id: 'cordis-empty', order: 5 },
          props => h(CordisEmptyAction, props),
        ))
        return () => {
          if (typeof disposePlugins === 'function') disposePlugins()
          if (typeof disposeApp === 'function') disposeApp()
          if (typeof disposeCordisEmpty === 'function') disposeCordisEmpty()
          disposeIcons()
          disposeStyles()
        }
      }, 'hang-dsh-plugins: 插件目录、Cordis 入口与 Desktop App 设置')
    }

    return { inject, apply }
  },
})
