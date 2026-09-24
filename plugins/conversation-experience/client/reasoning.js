// 思考展示 —— Client 半
// 保留 DSH 原生 Think 行，只让展开内容使用与工具卡片一致的滚动容器。
return {
  apply(ctx) {
    styles.insert(`
    `)

    ctx.effect(() => {
      const bindings = new Map()
      const atBottom = body => body.scrollHeight - body.scrollTop - body.clientHeight <= 2

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
            binding = { root, body, following: true, lastScrollTop: body.scrollTop, scroll: null, originalStyle: decorateBody(body) }
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
          restoreBody(binding)
          bindings.delete(body)
        }
      }

      const observer = new MutationObserver(inspectAll)
      observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['data-state'] })
      requestAnimationFrame(inspectAll)

      return () => {
        observer.disconnect()
        for (const [body, binding] of bindings) {
          body.removeEventListener('scroll', binding.scroll)
          restoreBody(binding)
        }
        bindings.clear()
      }
    })
  },
}
