// quota-monitor —— HOST 半（当前最新版，2026-08-31）
//
// 本文件内容即为 cordis_define 的 code.host 函数体：
// Agent 重放时把整个文件内容原样作为 code.host 传入即可。
// 运行效果：侧边栏底部显示当前模型 provider 的用量/余额（配额 /v1/usage、DeepSeek /user/balance）。
return {
  inject: ['subprocess', 'settings'],
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
      'deepseek': { settingsNs: 'llm-deepseek', fetch: fetchDeepseek, meta: { provider: 'deepseek', kind: 'prepaid', displayName: 'DeepSeek 官方' } },
      'deepseek-official': { settingsNs: 'llm-deepseek', fetch: fetchDeepseek, meta: { provider: 'deepseek', kind: 'prepaid', displayName: 'DeepSeek 官方' } },
    }

    function credentialRef(provider, source) {
      if (!settings) return null
      const section = settings.get(source.settingsNs)
      const profile = source.settingsNs === 'llm-pi-ai'
        ? section && section.providers && section.providers[provider]
        : section
      const ref = profile && profile.apiKeyEnv
      return typeof ref === 'string' && ref.length > 0 ? ref : null
    }

    const queryEntry = async (ref, fetcher, meta) => {
      if (!creds) return Object.assign({}, meta, { ok: false, error: '凭证服务不可用' })
      const resolved = await creds.resolve(ref)
      if (!resolved) return Object.assign({}, meta, { ok: false, error: '未配置 ' + ref })
      try {
        return await fetcher(resolved.value)
      } catch (e) {
        return Object.assign({}, meta, { ok: false, error: String((e && e.message) || e) })
      }
    }

    const cache = new Map()
    const inflight = new Map()
    const freshFor = entry => entry.ok === false ? 10000 : 60000

    async function entryFor(provider, source) {
      const key = source.meta.provider
      const now = Date.now()
      const held = cache.get(key)
      if (held && now < held.expiresAt) return held
      const pending = inflight.get(key)
      if (pending) return pending

      const operation = (async () => {
        const ref = credentialRef(provider, source)
        const entry = ref
          ? await queryEntry(ref, source.fetch, source.meta)
          : Object.assign({}, source.meta, { ok: false, error: '当前模型未配置凭证引用' })
        const capturedAt = new Date().toISOString()
        const record = { entry, capturedAt, expiresAt: Date.now() + freshFor(entry) }
        cache.set(key, record)
        return record
      })().finally(() => { inflight.delete(key) })
      inflight.set(key, operation)
      return operation
    }

    ctx.on('credentials/reference-updated', () => { cache.clear() })
    ctx.on('settings/updated', ns => {
      if (ns === 'llm-pi-ai' || ns === 'llm-deepseek') cache.clear()
    })

    // 两个数据源各预热一次；所有会话共享缓存，并发切换复用同一个请求。
    void Promise.allSettled([
      entryFor('opencode-go', SOURCES['opencode-go']),
      entryFor('deepseek-official', SOURCES['deepseek-official']),
    ])

    harness.handle('quota.snapshot', async (selection) => {
      // 按当前模型 provider 匹配数据源（provider 命名差异由 SOURCES 别名覆盖）
      const current = selection && typeof selection.provider === 'string'
        ? { provider: selection.provider, model: String(selection.model || '') }
        : null
      const entries = []
      const source = current && SOURCES[current.provider]
      let capturedAt = new Date().toISOString()
      if (source) {
        const record = await entryFor(current.provider, source)
        capturedAt = record.capturedAt
        entries.push(record.entry)
      }
      return { capturedAt, current, entries }
    })
  },
}
