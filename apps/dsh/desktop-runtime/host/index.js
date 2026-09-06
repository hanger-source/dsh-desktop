'use strict'

const Fs = require('node:fs')
const Os = require('node:os')
const Path = require('node:path')
const { VersionService } = require('./versions.js')
const { sendJson } = require('./process.js')

module.exports = {
  inject: ['connection', 'webServer'],
  apply(ctx) {
    const dshHome = process.env.DSH_HOME || Path.join(Os.homedir(), '.dsh')
    const runtimeDir = Path.join(dshHome, 'runtime', 'dsh-desktop')
    Fs.mkdirSync(runtimeDir, { recursive: true })
    const logPath = Path.join(runtimeDir, 'app-runtime.log')
    const log = message => {
      try { Fs.appendFileSync(logPath, new Date().toISOString() + ' ' + message + '\n') } catch (_error) {}
    }
    const dshExecutable = process.env.DSH_EXECUTABLE || process.argv[1]
    const versions = new VersionService({
      appVersion: process.env.DSH_APP_VERSION,
      appBundlePath: process.env.DSH_APP_BUNDLE_PATH,
      dshVersion: process.env.DSH_VERSION,
      dshExecutable,
      dshHome,
      repository: process.env.DSH_DESKTOP_GITHUB || 'hanger-source/dsh-desktop',
      commandEnvironment: process.env,
    })

    const parentPid = Number(process.env.DSH_PARENT_PID)
    if (Number.isSafeInteger(parentPid) && parentPid > 1) {
      const timer = setInterval(() => {
        try { process.kill(parentPid, 0) } catch (_error) { process.kill(process.pid, 'SIGTERM') }
      }, 1_000)
      ctx.effect(() => () => clearInterval(timer))
    }

    const webServer = ctx.get('webServer')
    const connection = ctx.get('connection')
    const route = (path, methods, handler) => {
      ctx.effect(() => webServer.register({
        kind: 'exact',
        path,
        handler: async (request, response) => {
          const rejection = connection.requestRejection(request)
          if (rejection !== undefined) {
            response.writeHead(rejection)
            response.end(rejection === 401 ? 'unauthorized' : 'forbidden')
            return
          }
          if (!methods.includes(request.method || 'GET')) {
            sendJson(response, 405, { ok: false, error: 'Method Not Allowed' })
            return
          }
          try {
            sendJson(response, 200, { ok: true, value: await handler(request) })
          } catch (error) {
            log('[api] ' + path + ' failed: ' + (error.stack || error.message || error))
            sendJson(response, 500, { ok: false, error: error.message || String(error) })
          }
        },
      }), 'dsh-desktop-runtime: ' + path)
    }

    route('/api/dsh-desktop/status', ['GET'], () => versions.status())
    route('/api/dsh-desktop/status/check', ['GET'], () => versions.check())
    log('[app-runtime] ready app=' + (process.env.DSH_APP_VERSION || 'unknown'))
  },
}
