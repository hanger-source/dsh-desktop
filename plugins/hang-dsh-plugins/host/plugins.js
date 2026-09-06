'use strict'

const Fs = require('node:fs')
const Os = require('node:os')
const Path = require('node:path')
const Module = require('node:module')
const Semver = require('semver')
const { requestJson, run } = require('./process.js')

const BUNDLED_CATALOG = require('../catalog.json')
const PROFILE = 'web'

function newest(values) {
  return Semver.rsort(values.filter(value => Semver.valid(value)))[0] || null
}

function validateCatalog(value) {
  if (!value || value.schemaVersion !== 1 || !Array.isArray(value.plugins)) throw new Error('插件目录格式无效')
  const keys = new Set()
  const packages = new Set()
  for (const plugin of value.plugins) {
    if (!plugin || !/^[a-z0-9-]+$/.test(plugin.key || '') || !/^@hanger-source\/[a-z0-9-]+$/.test(plugin.package || '')) {
      throw new Error('插件目录包含无效条目')
    }
    if (!plugin.name || !plugin.purpose || !plugin.tagPrefix || keys.has(plugin.key) || packages.has(plugin.package)) {
      throw new Error('插件目录包含重复或不完整条目')
    }
    keys.add(plugin.key)
    packages.add(plugin.package)
  }
  return value
}

class ProfilePluginRepository {
  constructor(options) {
    this.dshHome = options.dshHome
    this.dshExecutable = options.dshExecutable
    this.commandEnvironment = options.commandEnvironment
    this.repository = options.repository || BUNDLED_CATALOG.repository
    this.sourceRoot = options.sourceRoot || null
    this.log = options.log
    this.profileDir = Path.join(this.dshHome, 'profiles', PROFILE)
    this.statePath = Path.join(this.profileDir, '.dsh-desktop-plugins.json')
    this.catalogCache = validateCatalog(BUNDLED_CATALOG)
    this.releaseCache = null
    this.running = null
  }

  manifest() {
    try { return JSON.parse(Fs.readFileSync(Path.join(this.profileDir, 'package.json'), 'utf8')) } catch (_error) {
      return { dependencies: {}, dsh: { profile: { bundles: [] } } }
    }
  }

  state() {
    try {
      const value = JSON.parse(Fs.readFileSync(this.statePath, 'utf8'))
      return value && typeof value === 'object' ? value : { channels: {}, enabled: {} }
    } catch (_error) { return { channels: {}, enabled: {} } }
  }

  writeState(value) {
    Fs.mkdirSync(this.profileDir, { recursive: true })
    const temporary = this.statePath + '.tmp'
    Fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n')
    Fs.renameSync(temporary, this.statePath)
  }

  installedPackages(catalog = this.catalogCache) {
    const manifest = this.manifest()
    const dependencies = manifest.dependencies || {}
    const requireFromProfile = Module.createRequire(Path.join(this.profileDir, 'package.json'))
    return new Map(catalog.plugins.flatMap(plugin => {
      if (!Object.hasOwn(dependencies, plugin.package)) return []
      try {
        const path = Path.dirname(requireFromProfile.resolve(plugin.package + '/package.json'))
        const version = Semver.valid(JSON.parse(Fs.readFileSync(Path.join(path, 'package.json'), 'utf8')).version)
        return [[plugin.package, { version, path, error: null }]]
      } catch (error) {
        return [[plugin.package, { version: null, path: null, error: error.message || String(error) }]]
      }
    }))
  }

  async catalog(refresh = false) {
    if (this.sourceRoot) {
      return validateCatalog(JSON.parse(Fs.readFileSync(Path.join(this.sourceRoot, 'plugins/hang-dsh-plugins/catalog.json'), 'utf8')))
    }
    if (!refresh) return this.catalogCache
    const remote = await requestJson('https://raw.githubusercontent.com/' + this.repository + '/main/plugins/hang-dsh-plugins/catalog.json')
    this.catalogCache = validateCatalog(remote)
    return this.catalogCache
  }

  reconcileActivation(state = this.state(), catalog = this.catalogCache) {
    const manifestPath = Path.join(this.profileDir, 'package.json')
    const manifest = this.manifest()
    manifest.dsh = manifest.dsh || {}
    manifest.dsh.profile = manifest.dsh.profile || {}
    const before = manifest.dsh.profile.bundles || []
    const packages = new Set(catalog.plugins.map(plugin => plugin.package))
    const bundles = before.filter(packageName => {
      if (!packages.has(packageName)) return true
      const plugin = catalog.plugins.find(row => row.package === packageName)
      return state.enabled?.[plugin.key] !== false
    })
    for (const plugin of catalog.plugins) {
      if (state.enabled?.[plugin.key] === true && !bundles.includes(plugin.package)) bundles.push(plugin.package)
    }
    if (JSON.stringify(before) === JSON.stringify(bundles)) return { changed: false, bundles }
    manifest.dsh.profile.bundles = bundles
    const temporary = manifestPath + '.tmp'
    Fs.writeFileSync(temporary, JSON.stringify(manifest, null, 2) + '\n')
    Fs.renameSync(temporary, manifestPath)
    this.log('[plugins] reconciled activation: ' + bundles.join(', '))
    return { changed: true, bundles }
  }

