'use strict'

const Fs = require('node:fs')
const Path = require('node:path')
const { requestJson, requestText, run } = require('./process.js')

function normalizeVersion(value) {
  const match = /\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/.exec(String(value || ''))
  return match ? match[0] : null
}

function compareVersions(left, right) {
  const parse = value => {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(value || '')
    if (!match) return null
    return { core: [+match[1], +match[2], +match[3]], pre: match[4] ? match[4].split('.') : [] }
  }
  const a = parse(left)
  const b = parse(right)
  if (!a || !b) return null
  for (let index = 0; index < 3; index += 1) {
    if (a.core[index] !== b.core[index]) return a.core[index] - b.core[index]
  }
  if (a.pre.length === 0 || b.pre.length === 0) return a.pre.length === b.pre.length ? 0 : (a.pre.length === 0 ? 1 : -1)
  for (let index = 0; index < Math.max(a.pre.length, b.pre.length); index += 1) {
    const av = a.pre[index]
    const bv = b.pre[index]
    if (av === bv) continue
    if (av === undefined) return -1
    if (bv === undefined) return 1
    const an = /^\d+$/.test(av) ? Number(av) : null
    const bn = /^\d+$/.test(bv) ? Number(bv) : null
    if (an !== null && bn !== null) return an - bn
    if (an !== null) return -1
    if (bn !== null) return 1
    return av.localeCompare(bv)
  }
  return 0
}

function installedPackageVersion(executable, packageName) {
  if (!executable) return { version: null, error: 'DSH App 没有传入 dsh 可执行文件' }
  try {
    let directory = Path.dirname(Fs.realpathSync(executable))
    for (let depth = 0; depth < 8; depth += 1) {
      const manifestPath = Path.join(directory, 'package.json')
      if (Fs.existsSync(manifestPath)) {
        const manifest = JSON.parse(Fs.readFileSync(manifestPath, 'utf8'))
        if (manifest.name === packageName) {
          return { version: normalizeVersion(manifest.version), error: null }
        }
      }
      const parent = Path.dirname(directory)
      if (parent === directory) break
      directory = parent
    }
    return { version: null, error: '找不到 ' + packageName + ' 的 package.json' }
  } catch (error) {
    return { version: null, error: error.message || String(error) }
  }
}

class VersionService {
  constructor(options) {
    this.appVersion = normalizeVersion(options.appVersion) || '0.0.0'
    this.pluginManagerVersion = normalizeVersion(options.pluginManagerVersion) || null
    this.appBundlePath = options.appBundlePath
    this.dshExecutable = options.dshExecutable
    this.npmExecutable = options.npmExecutable
    this.repository = options.repository
    this.commandEnvironment = options.commandEnvironment
    this.cache = {}
    this.cacheAt = {}
  }

  cached(key) {
    return this.cache[key] && Date.now() - (this.cacheAt[key] || 0) < 5 * 60_000
      ? this.cache[key]
      : null
  }

  remember(key, value) {
    this.cache[key] = value
    this.cacheAt[key] = Date.now()
    return value
  }

  async status() {
    return {
      app: this.cached('app') || this.localAppStatus(),
      pluginManager: this.cached('pluginManager') || this.localPluginManagerStatus(),
      dsh: this.cached('dsh') || await this.dshStatus(false),
    }
  }

  async checkApp() {
    return this.remember('app', await this.appStatus())
  }

  async checkPluginManager() {
    return this.remember('pluginManager', await this.pluginManagerStatus())
  }

  async checkDsh() {
    return this.remember('dsh', await this.dshStatus(true))
  }

  localPluginManagerStatus() {
    return {
      installed: this.pluginManagerVersion,
      latest: null,
      updateAvailable: null,
      enabled: true,
      managedByApp: true,
      error: null,
    }
  }

  localAppStatus() {
    return {
      installed: this.appVersion,
      latest: null,
      updateAvailable: null,
      releaseUrl: 'https://github.com/' + this.repository + '/releases',
      assetUrl: null,
      checksumUrl: null,
      bundlePath: this.appBundlePath,
      error: null,
    }
  }

