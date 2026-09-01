'use strict'

const Fs = require('node:fs')
const Os = require('node:os')
const Path = require('node:path')
const { ProfilePluginRepository } = require('./plugins.js')
const { VersionService } = require('./versions.js')
const { readJsonBody, sendJson } = require('./process.js')
const packageManifest = require('../package.json')

module.exports = {
  inject: ['webServer'],
  apply(ctx) {
    const dshHome = process.env.DSH_HOME || Path.join(Os.homedir(), '.dsh')
    const runtimeDir = Path.join(dshHome, 'runtime', 'dsh-desktop')
    Fs.mkdirSync(runtimeDir, { recursive: true })
    const logPath = Path.join(runtimeDir, 'app-runtime.log')
    const log = message => {
      try { Fs.appendFileSync(logPath, new Date().toISOString() + ' ' + message + '\n') } catch (_error) {}
    }
    const dshExecutable = process.env.DSH_EXECUTABLE || process.argv[1]
    const plugins = new ProfilePluginRepository({
      dshHome,
      dshExecutable,
      commandEnvironment: process.env,
      repository: process.env.DSH_DESKTOP_GITHUB || 'hanger-source/dsh-desktop',
      sourceRoot: process.env.HANG_DSH_PLUGIN_SOURCE_ROOT,
      log,
    })
    const versions = new VersionService({
      appVersion: process.env.DSH_APP_VERSION,
      pluginManagerVersion: packageManifest.version,
      appBundlePath: process.env.DSH_APP_BUNDLE_PATH,
      dshExecutable,
      npmExecutable: process.env.DSH_NPM_EXECUTABLE,
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
    const route = (path, methods, handler) => {
      ctx.effect(() => webServer.register({
        kind: 'exact',
        path,
        handler: async (request, response) => {
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
      }), 'hang-dsh-plugins: ' + path)
    }

    route('/api/dsh-desktop/status', ['GET'], request => {
      const url = new URL(request.url, 'http://localhost')
      return versions.status(url.searchParams.get('force') === '1')
    })
    route('/api/dsh-desktop/dsh/update', ['POST'], () => versions.updateDsh())
    route('/api/dsh-desktop/plugins', ['GET'], request => {
      const url = new URL(request.url, 'http://localhost')
      return plugins.list(url.searchParams.get('force') === '1')
    })
    route('/api/dsh-desktop/plugins/mutate', ['POST'], async request => {
      const body = await readJsonBody(request)
      return plugins.mutate(body.key, body.action, body.channel)
    })
    log('[app-runtime] ready app=' + (process.env.DSH_APP_VERSION || 'unknown'))
  },
}
