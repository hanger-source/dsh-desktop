'use strict'

const Assert = require('node:assert/strict')
const Test = require('node:test')
const { pluginAddArguments } = require('./plugins.js')

Test.test('插件安装固定通过 npmjs 解析 profile 的全部依赖', () => {
  const spec = 'github:hanger-source/dsh-desktop#plugin-node-repl-v0.1.2&path:/plugins/node-repl'
  Assert.deepEqual(pluginAddArguments(spec), [
    'plugin', '--profile', 'web', 'add',
    '--registry=https://registry.npmjs.org', spec, '--save-exact',
  ])
})
