window.__ModuleLoader__.load({
  id: '@hanger-source/dsh-desktop-runtime',
  factory: (require) => {
    const React = require('react')
    const inject = ['slots']
    const h = React.createElement
    const nativeControl = () => window.webkit?.messageHandlers?.dshAppControl
    const snapshotKey = name => 'dsh-desktop-runtime:' + name
    const readSnapshot = name => {
      for (const storage of [window.localStorage, window.sessionStorage]) {
        try {
          const value = storage.getItem(snapshotKey(name))
          if (value) return JSON.parse(value)
        } catch (_error) {}
      }
      return null
    }
    const writeSnapshot = (name, value) => {
      try { window.localStorage.setItem(snapshotKey(name), JSON.stringify(value)) }
      catch (_error) {}
      return value
    }
    let appStatusSnapshot = readSnapshot('versions')
    let pluginStateSnapshot = readSnapshot('plugins')
    let pluginStateRequest = null

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

    function requestPluginState(checkUpdates = false) {
      if (!checkUpdates && pluginStateRequest) return pluginStateRequest
      const request = api('/plugins' + (checkUpdates ? '?force=1' : '')).then(value => {
        pluginStateSnapshot = writeSnapshot('plugins', value)
        return value
      })
      pluginStateRequest = request
      request.catch(() => {
        if (pluginStateRequest === request) pluginStateRequest = null
      })
      return request
    }

    function installStyles() {
      const style = document.createElement('style')
      style.id = 'dsh-desktop-runtime-styles'
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
        '.dsh-update-dialog-backdrop{position:fixed;inset:0;z-index:1000;display:grid;place-items:center;padding:28px;background:rgb(0 0 0 / 28%)}',
        '.dsh-update-dialog{width:min(520px,100%);max-height:min(640px,calc(100vh - 56px));display:flex;flex-direction:column;gap:16px;padding:20px;border:1px solid var(--dsw-alias-border-l1);border-radius:16px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 20px 60px rgb(0 0 0 / 24%)}',
        '.dsh-update-dialog-title{font-size:16px;font-weight:650;color:var(--dsw-alias-label-primary)}',
        '.dsh-update-dialog-list{display:flex;flex-direction:column;gap:8px;overflow:auto}',
        '.dsh-update-dialog-option{display:grid;grid-template-columns:18px minmax(0,1fr);gap:10px;align-items:start;padding:11px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;cursor:pointer}',
        '.dsh-update-dialog-option input{margin:3px 0 0;width:15px;height:15px}',
        '.dsh-update-dialog-name{display:block;font-weight:600;color:var(--dsw-alias-label-primary)}',
        '.dsh-update-dialog-actions{display:flex;justify-content:flex-end;gap:10px}',
        '.hHd-Xa_root:not(.hHd-Xa_collapsed){padding-bottom:4px!important}',
        '.hHd-Xa_footArea{display:grid!important;grid-template-columns:auto minmax(0,1fr)!important;align-items:center!important;column-gap:8px!important}',
        '.hHd-Xa_footerActions{display:contents!important}',
        '.hHd-Xa_settingsArea{grid-column:2!important;grid-row:2!important;width:100%!important;margin:0!important;padding:0!important}',
        '.hHd-Xa_settingsArea>*{width:100%!important;margin:0!important}',
        '.hHd-Xa_settingsArea .VOzbGW_trigger{justify-content:flex-end!important}',
        '.hHd-Xa_collapsed .hHd-Xa_footArea{display:flex!important;justify-content:center!important;align-items:center!important}',
        '.hHd-Xa_collapsed .hHd-Xa_settingsArea{display:flex!important;align-items:center!important;justify-content:center!important}',
        '.hHd-Xa_collapsed .hHd-Xa_settingsArea .VOzbGW_trigger{width:36px!important;justify-content:center!important}',
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
      const [railPopoverStyle, setRailPopoverStyle] = React.useState(null)
      const buttonRef = React.useRef(null)
      const wide = !props || props.wide !== false
      const placeRailPopover = React.useCallback(() => {
        const rect = buttonRef.current && buttonRef.current.getBoundingClientRect()
        if (!rect) return
        setRailPopoverStyle({
          position: 'fixed',
          left: rect.right + 8,
          bottom: Math.max(8, window.innerHeight - rect.bottom),
        })
      }, [])
      React.useEffect(() => {
        const inspect = () => setNativePresent(Boolean(document.querySelector('[data-cordis-badge]')))
        const observer = new MutationObserver(inspect)
        observer.observe(document.body, { childList: true, subtree: true })
        inspect()
        return () => observer.disconnect()
      }, [])
      React.useEffect(() => {
        if (!open || wide) return
        placeRailPopover()
        window.addEventListener('resize', placeRailPopover)
        return () => window.removeEventListener('resize', placeRailPopover)
      }, [open, wide, placeRailPopover])

      if (nativePresent) return null
      return h('div', { className: 'dsh-cordis-empty' }, [
        h('button', {
          key: 'button',
          ref: buttonRef,
          type: 'button',
          className: 'dsh-cordis-empty-button',
          'data-active': open || undefined,
          'aria-label': 'Cordis 插件',
          'aria-expanded': open,
          onClick: () => {
            if (!open && !wide) placeRailPopover()
            setOpen(value => !value)
          },
        }, [
          h('svg', { key: 'icon', width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4 }, [
            h('path', { key: 'a', d: 'M8 1.8v3M8 11.2v3M1.8 8h3M11.2 8h3' }),
            h('path', { key: 'b', d: 'm6.8 3-1.2-1.2M9.2 3l1.2-1.2M6.8 13l-1.2 1.2M9.2 13l1.2 1.2M3 6.8 1.8 5.6M3 9.2l-1.2 1.2M13 6.8l1.2-1.2M13 9.2l1.2 1.2' }),
          ]),
          wide ? h('span', { key: 'count' }, '0 running') : null,
        ]),
        open ? h('div', { key: 'popover', className: 'dsh-cordis-empty-popover', style: wide ? undefined : railPopoverStyle }, [
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

    function componentUpdateCandidates() {
      const candidates = []
      const app = appStatusSnapshot?.app
      const dsh = appStatusSnapshot?.dsh
      if (app?.updateAvailable && app.assetUrl && app.checksumUrl && app.latest) {
        candidates.push({
          key: 'app',
          name: 'DSH Desktop',
          detail: `${app.installed} → ${app.latest}`,
          target: { kind: 'app', key: 'app', version: app.latest, url: app.assetUrl, checksumUrl: app.checksumUrl },
        })
      }
      const pluginManager = appStatusSnapshot?.pluginManager
      if (pluginManager?.updateAvailable && pluginManager.target) {
        candidates.push({
          key: 'plugin-manager',
          name: 'Hang DSH Plugins',
          detail: `${pluginManager.installed || '未安装'} → ${pluginManager.latest}`,
          target: pluginManager.target,
        })
      }
      if (dsh?.updateAvailable && dsh.latest) {
        candidates.push({
          key: 'dsh',
          name: '@deepseek-ai/dsh',
          detail: `${dsh.installed} → ${dsh.latest}`,
          target: { kind: 'dsh', key: 'dsh', version: dsh.latest },
        })
      }
      return candidates
    }

    function pluginUpdateCandidates() {
      const candidates = []
      for (const plugin of pluginStateSnapshot?.plugins || []) {
        if (!plugin.installed || !plugin.updateAvailable || !plugin.target) continue
        candidates.push({
          key: 'plugin:' + plugin.key,
          name: plugin.name,
          detail: `${plugin.installedVersion} → ${plugin.target.version}`,
          target: plugin.target,
        })
      }
      return candidates
    }

    function availableUpdateCandidates() {
      return [...componentUpdateCandidates(), ...pluginUpdateCandidates()]
    }

    function applyUpdateCandidates(candidates) {
      const bridge = nativeControl()
      if (!bridge) throw new Error('只有 Desktop App 可以安装更新')
      if (!candidates.length) throw new Error('没有选择更新')
      bridge.postMessage({ action: 'applyUpdates', targets: candidates.map(candidate => candidate.target) })
    }

    function UpdateSelectionDialog({ candidates, busy, onClose }) {
      const [selected, setSelected] = React.useState(() => new Set(candidates.map(candidate => candidate.key)))
      const toggle = key => setSelected(current => {
        const next = new Set(current)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        return next
      })
      const apply = () => applyUpdateCandidates(candidates.filter(candidate => selected.has(candidate.key)))
      return h('div', { className: 'dsh-update-dialog-backdrop', role: 'presentation', onMouseDown: event => {
        if (event.target === event.currentTarget && !busy) onClose()
      } }, h('div', { className: 'dsh-update-dialog', role: 'dialog', 'aria-modal': true, 'aria-label': '选择更新' }, [
        h('div', { className: 'dsh-update-dialog-title' }, '选择更新'),
        h('div', { className: 'dsh-desktop-muted' }, '只安装勾选的项目，完成后统一重启一次。'),
        h('div', { className: 'dsh-update-dialog-list' }, candidates.map(candidate => h('label', {
          key: candidate.key,
          className: 'dsh-update-dialog-option',
        }, [
          h('input', {
            type: 'checkbox',
            checked: selected.has(candidate.key),
            disabled: busy,
            onChange: () => toggle(candidate.key),
          }),
          h('span', null, [
            h('span', { className: 'dsh-update-dialog-name' }, candidate.name),
            h('span', { className: 'dsh-desktop-muted' }, candidate.detail),
          ]),
        ]))),
        h('div', { className: 'dsh-update-dialog-actions' }, [
          h('button', { className: 'dsh-desktop-btn', disabled: busy, onClick: onClose }, '取消'),
          h('button', {
            className: 'dsh-desktop-btn dsh-desktop-btn-primary',
            disabled: busy || selected.size === 0 || !nativeControl(),
            onClick: apply,
          }, busy ? '正在更新…' : `更新所选（${selected.size}）`),
        ]),
      ]))
    }

    function AppSection() {
      const [state, setState] = React.useState({
        loading: !appStatusSnapshot,
        value: appStatusSnapshot,
        error: null,
      })
      const [checking, setChecking] = React.useState(false)
      const [busy, setBusy] = React.useState(false)
      const [message, setMessage] = React.useState(null)
      const [pickerOpen, setPickerOpen] = React.useState(false)

      const load = React.useCallback(async () => {
        try {
          const value = await api('/status')
          appStatusSnapshot = writeSnapshot('versions', value)
          setState({ loading: false, value, error: null })
        } catch (error) {
          setState(previous => ({ loading: false, value: previous.value, error: error.message || String(error) }))
        }
      }, [])
      React.useEffect(() => { load() }, [load])

      const checkUpdates = async () => {
        setChecking(true)
        setMessage(null)
        try {
          const value = await api('/status/check')
          appStatusSnapshot = writeSnapshot('versions', value)
          setState({ loading: false, value, error: null })
          const count = availableUpdateCandidates().length
          setMessage({ kind: 'ok', text: count ? `检查完成，当前有 ${count} 项可以更新。` : '检查完成，当前没有可用更新。' })
        } catch (error) {
          setState(previous => ({ ...previous, error: error.message || String(error) }))
        } finally {
          setChecking(false)
        }
      }

      React.useEffect(() => {
        const receiveUpdate = event => {
          const detail = event.detail || {}
          if (detail.state === 'failed') {
            setBusy(false)
            setMessage({ kind: 'error', text: detail.message || '更新失败' })
            return
          }
          setBusy(true)
          setMessage({ kind: 'ok', text: detail.message || '正在更新…' })
        }
        window.addEventListener('dsh-update-transaction', receiveUpdate)
        return () => window.removeEventListener('dsh-update-transaction', receiveUpdate)
      }, [])

      const value = state.value || {}
      const app = value.app || {}
      const pluginManager = value.pluginManager || {}
      const dsh = value.dsh || {}
      const candidates = availableUpdateCandidates()
      const candidate = key => candidates.find(item => item.key === key)
      const updateOne = key => {
        const item = candidate(key)
        if (!item) return
        setBusy(true)
        setMessage({ kind: 'ok', text: '正在准备更新…' })
        applyUpdateCandidates([item])
      }
      const status = (installed, latest, available, error) => h('div', { className: 'dsh-version-status' }, [
        h('span', { className: installed ? undefined : 'dsh-desktop-muted' }, installed || '—'),
        latest && available === true ? h('span', { className: 'dsh-desktop-muted' }, '最新 ' + latest) : null,
        available === true ? h('span', { className: 'dsh-desktop-warn' }, '有更新') : null,
        error ? h('span', { className: 'dsh-desktop-error' }, error) : null,
      ])

      return h('div', { className: 'dsh-desktop-root dsh-desktop-app-root' }, [
        h('div', { className: 'dsh-desktop-version-card' }, [
          h('div', { className: 'dsh-version-header' }, [
            h('span', { className: 'dsh-desktop-title' }, '组件更新'),
          ]),
          h('div', { className: 'dsh-desktop-row dsh-version-actions' }, [
            h('button', {
              className: 'dsh-desktop-btn',
              disabled: checking || busy,
              onClick: checkUpdates,
            }, checking ? '检查中…' : '检查更新'),
            candidates.length > 0 ? h('button', {
              className: 'dsh-desktop-btn dsh-desktop-btn-primary',
              disabled: checking || busy,
              onClick: () => setPickerOpen(true),
            }, '选择更新') : null,
          ]),
          h('div', { className: 'dsh-desktop-muted dsh-version-detail' }, '检查后可以选择需要的更新，也可以直接更新某个组件；所选项目统一安装并只重启一次。'),
        ]),
        h('div', { className: 'dsh-desktop-version-card' }, [
          h('div', { className: 'dsh-version-header' }, [
            h('span', { className: 'dsh-desktop-title' }, 'DSH Desktop'),
            status(app.installed, app.latest, app.updateAvailable, app.error),
          ]),
          h('div', { className: 'dsh-desktop-row dsh-version-actions' }, [
            app.updateAvailable ? h('button', {
              className: 'dsh-desktop-btn dsh-desktop-btn-primary',
              disabled: busy || !nativeControl(),
              onClick: () => updateOne('app'),
            }, '更新') : null,
            h('button', {
              className: 'dsh-desktop-btn',
              disabled: busy || !nativeControl(),
              onClick: () => nativeControl()?.postMessage('restart'),
            }, '重启 APP'),
          ]),
          app.bundlePath ? h('div', { className: 'dsh-desktop-muted dsh-desktop-mono dsh-version-detail' }, app.bundlePath) : null,
        ]),
        h('div', { className: 'dsh-desktop-version-card' }, [
          h('div', { className: 'dsh-version-header' }, [
            h('span', { className: 'dsh-desktop-title' }, 'Hang DSH Plugins'),
            status(pluginManager.installed, pluginManager.latest, pluginManager.updateAvailable, pluginManager.error),
          ]),
          h('div', { className: 'dsh-desktop-row dsh-version-actions' }, [
            pluginManager.updateAvailable ? h('button', {
              className: 'dsh-desktop-btn dsh-desktop-btn-primary',
              disabled: busy || !nativeControl(),
              onClick: () => updateOne('plugin-manager'),
            }, '更新') : null,
          ]),
          h('div', { className: 'dsh-desktop-muted dsh-version-detail' }, '插件目录与启停服务独立发布，也可与其他组件一起更新并统一重启。'),
        ]),
        h('div', { className: 'dsh-desktop-version-card dsh-version-last' }, [
          h('div', { className: 'dsh-version-header' }, [
            h('span', { className: 'dsh-desktop-title' }, '@deepseek-ai/dsh'),
            status(dsh.installed, dsh.latest, dsh.updateAvailable, dsh.installedError || dsh.latestError),
          ]),
          h('div', { className: 'dsh-desktop-row dsh-version-actions' }, [
            dsh.updateAvailable ? h('button', {
              className: 'dsh-desktop-btn dsh-desktop-btn-primary',
              disabled: busy || !nativeControl(),
              onClick: () => updateOne('dsh'),
            }, '更新') : null,
          ]),
          h('div', { className: 'dsh-desktop-muted dsh-version-detail' }, '由 npmjs 提供；与其他所选更新一起安装并统一重启。'),
        ]),
        state.error ? h('div', { className: 'dsh-desktop-error' }, '检查更新失败：' + state.error) : null,
        message ? h('div', { className: message.kind === 'ok' ? 'dsh-desktop-ok' : 'dsh-desktop-error' }, message.text) : null,
        pickerOpen ? h(UpdateSelectionDialog, {
          candidates,
          busy,
          onClose: () => setPickerOpen(false),
        }) : null,
      ])
    }
    function PluginSection() {
      const [state, setState] = React.useState({
        value: pluginStateSnapshot,
        error: null,
      })
      const [checking, setChecking] = React.useState(false)
      const [busy, setBusy] = React.useState(null)
      const [channels, setChannels] = React.useState({})
      const [message, setMessage] = React.useState(null)
      const [pickerOpen, setPickerOpen] = React.useState(false)

      const accept = React.useCallback(value => {
        setState({ value, error: null })
        setChannels(current => Object.fromEntries(value.plugins.map(plugin => [
          plugin.key,
          current[plugin.key] || plugin.channel,
        ])))
      }, [])

      const loadLocal = React.useCallback(async () => {
        try {
          accept(await requestPluginState(false))
        } catch (error) {
          const text = error.message || String(error)
          setState(previous => ({ value: previous.value, error: text }))
        }
      }, [accept])
      React.useEffect(() => { loadLocal() }, [loadLocal])

      const checkUpdates = async () => {
        setChecking(true)
        setMessage(null)
        try {
          const value = await requestPluginState(true)
          accept(value)
          const count = value.plugins.filter(plugin => plugin.installed && plugin.updateAvailable).length
          setMessage({ kind: 'ok', text: count ? `检查完成，当前有 ${count} 个插件可以更新。` : '检查完成，当前没有插件更新。' })
        } catch (error) {
          const text = error.message || String(error)
          setState(previous => ({ value: previous.value, error: text }))
          setMessage({ kind: 'error', text: '检查更新失败：' + text })
        } finally {
          setChecking(false)
        }
      }

      React.useEffect(() => {
        const receiveUpdate = event => {
          const detail = event.detail || {}
          if (detail.state === 'failed') {
            setBusy(null)
            setMessage({ kind: 'error', text: detail.message || '更新失败' })
            return
          }
          setBusy('updates')
          setMessage({ kind: 'ok', text: detail.message || '正在更新…' })
        }
        window.addEventListener('dsh-update-transaction', receiveUpdate)
        return () => window.removeEventListener('dsh-update-transaction', receiveUpdate)
      }, [])

      const mutate = async (plugin, action) => {
        const channel = channels[plugin.key] || plugin.channel
        setBusy(plugin.key + ':' + action)
        setMessage(null)
        try {
          await api('/plugins/mutate', { method: 'POST', body: { key: plugin.key, action, channel } })
          const bridge = nativeControl()
          if (bridge) {
            setMessage({ kind: 'ok', text: '插件状态已保存，正在重新加载…' })
            bridge.postMessage({ action: 'reloadService' })
          } else {
            pluginStateRequest = null
            await loadLocal()
            setBusy(null)
          }
        } catch (error) {
          setMessage({ kind: 'error', text: error.message || String(error) })
          setBusy(null)
        }
      }

      const updatePlugin = (plugin, channel) => {
        const target = plugin.targets?.[channel]
        if (!target) return
        const candidate = {
          key: 'plugin:' + plugin.key,
          name: plugin.name,
          detail: `${plugin.installedVersion} → ${target.version}`,
          target,
        }
        setBusy('updates')
        setMessage({ kind: 'ok', text: '正在准备更新…' })
        applyUpdateCandidates([candidate])
      }

      const view = state.value || { plugins: [] }
      const candidates = pluginUpdateCandidates()
      return h('div', { className: 'dsh-desktop-root' }, [
        h('div', { className: 'dsh-desktop-row' }, [
          h('span', { className: 'dsh-desktop-muted dsh-desktop-grow' }, '插件独立选择版本和启停；检查后可单独更新，也可与其他组件一起更新。'),
          h('button', {
            className: 'dsh-desktop-btn',
            disabled: busy !== null || checking,
            onClick: checkUpdates,
          }, checking ? '检查中…' : '检查更新'),
          candidates.length > 0 ? h('button', {
            className: 'dsh-desktop-btn dsh-desktop-btn-primary',
            disabled: busy !== null || checking,
            onClick: () => setPickerOpen(true),
          }, '选择更新') : null,
        ]),
        ...view.plugins.map(plugin => {
          const channel = channels[plugin.key] || plugin.channel
          const target = plugin.targets?.[channel]
          const channelChanged = channel !== plugin.channel
          const versionChanged = Boolean(plugin.installed && target && plugin.installedVersion !== target.version)
          const showUpdate = plugin.installed && (channelChanged || plugin.updateAvailable) && versionChanged
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
                ? plugin.installedVersion + (plugin.updateAvailable && plugin.latestVersion ? ' · 最新 ' + plugin.latestVersion : '')
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
                disabled: busy !== null || !nativeControl(),
                onClick: () => updatePlugin(plugin, channel),
              }, channelChanged ? '切换' : '更新') : null,
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
          className: message.kind === 'error' ? 'dsh-desktop-error' : 'dsh-desktop-ok',
        }, message.text) : null,
        pickerOpen ? h(UpdateSelectionDialog, {
          candidates,
          busy: busy === 'updates',
          onClose: () => setPickerOpen(false),
        }) : null,
      ])
    }
    function apply(ctx) {
      ctx.effect(() => {
        requestPluginState(false).catch(() => {})
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
        nativeControl()?.postMessage({ action: 'desktopRuntimeReady' })
        return () => {
          if (typeof disposePlugins === 'function') disposePlugins()
          if (typeof disposeApp === 'function') disposeApp()
          if (typeof disposeCordisEmpty === 'function') disposeCordisEmpty()
          disposeIcons()
          disposeStyles()
        }
      }, 'dsh-desktop-runtime: 插件目录、Cordis 入口与 Desktop App 设置')
    }

    return { inject, apply }
  },
})
