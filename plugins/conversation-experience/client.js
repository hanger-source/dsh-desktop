window.__ModuleLoader__.load({
  id: '@hanger-source/dsh-conversation-experience',
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
    const plugin = (() => {

// Generated from client/*.js. Do not edit this section directly.
const __dshClientPart0 = (() => {
// 排队消息 —— Client 半
// 通过正式 Slot 接管 QueueDock，保留 Session Remote API 作为唯一写入链路。
return {
  inject: ['slots', 'sessions'],
  apply(ctx) {
    styles.insert(`
      [data-queue-dock]{display:none!important}
      .dsh-flow-queue{box-sizing:border-box;flex:none;width:calc(100% - var(--dsh-composer-side-clearance) - var(--dsh-composer-side-clearance) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset));max-width:calc(var(--dsh-composer-card-max-width) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset));margin:0 auto calc(0px - var(--dsh-composer-stack-gap) - 3px);padding:0 var(--dsh-composer-dock-inset)}
      .dsh-flow-queue-panel{position:relative;overflow:hidden;width:100%;padding:2px 0;border-radius:12px 12px 0 0;background:var(--dsw-specific-tip)}
      .dsh-flow-queue-panel::after{position:absolute;inset:0;border:1px solid var(--dsw-alias-border-l1);border-bottom:0;border-radius:inherit;content:"";pointer-events:none}
      .dsh-flow-queue-head{box-sizing:border-box;display:flex;align-items:center;gap:10px;width:100%;height:36px;padding:4px 12px;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;line-height:24px}
      .dsh-flow-queue-count{flex:1 1 auto;min-width:0}
      .dsh-flow-queue-hint{color:var(--dsw-alias-label-tertiary);font-size:10px;font-weight:400}
      .dsh-flow-queue-list{display:flex;flex-direction:column;max-height:180px;overflow-y:auto;margin:0;padding:0;list-style:none}
      .dsh-flow-queue-item{box-sizing:border-box;display:flex;flex-direction:column;gap:6px;width:100%;padding:7px 5px 7px 12px;border-radius:8px}
      .dsh-flow-queue-item+.dsh-flow-queue-item{box-shadow:inset 0 1px 0 var(--dsw-alias-border-l1)}
      .dsh-flow-queue-line{display:flex;align-items:flex-start;gap:10px;min-width:0}
      .dsh-flow-queue-lead{display:grid;flex:none;place-items:center;width:14px;height:18px;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:18px}
      .dsh-flow-queue-preview{display:-webkit-box;flex:1;min-width:0;overflow:hidden;-webkit-box-orient:vertical;-webkit-line-clamp:3;color:var(--dsw-alias-label-primary-dimmed);font:var(--dsw-font-xs-13);line-height:18px;white-space:pre-wrap;overflow-wrap:anywhere}
      .dsh-flow-queue-preview[data-full="true"]{display:block;overflow:visible}
      .dsh-flow-queue-actions{display:flex;flex:none;align-items:center;gap:4px}
      .dsh-flow-queue-action{appearance:none;display:grid;flex:none;place-items:center;width:28px;height:28px;padding:0;border:0;border-radius:999px;background:transparent;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1;cursor:pointer}
      .dsh-flow-queue-action:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
      .dsh-flow-queue-action:focus-visible{outline:2px solid var(--dsw-alias-label-tertiary);outline-offset:-2px}
      .dsh-flow-queue-action:disabled{cursor:default;opacity:.45}
      .dsh-flow-queue-expand{align-self:flex-start;margin-left:24px;padding:0;border:0;background:transparent;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;cursor:pointer}
      .dsh-flow-queue-expand:hover{color:var(--dsw-alias-label-secondary)}
      .dsh-flow-queue-editor{box-sizing:border-box;width:100%;min-height:92px;resize:vertical;padding:9px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;outline:none;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:var(--dsw-font-xs-13);line-height:18px}
      .dsh-flow-queue-editor:focus{border-color:var(--dsw-alias-state-business-primary)}
      .dsh-flow-queue-edit-foot{display:flex;align-items:center;gap:4px}
      .dsh-flow-queue-shortcut{margin-right:auto;color:var(--dsw-alias-label-tertiary);font-size:10px}
      .dsh-flow-queue-error{padding:0 12px 8px;color:var(--dsw-alias-state-error-primary);font-size:11px}
    `)

    const slots = ctx.get('slots')
    const sessions = ctx.get('sessions')
    if (!slots || !sessions) return

    const icons = {
      queue: {
        viewBox: '0 0 14 14',
        paths: ['M7.00049 0.199829C3.24488 0.199829 0.199952 3.24408 0.199707 6.99963C0.199707 8.0414 0.434087 9.03061 0.854004 9.91467L1.11279 10.4576L2.19775 9.94202L1.94092 9.39905L1.81787 9.12268C1.5498 8.46885 1.40186 7.75171 1.40186 6.99963C1.4021 3.90808 3.90888 1.40198 7.00049 1.40198C10.0919 1.40219 12.5979 3.90821 12.5981 6.99963C12.5981 10.0913 10.0921 12.5981 7.00049 12.5983C6.36734 12.5983 5.90348 12.5535 5.49268 12.4401C5.08803 12.3283 4.7041 12.1414 4.24463 11.8209C3.57111 11.3511 2.60588 11.1855 1.81006 11.6881L1.79736 11.6959L1.78467 11.7047L1.25537 12.0778L1.65381 13.2672L2.46045 12.6989C2.75029 12.5214 3.18004 12.5442 3.55615 12.8063C4.10063 13.1861 4.60863 13.4423 5.17334 13.5983C5.73194 13.7525 6.31665 13.8004 7.00049 13.8004C10.7561 13.8002 13.8003 10.7553 13.8003 6.99963C13.8 3.24421 10.7559 0.200041 7.00049 0.199829ZM3.81201 7.47327V8.67542H7.11572V7.47327H3.81201ZM3.81201 6.34924H10.2173V5.14709H3.81201V6.34924Z'],
      },
      edit: {
        viewBox: '0 0 16 16',
        paths: ['M9.94076 1.34942C10.7047 0.90231 11.6503 0.902415 12.4143 1.34942C12.7061 1.52015 12.9688 1.79118 13.3104 2.13284C13.6521 2.47448 13.9231 2.73721 14.0939 3.02894C14.5408 3.79294 14.5409 4.73856 14.0939 5.50251C13.9231 5.79415 13.652 6.05704 13.3104 6.39861L6.65932 13.0497C6.28068 13.4284 6.00695 13.7108 5.66543 13.9097C5.32391 14.1085 4.94315 14.2074 4.42705 14.3498L3.24394 14.6761C2.77527 14.8054 2.34538 14.9262 2.00131 14.9684C1.65196 15.0112 1.17964 15.0013 0.810764 14.6325C0.441921 14.2637 0.432107 13.7913 0.47486 13.442C0.517035 13.0979 0.6379 12.668 0.767181 12.1993L1.09352 11.0162C1.23588 10.5001 1.33481 10.1193 1.5336 9.77784C1.7325 9.43632 2.0149 9.1626 2.39355 8.78395L9.04466 2.13284C9.38625 1.79126 9.64911 1.52016 9.94076 1.34942ZM15.5427 14.8398H7.55223L8.96707 13.425H15.5427V14.8398ZM3.39382 9.78422C2.965 10.213 2.84244 10.3436 2.75709 10.49C2.67183 10.6366 2.61862 10.8079 2.45733 11.3925L2.13099 12.5756C2.00183 13.0439 1.92194 13.3419 1.88863 13.5536C2.10041 13.5204 2.39872 13.4416 2.86764 13.3123L4.05075 12.9859C4.63544 12.8246 4.80669 12.7715 4.95323 12.6862C5.09968 12.6008 5.23022 12.4783 5.65905 12.0494L10.721 6.98644L8.45577 4.72121L3.39382 9.78422ZM11.7 2.57079C11.3774 2.38198 10.9777 2.38198 10.6551 2.57079C10.5602 2.62647 10.4487 2.72931 10.0449 3.13311L9.45604 3.72094L11.7213 5.98617L12.3102 5.39833C12.7139 4.99457 12.8168 4.88307 12.8725 4.78818C13.0613 4.46561 13.0612 4.06585 12.8725 3.74326C12.8169 3.64827 12.7146 3.53752 12.3102 3.13311C11.9057 2.72863 11.795 2.6264 11.7 2.57079Z'],
      },
      trash: {
        viewBox: '0 0 16 16',
        paths: ['M14.4782 4.84067L14.2138 10.1152C14.1102 12.1872 14.067 13.0115 13.3866 13.9607C13.1044 14.3546 12.7498 14.6912 12.3424 14.9535C11.8239 15.2872 11.2415 15.4316 10.5585 15.4998C9.88727 15.5668 9.04946 15.5656 7.99998 15.5656C6.95051 15.5656 6.1127 15.5668 5.44142 15.4998C4.75851 15.4316 4.17602 15.2872 3.65753 14.9535C3.25012 14.6912 2.89559 14.3546 2.61332 13.9607C1.93296 13.0115 1.88979 12.1872 1.78619 10.1152L1.52179 4.84067L2.89006 4.77277L3.15343 10.0463C3.26221 12.2218 3.32452 12.6015 3.72646 13.1624C3.90825 13.4161 4.13686 13.6334 4.39927 13.8023C4.66204 13.9714 5.00263 14.0792 5.57825 14.1367C6.16562 14.1953 6.92298 14.1963 7.99998 14.1963C9.07699 14.1963 9.83434 14.1953 10.4217 14.1367C10.9973 14.0792 11.3379 13.9714 11.6007 13.8023C11.8631 13.6334 12.0917 13.4161 12.2735 13.1624C12.6755 12.6015 12.7378 12.2218 12.8465 10.0463L13.1099 4.77277L14.4782 4.84067ZM5.43011 6.22849H6.7994V11.3909H5.43011V6.22849ZM9.20056 6.22849H10.5699V11.3909H9.20056V6.22849ZM8.53597 0.434431C9.17976 0.434431 9.6522 0.426926 10.0966 0.571258C10.2357 0.616451 10.3717 0.672554 10.502 0.738948C10.9182 0.951107 11.2464 1.29099 11.7015 1.74612L12.4978 2.54136H15.3742V3.91169H0.625732V2.54136H3.50218L4.29845 1.74612C4.75358 1.29099 5.08174 0.951107 5.49801 0.738948C5.62831 0.672554 5.76425 0.616451 5.90334 0.571258C6.34776 0.426926 6.82021 0.434431 7.46399 0.434431H8.53597ZM7.46399 1.80476C6.73208 1.80476 6.51641 1.81187 6.32617 1.87369C6.25545 1.89667 6.18668 1.92533 6.12041 1.95907C5.96398 2.03878 5.82348 2.16253 5.44142 2.54136H10.5585C10.1765 2.16253 10.036 2.03878 9.87955 1.95907C9.81329 1.92533 9.74452 1.89667 9.6738 1.87369C9.48356 1.81187 9.26789 1.80476 8.53597 1.80476H7.46399Z'],
      },
      send: {
        viewBox: '0 0 14 14',
        paths: ['M7.24707 1.01771C7.52897 1.07653 7.77619 1.19694 8.00391 1.38001C8.19202 1.53136 8.39884 1.73784 8.61914 1.95814L12.6396 5.9806L11.6299 6.99134L7.71484 3.0763V13.0001H6.28516V3.0763L2.36914 6.99134L1.35938 5.9806L5.38086 1.95814C5.60116 1.73784 5.80798 1.53136 5.99609 1.38001C6.19476 1.22027 6.4385 1.06739 6.75195 1.01771C6.91296 0.992304 7.07471 0.997504 7.24707 1.01771Z'],
      },
      check: {
        viewBox: '0 0 16 16',
        paths: ['M15.0498 3.92579L8.49512 12.3818C8.25774 12.6881 8.04517 12.9645 7.84668 13.1689C7.63957 13.3823 7.38732 13.5841 7.04492 13.6719C6.86373 13.7183 6.6757 13.7346 6.48926 13.7197C6.13666 13.6915 5.8528 13.5355 5.6123 13.3604C5.38201 13.1926 5.12573 12.9567 4.83984 12.6953L1.03125 9.21289L1.96875 8.1875L5.77734 11.6699C6.08684 11.9529 6.27773 12.1249 6.43066 12.2363C6.50183 12.2882 6.54699 12.3135 6.57324 12.3252C6.58525 12.3305 6.59269 12.3322 6.5957 12.333C6.59802 12.3336 6.59961 12.334 6.59961 12.334C6.63317 12.3367 6.66758 12.3335 6.7002 12.3252C6.7002 12.3252 6.70211 12.3251 6.7041 12.3242C6.70698 12.3229 6.71348 12.319 6.72461 12.3115C6.74849 12.2956 6.78843 12.2642 6.84961 12.2012C6.98138 12.0654 7.13957 11.8628 7.39648 11.5313L13.9502 3.07422L15.0498 3.92579Z'],
      },
      close: {
        viewBox: '0 0 16 16',
        paths: ['M14.1168 13.197L13.197 14.1167L1.8833 2.80303L2.80309 1.88324L14.1168 13.197Z', 'M13.197 1.88326L14.1168 2.80305L2.80309 14.1168L1.8833 13.197L13.197 1.88326Z'],
      },
    }

    function Icon({ name, size = 14 }) {
      const icon = icons[name]
      return React.createElement('svg', {
        width: size, height: size, viewBox: icon.viewBox, fill: 'none',
        xmlns: 'http://www.w3.org/2000/svg', 'aria-hidden': 'true',
      }, icon.paths.map((path, index) => React.createElement('path', {
        key: index, d: path, fill: 'currentColor',
      })))
    }

    function lineCount(text) {
      return text === '' ? 0 : text.split('\n').length
    }

    function queueText(row) {
      if (typeof row.text === 'string') return row.text
      if (typeof row.preview === 'string') return row.preview
      return '包含暂不支持编辑的内容'
    }

    function QueueDock(props) {
      const inbox = props.useSession(snapshot => snapshot.queue)
      const queue = React.useMemo(() => inbox.filter(row => row.placement === 'queued'), [inbox])
      const running = props.useSession(snapshot => snapshot.running)
      const mutable = props.useSession(snapshot => snapshot.subagent === null)
      const [editing, setEditing] = React.useState(null)
      const [busy, setBusy] = React.useState(null)
      const [expanded, setExpanded] = React.useState({})
      const [error, setError] = React.useState(null)

      React.useEffect(() => {
        if (editing && (!mutable || !queue.some(row => row.id === editing.id))) setEditing(null)
      }, [editing, mutable, queue])

      if (queue.length === 0) return null

      const act = async (id, action, failure) => {
        setBusy(id)
        setError(null)
        try {
          const session = sessions.binding(props.sessionId)?.session
          if (!session) throw new Error('当前会话连接不可用')
          const result = await session.updateQueue(id, action)
          if (!result.ok) throw new Error(result.error.code + '：' + result.error.message)
          return true
        } catch (actionError) {
          const detail = String((actionError && actionError.message) || actionError)
          setError(failure + '：' + detail)
          console.error('[排队消息] ' + failure, actionError)
          return false
        } finally {
          setBusy(null)
        }
      }

      const save = async () => {
        if (!editing || editing.text.trim() === '') return
        const ok = await act(editing.id, { kind: 'edit', content: [{ type: 'text', text: editing.text }] }, '排队消息保存失败')
        if (ok) setEditing(null)
      }

      return React.createElement('div', { className: 'dsh-flow-queue', 'data-dsh-flow-queue': '' },
        React.createElement('div', { className: 'dsh-flow-queue-panel' },
          queue.length > 1 ? React.createElement('div', { className: 'dsh-flow-queue-head' },
            React.createElement('span', { className: 'dsh-flow-queue-lead', 'aria-hidden': 'true' }, React.createElement(Icon, { name: 'queue' })),
            React.createElement('span', { className: 'dsh-flow-queue-count' }, '排队消息 ' + queue.length),
            React.createElement('span', { className: 'dsh-flow-queue-hint' }, mutable ? '等待当前回复完成' : '不可修改')) : null,
          React.createElement('ol', { className: 'dsh-flow-queue-list' }, queue.map(row => {
            const text = queueText(row)
            const isEditing = editing && editing.id === row.id
            const isLong = text.length > 180 || lineCount(text) > 3
            if (isEditing) {
              return React.createElement('li', { key: row.id, className: 'dsh-flow-queue-item' },
                React.createElement('textarea', {
                  autoFocus: true, className: 'dsh-flow-queue-editor', value: editing.text,
                  'aria-label': '编辑排队消息',
                  onChange: event => setEditing({ id: row.id, text: event.currentTarget.value }),
                  onKeyDown: event => {
                    if (event.key === 'Escape') {
                      event.preventDefault()
                      setEditing(null)
                    } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) {
                      event.preventDefault()
                      void save()
                    }
                  },
                }),
                React.createElement('div', { className: 'dsh-flow-queue-edit-foot' },
                  React.createElement('span', { className: 'dsh-flow-queue-shortcut' }, '⌘/Ctrl + Enter 保存 · Esc 取消'),
                  React.createElement('button', {
                    type: 'button', className: 'dsh-flow-queue-action', 'aria-label': '取消编辑', title: '取消',
                    disabled: busy !== null, onClick: () => setEditing(null),
                  }, React.createElement(Icon, { name: 'close' })),
                  React.createElement('button', {
                    type: 'button', className: 'dsh-flow-queue-action', 'aria-label': '保存排队消息', title: '保存',
                    disabled: busy !== null || editing.text.trim() === '', onClick: () => void save(),
                  }, React.createElement(Icon, { name: 'check' }))))
            }
            const full = expanded[row.id] === true
            return React.createElement('li', { key: row.id, className: 'dsh-flow-queue-item' },
              React.createElement('div', { className: 'dsh-flow-queue-line' },
                React.createElement('span', { className: 'dsh-flow-queue-lead', 'aria-hidden': 'true' }, React.createElement(Icon, { name: 'queue' })),
                React.createElement('span', { className: 'dsh-flow-queue-preview', 'data-full': full ? 'true' : 'false' }, text),
                mutable ? React.createElement('div', { className: 'dsh-flow-queue-actions' },
                  React.createElement('button', {
                    type: 'button', className: 'dsh-flow-queue-action', 'aria-label': '编辑排队消息',
                    disabled: busy !== null || row.text === null,
                    title: row.text === null ? '这条消息包含图片，不能只编辑文本' : '',
                    onClick: () => row.text !== null && setEditing({ id: row.id, text: row.text }),
                  }, React.createElement(Icon, { name: 'edit' })),
                  React.createElement('button', {
                    type: 'button', className: 'dsh-flow-queue-action', 'aria-label': '移除排队消息', title: '移除',
                    disabled: busy !== null,
                    onClick: () => void act(row.id, { kind: 'remove' }, '移除排队消息失败'),
                  }, React.createElement(Icon, { name: 'trash' })),
                  React.createElement('button', {
                    type: 'button', className: 'dsh-flow-queue-action', 'aria-label': '立即发送排队消息',
                    disabled: busy !== null || !running,
                    title: running ? '' : '当前没有运行中的回复',
                    onClick: () => void act(row.id, { kind: 'steer' }, '立即发送排队消息失败'),
                  }, React.createElement(Icon, { name: 'send' }))) : null),
              isLong ? React.createElement('button', {
                type: 'button', className: 'dsh-flow-queue-expand',
                onClick: () => setExpanded(values => Object.assign({}, values, { [row.id]: !full })),
              }, full ? '收起' : '展开全部') : null)
          })),
          error ? React.createElement('div', { className: 'dsh-flow-queue-error' }, error) : null))
    }

    slots.inject('conversation.input.dock', () => slots.register({
      name: 'conversation.input.dock',
      id: 'flowui-queue',
      order: 21,
    }, QueueDock))
  },
}

})()
const __dshClientPart1 = (() => {
// 思考展示 —— Client 半
// 保留 DSH 原生 Think 行，只让展开内容使用与工具卡片一致的滚动容器。
return {
  apply(ctx) {
    styles.insert(`
      [data-variant="think"] [data-disclosure-row]+div{box-sizing:border-box;max-height:260px;margin:4px 0 4px 4px;padding:12px 16px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-markdown-code-block);overflow-y:auto}
    `)

    ctx.effect(() => {
      const bindings = new Map()
      const atBottom = body => body.scrollHeight - body.scrollTop - body.clientHeight <= 2

      const follow = binding => {
        if (!binding.following || binding.root.getAttribute('data-state') !== 'running') return
        requestAnimationFrame(() => {
          if (!binding.following || binding.root.getAttribute('data-state') !== 'running') return
          binding.body.scrollTop = binding.body.scrollHeight
          binding.lastScrollTop = binding.body.scrollTop
          requestAnimationFrame(() => {
            if (!binding.following || binding.root.getAttribute('data-state') !== 'running') return
            binding.body.scrollTop = binding.body.scrollHeight
            binding.lastScrollTop = binding.body.scrollTop
          })
        })
      }

      const inspectAll = () => {
        const active = new Set()
        for (const root of document.querySelectorAll('[data-variant="think"]')) {
          const row = root.querySelector('[data-disclosure-row]')
          const body = row && row.nextElementSibling
          if (!body) continue
          active.add(body)

          let binding = bindings.get(body)
          if (!binding) {
            binding = { root, body, following: true, lastScrollTop: body.scrollTop, scroll: null }
            binding.scroll = () => {
              const nextScrollTop = body.scrollTop
              if (atBottom(body)) binding.following = true
              else if (nextScrollTop < binding.lastScrollTop - 1) binding.following = false
              binding.lastScrollTop = nextScrollTop
            }
            body.addEventListener('scroll', binding.scroll, { passive: true })
            bindings.set(body, binding)
          }
          follow(binding)
        }

        for (const [body, binding] of bindings) {
          if (active.has(body) && body.isConnected) continue
          body.removeEventListener('scroll', binding.scroll)
          bindings.delete(body)
        }
      }

      const observer = new MutationObserver(inspectAll)
      observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['data-state'] })
      requestAnimationFrame(inspectAll)

      return () => {
        observer.disconnect()
        for (const [body, binding] of bindings) body.removeEventListener('scroll', binding.scroll)
        bindings.clear()
      }
    })
  },
}

})()
const __dshClientPart2 = (() => {
// 终端展示 —— Client 半
// 保留 DSH 原生终端卡，只增强被截断命令的展开交互。
return {
  apply(ctx) {
    styles.insert(`
      [data-terminal] .dsh-flow-command-toggle{cursor:pointer}
      [data-terminal] .dsh-flow-command-toggle:focus-visible{outline:2px solid var(--dsw-alias-label-tertiary);outline-offset:2px;border-radius:4px}
      [data-terminal] .dsh-flow-command-expanded{overflow:visible!important;text-overflow:clip!important;white-space:pre-wrap!important;overflow-wrap:anywhere!important}
      [data-terminal] .dsh-flow-command-header-expanded{max-height:none!important}
    `)

    ctx.effect(() => {
      const bindings = new Map()

      const inspect = terminal => {
        if (bindings.has(terminal)) return
        const header = terminal.firstElementChild
        const prompt = header && header.firstElementChild
        if (!header || !prompt) return

        const commands = Array.from(prompt.children)
          .map(row => row.lastElementChild)
          .filter(command => command && command.scrollWidth > command.clientWidth + 1)
        if (commands.length === 0) return

        const toggle = () => {
          const expanded = prompt.getAttribute('aria-expanded') === 'true'
          prompt.setAttribute('aria-expanded', String(!expanded))
          header.classList.toggle('dsh-flow-command-header-expanded', !expanded)
          for (const command of commands) command.classList.toggle('dsh-flow-command-expanded', !expanded)
        }
        const click = event => {
          if (event.target.closest('button')) return
          toggle()
        }
        const keydown = event => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          toggle()
        }

        prompt.classList.add('dsh-flow-command-toggle')
        prompt.setAttribute('role', 'button')
        prompt.setAttribute('tabindex', '0')
        prompt.setAttribute('aria-expanded', 'false')
        prompt.addEventListener('click', click)
        prompt.addEventListener('keydown', keydown)
        bindings.set(terminal, { header, prompt, commands, click, keydown })
      }

      const inspectAll = () => {
        for (const terminal of document.querySelectorAll('[data-terminal]')) inspect(terminal)
      }
      const observer = new MutationObserver(inspectAll)
      observer.observe(document.body, { childList: true, subtree: true })
      requestAnimationFrame(inspectAll)

      return () => {
        observer.disconnect()
        for (const binding of bindings.values()) {
          binding.prompt.removeEventListener('click', binding.click)
          binding.prompt.removeEventListener('keydown', binding.keydown)
          binding.prompt.classList.remove('dsh-flow-command-toggle')
          binding.prompt.removeAttribute('role')
          binding.prompt.removeAttribute('tabindex')
          binding.prompt.removeAttribute('aria-expanded')
          binding.header.classList.remove('dsh-flow-command-header-expanded')
          for (const command of binding.commands) command.classList.remove('dsh-flow-command-expanded')
        }
      }
    })
  },
}

})()
const __dshClientParts = [__dshClientPart0, __dshClientPart1, __dshClientPart2]
for (const part of __dshClientParts) {
  if (!part || typeof part.apply !== 'function') throw new Error('client module must return a Cordis plugin')
}
const __dshClientInject = Array.from(new Set(__dshClientParts.flatMap(part => Array.isArray(part.inject) ? part.inject : [])))
return {
  inject: __dshClientInject,
  apply(ctx) {
    for (const part of __dshClientParts) part.apply(ctx)
  },
}

    })()
    const apply = plugin.apply
    return {
      ...plugin,
      apply(ctx) {
        const result = apply.call(plugin, ctx)
        ctx.effect(() => () => {
          for (const node of styleNodes.splice(0)) node.remove()
        }, 'dsh-conversation-experience: styles')
        return result
      },
    }
  },
})
