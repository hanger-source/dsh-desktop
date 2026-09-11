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
const __dshClientParts = [__dshClientPart0]
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
