import { spawn } from 'node:child_process'
import { accessSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoDir = resolve(fileURLToPath(new URL('..', import.meta.url)))
const packageDir = resolve(process.argv[2] ?? repoDir)
const runtimeFiles = {
  'darwin-arm64': 'node_repl',
  'win32-x64': 'node_repl.exe',
}
const platform = `${process.platform}-${process.arch}`
const runtimeFile = runtimeFiles[platform]
if (!runtimeFile) throw new Error(`node-repl runtime check does not support ${platform}`)

const pluginDir = join(packageDir, 'plugins', 'node-repl')
const command = join(pluginDir, 'vendor', platform, runtimeFile)
accessSync(command)
const { NODE_REPL_TOOL_SPECS } = await import(pathToFileURL(join(pluginDir, 'tool-specs.js')))

const child = spawn(command, ['--disable-sandbox'], {
  cwd: repoDir,
  env: { ...process.env, NODE_REPL_NODE_PATH: process.execPath },
  stdio: ['pipe', 'pipe', 'pipe'],
})
child.stdout.setEncoding('utf8')
child.stderr.setEncoding('utf8')

let nextId = 1
let stdoutBuffer = ''
let stderr = ''
const pending = new Map()

function send(message) {
  child.stdin.write(JSON.stringify(message) + '\n')
}

function request(method, params) {
  const id = nextId++
  return new Promise((resolveRequest, rejectRequest) => {
    const timeout = setTimeout(() => {
      pending.delete(id)
      rejectRequest(new Error(`node-repl runtime timed out during ${method}\n${stderr}`))
    }, 15_000)
    pending.set(id, {
      resolve(value) {
        clearTimeout(timeout)
        resolveRequest(value)
      },
      reject(error) {
        clearTimeout(timeout)
        rejectRequest(error)
      },
    })
    send({ jsonrpc: '2.0', id, method, params })
  })
}

function receiveLine(line) {
  if (!line.trim()) return
  const message = JSON.parse(line)
  if (message.id === undefined) return
  const held = pending.get(message.id)
  if (!held) return
  pending.delete(message.id)
  if (message.error) held.reject(new Error(String(message.error.message ?? JSON.stringify(message.error))))
  else held.resolve(message.result)
}

child.stdout.on('data', (chunk) => {
  stdoutBuffer += chunk
  for (;;) {
    const newline = stdoutBuffer.indexOf('\n')
    if (newline < 0) break
    const line = stdoutBuffer.slice(0, newline)
    stdoutBuffer = stdoutBuffer.slice(newline + 1)
    receiveLine(line)
  }
})
child.stderr.on('data', chunk => { stderr += chunk })
child.once('exit', (code, signal) => {
  const error = new Error(`node-repl runtime exited before verification: ${code ?? signal}\n${stderr}`)
  for (const held of pending.values()) held.reject(error)
  pending.clear()
})

try {
  await request('initialize', {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'hang-dsh-runtime-check', version: '1' },
  })
  send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })
  const listed = await request('tools/list', {})
  const actual = listed.tools.map(tool => tool.name).sort()
  const expected = NODE_REPL_TOOL_SPECS.map(tool => tool.name).sort()
  const missing = expected.filter(name => !actual.includes(name))
  if (missing.length > 0) {
    throw new Error(`node-repl runtime is missing ${missing.join(', ')}; actual ${actual.join(', ')}`)
  }
  const runtimePrivate = actual.filter(name => !expected.includes(name))
  console.log(
    `verified official node-repl runtime for ${platform}: ${expected.join(', ')}` +
    (runtimePrivate.length > 0 ? `; runtime-private: ${runtimePrivate.join(', ')}` : ''),
  )
  if (runtimePrivate.length > 0) {
    console.log(JSON.stringify(listed.tools.filter(tool => runtimePrivate.includes(tool.name))))
  }
} finally {
  child.stdin.end()
  child.kill()
}
