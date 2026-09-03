'use strict'

// 侧边栏底部显示当前模型 provider 的用量/余额。
module.exports = {
  inject: ['credentials', 'subprocess', 'settings', 'timer', 'webServer'],
  apply(ctx) {
    const creds = ctx.get('credentials')
    const settings = ctx.get('settings')

    async function httpGetJson(url, key) {
      const curl = await ctx.subprocess.resolveExecutable('curl')
      const handle = ctx.subprocess.spawn({
        argv: [curl, '-sS', '--max-time', '20', '-H', 'Authorization: Bearer ' + key, url],
        cwd: '/',
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes: 65536 },
          stderr: { maxBytes: 8192 },
        },
        graceMs: 2000,
      })
      const outcome = await handle.done
      const out = handle.collected.stdout.readFrom(0).text
      const err = handle.collected.stderr.readFrom(0).text
      if (outcome.exitCode !== 0) {
        throw new Error('curl 退出码 ' + outcome.exitCode + (err ? '：' + err.slice(0, 400) : ''))
      }
      return JSON.parse(out)
    }

    async function fetchDeepseek(key) {
      const data = await httpGetJson('https://api.deepseek.com/user/balance', key)
      const info = Array.isArray(data.balance_infos) ? data.balance_infos[0] : undefined
      if (!info) throw new Error('响应缺少 balance_infos 字段')
      return {
        provider: 'deepseek',
        kind: 'prepaid',
        displayName: 'DeepSeek 官方',
        ok: true,
        available: data.is_available !== false,
        currency: String(info.currency || 'CNY'),
        total: Number(info.total_balance),
        granted: Number(info.granted_balance),
        toppedUp: Number(info.topped_up_balance),
      }
    }

    async function fetchOpencodeGo(key) {
      const data = await httpGetJson('https://opencode.ai/zen/go/v1/usage', key)
      const usage = data && data.usage
      if (!usage || !usage.rolling || !usage.weekly || !usage.monthly) {
        throw new Error('响应缺少 usage 的 rolling/weekly/monthly 字段')
      }
      const bucket = (b) => ({
        status: String(b.status || 'unknown'),
        percent: typeof b.percent === 'number' ? b.percent : null,
        resetsAt: typeof b.resetsAt === 'string' ? b.resetsAt : null,
      })
      return {
        provider: 'opencode-go',
        kind: 'subscription',
        displayName: 'OpenCode Go',
        ok: true,
        buckets: {
          rolling: bucket(usage.rolling),
          weekly: bucket(usage.weekly),
          monthly: bucket(usage.monthly),
        },
      }
    }

    // key = 当前会话模型选择的 provider 名，别名覆盖实际命名差异
    const SOURCES = {
      'opencode-go': { settingsNs: 'llm-pi-ai', fetch: fetchOpencodeGo, meta: { provider: 'opencode-go', kind: 'subscription', displayName: 'OpenCode Go' } },
      'deepseek': { settingsNs: 'llm-deepseek', defaultRef: 'DEEPSEEK_API_KEY', fetch: fetchDeepseek, meta: { provider: 'deepseek', kind: 'prepaid', displayName: 'DeepSeek 官方' } },
      'deepseek-official': { settingsNs: 'llm-deepseek', defaultRef: 'DEEPSEEK_API_KEY', fetch: fetchDeepseek, meta: { provider: 'deepseek', kind: 'prepaid', displayName: 'DeepSeek 官方' } },
    }

    function credentialRef(provider, source) {
      if (!settings) return null
      const section = settings.get(source.settingsNs)
      const profile = source.settingsNs === 'llm-pi-ai'
        ? section && section.providers && section.providers[provider]
        : section
      const ref = profile && profile.apiKeyEnv || source.defaultRef
      return typeof ref === 'string' && ref.length > 0 ? ref : null
    }

    const queryEntry = async (ref, fetcher, meta) => {
      if (!creds) return Object.assign({}, meta, { ok: false, error: '凭证服务不可用' })
      const resolved = await creds.resolve(ref)
      if (!resolved) return Object.assign({}, meta, { ok: false, error: '未配置 ' + ref })
      try {
        return await fetcher(resolved.value)
      } catch (e) {
        const detail = String((e && e.message) || e)
        console.warn('[dsh-quota-monitor] ' + meta.displayName + ' refresh failed: ' + detail)
        return Object.assign({}, meta, { ok: false, error: '暂时无法更新' })
      }
    }

    const cache = new Map()
    const inflight = new Map()
    const ageLimit = (entry, maximum) => entry.ok === false ? Math.min(10000, maximum) : maximum

    function refreshEntry(provider, source) {
      const key = source.meta.provider
      const pending = inflight.get(key)
      if (pending) return pending

      const operation = (async () => {
        const held = cache.get(key)
        const ref = credentialRef(provider, source)
        const entry = ref
          ? await queryEntry(ref, source.fetch, source.meta)
          : Object.assign({}, source.meta, { ok: false, error: '当前模型未配置凭证引用' })
        // 短暂的网络失败不应覆盖最后一次有效用量；更新时间仍指向那次成功快照。
        if (entry.ok === false && held && held.entry && held.entry.ok === true) return held
        const capturedAt = new Date().toISOString()
        const record = { entry, capturedAt, capturedAtMs: Date.now() }
        cache.set(key, record)
        return record
      })().finally(() => { inflight.delete(key) })
      inflight.set(key, operation)
      return operation
    }

    async function entryFor(provider, source, maximumAge, allowStale) {
      const key = source.meta.provider
      const held = cache.get(key)
      if (held && Date.now() - held.capturedAtMs < ageLimit(held.entry, maximumAge)) return held
      if (held && allowStale) {
        void refreshEntry(provider, source)
        return held
      }
      return refreshEntry(provider, source)
    }

    ctx.on('credentials/reference-updated', () => { cache.clear() })
    ctx.on('settings/updated', ns => {
      if (ns === 'llm-pi-ai' || ns === 'llm-deepseek') cache.clear()
    })

    const sources = [
      ['opencode-go', SOURCES['opencode-go']],
      ['deepseek-official', SOURCES['deepseek-official']],
    ]

    // 两个数据源各预热一次；当前源由页面每 30 秒刷新，非当前源最多闲置 5 分钟。
    void Promise.allSettled([
      refreshEntry('opencode-go', SOURCES['opencode-go']),
      refreshEntry('deepseek-official', SOURCES['deepseek-official']),
    ])
    ctx.interval(() => {
      for (const [provider, source] of sources) {
        const held = cache.get(source.meta.provider)
        if (!held || Date.now() - held.capturedAtMs >= ageLimit(held.entry, 300000)) {
          void refreshEntry(provider, source)
        }
      }
    }, 300000)

    const snapshot = async (args) => {
      // 按当前模型 provider 匹配数据源（provider 命名差异由 SOURCES 别名覆盖）
      const selection = args && args.selection
      const current = selection && typeof selection.provider === 'string'
        ? { provider: selection.provider, model: String(selection.model || '') }
        : null
      const entries = []
      const source = current && SOURCES[current.provider]
      let capturedAt = new Date().toISOString()
      if (source) {
        const record = await entryFor(current.provider, source, 30000, args && args.allowStale === true)
        capturedAt = record.capturedAt
        entries.push(record.entry)
      }
      return { capturedAt, current, entries }
    }

    const webServer = ctx.get('webServer')
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/api/hanger/quota',
      handler: async (request, response) => {
        if (request.method !== 'GET') {
          response.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' })
          response.end(JSON.stringify({ ok: false, error: 'Method Not Allowed' }))
          return
        }
        try {
          const url = new URL(request.url, 'http://localhost')
          const provider = url.searchParams.get('provider')
          const model = url.searchParams.get('model')
          const value = await snapshot({
            selection: provider ? { provider, model: model || '' } : null,
            allowStale: url.searchParams.get('allowStale') === '1',
          })
          response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
          response.end(JSON.stringify({ ok: true, value }))
        } catch (error) {
          response.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
          response.end(JSON.stringify({ ok: false, error: error.message || String(error) }))
        }
      },
    }), 'dsh-quota-monitor: /api/hanger/quota')
  },
}
