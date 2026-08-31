// 会话体验 —— Client 半
// 保留 DSH 原生终端卡，只增强被截断命令的展开交互；排队消息通过正式 Slot 接管。
return {
  inject: ['slots', 'sessions'],
  apply(ctx) {
    styles.insert(`
      [data-terminal] .dsh-flow-command-toggle{cursor:pointer}
      [data-terminal] .dsh-flow-command-toggle:focus-visible{outline:2px solid var(--dsw-alias-label-tertiary);outline-offset:2px;border-radius:4px}
      [data-terminal] .dsh-flow-command-expanded{overflow:visible!important;text-overflow:clip!important;white-space:pre-wrap!important;overflow-wrap:anywhere!important}
      [data-terminal] .dsh-flow-command-header-expanded{max-height:none!important}
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
          console.error('[会话体验] ' + failure, actionError)
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
            React.createElement('span', { className: 'dsh-flow-queue-lead', 'aria-hidden': 'true' }, '≡'),
            React.createElement('span', { className: 'dsh-flow-queue-count' }, '排队消息 ' + queue.length),
            React.createElement('span', { className: 'dsh-flow-queue-hint' }, mutable ? '等待当前回复完成' : '不可修改')) : null,
          React.createElement('ol', { className: 'dsh-flow-queue-list' }, queue.map((row, index) => {
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
                  }, '×'),
                  React.createElement('button', {
                    type: 'button', className: 'dsh-flow-queue-action', 'aria-label': '保存排队消息', title: '保存',
                    disabled: busy !== null || editing.text.trim() === '', onClick: () => void save(),
                  }, '✓')))
            }
            const full = expanded[row.id] === true
            return React.createElement('li', { key: row.id, className: 'dsh-flow-queue-item' },
              React.createElement('div', { className: 'dsh-flow-queue-line' },
                React.createElement('span', { className: 'dsh-flow-queue-lead', 'aria-hidden': 'true' }, queue.length > 1 ? String(index + 1) : '≡'),
                React.createElement('span', { className: 'dsh-flow-queue-preview', 'data-full': full ? 'true' : 'false' }, text),
                mutable ? React.createElement('div', { className: 'dsh-flow-queue-actions' },
                  React.createElement('button', {
                    type: 'button', className: 'dsh-flow-queue-action', 'aria-label': '编辑排队消息',
                    disabled: busy !== null || row.text === null,
                    title: row.text === null ? '这条消息包含图片，不能只编辑文本' : '',
                    onClick: () => row.text !== null && setEditing({ id: row.id, text: row.text }),
                  }, '✎'),
                  React.createElement('button', {
                    type: 'button', className: 'dsh-flow-queue-action', 'aria-label': '移除排队消息', title: '移除',
                    disabled: busy !== null,
                    onClick: () => void act(row.id, { kind: 'remove' }, '移除排队消息失败'),
                  }, '×'),
                  React.createElement('button', {
                    type: 'button', className: 'dsh-flow-queue-action', 'aria-label': '立即发送排队消息',
                    disabled: busy !== null || !running,
                    title: running ? '' : '当前没有运行中的回复',
                    onClick: () => void act(row.id, { kind: 'steer' }, '立即发送排队消息失败'),
                  }, '➤')) : null),
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
