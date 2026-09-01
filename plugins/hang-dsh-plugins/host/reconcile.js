'use strict'

const Os = require('node:os')
const Path = require('node:path')
const { ProfilePluginRepository } = require('./plugins.js')

const dshHome = process.env.DSH_HOME || Path.join(Os.homedir(), '.dsh')
const repository = new ProfilePluginRepository({
  dshHome,
  dshExecutable: process.env.DSH_EXECUTABLE || 'dsh',
  commandEnvironment: process.env,
  repository: process.env.DSH_DESKTOP_GITHUB,
  log: message => process.stdout.write(message + '\n'),
})

process.stdout.write(JSON.stringify(repository.reconcileActivation()) + '\n')
