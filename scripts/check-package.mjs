import { readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const patch = readFileSync(join(root, manifest.dsh.bundle.patch), 'utf8')

const expected = [
  ['hanger-conversation-experience', 'plugins/conversation-experience'],
  ['hanger-quota-monitor', 'plugins/quota-monitor'],
  ['hanger-node-repl', 'plugins/node-repl'],
]

for (const [id, directory] of expected) {
  const pluginRoot = join(root, directory)
  const plugin = JSON.parse(readFileSync(join(pluginRoot, 'package.json'), 'utf8'))
  if (!plugin.name || !plugin.version || !plugin.dsh?.bundle?.patch) {
    throw new Error(`${directory} is not a complete DSH bundle package`)
  }
  statSync(join(pluginRoot, plugin.main))
  statSync(join(pluginRoot, plugin.dsh.bundle.patch))
  if (!patch.includes(`id: ${id}`) || !patch.includes(`./${directory}/index.js`)) {
    throw new Error(`root bundle does not mount ${directory}`)
  }
  if (plugin.dsh.client) {
    const clientExport = plugin.exports?.['./client']
    if (typeof clientExport !== 'string') throw new Error(`${directory} has no ./client export`)
    statSync(join(pluginRoot, clientExport))
  }
}

console.log(`verified ${manifest.name}@${manifest.version} with ${expected.length} feature rows`)
