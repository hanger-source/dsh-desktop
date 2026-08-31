'use strict'

const Fs = require('node:fs')
const Path = require('node:path')
const { run } = require('./process.js')

class PluginRepository {
  constructor(ctx, options) {
    this.ctx = ctx
    this.repoPath = options.repoPath
    this.remote = options.remote
    this.dshHome = options.dshHome
    this.runtimeDir = options.runtimeDir
    this.log = options.log
    this.disabledPath = Path.join(this.runtimeDir, 'disabled-plugins.json')
    this.disabled = this.readDisabled()
    this.syncing = null
    this.lastSync = { state: 'idle', commit: this.commit(), changed: false, error: null }
  }

  readDisabled() {
    try {
      const parsed = JSON.parse(Fs.readFileSync(this.disabledPath, 'utf8'))
      return new Set(Array.isArray(parsed) ? parsed.filter(value => typeof value === 'string') : [])
    } catch (_error) {
      return new Set()
    }
  }

  writeDisabled() {
    Fs.mkdirSync(this.runtimeDir, { recursive: true })
    const temporary = this.disabledPath + '.tmp'
    Fs.writeFileSync(temporary, JSON.stringify([...this.disabled].sort(), null, 2) + '\n')
    Fs.renameSync(temporary, this.disabledPath)
  }

  currentAgent() {
    const agents = this.ctx.get('agents')
    if (!agents) return null
    try {
      const initiator = agents.requireInitiator()
      if (initiator) return initiator
    } catch (_error) {}
    try {
      const roots = agents.roots()
      return roots && roots[0] ? roots[0] : null
    } catch (_error) {
      return null
    }
  }

  allPlugins(agent = this.currentAgent()) {
    const runner = this.ctx.get('dynamicCordisRunner')
    if (!runner || !agent) return []
    try {
      return runner.listPlugins(agent) || []
    } catch (_error) {
      return []
    }
  }

