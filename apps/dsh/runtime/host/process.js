'use strict'

const ChildProcess = require('node:child_process')
const Https = require('node:https')

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

function requestJson(url, redirects = 3) {
  return new Promise((resolve, reject) => {
    const request = Https.get(url, {
      headers: {
        Accept: 'application/vnd.github+json, application/json',
        'User-Agent': 'DSH-Desktop',
      },
      timeout: 15_000,
    }, response => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location && redirects > 0) {
        response.resume()
        requestJson(new URL(response.headers.location, url).toString(), redirects - 1).then(resolve, reject)
        return
      }
      let body = ''
      response.setEncoding('utf8')
      response.on('data', chunk => {
        body += chunk
        if (body.length > 4 * 1024 * 1024) request.destroy(new Error('响应超过 4 MB'))
      })
      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error('HTTP ' + response.statusCode + ': ' + body.slice(0, 300)))
          return
        }
        try {
          resolve(JSON.parse(body))
        } catch (error) {
          reject(new Error('JSON 解析失败：' + error.message))
        }
      })
    })
    request.on('timeout', () => request.destroy(new Error('请求超时')))
    request.on('error', reject)
  })
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

module.exports = { readJsonBody, requestJson, run, sendJson }
