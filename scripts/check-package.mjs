import { createHash } from 'node:crypto'
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

for (const [platform, executable] of [
  ['darwin-arm64', 'node_repl'],
  ['win32-x64', 'node_repl.exe'],
]) {
  const vendorRoot = join(root, 'plugins/node-repl/vendor', platform)
  const provenance = JSON.parse(readFileSync(join(vendorRoot, 'manifest.json'), 'utf8'))
  const runtime = readFileSync(join(vendorRoot, executable))
  const sha256 = createHash('sha256').update(runtime).digest('hex')
  if (sha256 !== provenance.sha256) {
    throw new Error(`node-repl ${platform} runtime SHA-256 does not match its provenance manifest`)
  }
  if (runtime.byteLength !== provenance.bytes) {
    throw new Error(`node-repl ${platform} runtime size does not match its provenance manifest`)
  }
}

console.log(`verified ${manifest.name}@${manifest.version} with ${expected.length} feature rows`)
