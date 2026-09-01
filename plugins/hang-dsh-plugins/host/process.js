'use strict'

const ChildProcess = require('node:child_process')
const Http = require('node:http')
const Https = require('node:https')
const Tls = require('node:tls')

function run(executable, args, options = {}) {
  const timeoutMs = options.timeoutMs || 30_000
  const maxBytes = options.maxBytes || 1024 * 1024
  return new Promise((resolve, reject) => {
    const child = ChildProcess.spawn(executable, args, {
      cwd: options.cwd || '/',
      env: options.env || process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const append = (current, chunk) => (current + chunk.toString('utf8')).slice(-maxBytes)
    child.stdout.on('data', chunk => { stdout = append(stdout, chunk) })
    child.stderr.on('data', chunk => { stderr = append(stderr, chunk) })
    child.once('error', error => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    })
    child.once('close', (exitCode, signal) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ exitCode, signal, stdout, stderr })
    })
    const timer = setTimeout(() => {
      if (settled) return
      child.kill('SIGTERM')
      setTimeout(() => {
        if (!settled) child.kill('SIGKILL')
      }, 2_000).unref()
    }, timeoutMs)
    timer.unref()
  })
}

const PROXY_ENV_KEYS = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy']
let cachedProxy

function resolveProxy() {
  if (cachedProxy !== undefined) return cachedProxy
  cachedProxy = PROXY_ENV_KEYS.map(key => process.env[key]).find(Boolean) || null
  if (!cachedProxy) {
    for (const key of ['https.proxy', 'http.proxy']) {
      try {
        const value = ChildProcess.execFileSync('git', ['config', '--get', key], {
          encoding: 'utf8',
          timeout: 5_000,
        }).trim()
        if (value) {
          cachedProxy = value
          break
        }
      } catch (_error) {}
    }
  }
  return cachedProxy
}

function openProxyTunnel(proxyUrl, target) {
  return new Promise((resolve, reject) => {
    let proxy
    try {
      proxy = new URL(proxyUrl)
    } catch (_error) {
      reject(new Error('代理地址无效：' + proxyUrl))
      return
    }
    if (proxy.protocol !== 'http:') {
      reject(new Error('仅支持 http:// 代理，当前：' + proxy.protocol))
      return
    }
    const connect = Http.request({
      host: proxy.hostname,
      port: Number(proxy.port) || 80,
      method: 'CONNECT',
      path: target.hostname + ':' + (target.port || 443),
      timeout: 15_000,
    })
    connect.once('connect', (response, socket) => {
      if (response.statusCode !== 200) {
        socket.destroy()
        reject(new Error('代理隧道失败：HTTP ' + response.statusCode))
        return
      }
      resolve(socket)
    })
    connect.once('timeout', () => connect.destroy(new Error('代理连接超时')))
    connect.once('error', reject)
    connect.end()
  })
}

function requestText(rawUrl, redirects = 3) {
  return new Promise((resolve, reject) => {
    let url
    try {
      url = new URL(rawUrl)
    } catch (error) {
      reject(error)
      return
    }
    const proxy = resolveProxy()
    if (proxy && url.protocol !== 'https:') {
      reject(new Error('代理模式下仅支持 https 目标：' + url.protocol))
      return
    }

    const onResponse = response => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location && redirects > 0) {
        response.resume()
        requestText(new URL(response.headers.location, url).toString(), redirects - 1).then(resolve, reject)
        return
      }
      let body = ''
      response.setEncoding('utf8')
      response.on('data', chunk => {
        body += chunk
        if (body.length > 4 * 1024 * 1024) response.destroy(new Error('响应超过 4 MB'))
      })
      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error('HTTP ' + response.statusCode + ': ' + body.slice(0, 300)))
          return
        }
        resolve(body)
      })
    }

    const build = transportSocket => {
      const request = (transportSocket ? Http : Https).request({
        host: url.hostname,
        path: url.pathname + url.search,
        headers: {
          Host: url.host,
          Accept: 'application/vnd.github+json, application/json',
          'User-Agent': 'DSH-Desktop',
        },
        timeout: 15_000,
        ...(transportSocket ? { createConnection: () => transportSocket } : {}),
      }, onResponse)
      request.on('timeout', () => request.destroy(new Error('请求超时')))
      request.on('error', reject)
      request.end()
    }

    if (!proxy) {
      build(null)
      return
    }
    openProxyTunnel(proxy, url).then(socket => {
      const tlsSocket = Tls.connect({ socket, servername: url.hostname })
      tlsSocket.once('secureConnect', () => build(tlsSocket))
      tlsSocket.once('error', reject)
    }, reject)
  })
}

async function requestJson(url) {
  const body = await requestText(url)
  try {
    return JSON.parse(body)
  } catch (error) {
    throw new Error('JSON 解析失败：' + error.message)
  }
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', chunk => {
      body += chunk
      if (body.length > 128 * 1024) request.destroy(new Error('请求体过大'))
    })
    request.on('end', () => {
      if (!body) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(body))
      } catch (error) {
        reject(new Error('请求 JSON 无效：' + error.message))
      }
    })
    request.on('error', reject)
  })
}

function sendJson(response, statusCode, value) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  response.end(JSON.stringify(value))
}

module.exports = { readJsonBody, requestJson, requestText, run, sendJson }
