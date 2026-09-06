import Fs from 'node:fs'
import Module from 'node:module'
import Path from 'node:path'

const [resolutionBase, ...packageNames] = process.argv.slice(2)
if (!resolutionBase || packageNames.length === 0) throw new Error('缺少模块解析基准或包名')

const base = Fs.statSync(resolutionBase).isDirectory()
  ? Path.join(resolutionBase, 'package.json')
  : Fs.realpathSync(resolutionBase)
const requireFromBase = Module.createRequire(base)
const packages = Object.fromEntries(packageNames.map(name => {
  const manifestPath = requireFromBase.resolve(name + '/package.json')
  const manifest = JSON.parse(Fs.readFileSync(manifestPath, 'utf8'))
  if (manifest.name !== name || typeof manifest.version !== 'string') {
    throw new Error(name + ' 的 package.json 无效')
  }
  return [name, { path: Path.dirname(manifestPath), version: manifest.version }]
}))
process.stdout.write(JSON.stringify(packages))
