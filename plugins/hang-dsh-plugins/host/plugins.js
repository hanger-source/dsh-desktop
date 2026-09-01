'use strict'

const Fs = require('node:fs')
const Os = require('node:os')
const Path = require('node:path')
const { run } = require('./process.js')

const CATALOG = require('../catalog.json')
const PROFILE = 'web'

function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(String(value || ''))
  if (!match) return null
  return { core: [Number(match[1]), Number(match[2]), Number(match[3])], prerelease: match[4] ? match[4].split('.') : [] }
}

function compareVersions(left, right) {
  const a = parseVersion(left)
  const b = parseVersion(right)
  if (!a || !b) return 0
  for (let index = 0; index < 3; index += 1) {
    if (a.core[index] !== b.core[index]) return a.core[index] - b.core[index]
  }
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    return a.prerelease.length === b.prerelease.length ? 0 : (a.prerelease.length === 0 ? 1 : -1)
  }
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index += 1) {
    const av = a.prerelease[index]
    const bv = b.prerelease[index]
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

function newest(values) {
  return values.filter(value => parseVersion(value)).sort(compareVersions).at(-1) || null
}

class ProfilePluginRepository {
  constructor(options) {
    this.dshHome = options.dshHome
    this.dshExecutable = options.dshExecutable
    this.commandEnvironment = options.commandEnvironment
    this.repository = options.repository || CATALOG.repository
    this.sourceRoot = options.sourceRoot || null
    this.log = options.log
    this.profileDir = Path.join(this.dshHome, 'profiles', PROFILE)
    this.statePath = Path.join(this.profileDir, '.hang-dsh-plugins.json')
    this.releaseCache = null
    this.releaseCacheAt = 0
    this.running = null
  }

  manifest() {
    try {
      return JSON.parse(Fs.readFileSync(Path.join(this.profileDir, 'package.json'), 'utf8'))
    } catch (_error) {
      return { dependencies: {}, dsh: { profile: { bundles: [] } } }
    }
  }

  state() {
    try {
      const value = JSON.parse(Fs.readFileSync(this.statePath, 'utf8'))
      return value && typeof value === 'object' ? value : { channels: {}, enabled: {} }
    } catch (_error) {
      return { channels: {}, enabled: {} }
    }
  }

  writeState(value) {
    Fs.mkdirSync(this.profileDir, { recursive: true })
    const temporary = this.statePath + '.tmp'
    Fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n')
    Fs.renameSync(temporary, this.statePath)
  }

  installedVersion(packageName) {
    try {
      const manifestPath = Path.join(this.profileDir, 'node_modules', ...packageName.split('/'), 'package.json')
      return JSON.parse(Fs.readFileSync(manifestPath, 'utf8')).version || null
    } catch (_error) {
      return null
    }
  }

  reconcileActivation(state = this.state()) {
    const manifestPath = Path.join(this.profileDir, 'package.json')
    const manifest = this.manifest()
    manifest.dsh = manifest.dsh || {}
    manifest.dsh.profile = manifest.dsh.profile || {}
    const before = manifest.dsh.profile.bundles || []
    const bundles = before.filter(packageName => {
      const plugin = CATALOG.plugins.find(row => row.package === packageName)
      return !plugin || state.enabled?.[plugin.key] !== false
    })
    for (const plugin of CATALOG.plugins) {
      if (state.enabled?.[plugin.key] === true && !bundles.includes(plugin.package)) {
        bundles.push(plugin.package)
      }
    }
    if (JSON.stringify(before) === JSON.stringify(bundles)) return { changed: false, bundles }
    manifest.dsh.profile.bundles = bundles
    const temporary = manifestPath + '.tmp'
    Fs.writeFileSync(temporary, JSON.stringify(manifest, null, 2) + '\n')
    Fs.renameSync(temporary, manifestPath)
    this.log('[plugins] reconciled activation: ' + bundles.join(', '))
    return { changed: true, bundles }
  }

  async releases(force = false) {
    if (this.sourceRoot) {
      return Object.fromEntries(CATALOG.plugins.map(plugin => {
        let version = null
        try {
          version = JSON.parse(Fs.readFileSync(Path.join(this.sourceRoot, 'plugins', plugin.key, 'package.json'), 'utf8')).version
        } catch (_error) {}
        const channel = version && version.includes('-') ? 'beta' : 'stable'
        return [plugin.key, {
          stable: channel === 'stable' ? { version, tag: null } : null,
          beta: channel === 'beta' ? { version, tag: null } : null,
        }]
      }))
    }
    if (!force && this.releaseCache && Date.now() - this.releaseCacheAt < 5 * 60_000) return this.releaseCache
    const result = await run('git', [
      'ls-remote', '--tags', '--refs', 'https://github.com/' + this.repository + '.git',
    ], {
      env: this.commandEnvironment,
      cwd: this.sourceRoot || Os.homedir(),
      timeoutMs: 30_000,
      maxBytes: 2 * 1024 * 1024,
    })
    if (result.exitCode !== 0) {
      throw new Error((result.stderr || result.stdout || 'git ls-remote exit ' + result.exitCode).trim())
    }
    const tags = result.stdout.split('\n').map(line => {
      const marker = '\trefs/tags/'
      const index = line.indexOf(marker)
      return index === -1 ? '' : line.slice(index + marker.length)
    }).filter(Boolean)
    this.releaseCache = Object.fromEntries(CATALOG.plugins.map(plugin => {
      const matched = tags.filter(tag => tag.startsWith(plugin.tagPrefix))
        .map(tag => ({ tag, version: tag.slice(plugin.tagPrefix.length) }))
        .filter(row => parseVersion(row.version))
      const stableVersion = newest(matched.filter(row => !row.version.includes('-')).map(row => row.version))
      const betaVersion = newest(matched.filter(row => row.version.includes('-')).map(row => row.version))
      return [plugin.key, {
        stable: stableVersion ? matched.find(row => row.version === stableVersion) : null,
        beta: betaVersion ? matched.find(row => row.version === betaVersion) : null,
      }]
    }))
    this.releaseCacheAt = Date.now()
    return this.releaseCache
  }

  async list(checkRemote = false) {
    const releases = checkRemote ? await this.releases(true) : this.releaseCache
    const manifest = this.manifest()
    const state = this.state()
    const dependencies = manifest.dependencies || {}
    const bundles = new Set(manifest.dsh && manifest.dsh.profile && manifest.dsh.profile.bundles || [])
    return {
      plugins: CATALOG.plugins.map(plugin => {
        const installed = Object.hasOwn(dependencies, plugin.package)
        const installedVersion = installed ? this.installedVersion(plugin.package) : null
        const remembered = state.channels && state.channels[plugin.key]
        const requestedChannel = remembered || (installedVersion && installedVersion.includes('-') ? 'beta' : 'stable')
        const release = releases?.[plugin.key] || { stable: null, beta: null }
        const channel = requestedChannel
        const selected = release[channel]
        return {
          ...plugin,
          installed,
          enabled: installed && bundles.has(plugin.package),
          installedVersion,
          channel,
          latestVersion: selected && selected.version || null,
          updateAvailable: Boolean(installedVersion && selected && compareVersions(installedVersion, selected.version) < 0),
          releases: release,
        }
      }),
      checkedAt: releases ? new Date().toISOString() : null,
    }
  }

  spec(plugin, release) {
    if (this.sourceRoot) return 'file:' + Path.join(this.sourceRoot, 'plugins', plugin.key)
    if (!release || !release.tag) throw new Error('这个频道还没有可安装版本')
    return 'github:' + this.repository + '#' + release.tag + '&path:/plugins/' + plugin.key
  }

  async mutate(key, action, channel) {
    if (this.running) throw new Error('已有插件操作正在进行')
    const plugin = CATALOG.plugins.find(row => row.key === key)
    if (!plugin) throw new Error('没有这个插件：' + key)
    if (!['update', 'enable', 'disable'].includes(action)) throw new Error('无效操作：' + action)
    if (action !== 'disable' && !['stable', 'beta'].includes(channel)) throw new Error('无效频道：' + channel)
    this.running = this.performMutation(plugin, action, channel).finally(() => { this.running = null })
    return this.running
  }

  async performMutation(plugin, action, channel) {
    const manifest = this.manifest()
    const installed = Object.hasOwn(manifest.dependencies || {}, plugin.package)
    const wasEnabled = installed && new Set(manifest.dsh?.profile?.bundles || []).has(plugin.package)
    const state = this.state()

    if (action === 'disable') {
      state.enabled = { ...(state.enabled || {}), [plugin.key]: false }
      this.writeState(state)
      this.reconcileActivation(state)
    } else {
      const release = (await this.releases(true))[plugin.key]?.[channel]
      const mustInstall = action === 'update' || !installed || state.channels?.[plugin.key] !== channel
      if (mustInstall) {
        const result = await run(this.dshExecutable, [
          'plugin', '--profile', PROFILE, 'add', this.spec(plugin, release), '--save-exact',
        ], {
          env: this.commandEnvironment,
          cwd: this.sourceRoot || Os.homedir(),
          timeoutMs: 5 * 60_000,
          maxBytes: 512 * 1024,
        })
        if (result.exitCode !== 0) {
          throw new Error((result.stderr || result.stdout || 'dsh plugin exit ' + result.exitCode).trim())
        }
      }
      state.channels = { ...(state.channels || {}), [plugin.key]: channel }
      state.enabled = {
        ...(state.enabled || {}),
        [plugin.key]: action === 'enable'
          ? true
          : (typeof state.enabled?.[plugin.key] === 'boolean' ? state.enabled[plugin.key] : wasEnabled),
      }
      this.writeState(state)
      this.reconcileActivation(state)
    }
    this.releaseCache = null
    this.log('[plugins] ' + action + ' ' + plugin.key + ' channel=' + channel)
    return { action, key: plugin.key, channel, requiresRestart: true }
  }
}

module.exports = { ProfilePluginRepository, compareVersions }
