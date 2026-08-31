'use strict'

const Fs = require('node:fs')
const Path = require('node:path')
const { PluginRepository } = require('./plugins.js')
const { VersionService } = require('./versions.js')
const { readJsonBody, sendJson } = require('./process.js')

module.exports = {
  inject: ['webServer'],
  apply(ctx) {
    const dshHome = process.env.DSH_HOME || Path.join(process.env.HOME, '.dsh')
    const runtimeDir = process.env.DSH_DESKTOP_RUNTIME || Path.join(dshHome, 'runtime', 'dsh-desktop')
    const repoPath = process.env.DSH_DESKTOP_REPO || Path.join(dshHome, 'dsh-desktop')
    const remote = process.env.DSH_DESKTOP_REMOTE || 'https://github.com/hanger-source/dsh-desktop.git'
    Fs.mkdirSync(runtimeDir, { recursive: true })
    const logPath = Path.join(runtimeDir, 'app-runtime.log')
    const log = message => {
      try { Fs.appendFileSync(logPath, new Date().toISOString() + ' ' + message + '\n') } catch (_error) {}
    }

    const plugins = new PluginRepository(ctx, { repoPath, remote, dshHome, runtimeDir, log })
    const versions = new VersionService({
      appVersion: process.env.DSH_APP_VERSION,
      appBundlePath: process.env.DSH_APP_BUNDLE_PATH,
      dshExecutable: process.env.DSH_EXECUTABLE,
      npmExecutable: process.env.DSH_NPM_EXECUTABLE,
      repository: process.env.DSH_DESKTOP_GITHUB || 'hanger-source/dsh-desktop',
      commandEnvironment: process.env,
    })

    const parentPid = Number(process.env.DSH_PARENT_PID)
    if (Number.isSafeInteger(parentPid) && parentPid > 1) {
      const timer = setInterval(() => {
        try {
          process.kill(parentPid, 0)
        } catch (_error) {
          log('[app-runtime] parent exited -> SIGTERM web process pid=' + process.pid)
          process.kill(process.pid, 'SIGTERM')
        }
      }, 1_000)
      ctx.effect(() => () => clearInterval(timer))
    }

    ctx.on('agent/created', payload => {
      if (!payload || !payload.agent) return
      setTimeout(() => {
        plugins.reconcile().catch(error => log('[plugins] initial reconcile failed: ' + error.message))
      }, 1_200)
    })

    const webServer = ctx.get('webServer')
    const route = (path, methods, handler) => {
      webServer.register({
        kind: 'exact',
        path,
        handler: async (request, response) => {
          if (!methods.includes(request.method || 'GET')) {
            sendJson(response, 405, { ok: false, error: 'Method Not Allowed' })
            return
          }
          try {
            const value = await handler(request)
            sendJson(response, 200, { ok: true, value })
          } catch (error) {
            log('[api] ' + path + ' failed: ' + (error.stack || error.message || error))
            sendJson(response, 500, { ok: false, error: error.message || String(error) })
          }
        },
      })
    }

    route('/api/dsh-desktop/status', ['GET'], request => {
      const url = new URL(request.url, 'http://localhost')
      return versions.status(url.searchParams.get('force') === '1')
    })
    route('/api/dsh-desktop/dsh/update', ['POST'], () => versions.updateDsh())
    route('/api/dsh-desktop/plugins', ['GET'], () => plugins.list())
    route('/api/dsh-desktop/plugins/reconcile', ['POST'], () => plugins.reconcile())
    route('/api/dsh-desktop/plugins/sync', ['POST'], () => plugins.sync())
    route('/api/dsh-desktop/plugins/toggle', ['POST'], async request => {
      const body = await readJsonBody(request)
      if (!body.key || typeof body.key !== 'string') throw new Error('缺少插件 key')
      return plugins.toggle(body.key)
    })

    plugins.sync().catch(error => log('[plugins] background sync failed: ' + error.message))
    log('[app-runtime] ready app=' + (process.env.DSH_APP_VERSION || 'unknown') + ' repo=' + repoPath)
  },
}
