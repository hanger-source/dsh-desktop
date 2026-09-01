// node-repl —— HOST 半
//
// 插件由 DSH Desktop 的 Hang 插件加载器动态装入 Cordis。它通过正式的
// subprocess/tools capability seams 启动随仓库同步的 MCP server 并注册工具；
// 不依赖 Profile、Bundle、require、process 或宿主私有模块。
return {
  name: 'node-repl',
  inject: ['subprocess', 'timer', 'tools'],
  async apply(ctx) {
    const dshHomePath = ctx.get('dshHomePath')
    if (typeof dshHomePath !== 'function') {
      throw new Error('node-repl: dshHomePath 服务不可用')
    }

    const command = dshHomePath(
      'dsh-desktop',
      'plugins',
      'node-repl',
      'vendor',
      'darwin-arm64',
      'node_repl',
    )
    const node = await ctx.subprocess.resolveExecutable('node')
    const handle = ctx.subprocess.spawn({
      argv: [command, '--disable-sandbox'],
      cwd: dshHomePath(),
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
        clientInfo: { name: 'dsh-node-repl', version: '0.1.0' },
      }, 15000)
      send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })

      const listed = await request('tools/list', {}, 15000)
      const tools = listed && Array.isArray(listed.tools) ? listed.tools : []
      if (tools.length === 0) throw new Error('node-repl: MCP server 没有返回工具')

      for (const tool of tools) {
        if (!tool || typeof tool.name !== 'string' || !tool.inputSchema) continue
        const publicName = 'mcp__node_repl__' + tool.name
        const definition = harness.defineTool({
          name: publicName,
          description: String(tool.description || ('Node REPL MCP tool: ' + tool.name)),
          parameters: tool.inputSchema,
          timeoutMs: 300000,
          output: {
            schema: { type: 'json' },
            render: renderResult,
          },
          async execute(args) {
            const result = await request('tools/call', {
              name: tool.name,
              arguments: args,
            }, 300000)
            if (result && result.isError === true) throw new Error(resultText(result))
            return result
          },
        })
        toolDisposers.push(harness.registerTool(ctx, definition))
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
