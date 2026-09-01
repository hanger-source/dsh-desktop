import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const packageDirectory = dirname(fileURLToPath(import.meta.url))
const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')

const plugin = {
  name: 'node-repl',
  inject: ['subprocess', 'timer', 'tools', 'attachments'],
  async apply(ctx) {
    const command = join(packageDirectory, 'vendor', 'darwin-arm64', 'node_repl')
    const node = await ctx.subprocess.resolveExecutable('node')
    const base64Executable = await ctx.subprocess.resolveExecutable('base64')
    const handle = ctx.subprocess.spawn({
      argv: [command, '--disable-sandbox'],
      cwd: dshHome,
      env: { NODE_REPL_NODE_PATH: node },
      stdio: {
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'inherit',
      },
      graceMs: 2000,
    })

    if (!handle.stdin || !handle.stdout) {
      handle.terminate()
      throw new Error('node-repl: MCP 子进程没有可用的 stdio 管道')
    }

    const pending = new Map()
    const toolDisposers = []
    const decoder = new TextDecoder()
    let nextRequestId = 1
    let stdoutBuffer = ''
    let stopping = false

    function rejectPending(error) {
      for (const request of pending.values()) {
        request.cancelTimeout()
        request.reject(error)
      }
      pending.clear()
    }

    function send(message) {
      handle.stdin.write(JSON.stringify(message) + '\n')
    }

    function request(method, params, timeoutMs) {
      const id = nextRequestId++
      return new Promise((resolve, reject) => {
        const cancelTimeout = ctx.timeout(() => {
          pending.delete(id)
          reject(new Error('node-repl: MCP 请求超时：' + method))
        }, timeoutMs)
        pending.set(id, { resolve, reject, cancelTimeout })
        try {
          send({ jsonrpc: '2.0', id, method, params })
        } catch (error) {
          pending.delete(id)
          cancelTimeout()
          reject(error)
        }
      })
    }

    function receive(message) {
      if (message && message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
        const held = pending.get(message.id)
        if (!held) return
        pending.delete(message.id)
        held.cancelTimeout()
        if (message.error) {
          held.reject(new Error('node-repl MCP：' + String(message.error.message || JSON.stringify(message.error))))
        } else {
          held.resolve(message.result)
        }
        return
      }

      // 这个 server 当前不会反向调用客户端；如果以后新增请求，明确拒绝，
      // 避免它悬挂在等待状态。
      if (message && message.id !== undefined && typeof message.method === 'string') {
        send({
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32601, message: 'Method not supported by DSH Node REPL client' },
        })
      }
    }

    function receiveLine(line) {
      if (!line.trim()) return
      try {
        receive(JSON.parse(line))
      } catch (error) {
        console.error('node-repl: 无法解析 MCP 输出', String((error && error.message) || error))
      }
    }

    const onStdout = (chunk) => {
      stdoutBuffer += decoder.decode(chunk, { stream: true })
      for (;;) {
        const newline = stdoutBuffer.indexOf('\n')
        if (newline < 0) break
        const line = stdoutBuffer.slice(0, newline)
        stdoutBuffer = stdoutBuffer.slice(newline + 1)
        receiveLine(line)
      }
    }
    handle.stdout.on('data', onStdout)

    const onStdinError = (error) => {
      if (!stopping) rejectPending(error)
    }
    handle.stdin.on('error', onStdinError)

    void handle.done.then((outcome) => {
      if (stdoutBuffer.trim()) receiveLine(stdoutBuffer)
      if (stopping) return
      const detail = outcome.exitCode === null
        ? 'signal ' + String(outcome.signal)
        : 'exit ' + String(outcome.exitCode)
      const error = new Error('node-repl: MCP 子进程意外退出（' + detail + '）')
      rejectPending(error)
      console.error(error.message)
    }, (error) => {
      if (stopping) return
      rejectPending(error)
      console.error('node-repl: MCP 子进程启动失败', String((error && error.message) || error))
    })

    const attachments = ctx.get('attachments')
    if (!attachments) {
      throw new Error('node-repl: attachments 服务不可用')
    }

    function base64Value(code) {
      if (code >= 65 && code <= 90) return code - 65
      if (code >= 97 && code <= 122) return code - 71
      if (code >= 48 && code <= 57) return code + 4
      if (code === 43) return 62
      if (code === 47) return 63
      return -1
    }

    function validateBase64(data) {
      if (typeof data !== 'string' || data.length === 0 || data.length % 4 !== 0) {
        throw new Error('node-repl: MCP 图片不是完整的 base64')
      }
      const padding = data.endsWith('==') ? 2 : (data.endsWith('=') ? 1 : 0)
      for (let offset = 0; offset < data.length; offset += 4) {
        const a = base64Value(data.charCodeAt(offset))
        const b = base64Value(data.charCodeAt(offset + 1))
        const last = offset + 4 === data.length
        const cPadding = data.charCodeAt(offset + 2) === 61
        const dPadding = data.charCodeAt(offset + 3) === 61
        const c = cPadding ? 0 : base64Value(data.charCodeAt(offset + 2))
        const d = dPadding ? 0 : base64Value(data.charCodeAt(offset + 3))
        if (a < 0 || b < 0 || c < 0 || d < 0 || (!last && (cPadding || dPadding))) {
          throw new Error('node-repl: MCP 图片包含无效的 base64')
        }
        if (cPadding && (!dPadding || (b & 15) !== 0)) {
          throw new Error('node-repl: MCP 图片不是规范 base64')
        }
        if (!cPadding && dPadding && (c & 3) !== 0) {
          throw new Error('node-repl: MCP 图片不是规范 base64')
        }
      }
      return (data.length / 4) * 3 - padding
    }

    async function decodeBase64(data) {
      const expectedBytes = validateBase64(data)
      // Dynamic host code runs in a VM realm. A Uint8Array created there has the
      // right bytes but is not accepted by the host image decoder. Managed
      // subprocess stdout yields host-realm Buffer chunks without exposing Node
      // globals inside the plugin sandbox.
      const decoder = ctx.subprocess.spawn({
        argv: [base64Executable, '-D'],
        cwd: dshHome,
        env: {},
        stdio: {
          stdin: { data },
          stdout: 'pipe',
          stderr: 'inherit',
        },
        graceMs: 2000,
      })
      if (!decoder.stdout) {
        decoder.terminate()
        throw new Error('node-repl: base64 解码器没有可用的 stdout')
      }
      const chunks = []
      decoder.stdout.on('data', chunk => chunks.push(chunk))
      const outcome = await decoder.done
      if (outcome.exitCode !== 0) {
        throw new Error('node-repl: MCP 图片 base64 解码失败')
      }
      if (chunks.length === 0) {
        throw new Error('node-repl: MCP 图片 base64 解码结果为空')
      }
      const bytes = chunks.length === 1
        ? chunks[0]
        : chunks[0].constructor.concat(chunks)
      if (bytes.byteLength !== expectedBytes) {
        throw new Error('node-repl: MCP 图片 base64 解码长度不匹配')
      }
      console.log('node-repl: MCP 图片已解码', {
        bytes: bytes.byteLength,
        constructor: bytes.constructor && bytes.constructor.name,
        firstBytes: Array.from(bytes.subarray(0, 8)),
      })
      return bytes
    }

    async function persistResultImages(value) {
      if (!value || !Array.isArray(value.content)) return value
      const imageBlocks = value.content.filter(block => block && block.type === 'image')
      if (imageBlocks.length === 0) return value
      const decoded = []
      for (const block of imageBlocks) {
        if (typeof block.mimeType !== 'string') {
          throw new Error('node-repl: MCP 图片缺少 mimeType')
        }
        decoded.push({
          data: await decodeBase64(block.data),
          mediaType: block.mimeType,
        })
      }
      let refs
      try {
        refs = await attachments.saveImages(decoded)
      } catch (error) {
        console.error(
          'node-repl: MCP 图片附件持久化失败',
          String((error && error.message) || error),
          String((error && error.cause && error.cause.message) || ''),
        )
        throw error
      }
      let imageIndex = 0
      return {
        ...value,
        content: value.content.map(block => block && block.type === 'image'
          ? { type: 'image', attachment: refs[imageIndex++] }
          : block),
      }
    }

    function resultText(value) {
      if (!value || !Array.isArray(value.content)) return JSON.stringify(value)
      const text = value.content
        .filter(block => block && block.type === 'text' && typeof block.text === 'string')
        .map(block => block.text)
        .join('\n')
      return text || JSON.stringify(value)
    }

    function renderResult(_args, value) {
      if (value && Array.isArray(value.content)) {
        const blocks = value.content.filter(block => block && typeof block.type === 'string')
        if (blocks.length > 0) return blocks
      }
      return [{ type: 'text', text: resultText(value) }]
    }

    try {
      const initialized = await request('initialize', {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'dsh-node-repl', version: '0.1.1' },
      }, 15000)
      send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })

      const listed = await request('tools/list', {}, 15000)
      const tools = listed && Array.isArray(listed.tools) ? listed.tools : []
      if (tools.length === 0) throw new Error('node-repl: MCP server 没有返回工具')

      for (const tool of tools) {
        if (!tool || typeof tool.name !== 'string' || !tool.inputSchema) continue
        const publicName = 'mcp__node_repl__' + tool.name
        const definition = {
          name: publicName,
          description: String(tool.description || ('Node REPL MCP tool: ' + tool.name)),
          parameters: tool.inputSchema,
          timeoutMs: 300000,
          output: {
            schema: {},
            render: renderResult,
          },
          async execute(args) {
            const result = await request('tools/call', {
              name: tool.name,
              arguments: args,
            }, 300000)
            if (result && result.isError === true) throw new Error(resultText(result))
            return persistResultImages(result)
          },
        }
        toolDisposers.push(ctx.tools.register(definition))
      }

      console.log(
        'Node REPL 已通过 Cordis 注册：' +
        toolDisposers.length +
        ' 个工具；MCP ' +
        String(initialized && initialized.serverInfo && initialized.serverInfo.version || 'unknown'),
      )
    } catch (error) {
      stopping = true
      rejectPending(error)
      handle.terminate()
      await handle.waitForExit()
      throw error
    }

    ctx.effect(() => async () => {
      stopping = true
      for (const dispose of toolDisposers.splice(0)) dispose()
      rejectPending(new Error('node-repl: Cordis 插件已卸载'))
      handle.stdout.off('data', onStdout)
      handle.stdin.off('error', onStdinError)
      handle.terminate()
      await handle.waitForExit()
    }, 'node-repl MCP process')
  },
}

export const inject = plugin.inject
export const apply = plugin.apply
