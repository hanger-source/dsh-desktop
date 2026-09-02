import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

import { createNodeReplClient } from './mcp-client.js'
import { createResultAdapter } from './result-adapter.js'
import { NODE_REPL_TOOL_SPECS } from './tool-specs.js'

const packageDirectory = dirname(fileURLToPath(import.meta.url))
const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
const packageVersion = '0.1.2'

function createAgentRuntime(ctx, options) {
  let disposed = false
  let client = null
  let clientPromise = null

  async function createClient() {
    const created = await createNodeReplClient(ctx, {
      command: options.command,
      node: options.node,
      cwd: options.agent.session.header.cwd ?? dshHome,
      sessionId: options.agent.id,
      version: packageVersion,
      expectedTools: NODE_REPL_TOOL_SPECS,
    })
    if (disposed) {
      await created.dispose()
      throw new Error('node-repl: 会话 REPL 已关闭')
    }
    client = created
    void created.done.finally(() => {
      if (client === created) {
        client = null
        clientPromise = null
      }
    }).catch(() => {})
    return created
  }

  function getClient() {
    if (disposed) return Promise.reject(new Error('node-repl: 会话 REPL 已关闭'))
    if (!clientPromise) {
      clientPromise = createClient().catch((error) => {
        clientPromise = null
        throw error
      })
    }
    return clientPromise
  }

  const toolDisposers = []
  try {
    for (const tool of NODE_REPL_TOOL_SPECS) {
      toolDisposers.push(options.agent.ctx.tools.register({
        name: 'mcp__node_repl__' + tool.name,
        description: tool.description,
        parameters: tool.parameters,
        timeoutMs: 300000,
        output: { schema: {}, render: options.resultAdapter.render },
        async execute(args, exec) {
          if (exec.agent !== options.agent) throw new Error('node-repl: 工具执行会话与注册会话不一致')
          const activeClient = await getClient()
          const result = await activeClient.call(tool.name, args, exec.signal)
          if (result && result.isError === true) throw new Error(options.resultAdapter.resultText(result))
          return options.resultAdapter.persistResultImages(result)
        },
      }))
    }
  } catch (error) {
    for (const dispose of toolDisposers.reverse()) dispose()
    throw error
  }

  console.log('node-repl: 已为会话注册工具', options.agent.id, 'tools=' + toolDisposers.length)

  return async function dispose() {
    if (disposed) return
    disposed = true
    for (const disposeTool of toolDisposers.reverse()) disposeTool()
    const creating = clientPromise
    clientPromise = null
    client = null
    if (!creating) return
    let activeClient
    try {
      activeClient = await creating
    } catch {
      return
    }
    try {
      await activeClient.dispose()
    } catch (error) {
      console.error('node-repl: 会话 REPL 清理失败', options.agent.id, String((error && error.message) || error))
    }
  }
}

const plugin = {
  name: 'node-repl',
  inject: ['agents', 'subprocess', 'timer', 'tools', 'attachments'],
  async apply(ctx) {
    const command = join(packageDirectory, 'vendor', 'darwin-arm64', 'node_repl')
    const node = await ctx.subprocess.resolveExecutable('node')
    const base64Executable = await ctx.subprocess.resolveExecutable('base64')
    const attachments = ctx.get('attachments')
    if (!attachments) throw new Error('node-repl: attachments 服务不可用')
    const resultAdapter = createResultAdapter(ctx, { attachments, base64Executable, dshHome })
    const runtimes = new Map()
    let stopping = false

    function install(agent) {
      if (stopping || runtimes.has(agent)) return
      const cleanup = agent.ctx.effect(() => {
        const disposeRuntime = createAgentRuntime(ctx, { agent, command, node, resultAdapter })
        return async () => {
          try {
            await disposeRuntime()
          } finally {
            if (runtimes.get(agent) === cleanup) runtimes.delete(agent)
          }
        }
      }, 'node-repl.session-runtime()')
      runtimes.set(agent, cleanup)
    }

    ctx.effect(() => {
      const stopCreated = ctx.on('agent/created', ({ agent }) => install(agent))
      for (const agent of ctx.agents.list()) install(agent)
      return async () => {
        stopping = true
        stopCreated()
        const cleanups = [...runtimes.values()]
        runtimes.clear()
        await Promise.allSettled(cleanups.map(cleanup => Promise.resolve(cleanup())))
      }
    }, 'node-repl.lifecycle()')
  },
}

export const inject = plugin.inject
export const apply = plugin.apply
