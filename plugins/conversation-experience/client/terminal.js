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
