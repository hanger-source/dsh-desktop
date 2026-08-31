const script = document.currentScript
if (!script) throw new Error('dsh-client-bootstrap: document.currentScript unavailable')
const pathname = decodeURIComponent(new URL(script.src).pathname)
const prefix = '/plugins/'
const suffix = '/client.js'
if (!pathname.startsWith(prefix) || !pathname.endsWith(suffix)) {
  throw new Error('dsh-client-bootstrap: unexpected bundle URL ' + pathname)
}
const moduleId = pathname.slice(prefix.length, -suffix.length)

window.__ModuleLoader__.load({
  id: moduleId,
  factory: () => {
    const TARGET_NAMES = new Set([
      'DSH App Hub',
      'hang-plugins 管理器',
      'quota-monitor 用量监视',
    ])
    const SETTINGS_NAV_ICONS = new Map([
      ['Hang 的插件', 'dsh-settings-nav-plugin-store'],
      ['App', 'dsh-settings-nav-app'],
    ])
    const SETTINGS_NAV_STYLE_ID = 'dsh-settings-nav-icons'
    const inject = ['remote', 'remote.dynamicCordisRunner', 'dynamicCordisRunner']

    function installSettingsNavIcons() {
      let style = document.getElementById(SETTINGS_NAV_STYLE_ID)
      if (!style) {
        style = document.createElement('style')
        style.id = SETTINGS_NAV_STYLE_ID
        style.textContent = [
          '.dsh-settings-nav-plugin-store>svg,.dsh-settings-nav-app>svg{display:none}',
          '.dsh-settings-nav-plugin-store::before,.dsh-settings-nav-app::before{content:"";width:16px;height:16px;flex:none;background:currentColor;-webkit-mask-image:var(--dsh-settings-nav-icon);-webkit-mask-position:center;-webkit-mask-repeat:no-repeat;-webkit-mask-size:16px 16px;mask-image:var(--dsh-settings-nav-icon);mask-position:center;mask-repeat:no-repeat;mask-size:16px 16px}',
          '.dsh-settings-nav-plugin-store{--dsh-settings-nav-icon:url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2716%27 height=%2716%27 viewBox=%270 0 16 16%27 fill=%27none%27 stroke=%27black%27 stroke-width=%271.4%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27%3E%3Crect x=%272%27 y=%272%27 width=%275%27 height=%275%27 rx=%271%27/%3E%3Crect x=%279%27 y=%272%27 width=%275%27 height=%275%27 rx=%271%27/%3E%3Crect x=%272%27 y=%279%27 width=%275%27 height=%275%27 rx=%271%27/%3E%3Cpath d=%27M11.5 9v5M9 11.5h5%27/%3E%3C/svg%3E")}',
          '.dsh-settings-nav-app{--dsh-settings-nav-icon:url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2716%27 height=%2716%27 viewBox=%270 0 16 16%27 fill=%27none%27 stroke=%27black%27 stroke-width=%271.4%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27%3E%3Crect x=%272%27 y=%272.5%27 width=%2712%27 height=%2711%27 rx=%272%27/%3E%3Cpath d=%27M2 5.5h12%27/%3E%3Cpath d=%27M4.5 4h.01M6.5 4h.01%27/%3E%3C/svg%3E")}',
        ].join('')
        document.head.appendChild(style)
      }

      const markRows = () => {
        for (const button of document.querySelectorAll('[role="dialog"] nav button')) {
          const className = SETTINGS_NAV_ICONS.get(button.textContent?.trim())
          if (className) button.classList.add(className)
        }
      }
      markRows()
      const observer = new MutationObserver(markRows)
      observer.observe(document.documentElement, { childList: true, subtree: true })
      return () => {
        observer.disconnect()
        style?.remove()
        for (const className of SETTINGS_NAV_ICONS.values()) {
          for (const row of document.querySelectorAll('.' + className)) row.classList.remove(className)
        }
      }
    }

    function apply(ctx) {
      let disposed = false
      let running = false
      let rerun = false
      let retryTimer = null
      let retriesLeft = 20

      const schedule = (delay = 0) => {
        if (disposed) return
        if (retryTimer !== null) clearTimeout(retryTimer)
        retryTimer = setTimeout(() => {
          retryTimer = null
          resume().catch((error) => {
            console.error('[dsh-client-bootstrap] 自动挂载失败：', error)
            if (retriesLeft-- > 0) schedule(500)
          })
        }, delay)
      }

      const resume = async () => {
        if (running) {
          rerun = true
          return
        }
        running = true
        try {
          const answered = await ctx.remote.dynamicCordisRunner.inventory()
          if (!answered.ok) {
            throw new Error(answered.error.code + ': ' + answered.error.message)
          }
          const targets = answered.value.filter((row) => row.packages.some((pkg) => TARGET_NAMES.has(pkg.name)))
          for (const row of targets) {
            if (ctx.dynamicCordisRunner.isLoaded(row.pluginId)) continue
            const target = row.packages[row.packages.length - 1]
            if (!target) continue
            const mode = row.currentPackageId && row.currentPackageId !== target.packageId ? 'update' : 'run'
            console.info('[dsh-client-bootstrap] 自动挂载 ' + row.pluginId + '/' + target.packageId + ' (' + mode + ')')
            await ctx.dynamicCordisRunner.startUserRun({
              agentId: row.agentId,
              pluginId: row.pluginId,
              packageId: target.packageId,
              mode,
              hasClientHalf: target.hasClientHalf,
            })
          }
          if (targets.length < TARGET_NAMES.size && retriesLeft-- > 0) schedule(500)
        } finally {
          running = false
          if (rerun) {
            rerun = false
            schedule()
          }
        }
      }

      ctx.on('connection/reset', () => {
        retriesLeft = 20
        schedule()
      })
      ctx.effect(() => {
        const disposeSettingsNavIcons = installSettingsNavIcons()
        schedule()
        return () => {
          disposed = true
          if (retryTimer !== null) clearTimeout(retryTimer)
          disposeSettingsNavIcons()
        }
      }, 'dsh-client-bootstrap: 自动挂载仓库插件并呈现设置导航图标')
    }

    return { inject, apply }
  },
})
