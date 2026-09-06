'use strict'

const Fs = require('node:fs')
const Path = require('node:path')
const Module = require('node:module')
const Semver = require('semver')
const { requestJson, run } = require('./process.js')

const PLUGIN_MANAGER = '@hanger-source/hang-dsh-plugins'

function normalizeVersion(value) {
  const match = /\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/.exec(String(value || ''))
  return match ? Semver.valid(match[0]) : null
}

function newestStableTag(tags, prefix) {
  const versions = tags
    .filter(tag => tag.startsWith(prefix))
    .map(tag => tag.slice(prefix.length))
    .filter(version => Semver.valid(version) && !Semver.prerelease(version))
  return Semver.rsort(versions)[0] || null
}

class VersionService {
  constructor(options) {
    this.appVersion = normalizeVersion(options.appVersion) || '0.0.0'
    this.dshVersion = normalizeVersion(options.dshVersion)
    this.appBundlePath = options.appBundlePath
    this.dshExecutable = options.dshExecutable
    this.dshHome = options.dshHome
    this.repository = options.repository
    this.commandEnvironment = options.commandEnvironment
    this.cache = null
  }

  async installedProfilePackages() {
    const result = await run(this.dshExecutable, ['plugin', '--profile', 'web', 'list', '--json', '--depth=0'], {
      env: this.commandEnvironment,
      cwd: this.dshHome,
      timeoutMs: 30_000,
      maxBytes: 2 * 1024 * 1024,
    })
    if (result.exitCode !== 0) throw new Error((result.stderr || result.stdout || 'dsh plugin list exit ' + result.exitCode).trim())
    const dependencies = JSON.parse(result.stdout)[0]?.dependencies || {}
    const profileDirectory = Path.join(this.dshHome, 'profiles', 'web')
    const requireFromProfile = Module.createRequire(Path.join(profileDirectory, 'package.json'))
    return new Map(Object.entries(dependencies).map(([name, dependency]) => {
      let version = normalizeVersion(dependency.version)
      const path = Path.dirname(requireFromProfile.resolve(name + '/package.json'))
      version = normalizeVersion(JSON.parse(Fs.readFileSync(Path.join(path, 'package.json'), 'utf8')).version) || version
      return [name, { version, path }]
    }))
  }

  localAppStatus() {
    return {
      key: 'app', kind: 'app', name: 'DSH Desktop', installed: this.appVersion,
      latest: null, updateAvailable: null,
      releaseUrl: 'https://github.com/' + this.repository + '/releases',
      assetUrl: null, checksumUrl: null, bundlePath: this.appBundlePath, error: null,
    }
  }

  localDshStatus() {
    return {
      key: 'dsh', kind: 'dsh', name: '@deepseek-ai/dsh', installed: this.dshVersion,
      latest: null, updateAvailable: null,
      installedError: this.dshVersion ? null : 'DSH App 没有传入有效的 dsh 版本', latestError: null,
    }
  }

  localPluginManagerStatus(packages, error = null) {
    const installed = packages?.get(PLUGIN_MANAGER)
    return {
      key: 'plugin-manager', kind: 'pluginManager', name: 'Hang DSH Plugins',
      package: PLUGIN_MANAGER, installed: installed?.version || null, path: installed?.path || null,
      latest: null, updateAvailable: null, target: null, error,
    }
  }

  async localStatus() {
    try {
      const packages = await this.installedProfilePackages()
      return { app: this.localAppStatus(), pluginManager: this.localPluginManagerStatus(packages), dsh: this.localDshStatus() }
    } catch (error) {
      return {
        app: this.localAppStatus(),
        pluginManager: this.localPluginManagerStatus(null, error.message || String(error)),
        dsh: this.localDshStatus(),
      }
    }
  }

  async status() {
    return this.cache || this.localStatus()
  }

  async remoteTags() {
    const result = await run('git', ['ls-remote', '--tags', '--refs', 'https://github.com/' + this.repository + '.git'], {
      env: this.commandEnvironment,
      timeoutMs: 30_000,
      maxBytes: 2 * 1024 * 1024,
    })
    if (result.exitCode !== 0) throw new Error((result.stderr || result.stdout || 'git ls-remote exit ' + result.exitCode).trim())
    return result.stdout.split('\n').map(line => line.split('\trefs/tags/')[1] || '').filter(Boolean)
  }

  appStatus(local, tags) {
    const status = { ...local }
    const prefix = 'dsh-app-v'
    status.latest = newestStableTag(tags, prefix)
    if (!status.latest) throw new Error('没有找到 DSH Desktop Release')
    const tag = prefix + status.latest
    status.releaseUrl = 'https://github.com/' + this.repository + '/releases/tag/' + tag
    status.assetUrl = 'https://github.com/' + this.repository + '/releases/download/' + tag + '/DSH.dmg'
    status.checksumUrl = 'https://github.com/' + this.repository + '/releases/download/' + tag + '/SHA256SUMS.txt'
    status.updateAvailable = Semver.lt(status.installed, status.latest)
    return status
  }

  pluginManagerStatus(local, tags) {
    const status = { ...local }
    const prefix = 'plugin-hang-dsh-plugins-v'
    status.latest = newestStableTag(tags, prefix)
    if (!status.latest) throw new Error('没有找到 Hang DSH Plugins Release')
    status.updateAvailable = status.installed ? Semver.lt(status.installed, status.latest) : true
    status.target = status.updateAvailable
      ? {
          kind: 'pluginManager',
          key: 'plugin-manager',
          package: PLUGIN_MANAGER,
          version: status.latest,
          spec: 'github:' + this.repository + '#' + prefix + status.latest + '&path:/plugins/hang-dsh-plugins',
        }
      : null
    return status
  }

  async dshStatus(local) {
    const status = { ...local }
    try {
      const metadata = await requestJson('https://registry.npmjs.org/@deepseek-ai/dsh/latest')
      status.latest = normalizeVersion(metadata && metadata.version)
      if (!status.latest) throw new Error('npmjs 没有返回有效版本')
      status.updateAvailable = status.installed ? Semver.lt(status.installed, status.latest) : null
    } catch (error) {
      status.latestError = error.message || String(error)
    }
    return status
  }

  async check() {
    const local = await this.localStatus()
    const [tagsResult, dshResult] = await Promise.allSettled([
      this.remoteTags(),
      this.dshStatus(local.dsh),
    ])
    let app = local.app
    let pluginManager = local.pluginManager
    if (tagsResult.status === 'fulfilled') {
      try {
        app = this.appStatus(local.app, tagsResult.value)
      } catch (error) {
        app = { ...local.app, error: error.message || String(error) }
      }
      try {
        pluginManager = this.pluginManagerStatus(local.pluginManager, tagsResult.value)
      } catch (error) {
        pluginManager = { ...local.pluginManager, error: error.message || String(error) }
      }
    } else {
      const error = tagsResult.reason?.message || String(tagsResult.reason)
      app = { ...local.app, error }
      pluginManager = { ...local.pluginManager, error }
    }
    const dsh = dshResult.status === 'fulfilled'
      ? dshResult.value
      : { ...local.dsh, latestError: dshResult.reason?.message || String(dshResult.reason) }
    this.cache = { app, pluginManager, dsh }
    return this.cache
  }
}

module.exports = { VersionService, normalizeVersion }
