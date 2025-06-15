import * as nodePty from 'node-pty';

export interface REPLConfig {
  name: string;
  type: 'pry' | 'irb' | 'ipython' | 'node' | 'python' | 'custom' | 'cmd';
  shell: 'bash' | 'zsh' | 'cmd' | 'powershell' | 'cmd.exe';
  setupCommands: string[];
  replCommand: string;
  workingDirectory?: string;
  environment?: Record<string, string>;
  promptPattern?: string;
  timeout?: number;
}

export interface SessionState {
  id: string;
  config: REPLConfig;
  status: 'initializing' | 'ready' | 'executing' | 'error' | 'terminated';
  process?: nodePty.IPty;
  currentDirectory: string;
  history: string[];
  lastOutput: string;
  lastError?: string;
  createdAt: Date;
  lastActivity: Date;
}

export interface CommandResult {
  success: boolean;
  output: string;
  error?: string;
  executionTime: number;
}

export interface PromptInfo {
  detected: boolean;
  type: string;
  ready: boolean;
  prompt: string;
}