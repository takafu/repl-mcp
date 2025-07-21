import { REPLConfig } from './types.js';

export const DEFAULT_REPL_CONFIGS: Record<string, REPLConfig> = {
  pry: {
    name: 'Pry (Ruby)',
    type: 'pry',
    shell: process.platform === 'win32' ? 'cmd' : 'bash',
    commands: ['pry --no-pager'],
    timeout: 10000
  },

  irb: {
    name: 'IRB (Ruby)',
    type: 'irb',
    shell: process.platform === 'win32' ? 'cmd' : 'bash',
    commands: [
      'IRB.conf[:USE_READLINE] = false',
      'IRB.conf[:PROMPT_MODE] = :DEFAULT',
      'irb'
    ],
    timeout: 10000
  },

  cmd_test: {
    name: 'CMD Test',
    type: 'cmd',
    shell: 'cmd',
    commands: [],
    timeout: 10000
  },

  rails_console: {
    name: 'Rails Console',
    type: 'pry',
    shell: process.platform === 'win32' ? 'cmd' : 'bash',
    commands: [
      'bundle exec rails console'
    ],
    timeout: 10000
  },

  rails_console_production: {
    name: 'Rails Console (Production)',
    type: 'pry',
    shell: process.platform === 'win32' ? 'cmd' : 'bash',
    commands: [
      'RAILS_ENV=production bundle exec rails console'
    ],
    environment: {
      'RAILS_ENV': 'production'
    },
    timeout: 10000
  },

  ipython: {
    name: 'IPython (Python)',
    type: 'ipython',
    shell: process.platform === 'win32' ? 'cmd' : 'bash',
    commands: ['ipython'],
    timeout: 10000
  },

  node: {
    name: 'Node.js REPL',
    type: 'node',
    shell: process.platform === 'win32' ? 'cmd' : 'bash',
    commands: ['node'],
    timeout: 10000
  },

  python: {
    name: 'Python REPL',
    type: 'python',
    shell: process.platform === 'win32' ? 'cmd' : 'bash',
    commands: ['python'],
    timeout: 10000
  },

  bash: {
    name: 'Bash Shell',
    type: 'bash',
    shell: 'bash',
    commands: [],
    timeout: 30000
  },

  zsh: {
    name: 'Zsh Shell',
    type: 'zsh',
    shell: 'zsh',
    commands: [],
    timeout: 30000
  }
};

export function getConfigByName(name: string): REPLConfig | undefined {
  return DEFAULT_REPL_CONFIGS[name];
}

export function listAvailableConfigs(): string[] {
  return Object.keys(DEFAULT_REPL_CONFIGS);
}

export function createCustomConfig(
  name: string,
  shell: REPLConfig['shell'],
  commands: string[],
  startingDirectory?: string,
  environment?: Record<string, string>,
  promptPattern?: string,
  timeout?: number,
  type?: REPLConfig['type']  // 明示的なtype指定を追加
): REPLConfig {
  return {
    name,
    type: type || 'custom',  // 指定されたtype、または'custom'をデフォルト
    shell,
    commands,
    startingDirectory,
    environment,
    promptPattern,
    timeout
  };
}