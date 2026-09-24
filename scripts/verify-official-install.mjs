import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoDir = resolve(fileURLToPath(new URL('..', import.meta.url)))
const verifyDir = mkdtempSync(join(tmpdir(), 'hang-dsh-plugins-'))
const packageDir = join(verifyDir, 'package')
const dshHome = join(verifyDir, 'dsh-home')
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const dshCommand = process.platform === 'win32' ? 'dsh.cmd' : 'dsh'
const env = {
  ...process.env,
  DSH_HOME: dshHome,
  npm_config_registry: process.env.npm_config_registry ?? 'https://registry.npmjs.org',
}

mkdirSync(packageDir, { recursive: true })

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoDir,
    env,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    if (options.capture) {
      process.stderr.write(result.stdout ?? '')
      process.stderr.write(result.stderr ?? '')
    }
    throw new Error(`${command} exited with status ${result.status}`)
  }
  return result.stdout ?? ''
}

let installSpec = process.argv[2]
if (!installSpec) {
  const packResult = JSON.parse(run(npmCommand, [
    'pack',
    repoDir,
    '--pack-destination',
    packageDir,
    '--json',
  ], { capture: true }))
  installSpec = join(packageDir, packResult[0].filename)
}

run(dshCommand, ['integration', '--from-default-profile', 'web', '--dump-config'], { capture: true })
run(dshCommand, ['plugin', '--profile', 'integration', 'add', installSpec, '--save-exact'])

const composedConfig = run(dshCommand, ['integration', '--dump-config'], { capture: true })
for (const rowId of [
  'hanger-conversation-experience',
  'hanger-quota-monitor',
  'hanger-node-repl',
]) {
  if (!composedConfig.includes(rowId)) {
    throw new Error(`official composed config is missing ${rowId}`)
  }
}

const dependencyList = JSON.parse(run(dshCommand, [
  'plugin',
  '--profile',
  'integration',
  'list',
  '--json',
  '--depth=0',
], { capture: true }))
if (!dependencyList[0]?.dependencies?.['@hanger-source/hang-dsh-plugins']) {
  throw new Error('official profile does not contain the aggregate dependency')
}

const runtime = spawn(dshCommand, ['integration', '--no-open', '--port', '0'], {
  cwd: repoDir,
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
})
let runtimeOutput = ''
runtime.stdout.setEncoding('utf8')
runtime.stderr.setEncoding('utf8')

const runtimeUrl = await new Promise((resolveUrl, reject) => {
  const timeout = setTimeout(() => reject(new Error(`official DSH host did not become ready\n${runtimeOutput}`)), 60_000)
  const consume = (chunk) => {
    runtimeOutput += chunk
    const match = runtimeOutput.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=\S+/)
    if (!match) return
    clearTimeout(timeout)
    resolveUrl(match[0])
  }
  runtime.stdout.on('data', consume)
  runtime.stderr.on('data', consume)
  runtime.once('exit', (code) => {
    clearTimeout(timeout)
    reject(new Error(`official DSH host exited with status ${code}\n${runtimeOutput}`))
  })
})

try {
  const authResponse = await fetch(runtimeUrl, { redirect: 'manual' })
  const cookie = authResponse.headers.get('set-cookie')?.split(';', 1)[0]
  if (!cookie) throw new Error('official DSH host did not issue an authentication cookie')
  const origin = runtimeUrl.slice(0, runtimeUrl.indexOf('/?token='))
  const indexResponse = await fetch(`${origin}/`, { headers: { cookie } })
  if (!indexResponse.ok) throw new Error(`official DSH index returned HTTP ${indexResponse.status}`)
  const indexHtml = await indexResponse.text()
  for (const clientPackage of [
    '@hanger-source/dsh-conversation-experience',
    '@hanger-source/dsh-quota-monitor',
  ]) {
    if (!indexHtml.includes(clientPackage)) {
      throw new Error(`official Client graph is missing ${clientPackage}`)
    }
  }
} finally {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(runtime.pid), '/t', '/f'], { stdio: 'ignore' })
  } else {
    runtime.kill('SIGINT')
  }
}

console.log(`official DSH install verified: ${installSpec}`)
console.log(`verification workspace retained at: ${verifyDir}`)
