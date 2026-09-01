'use strict'

const Fs = require('node:fs')
const Os = require('node:os')
const Path = require('node:path')
const { ProfilePluginRepository } = require('./plugins.js')

const CATALOG = require('../catalog.json')
const MIGRATION_VERSION = 2

function readJson(path, fallback) {
  try {
    return JSON.parse(Fs.readFileSync(path, 'utf8'))
  } catch (_error) {
    return fallback
  }
}

function legacyEnabledKeys(dshHome) {
  const root = Path.join(dshHome, 'dsh-desktop', 'plugins')
  if (!Fs.existsSync(root)) return []
  const disabled = new Set(readJson(
    Path.join(dshHome, 'runtime', 'dsh-desktop', 'disabled-plugins.json'),
    [],
  ))
  return CATALOG.plugins
    .filter(plugin => !disabled.has(plugin.key))
    .filter(plugin => Fs.existsSync(Path.join(root, plugin.key, 'meta.json')))
    .map(plugin => plugin.key)
}

async function migrate(options = {}) {
  const dshHome = options.dshHome || process.env.DSH_HOME || Path.join(Os.homedir(), '.dsh')
  const profileDir = Path.join(dshHome, 'profiles', 'web')
  const markerPath = Path.join(profileDir, `.hang-dsh-plugins-migration-v${MIGRATION_VERSION}.json`)
  if (Fs.existsSync(markerPath)) return readJson(markerPath, { migrated: [] })

  const keys = legacyEnabledKeys(dshHome)
  const manifest = readJson(Path.join(profileDir, 'package.json'), { dependencies: {} })
  const dependencies = manifest.dependencies || {}
  const pending = keys.filter(key => {
    const plugin = CATALOG.plugins.find(row => row.key === key)
    return plugin && !Object.hasOwn(dependencies, plugin.package)
  })
  const log = options.log || (message => process.stdout.write(message + '\n'))
  const repository = options.repository || new ProfilePluginRepository({
    dshHome,
    dshExecutable: options.dshExecutable || process.env.DSH_EXECUTABLE,
    commandEnvironment: options.commandEnvironment || process.env,
    repository: process.env.DSH_DESKTOP_GITHUB || CATALOG.repository,
    log,
  })

  for (const key of pending) {
    log('[migration] installing legacy enabled plugin ' + key)
    await repository.mutate(key, 'enable', 'beta')
  }

  const current = await repository.list(true)
  const upgrades = current.plugins.filter(plugin => plugin.installed && plugin.updateAvailable)
  for (const plugin of upgrades) {
    log('[migration] updating installed plugin ' + plugin.key + ' channel=' + plugin.channel)
    await repository.mutate(plugin.key, 'update', plugin.channel)
  }

  const result = {
    version: MIGRATION_VERSION,
    migrated: pending,
    alreadyInstalled: keys.filter(key => !pending.includes(key)),
    upgraded: upgrades.map(plugin => plugin.key),
    completedAt: new Date().toISOString(),
  }
  Fs.mkdirSync(profileDir, { recursive: true })
  const temporary = markerPath + '.tmp'
  Fs.writeFileSync(temporary, JSON.stringify(result, null, 2) + '\n')
  Fs.renameSync(temporary, markerPath)
  return result
}

if (require.main === module) {
  migrate().catch(error => {
    process.stderr.write((error && error.stack) || String(error))
    process.stderr.write('\n')
    process.exitCode = 1
  })
}

module.exports = { legacyEnabledKeys, migrate }
