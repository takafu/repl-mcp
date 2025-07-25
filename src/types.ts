import * as nodePty from 'node-pty';

export interface REPLConfig {
  name: string;
  type: 'pry' | 'irb' | 'ipython' | 'node' | 'python' | 'bash' | 'zsh' | 'cmd' | 'custom';
  shell: 'bash' | 'zsh' | 'cmd' | 'powershell' | 'cmd.exe';
  commands: string[];
  startingDirectory?: string;
  environment?: Record<string, string>;
  promptPattern?: string;
  timeout?: number;
}

export interface SessionState {
  id: string;
  config: REPLConfig;
  displayName?: string; // Optional custom name for the session
  status: 'initializing' | 'ready' | 'executing' | 'error' | 'terminated';
  process?: nodePty.IPty;
  currentDirectory: string;
  history: string[];
  lastOutput: string;
  lastError?: string;
  createdAt: Date;
  lastActivity: Date;
  // LLM learned prompt patterns for this session
  learnedPromptPatterns: string[];
}

export interface CommandResult {
  success: boolean;
  rawOutput: string;
  error?: string;
  executionTime: number;
  // LLM assistance fields
  question?: string;
  questionType?: 'timeout_analysis' | 'prompt_detection' | 'error_recovery';
  context?: any;
  canContinue?: boolean;
}

export interface SessionCreationResult {
  success: boolean;
  sessionId?: string;
  error?: string;
  // LLM assistance fields for session creation
  question?: string;
  questionType?: 'session_timeout' | 'prompt_detection';
  context?: {
    sessionId: string;
    rawOutput: string;
    timeoutError: string;
  };
  canContinue?: boolean;
}


export interface PromptInfo {
  detected: boolean;
  type: string;
  ready: boolean;
  prompt: string;
}