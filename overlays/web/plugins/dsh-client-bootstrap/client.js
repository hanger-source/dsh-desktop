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
    const inject = ['remote', 'remote.dynamicCordisRunner', 'dynamicCordisRunner']

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
        schedule()
        return () => {
          disposed = true
          if (retryTimer !== null) clearTimeout(retryTimer)
        }
      }, 'dsh-client-bootstrap: 自动挂载仓库插件')
    }

    return { inject, apply }
  },
})
