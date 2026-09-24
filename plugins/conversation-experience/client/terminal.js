// 终端展示 —— Client 半
// 保留 DSH 原生终端卡，只增强被截断命令的点击展开和收起。
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
        const existing = bindings.get(terminal)
        const header = terminal.firstElementChild
        const prompt = header && header.firstElementChild
        if (!header || !prompt) {
          if (existing) {
            existing.dispose()
            bindings.delete(terminal)
          }
          return
        }

        if (existing?.prompt === prompt && prompt.getAttribute('aria-expanded') === 'true') return

        const commands = Array.from(prompt.children)
          .map(row => row.lastElementChild)
          .filter(command => command && command.scrollWidth > command.clientWidth + 1)
        if (commands.length === 0) {
          if (existing) {
            existing.dispose()
            bindings.delete(terminal)
          }
          return
        }
        if (existing?.prompt === prompt && commands.length === existing.commands.length && commands.every(command => existing.commands.includes(command))) return
        if (existing) {
          existing.dispose()
          bindings.delete(terminal)
        }

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
        const dispose = () => {
          prompt.removeEventListener('click', click)
          prompt.removeEventListener('keydown', keydown)
          prompt.classList.remove('dsh-flow-command-toggle')
          prompt.removeAttribute('role')
          prompt.removeAttribute('tabindex')
          prompt.removeAttribute('aria-expanded')
          header.classList.remove('dsh-flow-command-header-expanded')
          for (const command of commands) command.classList.remove('dsh-flow-command-expanded')
        }

        prompt.classList.add('dsh-flow-command-toggle')
        prompt.setAttribute('role', 'button')
        prompt.setAttribute('tabindex', '0')
        prompt.setAttribute('aria-expanded', 'false')
        prompt.addEventListener('click', click)
        prompt.addEventListener('keydown', keydown)
        bindings.set(terminal, { prompt, commands, dispose })
      }

      const inspectAll = () => {
        for (const terminal of document.querySelectorAll('[data-terminal]')) {
          resizeObserver.observe(terminal)
          inspect(terminal)
        }
        for (const [terminal, binding] of bindings) {
          if (terminal.isConnected) continue
          binding.dispose()
          bindings.delete(terminal)
        }
      }
      const observer = new MutationObserver(inspectAll)
      observer.observe(document.body, { childList: true, subtree: true, characterData: true })
      const resizeObserver = new ResizeObserver(entries => {
        for (const entry of entries) inspect(entry.target)
      })
      requestAnimationFrame(inspectAll)

      return () => {
        observer.disconnect()
        resizeObserver.disconnect()
        for (const binding of bindings.values()) binding.dispose()
        bindings.clear()
      }
    })
  },
}
