// quota-monitor —— CLIENT 半（当前最新版，2026-08-31）
//
// 本文件内容即为 cordis_define 的 code.client 函数体：
// Agent 重放时把整个文件内容原样作为 code.client 传入即可。
// 运行效果：侧边栏底部「插件/用量/设置」三行中的用量面板，
// OpenCode Go 名称加粗并与更新时间同行，小时/本周/本月逐行排布，剩余倒计时无"后重置"字样。
return {
  inject: ['slots', 'timer'],
  apply(ctx) {
    // 让 footerActions 容器可换行：cordis 插件按钮独占第一行，用量面板第二行，设置第三行。
    styles.insert('\n' +
      '.hHd-Xa_footerActions{flex-wrap:wrap!important;gap:2px}' +
      '.mq-root{flex:0 0 100%;display:flex;flex-direction:column;gap:5px;width:100%;box-sizing:border-box;padding:8px 6px 6px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary)}' +
      '.mq-head{display:flex;align-items:baseline;gap:6px}' +
      '.mq-name{font-size:13px;font-weight:700;color:var(--dsw-alias-label-primary);letter-spacing:.01em}' +
      '.mq-updated{margin-left:auto;font-size:10px;color:var(--dsw-alias-label-tertiary)}' +
      '.mq-row{display:flex;align-items:center;gap:8px;white-space:nowrap}' +
      '.mq-label{flex:none;width:52px;color:var(--dsw-alias-label-tertiary);font-size:11px}' +
      '.mq-pct{flex:none;min-width:36px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary);font-weight:600;font-size:12px}' +
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

    function QuotaSide(props) {
      const wide = props && props.wide !== false
      const [snap, setSnap] = React.useState(null)
      const [error, setError] = React.useState(null)
      const selectionKey = React.useRef(null)

      React.useEffect(() => {
        let active = true
        const load = async () => {
          try {
            const data = await host.call('quota.snapshot')
            if (active) {
              selectionKey.current = JSON.stringify(data && data.current)
              setSnap(data)
              setError(null)
            }
          } catch (e) {
            if (active) setError(String((e && e.message) || e))
          }
        }
        load()
        const stopRefresh = ctx.interval(load, 60000)
        const checkSelection = async () => {
          try {
            const current = await host.call('quota.selection')
            const nextKey = JSON.stringify(current)
            if (selectionKey.current !== null && selectionKey.current !== nextKey) await load()
          } catch (e) {
            if (active) setError(String((e && e.message) || e))
          }
        }
        const stopSelection = ctx.interval(checkSelection, 1000)
        return () => {
          active = false
          stopRefresh()
          stopSelection()
        }
      }, [])

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
          React.createElement('span', { className: 'mq-pct' }, fmtCurrency(e.currency) + ' ' + fmtMoney(e.total))))
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