  async pluginManagerStatus() {
    let latest = null
    let error = null
    try {
      const prefix = 'plugin-hang-dsh-plugins-v'
      const result = await run('git', [
        'ls-remote', '--tags', '--refs', 'https://github.com/' + this.repository + '.git',
      ], {
        env: this.commandEnvironment,
        timeoutMs: 30_000,
        maxBytes: 2 * 1024 * 1024,
      })
      if (result.exitCode !== 0) {
        throw new Error((result.stderr || result.stdout || 'git ls-remote exit ' + result.exitCode).trim())
      }
      const versions = result.stdout.split('\n')
        .map(line => line.split('\trefs/tags/')[1] || '')
        .filter(value => value.startsWith(prefix))
        .map(value => normalizeVersion(value.slice(prefix.length)))
        .filter(Boolean)
      latest = versions.sort(compareVersions).at(-1) || null
    } catch (caught) {
      error = caught.message
    }
    const compared = this.pluginManagerVersion && latest
      ? compareVersions(this.pluginManagerVersion, latest)
      : null
    return {
      installed: this.pluginManagerVersion,
      latest,
      updateAvailable: compared === null ? null : compared < 0,
      enabled: true,
      managedByApp: true,
      error,
    }
  }

  async appStatus() {
    let latest = null
    let releaseUrl = 'https://github.com/' + this.repository + '/releases'
    let assetUrl = null
    let checksumUrl = null
    let error = null
    try {
      const feed = await requestText('https://github.com/' + this.repository + '/releases.atom')
      const entries = feed.match(/<entry>[\s\S]*?<\/entry>/g) || []
      const entry = entries.find(value => /Repository\/\d+\/dsh-app-v\d+\.\d+\.\d+<\/id>/.test(value))
      const tag = entry && /Repository\/\d+\/(dsh-app-v\d+\.\d+\.\d+)<\/id>/.exec(entry)?.[1]
      if (tag) {
        latest = normalizeVersion(tag)
        releaseUrl = 'https://github.com/' + this.repository + '/releases/tag/' + tag
        assetUrl = 'https://github.com/' + this.repository + '/releases/download/' + tag + '/DSH.dmg'
        checksumUrl = 'https://github.com/' + this.repository + '/releases/download/' + tag + '/SHA256SUMS.txt'
      }
    } catch (caught) {
      error = caught.message
    }
    const compared = latest ? compareVersions(this.appVersion, latest) : null
    return {
      installed: this.appVersion,
      latest,
      updateAvailable: compared === null ? null : compared < 0,
      releaseUrl,
      assetUrl,
      checksumUrl,
      bundlePath: this.appBundlePath,
      error,
    }
  }

  async dshStatus(checkLatest = true) {
    const local = installedPackageVersion(this.dshExecutable, '@deepseek-ai/dsh')
    const installed = local.version
    let latest = null
    const installedError = local.error
    let latestError = null
    if (checkLatest) {
      try {
        const metadata = await requestJson('https://registry.npmjs.org/@deepseek-ai/dsh/latest')
        latest = normalizeVersion(metadata && metadata.version)
      } catch (caught) {
        latestError = caught.message
      }
    }
    const compared = installed && latest ? compareVersions(installed, latest) : null
    return {
      installed,
      latest,
      updateAvailable: compared === null ? null : compared < 0,
      installedError,
      latestError,
    }
  }

  async updateDsh() {
    if (!this.npmExecutable) throw new Error('找不到与当前 Node.js 配套的 npm，无法更新 dsh。')
    const result = await run(this.npmExecutable, [
      'install', '-g', '@deepseek-ai/dsh@latest',
      '--registry=https://registry.npmjs.org',
      '--loglevel=info',
    ], {
      env: this.commandEnvironment,
      cwd: Path.dirname(this.appBundlePath || '/'),
      timeoutMs: 5 * 60_000,
      maxBytes: 256 * 1024,
    })
    if (result.exitCode !== 0) {
      throw new Error((result.stderr || result.stdout || 'npm exit ' + result.exitCode).trim())
    }
    delete this.cache.dsh
    delete this.cacheAt.dsh
    return { ok: true, requiresRestart: true, output: (result.stdout || result.stderr).trim().slice(-4000) }
  }
}

module.exports = { VersionService, compareVersions, normalizeVersion }
