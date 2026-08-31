'use strict'

const Path = require('node:path')
const { requestJson, run } = require('./process.js')

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

class VersionService {
  constructor(options) {
    this.appVersion = normalizeVersion(options.appVersion) || '0.0.0'
    this.appBundlePath = options.appBundlePath
    this.dshExecutable = options.dshExecutable
    this.npmExecutable = options.npmExecutable
    this.repository = options.repository
    this.commandEnvironment = options.commandEnvironment
    this.cache = null
    this.cacheAt = 0
  }

  async status(force = false) {
    if (!force && this.cache && Date.now() - this.cacheAt < 5 * 60_000) return this.cache
    const [app, dsh] = await Promise.all([this.appStatus(), this.dshStatus()])
    this.cache = { app, dsh, checkedAt: new Date().toISOString() }
    this.cacheAt = Date.now()
    return this.cache
  }

  async appStatus() {
    let latest = null
    let releaseUrl = 'https://github.com/' + this.repository + '/releases'
    let assetUrl = null
    let error = null
    try {
      const releases = await requestJson('https://api.github.com/repos/' + this.repository + '/releases?per_page=30')
      const release = Array.isArray(releases)
        ? releases.find(item => !item.draft && !item.prerelease && /^dsh-app-v\d+\.\d+\.\d+/.test(item.tag_name || ''))
        : null
      if (release) {
        latest = normalizeVersion(release.tag_name)
        releaseUrl = release.html_url || releaseUrl
        const assets = Array.isArray(release.assets) ? release.assets : []
        const asset = assets.find(item => /\.dmg$/i.test(item.name || '')) || assets.find(item => /\.zip$/i.test(item.name || ''))
        assetUrl = asset ? asset.browser_download_url : null
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
      bundlePath: this.appBundlePath,
      error,
    }
  }

  async dshStatus() {
    let installed = null
    let latest = null
    let installedError = null
    let latestError = null
    if (this.dshExecutable) {
      try {
        const result = await run(this.dshExecutable, ['--version'], {
          env: this.commandEnvironment,
          timeoutMs: 10_000,
          maxBytes: 16_384,
        })
        installed = result.exitCode === 0 ? normalizeVersion(result.stdout || result.stderr) : null
        if (result.exitCode !== 0) installedError = (result.stderr || result.stdout || 'exit ' + result.exitCode).trim()
      } catch (caught) {
        installedError = caught.message
      }
    } else {
      installedError = 'DSH App 没有传入 dsh 可执行文件'
    }
    try {
      const metadata = await requestJson('https://registry.npmjs.org/@deepseek-ai/dsh/latest')
      latest = normalizeVersion(metadata && metadata.version)
    } catch (caught) {
      latestError = caught.message
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
    this.cache = null
    return { ok: true, requiresRestart: true, output: (result.stdout || result.stderr).trim().slice(-4000) }
  }
}

module.exports = { VersionService, compareVersions, normalizeVersion }