  async releases(catalog, refresh = false) {
    if (this.sourceRoot) {
      return Object.fromEntries(catalog.plugins.map(plugin => {
        let version = null
        try { version = JSON.parse(Fs.readFileSync(Path.join(this.sourceRoot, 'plugins', plugin.key, 'package.json'), 'utf8')).version } catch (_error) {}
        const channel = version && version.includes('-') ? 'beta' : 'stable'
        return [plugin.key, { stable: channel === 'stable' ? { version, tag: null } : null, beta: channel === 'beta' ? { version, tag: null } : null }]
      }))
    }
    if (!refresh && this.releaseCache) return this.releaseCache
    const result = await run('git', ['ls-remote', '--tags', '--refs', 'https://github.com/' + this.repository + '.git'], {
      env: this.commandEnvironment, cwd: Os.homedir(), timeoutMs: 30_000, maxBytes: 2 * 1024 * 1024,
    })
    if (result.exitCode !== 0) throw new Error((result.stderr || result.stdout || 'git ls-remote exit ' + result.exitCode).trim())
    const tags = result.stdout.split('\n').map(line => line.split('\trefs/tags/')[1] || '').filter(Boolean)
    this.releaseCache = Object.fromEntries(catalog.plugins.map(plugin => {
      const matched = tags.filter(tag => tag.startsWith(plugin.tagPrefix))
        .map(tag => ({ tag, version: tag.slice(plugin.tagPrefix.length) })).filter(row => Semver.valid(row.version))
      const stableVersion = newest(matched.filter(row => !row.version.includes('-')).map(row => row.version))
      const betaVersion = newest(matched.filter(row => row.version.includes('-')).map(row => row.version))
      return [plugin.key, {
        stable: stableVersion ? matched.find(row => row.version === stableVersion) : null,
        beta: betaVersion ? matched.find(row => row.version === betaVersion) : null,
      }]
    }))
    return this.releaseCache
  }

  async list(refresh = false) {
    const catalog = await this.catalog(refresh)
    const releases = refresh ? await this.releases(catalog, true) : this.releaseCache
    const manifest = this.manifest()
    const state = this.state()
    const installedPackages = this.installedPackages(catalog)
    const dependencies = manifest.dependencies || {}
    const bundles = new Set(manifest.dsh?.profile?.bundles || [])
    return {
      plugins: catalog.plugins.map(plugin => {
        const installed = Object.hasOwn(dependencies, plugin.package)
        const installedVersion = installedPackages.get(plugin.package)?.version || null
        const channel = state.channels?.[plugin.key] || (installedVersion?.includes('-') ? 'beta' : 'stable')
        const available = releases?.[plugin.key] || { stable: null, beta: null }
        const selected = available[channel]
        const targets = Object.fromEntries(['stable', 'beta'].map(name => {
          const release = available[name]
          return [name, release ? {
            kind: 'plugin',
            key: plugin.key,
            package: plugin.package,
            version: release.version,
            channel: name,
            spec: this.spec(plugin, release),
          } : null]
        }))
        return {
          ...plugin,
          installed,
          enabled: installed && bundles.has(plugin.package),
          installedVersion,
          installedError: installedPackages.get(plugin.package)?.error || null,
          channel,
          latestVersion: selected?.version || null,
          updateAvailable: Boolean(installedVersion && selected && Semver.lt(installedVersion, selected.version)),
          releases: available,
          target: targets[channel],
          targets,
        }
      }),
      checkedAt: releases ? new Date().toISOString() : null,
    }
  }

  spec(plugin, release) {
    if (this.sourceRoot) return 'file:' + Path.join(this.sourceRoot, 'plugins', plugin.key)
    if (!release?.tag) throw new Error('这个频道还没有可安装版本')
    return 'github:' + this.repository + '#' + release.tag + '&path:/plugins/' + plugin.key
  }

  async mutate(key, action, channel) {
    if (this.running) throw new Error('已有插件操作正在进行')
    this.running = this.performMutation(key, action, channel).finally(() => { this.running = null })
    return this.running
  }

  async performMutation(key, action, channel) {
    if (!['enable', 'disable'].includes(action)) throw new Error('无效操作：' + action)
    const catalog = await this.catalog(false)
    const plugin = catalog.plugins.find(row => row.key === key)
    if (!plugin) throw new Error('没有这个插件：' + key)
    if (action === 'enable' && !['stable', 'beta'].includes(channel)) throw new Error('无效频道：' + channel)
    const manifest = this.manifest()
    const installed = Object.hasOwn(manifest.dependencies || {}, plugin.package)
    const installedVersion = this.installedPackages(catalog).get(plugin.package)?.version || null
    const state = this.state()
    const currentChannel = state.channels?.[plugin.key] || (installedVersion?.includes('-') ? 'beta' : 'stable')
    if (action === 'enable' && (!installed || currentChannel !== channel)) {
      const release = (await this.releases(catalog, true))[plugin.key]?.[channel]
      const result = await run(this.dshExecutable, ['plugin', '--profile', PROFILE, 'add', this.spec(plugin, release), '--save-exact'], {
        env: this.commandEnvironment, cwd: this.sourceRoot || Os.homedir(), timeoutMs: 5 * 60_000, maxBytes: 512 * 1024,
      })
      if (result.exitCode !== 0) throw new Error((result.stderr || result.stdout || 'dsh plugin exit ' + result.exitCode).trim())
    }
    state.channels = { ...(state.channels || {}), [plugin.key]: channel }
    state.enabled = { ...(state.enabled || {}), [plugin.key]: action === 'enable' }
    this.writeState(state)
    this.reconcileActivation(state, catalog)
    this.log('[plugins] ' + action + ' ' + plugin.key + ' channel=' + channel)
    return { action, key: plugin.key, channel, requiresRestart: true }
  }
}

module.exports = { ProfilePluginRepository, validateCatalog }
