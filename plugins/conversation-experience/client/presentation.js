// 过程思考展示 —— Client 半
// DSH 0.1.7 的部分 provider 会把中间思考写成 Turn process 内的普通
// assistant-step，而不是 reasoning block。为它补回旧 Think 组件的两层结构：
// 思考标题/摘要行 + 独立的圆角滚动正文；外层 Turn process 仍由 DSH 管理。
return {
  apply(ctx) {
    styles.insert(`
      .dsh-flow-process-reasoning{display:flex;flex-direction:column}
      .dsh-flow-process-reasoning-row{position:relative;box-sizing:border-box;display:flex;align-items:center;min-width:0;height:calc(24px + var(--dsh-content-font-delta,0px));padding:0;border:0;background:transparent;color:var(--dsw-alias-label-primary);font-family:inherit;font-size:var(--dsh-content-font-size,14px);font-weight:400;line-height:calc(24px + var(--dsh-content-font-delta,0px));text-align:left;cursor:pointer;overflow:hidden}
      .dsh-flow-process-reasoning-row:hover{color:var(--dsw-alias-label-primary)}
      .dsh-flow-process-reasoning-row:focus-visible{outline:2px solid var(--dsw-alias-label-tertiary);outline-offset:2px;border-radius:4px}
      .dsh-flow-process-reasoning-leading{position:relative;display:inline-flex;flex:none;align-items:center;justify-content:center;width:calc(16px + var(--dsh-content-font-delta,0px));height:calc(16px + var(--dsh-content-font-delta,0px));margin-right:6px;color:var(--dsw-alias-label-tertiary)}
      .dsh-flow-process-reasoning-leading svg{width:calc(14px + var(--dsh-content-font-delta,0px));height:calc(14px + var(--dsh-content-font-delta,0px))}
      .dsh-flow-process-reasoning-icon{display:inline-flex;opacity:1;transition:opacity 100ms ease}
      .dsh-flow-process-reasoning-chevron{position:absolute;inset:0;display:inline-flex;align-items:center;justify-content:center;margin:auto;opacity:0;transition:opacity 100ms ease,transform 100ms ease}
      .dsh-flow-process-reasoning-row:hover .dsh-flow-process-reasoning-icon,
      .dsh-flow-process-reasoning[data-expanded="true"]>.dsh-flow-process-reasoning-row .dsh-flow-process-reasoning-icon{opacity:0}
      .dsh-flow-process-reasoning-row:hover .dsh-flow-process-reasoning-chevron,
      .dsh-flow-process-reasoning[data-expanded="true"]>.dsh-flow-process-reasoning-row .dsh-flow-process-reasoning-chevron{opacity:1}
      .dsh-flow-process-reasoning[data-expanded="true"]>.dsh-flow-process-reasoning-row .dsh-flow-process-reasoning-chevron{transform:rotate(180deg)}
      .dsh-flow-process-reasoning-title{flex:none;color:var(--dsw-alias-label-secondary);font-size:var(--dsh-content-font-size-secondary,13px);font-weight:400;line-height:calc(24px + var(--dsh-content-font-delta,0px))}
      .dsh-flow-process-reasoning-separator{flex:none;width:2px;height:2px;margin:0 8px;border-radius:1px;background:var(--dsw-alias-label-caption)}
      .dsh-flow-process-reasoning-summary{min-width:0;overflow:hidden;color:var(--dsw-alias-label-tertiary);font-size:var(--dsh-content-font-size-secondary,13px);line-height:20px;text-overflow:ellipsis;white-space:nowrap}
      .dsh-flow-process-reasoning[data-expanded="true"]>.dsh-flow-process-reasoning-row .dsh-flow-process-reasoning-separator,
      .dsh-flow-process-reasoning[data-expanded="true"]>.dsh-flow-process-reasoning-row .dsh-flow-process-reasoning-summary{display:none}
      .dsh-flow-process-reasoning[data-expanded="false"]>:not(.dsh-flow-process-reasoning-row){display:none!important}
      @media (prefers-reduced-motion:reduce){.dsh-flow-process-reasoning-chevron{transition:none}}
    `)

    ctx.effect(() => {
      const selector = '[data-chat-flow-kind="assistant-step"][data-turn-process-member]:not(:has([data-variant="think"]))'
      const bindings = new Map()
      const atBottom = body => body.scrollHeight - body.scrollTop - body.clientHeight <= 2
      const running = body => body.querySelector('[data-streaming]') !== null

      const decorateBody = body => {
        const originalStyle = body.getAttribute('style')
        body.style.setProperty('box-sizing', 'border-box')
        body.style.setProperty('max-height', '260px')
        body.style.setProperty('margin', '4px 0 4px 4px')
        body.style.setProperty('padding', '12px 16px')
        body.style.setProperty('border', '.5px solid var(--dsw-alias-border-l1)')
        body.style.setProperty('border-radius', '12px')
        body.style.setProperty('background', 'var(--dsw-alias-markdown-code-block)')
        body.style.setProperty('overflow', 'hidden auto')
        return originalStyle
      }

      const restoreBody = binding => {
        if (binding.originalStyle === null) binding.body.removeAttribute('style')
        else binding.body.setAttribute('style', binding.originalStyle)
      }

      const firstLine = body => {
        const text = body.innerText.trim()
        const newline = text.indexOf('\n')
        return (newline === -1 ? text : text.slice(0, newline)).replaceAll('**', '')
      }

      const icon = paths => {
        const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
        node.setAttribute('width', '14')
        node.setAttribute('height', '14')
        node.setAttribute('viewBox', '0 0 16 16')
        node.setAttribute('fill', 'none')
        node.setAttribute('aria-hidden', 'true')
        node.setAttribute('stroke-width', '1')
        for (const descriptor of paths) {
          const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
          path.setAttribute('d', descriptor.d)
          path.setAttribute(descriptor.fill ? 'fill' : 'stroke', 'currentColor')
          node.append(path)
        }
        return node
      }

      const makeRow = binding => {
        const row = document.createElement('button')
        row.type = 'button'
        row.className = 'dsh-flow-process-reasoning-row'
        row.setAttribute('aria-expanded', 'true')
        row.setAttribute('aria-label', '收起思考')

        const leading = document.createElement('span')
        leading.className = 'dsh-flow-process-reasoning-leading'

        const think = document.createElement('span')
        think.className = 'dsh-flow-process-reasoning-icon'
        think.append(icon([
          { d: 'M10.7554 5.24466C13.9891 8.4783 15.3769 12.3333 13.8552 13.8551C12.3335 15.3768 8.4785 13.989 5.24478 10.7553C2.01111 7.52165 0.623307 3.66664 2.14504 2.14491C3.66676 0.623189 7.52178 2.01099 10.7554 5.24466Z' },
          { d: 'M10.7554 10.7553C7.52178 13.989 3.66676 15.3768 2.14504 13.8551C0.623307 12.3333 2.01111 8.4783 5.24478 5.24466C8.4785 2.01099 12.3335 0.623189 13.8552 2.14491C15.3769 3.66664 13.9891 7.52165 10.7554 10.7553Z' },
          { d: 'M8.9587 8.00025C8.9587 8.52835 8.5306 8.95655 8.0024 8.95655C7.47429 8.95655 7.04614 8.52835 7.04614 8.00025C7.04614 7.47209 7.47429 7.04395 8.0024 7.04395C8.5306 7.04395 8.9587 7.47209 8.9587 8.00025Z', fill: true },
        ]))

        const chevron = document.createElement('span')
        chevron.className = 'dsh-flow-process-reasoning-chevron'
        chevron.append(icon([{ d: 'M4 6L7.29289 9.29289C7.68342 9.68342 8.31658 9.68342 8.70711 9.29289L12 6' }]))
        leading.append(think, chevron)

        const title = document.createElement('span')
        title.className = 'dsh-flow-process-reasoning-title'
        title.textContent = '思考'

        const separator = document.createElement('span')
        separator.className = 'dsh-flow-process-reasoning-separator'
        separator.setAttribute('aria-hidden', 'true')

        const summary = document.createElement('span')
        summary.className = 'dsh-flow-process-reasoning-summary'
        summary.textContent = firstLine(binding.body)

        row.append(leading, title, separator, summary)
        return { row, summary }
      }

      const setExpanded = (binding, expanded) => {
        binding.root.setAttribute('data-expanded', String(expanded))
        binding.row.setAttribute('aria-expanded', String(expanded))
        binding.row.setAttribute('aria-label', expanded ? '收起思考' : '展开思考')
      }

      const unbind = binding => {
        binding.body.removeEventListener('scroll', binding.scroll)
        binding.row.removeEventListener('click', binding.toggle)
        binding.row.remove()
        restoreBody(binding)
        binding.root.classList.remove('dsh-flow-process-reasoning')
        binding.root.removeAttribute('data-expanded')
      }

      const bind = (root, body) => {
        const binding = {
          root,
          body,
          row: null,
          summary: null,
          following: true,
          lastScrollTop: body.scrollTop,
          scroll: null,
          toggle: null,
          originalStyle: decorateBody(body),
        }
        const built = makeRow(binding)
        binding.row = built.row
        binding.summary = built.summary
        binding.scroll = () => {
          const nextScrollTop = body.scrollTop
          if (atBottom(body)) binding.following = true
          else if (nextScrollTop < binding.lastScrollTop - 1) binding.following = false
          binding.lastScrollTop = nextScrollTop
        }
        binding.toggle = () => setExpanded(binding, root.getAttribute('data-expanded') !== 'true')

        root.classList.add('dsh-flow-process-reasoning')
        root.prepend(binding.row)
        setExpanded(binding, true)
        body.addEventListener('scroll', binding.scroll, { passive: true })
        binding.row.addEventListener('click', binding.toggle)
        return binding
      }

      const follow = binding => {
        if (!binding.following || !running(binding.body)) return
        requestAnimationFrame(() => {
          if (!binding.following || !running(binding.body)) return
          binding.body.scrollTop = binding.body.scrollHeight
          binding.lastScrollTop = binding.body.scrollTop
          requestAnimationFrame(() => {
            if (!binding.following || !running(binding.body)) return
            binding.body.scrollTop = binding.body.scrollHeight
            binding.lastScrollTop = binding.body.scrollTop
          })
        })
      }

      const inspectAll = () => {
        const active = new Set()
        for (const root of document.querySelectorAll(selector)) {
          const content = Array.from(root.children).find(child => !child.classList.contains('dsh-flow-process-reasoning-row'))
          const body = content && content.style.display === 'contents' ? content.firstElementChild : content
          if (!body || body.innerText.trim() === '') continue
          active.add(root)

          let binding = bindings.get(root)
          if (binding && binding.body !== body) {
            unbind(binding)
            bindings.delete(root)
            binding = null
          }
          if (!binding) {
            binding = bind(root, body)
            bindings.set(root, binding)
          }
          if (root.getAttribute('data-expanded') !== 'true') {
            const summary = firstLine(body)
            if (binding.summary.textContent !== summary) binding.summary.textContent = summary
          }
          follow(binding)
        }

        for (const [root, binding] of bindings) {
          if (active.has(root) && root.isConnected) continue
          unbind(binding)
          bindings.delete(root)
        }
      }

      const observer = new MutationObserver(inspectAll)
      observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['data-streaming'] })
      requestAnimationFrame(inspectAll)

      return () => {
        observer.disconnect()
        for (const binding of bindings.values()) unbind(binding)
        bindings.clear()
      }
    })
  },
}
