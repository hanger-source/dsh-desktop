import Fs from 'node:fs'
import Path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = Path.dirname(fileURLToPath(import.meta.url))
const sources = ['queue.js', 'reasoning.js', 'terminal.js']
const parts = sources.map((name, index) => {
  const source = Fs.readFileSync(Path.join(root, 'client', name), 'utf8').trim()
  return `const __dshClientPart${index} = (() => {\n${source}\n\n})()`
})
const names = sources.map((_name, index) => `__dshClientPart${index}`)

const output = `window.__ModuleLoader__.load({
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
${parts.join('\n')}
const __dshClientParts = [${names.join(', ')}]
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
`

const target = Path.join(root, 'client.js')
if (process.argv.includes('--check')) {
  if (Fs.readFileSync(target, 'utf8') !== output) {
    console.error('client.js is not generated from client/*.js')
    process.exitCode = 1
  }
} else {
  Fs.writeFileSync(target, output)
}
