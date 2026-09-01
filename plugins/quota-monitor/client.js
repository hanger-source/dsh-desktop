window.__ModuleLoader__.load({
  id: '@hanger-source/dsh-quota-monitor',
  factory: (require) => {
    const React = require('react')
    const styleNodes = []
    const styles = {
      insert(css) {
        const node = document.createElement('style')
        node.textContent = css
        document.head.appendChild(node)
        styleNodes.push(node)
      },
    }
    const plugin = {
  inject: ['slots', 'timer', 'sessions', 'modelDirectories'],
  apply(ctx) {
    // 用量面板横跨整个 footer；底部一行保留 Cordis 插件状态在左、设置在右。
    styles.insert('\n' +
      '.hHd-Xa_footArea{display:grid!important;grid-template-columns:minmax(0,1fr) auto!important;align-items:end!important;column-gap:8px!important}' +
      '.hHd-Xa_footerActions{display:contents!important}' +
      '.hHd-Xa_settingsArea{grid-column:2!important;grid-row:2!important}' +
      '.mq-root{grid-column:1/-1;display:flex;flex-direction:column;gap:5px;width:100%;box-sizing:border-box;padding:8px 6px 6px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary)}' +
      '.mq-head{display:flex;align-items:baseline;gap:6px}' +
      '.mq-name{font-size:13px;font-weight:700;color:var(--dsw-alias-label-primary);letter-spacing:.01em}' +
      '.mq-updated{margin-left:auto;font-size:10px;color:var(--dsw-alias-label-tertiary)}' +
      '.mq-row{display:flex;align-items:center;gap:8px;white-space:nowrap}' +
      '.mq-label{flex:none;width:52px;color:var(--dsw-alias-label-tertiary);font-size:11px}' +
      '.mq-pct{flex:none;min-width:36px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary);font-weight:600;font-size:12px}' +
      '.mq-balance{margin-left:auto;text-align:right}' +
      '.mq-bar{width:44px;height:3px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);overflow:hidden;flex:none}' +
      '.mq-fill{display:block;height:100%;border-radius:inherit;background:var(--dsw-alias-brand-primary)}' +
      '.mq-fill-warn{background:var(--dsw-alias-state-warn-primary)}' +
      '.mq-fill-err{background:var(--dsw-alias-state-error-primary)}' +
      '.mq-reset{margin-left:auto;font-size:10px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}' +
      '.mq-warn{color:var(--dsw-alias-state-warn-primary)}' +
      '.mq-err{color:var(--dsw-alias-state-error-primary)}' +
      '.mq-muted{opacity:.6}' +
      '.mq-live{display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-success-primary);animation:mq-blink 1.2s infinite}' +
      '@keyframes mq-blink{50%{opacity:.25}}')

    async function quotaSnapshot(selection, allowStale) {
      const query = new URLSearchParams()
      if (selection && selection.provider) query.set('provider', selection.provider)
      if (selection && selection.model) query.set('model', selection.model)
      if (allowStale) query.set('allowStale', '1')
      const response = await fetch('/api/hanger/quota?' + query)
      const result = await response.json().catch(() => null)
      if (!response.ok || !result || result.ok !== true) {
        throw new Error(result && result.error || ('HTTP ' + response.status))
      }
      return result.value
    }

    function fmtCurrency(c) {
      const m = { CNY: '¥', USD: '$', EUR: '€', GBP: '£', JPY: '¥' }
      return m[c] || c
    }

    function fmtMoney(n) {
      if (typeof n !== 'number' || !isFinite(n)) return '—'
      return n.toLocaleString('zh-CN', { maximumFractionDigits: 6, useGrouping: false })
    }

    // 剩余时间：纯倒计时（不写"后重置"），逐级向下取整。
    function fmtReset(iso) {
      if (!iso) return '时间未知'
      const d = new Date(iso)
      if (!isFinite(d.getTime())) return '时间未知'
      const diff = d.getTime() - Date.now()
      if (diff > 0) {
        const days = Math.floor(diff / 86400000)
        const hours = Math.floor((diff % 86400000) / 3600000)
        const mins = Math.floor((diff % 3600000) / 60000)
        if (days > 0) return days + '天' + (hours > 0 ? hours + '小时' : '')
        if (hours > 0) return hours + '小时' + (mins > 0 ? mins + '分' : '')
        if (mins > 0) return mins + '分'
        return '即将重置'
      }
      return d.toLocaleString('zh-CN')
    }

    function fmtPct(v) {
      return typeof v === 'number' ? v + '%' : '—'
    }

    function useCurrentModel() {
      const sessionId = React.useSyncExternalStore(
        listener => ctx.sessions.list.subscribe(listener),
        () => ctx.sessions.list.getSnapshot().current,
      )
      const directory = React.useMemo(
        () => sessionId === undefined ? null : ctx.modelDirectories.directoryFor(sessionId),
        [sessionId],
      )
      return React.useSyncExternalStore(
        listener => directory === null ? () => {} : directory.store.subscribe(listener),
        () => directory === null ? null : directory.store.getSnapshot().current,
      )
    }

    function QuotaSide(props) {
      const wide = props && props.wide !== false
      const currentModel = useCurrentModel()
      const [snap, setSnap] = React.useState(null)
      const [error, setError] = React.useState(null)
      const snapshots = React.useRef(new Map())
      const provider = currentModel && currentModel.provider

      React.useEffect(() => {
        let active = true
        if (provider && snapshots.current.has(provider)) setSnap(snapshots.current.get(provider))
        else setSnap(null)
        const load = async (allowStale) => {
          try {
            const data = await quotaSnapshot(currentModel, allowStale)
            if (active) {
              if (provider) snapshots.current.set(provider, data)
              setSnap(data)
              setError(null)
            }
          } catch (e) {
            if (active) setError(String((e && e.message) || e))
          }
        }
        load(true)
        const stopRefresh = ctx.interval(() => { void load(false) }, 30000)
        return () => {
          active = false
          stopRefresh()
        }
      }, [provider])

      if (!wide) return null

      if (error) {
        return React.createElement('div', { className: 'mq-root' },
          React.createElement('span', { className: 'mq-err' }, '用量读取失败：' + error))
      }

      const entries = snap && Array.isArray(snap.entries) ? snap.entries : null
      if (!entries) {
        return React.createElement('div', { className: 'mq-root mq-muted' },
          React.createElement('span', { className: 'mq-live' }),
          React.createElement('span', null, '正在读取用量…'))
      }

      const e = entries[0]
      const updated = snap && snap.capturedAt
        ? '更新于 ' + new Date(snap.capturedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
        : ''

      const head = React.createElement('div', { className: 'mq-head' },
        React.createElement('span', { className: 'mq-name' }, e && e.displayName),
        updated ? React.createElement('span', { className: 'mq-updated' }, updated) : null)

      if (!e || e.ok === false) {
        return React.createElement('div', { className: 'mq-root' },
          head,
          React.createElement('span', { className: 'mq-err' }, e ? e.error : '未检测到已配置的用量数据源'))
      }

      const body = []
      if (e.kind === 'prepaid') {
        const detail = '总余额 ' + fmtCurrency(e.currency) + ' ' + fmtMoney(e.total) +
          '（充值 ' + fmtMoney(e.toppedUp) + ' / 赠送 ' + fmtMoney(e.granted) + '）'
        body.push(React.createElement('div', { key: 'balance', className: 'mq-row', title: detail },
          React.createElement('span', { className: 'mq-label' }, '余额'),
          React.createElement('span', { className: 'mq-pct mq-balance' }, fmtCurrency(e.currency) + ' ' + fmtMoney(e.total))))
      } else if (e.kind === 'subscription' && e.buckets) {
        const b = e.buckets
        const barCls = (pct) => {
          if (pct == null) return ''
          if (pct > 95) return ' mq-fill-err'
          if (pct > 80) return ' mq-fill-warn'
          return ''
        }
        const row = (id, label) => {
          const v = b[id]
          const pct = fmtPct(v.percent)
          const reset = fmtReset(v.resetsAt)
          const bar = typeof v.percent === 'number'
            ? React.createElement('span', { className: 'mq-bar' },
                React.createElement('span', { className: 'mq-fill' + barCls(v.percent), style: { width: v.percent + '%' } }))
            : null
          return React.createElement('div', { key: id, className: 'mq-row' + (v.status !== 'ok' ? ' mq-warn' : ''), title: label + '用量 ' + pct + '，剩 ' + reset },
            React.createElement('span', { className: 'mq-label' }, label),
            React.createElement('span', { className: 'mq-pct' + (v.status !== 'ok' ? ' mq-warn' : '') }, pct),
            bar,
            React.createElement('span', { className: 'mq-reset' }, reset))
        }
        body.push(row('rolling', '小时'))
        body.push(row('weekly', '本周'))
        body.push(row('monthly', '本月'))
      }

      return React.createElement('div', { className: 'mq-root' }, head, body)
    }

    const slots = ctx.get('slots')
    if (slots === undefined) return
    slots.inject('sidebar.footer.action', () => slots.register(
      { name: 'sidebar.footer.action', id: 'model-quota' },
      (props) => React.createElement(QuotaSide, props),
    ))
  },
}
    const apply = plugin.apply
    return {
      ...plugin,
      apply(ctx) {
        const result = apply.call(plugin, ctx)
        ctx.effect(() => () => {
          for (const node of styleNodes.splice(0)) node.remove()
        }, 'dsh-quota-monitor: styles')
        return result
      },
    }
  },
})
