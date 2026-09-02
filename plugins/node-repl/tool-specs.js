export const NODE_REPL_TOOL_SPECS = Object.freeze([
  Object.freeze({
    name: 'js',
    description: 'Execute JavaScript in a persistent node_repl with top-level await. The runtime is Node.js (not a browser). State persists across calls. Return values are rendered automatically; use console.log for explicit output. Static import statements are not supported; use dynamic import() with npm packages or absolute local .mjs/.js files. Local file modules must be ESM and execute in the same VM context. Bare package imports resolve from the REPL-wide module roots (NODE_REPL_MODULE_DIRS, then cwd), not relative to the imported file. Local modules may statically import only other local relative/absolute/file:// .mjs/.js modules; package and builtin imports from local files must stay dynamic. import.meta.resolve() returns importable strings such as file://..., package names, and node:... specifiers. Local file modules are reloaded each exec, while top-level bindings persist until js_reset.',
    parameters: Object.freeze({
      additionalProperties: false,
      properties: Object.freeze({
        code: Object.freeze({
          description: 'JavaScript code to execute with top-level await.',
          type: 'string',
        }),
        timeout_ms: Object.freeze({
          description: 'Optional execution timeout in milliseconds. Defaults to 30000 (30 seconds) when omitted.',
          minimum: 1,
          type: 'integer',
        }),
        title: Object.freeze({
          description: 'Short user-facing description of what the code does.',
          maxLength: 80,
          minLength: 1,
          type: 'string',
        }),
      }),
      required: Object.freeze(['code']),
      type: 'object',
    }),
  }),
  Object.freeze({
    name: 'js_add_node_module_dir',
    description: 'Add an absolute node_modules directory for package imports. The directory remains available after js_reset.',
    parameters: Object.freeze({
      additionalProperties: false,
      properties: Object.freeze({
        path: Object.freeze({
          description: 'Absolute path to a node_modules directory to add to Node package resolution.',
          minLength: 1,
          type: 'string',
        }),
      }),
      required: Object.freeze(['path']),
      type: 'object',
    }),
  }),
  Object.freeze({
    name: 'js_reset',
    description: 'Reset the JavaScript kernel and clear all bindings.',
    parameters: Object.freeze({
      additionalProperties: false,
      properties: Object.freeze({}),
      type: 'object',
    }),
  }),
])
