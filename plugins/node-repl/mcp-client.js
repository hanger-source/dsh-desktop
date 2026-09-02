function errorMessage(error) {
  return String((error && error.message) || error)
}

function cancellationError(signal) {
  if (signal.reason instanceof Error) return signal.reason
  const error = new Error('node-repl: MCP 请求已取消')
  error.name = 'AbortError'
  return error
}

function canonicalJson(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']'
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}'
  }
  return JSON.stringify(value)
}

function assertToolContract(listed, expectedTools) {
  const tools = listed && Array.isArray(listed.tools) ? listed.tools : []
  const actualNames = tools.map(tool => tool && tool.name).filter(name => typeof name === 'string').sort()
  const expectedNames = expectedTools.map(tool => tool.name).sort()
  if (canonicalJson(actualNames) !== canonicalJson(expectedNames)) {
    throw new Error(
      'node-repl: MCP 工具集合与随插件固定的契约不一致（expected ' +
      expectedNames.join(', ') + '; actual ' + actualNames.join(', ') + '）',
    )
  }
  for (const expected of expectedTools) {
    const actual = tools.find(tool => tool && tool.name === expected.name)
    if (canonicalJson(actual && actual.inputSchema) !== canonicalJson(expected.parameters)) {
      throw new Error('node-repl: MCP 工具 ' + expected.name + ' 的参数契约与插件版本不一致')
    }
  }
}

export async function createNodeReplClient(ctx, options) {
  const handle = ctx.subprocess.spawn({
    argv: [options.command, '--disable-sandbox'],
    cwd: options.cwd,
    env: { NODE_REPL_NODE_PATH: options.node },
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
  const decoder = new TextDecoder()
  let nextRequestId = 1
  let stdoutBuffer = ''
  let stopping = false
  let disposed = false

  function send(message) {
    handle.stdin.write(JSON.stringify(message) + '\n')
  }

  function rejectPending(error) {
    for (const held of pending.values()) {
      held.cleanup()
      held.reject(error)
    }
    pending.clear()
  }

  function request(method, params, timeoutMs, signal) {
    if (signal?.aborted) return Promise.reject(cancellationError(signal))
    const id = nextRequestId++
    return new Promise((resolve, reject) => {
      let settled = false
      const cancelTimeout = ctx.timeout(() => {
        if (settled) return
        settled = true
        pending.delete(id)
        signal?.removeEventListener('abort', onAbort)
        try {
          send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: id, reason: 'timeout' } })
        } catch {}
        reject(new Error('node-repl: MCP 请求超时：' + method))
      }, timeoutMs)
      const cleanup = () => {
        if (settled) return false
        settled = true
        cancelTimeout()
        signal?.removeEventListener('abort', onAbort)
        return true
      }
      const onAbort = () => {
        if (!cleanup()) return
        pending.delete(id)
        try {
          send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: id, reason: 'DSH tool call cancelled' } })
        } catch {}
        reject(cancellationError(signal))
      }
      pending.set(id, { resolve, reject, cleanup })
      signal?.addEventListener('abort', onAbort, { once: true })
      try {
        send({ jsonrpc: '2.0', id, method, params })
      } catch (error) {
        pending.delete(id)
        cleanup()
        reject(error)
      }
    })
  }

  function receive(message) {
    if (message && message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
      const held = pending.get(message.id)
      if (!held || !held.cleanup()) return
      pending.delete(message.id)
      if (message.error) {
        held.reject(new Error('node-repl MCP：' + String(message.error.message || JSON.stringify(message.error))))
      } else {
        held.resolve(message.result)
      }
      return
    }
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
      console.error('node-repl: 无法解析 MCP 输出', errorMessage(error))
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

  const done = handle.done.then((outcome) => {
    stdoutBuffer += decoder.decode()
    if (stdoutBuffer.trim()) receiveLine(stdoutBuffer)
    if (!stopping) {
      const detail = outcome.exitCode === null
        ? 'signal ' + String(outcome.signal)
        : 'exit ' + String(outcome.exitCode)
      const error = new Error('node-repl: MCP 子进程意外退出（' + detail + '）')
      rejectPending(error)
      console.error(error.message)
    }
    return outcome
  }, (error) => {
    if (!stopping) {
      rejectPending(error)
      console.error('node-repl: MCP 子进程启动失败', errorMessage(error))
    }
    throw error
  })
  done.catch(() => {})

  async function dispose() {
    if (disposed) return
    disposed = true
    stopping = true
    rejectPending(new Error('node-repl: 会话 REPL 已关闭'))
    handle.stdout.off('data', onStdout)
    handle.stdin.off('error', onStdinError)
    handle.terminate()
    await handle.waitForExit()
  }

  try {
    const initialized = await request('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'dsh-node-repl', version: options.version },
    }, 15000)
    send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })
    const listed = await request('tools/list', {}, 15000)
    assertToolContract(listed, options.expectedTools)
    console.log(
      'node-repl: 会话 MCP 已就绪',
      options.sessionId,
      'cwd=' + options.cwd,
      'MCP=' + String(initialized && initialized.serverInfo && initialized.serverInfo.version || 'unknown'),
    )
  } catch (error) {
    try {
      await dispose()
    } catch (cleanupError) {
      console.error('node-repl: MCP 初始化失败后的清理失败', errorMessage(cleanupError))
    }
    throw error
  }

  return {
    done,
    async call(name, args, signal) {
      if (disposed) throw new Error('node-repl: 会话 REPL 已关闭')
      return request('tools/call', { name, arguments: args }, 300000, signal)
    },
    dispose,
  }
}