  commit() {
    const head = Path.join(this.repoPath, '.git', 'HEAD')
    if (!Fs.existsSync(head)) return null
    try {
      const result = require('node:child_process').spawnSync('/usr/bin/git', ['-C', this.repoPath, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' })
      return result.status === 0 ? result.stdout.trim() : null
    } catch (_error) {
      return null
    }
  }

  sources() {
    const root = Path.join(this.repoPath, 'plugins')
    if (!Fs.existsSync(root)) return []
    const sources = []
    for (const key of Fs.readdirSync(root).sort()) {
      const directory = Path.join(root, key)
      if (!Fs.statSync(directory).isDirectory()) continue
      const metaPath = Path.join(directory, 'meta.json')
      if (!Fs.existsSync(metaPath)) continue
      let meta
      try {
        meta = JSON.parse(Fs.readFileSync(metaPath, 'utf8'))
      } catch (error) {
        this.log('[plugins] ' + key + ' meta.json 无效：' + error.message)
        continue
      }
      const hostPath = Path.join(directory, 'code.host.js')
      const clientPath = Path.join(directory, 'code.client.js')
      const host = Fs.existsSync(hostPath) ? Fs.readFileSync(hostPath, 'utf8') : ''
      const client = Fs.existsSync(clientPath) ? Fs.readFileSync(clientPath, 'utf8') : ''
      if (!host && !client) continue
      sources.push({ key, meta, host, client })
    }
    return sources
  }

  findPlugin(source, plugins) {
    const prefixes = Array.isArray(source.meta.matchPrefix) ? source.meta.matchPrefix : []
    for (const plugin of plugins) {
      const base = String(plugin.pluginId).split('-')[0]
      if (prefixes.includes(base)) return plugin
    }
    return null
  }

  currentPackage(runner, agent, plugin) {
    const packageId = plugin && (plugin.currentPackageId || (plugin.packages && plugin.packages.length > 0 && plugin.packages[plugin.packages.length - 1].packageId))
    if (!packageId) return null
    try {
      return runner.inspectPackage(agent, plugin.pluginId, packageId)
    } catch (_error) {
      return null
    }
  }

  async reconcile(keys = null) {
    const runner = this.ctx.get('dynamicCordisRunner')
    const agent = this.currentAgent()
    if (!runner || !agent) return { pending: true, activations: [], errors: [] }
    const wanted = keys ? new Set(keys) : null
    const activations = []
    const errors = []
    let plugins = this.allPlugins(agent)
    for (const source of this.sources()) {
      if (wanted && !wanted.has(source.key)) continue
      if (this.disabled.has(source.key)) continue
      try {
        let plugin = this.findPlugin(source, plugins)
        const previousPackageId = plugin ? plugin.currentPackageId : null
        let packageId = null
        if (plugin) {
          const current = this.currentPackage(runner, agent, plugin)
          const sameSource = current
            && ((current.code && current.code.host) || '') === source.host
            && ((current.code && current.code.client) || '') === source.client
          if (sameSource) {
            packageId = current.packageId
          } else {
            const defined = runner.define({
              name: source.meta.name || source.key,
              purpose: source.meta.purpose || '',
              plugin: { kind: 'existing', pluginId: plugin.pluginId },
              code: { host: source.host || undefined, client: source.client || undefined },
              sessionId: agent.id,
            })
            packageId = defined.packageId
          }
        } else {
          const defined = runner.define({
            name: source.meta.name || source.key,
            purpose: source.meta.purpose || '',
            plugin: { kind: 'new', idPrefix: source.meta.idPrefix },
            code: { host: source.host || undefined, client: source.client || undefined },
            sessionId: agent.id,
          })
          packageId = defined.packageId
          plugin = { pluginId: defined.pluginId, activeRun: null, packages: [] }
          plugins = this.allPlugins(agent)
        }
        activations.push({
          key: source.key,
          agentId: agent.id,
          pluginId: plugin.pluginId,
          packageId,
          mode: previousPackageId && previousPackageId !== packageId ? 'update' : 'run',
          hasClientHalf: Boolean(source.client),
        })
      } catch (error) {
        errors.push({ key: source.key, error: error.message || String(error) })
      }
    }
    this.log('[plugins] reconcile activations=' + JSON.stringify(activations) + ' errors=' + JSON.stringify(errors))
    return { pending: false, activations, errors }
  }

  async list() {
    const agent = this.currentAgent()
    const plugins = this.allPlugins(agent)
    const packages = this.sources().map(source => {
      const plugin = this.findPlugin(source, plugins)
      const latest = plugin && plugin.latestRun
      const failed = latest && latest.status === 'failed'
      const error = failed && latest.error
        ? {
            phase: latest.error.phase || null,
            message: latest.error.message || String(latest.error),
          }
        : null
      return {
        key: source.key,
        name: source.meta.name || source.key,
        purpose: source.meta.purpose || '',
        pluginId: plugin ? plugin.pluginId : null,
        state: this.disabled.has(source.key)
          ? 'disabled'
          : (plugin && plugin.activeRun ? 'running' : (failed ? 'failed' : (plugin ? 'stopped' : 'ready'))),
        error,
      }
    })
    return {
      repoPath: this.repoPath,
      remote: this.remote.replace(/\.git$/, ''),
      repoExists: Fs.existsSync(Path.join(this.repoPath, '.git')),
      commit: this.commit(),
      sync: this.lastSync,
      packages,
    }
  }

  async sync() {
    if (this.syncing) return this.syncing
    this.syncing = this.performSync().finally(() => { this.syncing = null })
    return this.syncing
  }

  async performSync() {
    const before = this.commit()
    this.lastSync = { state: 'syncing', commit: before, changed: false, error: null }
    try {
      let result
      if (Fs.existsSync(Path.join(this.repoPath, '.git'))) {
        result = await run('/usr/bin/git', ['-C', this.repoPath, 'pull', '--ff-only'], { timeoutMs: 120_000 })
      } else {
        if (Fs.existsSync(this.repoPath)) throw new Error('插件仓库路径已存在但不是 Git 仓库：' + this.repoPath)
        Fs.mkdirSync(Path.dirname(this.repoPath), { recursive: true })
        result = await run('/usr/bin/git', ['clone', '--quiet', this.remote, this.repoPath], { timeoutMs: 120_000 })
      }
      if (result.exitCode !== 0) throw new Error((result.stderr || result.stdout || 'git exit ' + result.exitCode).trim())
      this.syncSkills()
      const commit = this.commit()
      this.lastSync = { state: 'ready', commit, changed: before !== commit, error: null }
      const reconciled = await this.reconcile()
      return { ok: true, ...this.lastSync, ...reconciled }
    } catch (error) {
      this.lastSync = { state: 'failed', commit: before, changed: false, error: error.message || String(error) }
      this.log('[plugins] sync failed: ' + this.lastSync.error)
      throw error
    }
  }

  syncSkills() {
    const sourceRoot = Path.join(this.repoPath, 'skills')
    const destinationRoot = Path.join(this.dshHome, 'skills')
    if (!Fs.existsSync(sourceRoot)) return
    Fs.mkdirSync(destinationRoot, { recursive: true })
    for (const key of Fs.readdirSync(sourceRoot)) {
      const source = Path.join(sourceRoot, key)
      if (!Fs.statSync(source).isDirectory()) continue
      Fs.cpSync(source, Path.join(destinationRoot, key), { recursive: true, force: true })
    }
  }

  async toggle(key) {
    const source = this.sources().find(item => item.key === key)
    if (!source) throw new Error('没有这个插件：' + key)
    const runner = this.ctx.get('dynamicCordisRunner')
    const agent = this.currentAgent()
    if (!runner || !agent) throw new Error('插件运行器尚未就绪')
    const plugin = this.findPlugin(source, this.allPlugins(agent))
    if (plugin && plugin.activeRun && !this.disabled.has(key)) {
      await runner.stop(agent, plugin.pluginId)
      this.disabled.add(key)
      this.writeDisabled()
      return { ok: true, action: 'disabled', text: '已停用 ' + source.meta.name, activations: [] }
    }
    this.disabled.delete(key)
    this.writeDisabled()
    const reconciled = await this.reconcile([key])
    return { ok: true, action: 'enabled', text: '已启用 ' + source.meta.name, ...reconciled }
  }
}

module.exports = { PluginRepository }
