import { ChildProcess } from 'child_process';
import * as nodePty from 'node-pty';
import { REPLConfig, SessionState, CommandResult, LLMGuidance, SessionCreationResult } from './types.js';
import { PromptDetector } from './prompt-detector.js';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import pkg from '@xterm/xterm';
import serializePkg from '@xterm/addon-serialize';
const Terminal = pkg.Terminal;
const SerializeAddon = serializePkg.SerializeAddon;

export class SessionManager {
  private sessions: Map<string, SessionState> = new Map();
  private outputBuffers: Map<string, string> = new Map(); // Complete output buffers (cleared before each command)
  private sessionLogs: Map<string, string[]> = new Map(); // Session-specific logs
  private globalLogs: string[] = []; // Global logs (server events)
  private serverTerminals: Map<string, any> = new Map(); // Server-side xterm.js instances
  private serializeAddons: Map<string, any> = new Map(); // Serialize addons for each terminal
  private readonly MAX_LOGS_PER_SESSION = 50; // Limit logs per session
  private readonly MAX_GLOBAL_LOGS = 100; // Limit global logs
  private readonly MAX_OUTPUT_SIZE = 50 * 1024; // 50KB limit for MCP responses
  private readonly MAX_HISTORY_SIZE = 10; // Limit history to last 10 commands



  private truncateForMCPResponse(output: string): string {
    if (output.length <= this.MAX_OUTPUT_SIZE) {
      return output;
    }
    
    const keepSize = Math.floor(this.MAX_OUTPUT_SIZE * 0.8); // Keep 80% of max size
    return '[...output truncated. Total length: ' + output.length + ' chars, showing last ' + keepSize + ' chars...]\n' + 
           output.slice(-keepSize);
  }

  public log(message: string, sessionId?: string) {
    const timestamp = new Date().toISOString();
    const logEntry = `${timestamp}: ${message}`;
    
    if (sessionId) {
      // Session-specific log
      if (!this.sessionLogs.has(sessionId)) {
        this.sessionLogs.set(sessionId, []);
      }
      const sessionLogArray = this.sessionLogs.get(sessionId)!;
      sessionLogArray.push(logEntry);
      
      // Rotate session logs if too many
      if (sessionLogArray.length > this.MAX_LOGS_PER_SESSION) {
        sessionLogArray.splice(0, sessionLogArray.length - this.MAX_LOGS_PER_SESSION);
      }
    } else {
      // Global log
      this.globalLogs.push(logEntry);
      
      // Rotate global logs if too many
      if (this.globalLogs.length > this.MAX_GLOBAL_LOGS) {
        this.globalLogs.splice(0, this.globalLogs.length - this.MAX_GLOBAL_LOGS);
      }
    }
    
    console.error(logEntry); // Also log to console.error for immediate visibility
  }

  public getDebugLogs(sessionId?: string): string[] {
    if (sessionId) {
      // Return session-specific logs only
      const sessionLogArray = this.sessionLogs.get(sessionId) || [];
      return sessionLogArray;
    } else {
      // Return only recent global logs to avoid token overflow
      return this.globalLogs.slice(-20); // Last 20 global logs only
    }
  }

  public clearDebugLogs(sessionId?: string): void {
    if (sessionId) {
      this.sessionLogs.delete(sessionId);
    } else {
      this.sessionLogs.clear();
      this.globalLogs = [];
    }
  }

  public getFullOutput(sessionId: string, offset: number = 0, limit: number = 40000): {
    success: boolean;
    output?: string;
    totalLength?: number;
    offset?: number;
    length?: number;
    hasMore?: boolean;
    nextOffset?: number;
    error?: string;
  } {
    const fullOutput = this.outputBuffers.get(sessionId);
    
    if (!fullOutput) {
      return {
        success: false,
        error: `No output buffer found for session ${sessionId}`
      };
    }

    const totalLength = fullOutput.length;
    const endPos = Math.min(offset + limit, totalLength);
    const outputChunk = fullOutput.slice(offset, endPos);
    const actualLength = outputChunk.length;
    const hasMore = endPos < totalLength;
    const nextOffset = hasMore ? endPos : undefined;

    return {
      success: true,
      output: outputChunk,
      totalLength,
      offset,
      length: actualLength,
      hasMore,
      nextOffset
    };
  }

  public getLogStats(): { totalSessions: number, totalLogs: number, globalLogs: number } {
    const totalLogs = Array.from(this.sessionLogs.values()).reduce((sum, logs) => sum + logs.length, 0);
    return {
      totalSessions: this.sessionLogs.size,
      totalLogs: totalLogs,
      globalLogs: this.globalLogs.length
    };
  }



  public async createSession(config: REPLConfig): Promise<SessionCreationResult> {
    const sessionId = this.generateSessionId();
    const startingDir = config.startingDirectory || process.cwd();

    // Create session state first, so sessionId always exists
    const sessionState: SessionState = {
      id: sessionId,
      config,
      status: 'initializing',
      currentDirectory: startingDir,
      history: [],
      lastOutput: '',
      createdAt: new Date(),
      lastActivity: new Date(),
      learnedPromptPatterns: []
    };

    this.sessions.set(sessionId, sessionState);
    this.outputBuffers.set(sessionId, '');

    // Validate starting directory exists
    try {
      const stats = fs.statSync(startingDir);
      if (!stats.isDirectory()) {
        sessionState.status = 'error';
        sessionState.lastError = `Starting directory is not a directory: ${startingDir}`;
        return {
          success: false,
          sessionId,
          error: `Starting directory is not a directory: ${startingDir}`
        };
      }
    } catch (error) {
      sessionState.status = 'error';
      sessionState.lastError = `Starting directory does not exist or is not accessible: ${startingDir}`;
      return {
        success: false,
        sessionId,
        error: `Starting directory does not exist or is not accessible: ${startingDir}`
      };
    }

    this.log(`[DEBUG ${sessionId}] Starting session creation for ${config.type}`, sessionId);

    try {
      // Create shell process
      this.log(`[DEBUG ${sessionId}] Creating shell process`, sessionId);
      const shellProcess = this.createShellProcess(config, startingDir);
      sessionState.process = shellProcess;

      // Send zsh-specific initialization immediately after process creation
      if (config.shell === 'zsh') {
        this.log(`[DEBUG ${sessionId}] Sending histchars initialization for zsh`, sessionId);
        shellProcess.write('histchars=\r\n');
      }

      // Create server-side terminal
      this.log(`[DEBUG ${sessionId}] Creating server-side terminal`, sessionId);
      this.createServerSideTerminal(sessionId);

      // Setup output handlers
      this.log(`[DEBUG ${sessionId}] Setting up output handlers`, sessionId);
      this.setupOutputHandlers(sessionId, shellProcess);

      // Wait for shell to be ready (with LLM fallback)
      this.log(`[DEBUG ${sessionId}] Waiting for shell to be ready`, sessionId);
      try {
        await this.waitForShellReady(sessionId);
      } catch (error) {
        // Try LLM-assisted prompt detection
        this.log(`[DEBUG ${sessionId}] Standard prompt detection failed, trying LLM fallback`, sessionId);
        const result = await this.waitForPromptWithLLMFallback(sessionId, 10000);
        if (!result.success) {
          // If LLM fallback returns a question, this is a different kind of error
          if (result.question) {
            throw new Error(`Session needs LLM assistance: ${result.question}`);
          }
          throw new Error(result.error || 'Shell initialization failed');
        }
        // LLM fallback succeeded, continue with session creation
      }

      // Execute commands in order
      this.log(`[DEBUG ${sessionId}] Executing commands: ${config.commands.length}`, sessionId);
      for (let i = 0; i < config.commands.length; i++) {
        const command = config.commands[i];
        const isLastCommand = i === config.commands.length - 1;
        
        if (isLastCommand) {
          this.log(`[DEBUG ${sessionId}] Starting REPL: ${command}`, sessionId);
          await this.startREPL(sessionId, command);
        } else {
          this.log(`[DEBUG ${sessionId}] Executing setup command: ${command}`, sessionId);
          await this.executeSetupCommand(sessionId, command);
        }
      }

      sessionState.status = 'ready';
      sessionState.lastActivity = new Date();

      this.log(`[DEBUG ${sessionId}] Session ready`, sessionId);
      return {
        success: true,
        sessionId
      };
    } catch (error) {
      this.log(`[DEBUG ${sessionId}] Session creation failed: ${error}`, sessionId);
      sessionState.status = 'error';
      sessionState.lastError = error instanceof Error ? error.message : String(error);
      
      // Check if this is a timeout error that could benefit from LLM assistance
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('timeout')) {
        const rawOutput = this.outputBuffers.get(sessionId) || '';
        this.log(`[DEBUG ${sessionId}] Timeout detected, offering LLM assistance`, sessionId);
        
        return {
          success: false,
          sessionId,
          question: `Session creation timed out. Here's the raw output - please analyze and respond:

Raw output:
"""
${rawOutput}
"""

Timeout error: ${errorMessage}

Please respond with one of:
- READY:{pattern} - if you see a working prompt, specify the pattern
- SEND:{command} - if a command should be sent (e.g., \\n for Enter, \\x03 for Ctrl+C)  
- WAIT:{seconds} - if we should wait longer (specify number of seconds)
- FAILED:{reason} - if this should be considered a failure`,
          questionType: 'session_timeout',
          context: {
            sessionId,
            rawOutput,
            timeoutError: errorMessage
          },
          canContinue: true
        };
      }
      
      // For non-timeout errors, just return failure
      return {
        success: false,
        sessionId,
        error: errorMessage
      };
    }
  }

  public async executeCommand(sessionId: string, command: string, timeout: number = 30000): Promise<CommandResult> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    if (session.status !== 'ready') {
      throw new Error(`Session ${sessionId} is not ready (status: ${session.status})`);
    }

    session.status = 'executing';
    session.lastActivity = new Date();

    const startTime = Date.now();

    try {
      // Clear output buffer before sending command
      this.outputBuffers.set(sessionId, '');

      // Send command
      session.process!.write(command + '\r\n');

      // Wait for prompt to return
      const result = await this.waitForPromptWithLLMFallback(sessionId, timeout);
      if (result.question) {
        // Return LLM question without updating session state
        return result;
      }
            const output = result.rawOutput!;
      
      const executionTime = Date.now() - startTime;
      const isError = PromptDetector.isErrorOutput(output, session.config.type);

      session.status = 'ready';
      session.history.push(command);
      
      // Limit history to last MAX_HISTORY_SIZE commands
      if (session.history.length > this.MAX_HISTORY_SIZE) {
        session.history = session.history.slice(-this.MAX_HISTORY_SIZE);
      }
      
      session.lastOutput = output;
      session.lastActivity = new Date();

      return {
        success: !isError,
        rawOutput: this.truncateForMCPResponse(output.trim()),
        error: isError ? this.truncateForMCPResponse(output.trim()) : undefined,
        executionTime
      };
    } catch (error) {
      session.status = 'error';
      session.lastError = error instanceof Error ? error.message : String(error);
      
      return {
        success: false,
        rawOutput: '',
        error: error instanceof Error ? error.message : String(error),
        executionTime: Date.now() - startTime
      };
    }
  }

  public getSession(sessionId: string): SessionState | undefined {
    return this.sessions.get(sessionId);
  }

  public listSessions(): SessionState[] {
    return Array.from(this.sessions.values());
  }

  public async answerSessionQuestion(sessionId: string, answer: string): Promise<CommandResult> {
    return await this.handleLLMGuidance(sessionId, answer);
  }

  public async destroySession(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    if (session.process) {
      session.process.kill();
    }

    this.sessions.delete(sessionId);
    this.outputBuffers.delete(sessionId);
    this.sessionLogs.delete(sessionId); // Clean up session-specific logs
    this.serverTerminals.delete(sessionId); // Clean up server-side terminal
    this.serializeAddons.delete(sessionId); // Clean up serialize addon
    
    return true;
  }

  private createShellProcess(config: REPLConfig, startingDir: string): nodePty.IPty {
    const env = { ...process.env, ...config.environment };
    
    let shellCommand: string;
    let shellArgs: string[] = [];

    switch (config.shell) {
      case 'bash':
        shellCommand = 'bash';
        shellArgs = ['-i']; // interactive mode
        break;
      case 'zsh':
        shellCommand = 'zsh';
        shellArgs = ['-i'];
        break;
      case 'cmd':
        shellCommand = 'cmd.exe';
        shellArgs = ['/K']; // /K keeps cmd.exe running after commands
        break;
      case 'powershell':
        shellCommand = 'powershell.exe';
        shellArgs = []; // powershell.exe doesn't need -NoExit with node-pty
        break;
      default:
        shellCommand = process.platform === 'win32' ? 'powershell.exe' : 'bash';
        shellArgs = [];
    }

    // node-pty's spawn returns a PtyProcess
    return nodePty.spawn(shellCommand, shellArgs, {
      name: 'xterm-color',
      cols: 132,
      rows: 43,
      cwd: startingDir,
      env: { ...env, TERM: 'xterm' } as { [key: string]: string }, // Cast to string dictionary
      encoding: 'utf8',
      // Enable ConPTY on Windows if build number is high enough
      useConpty: process.platform === 'win32' && getWindowsBuildNumber() >= 18309,
      // useConptyDll: false // Keep this false for now unless explicitly needed
    });
  }

  private createServerSideTerminal(sessionId: string): void {
    // Create server-side xterm.js instance
    const terminal = new Terminal({
      cols: 132,
      rows: 43,
      allowProposedApi: true // Required for some addons
    });

    // Create and load SerializeAddon
    const serializeAddon = new SerializeAddon();
    terminal.loadAddon(serializeAddon);

    // Store references
    this.serverTerminals.set(sessionId, terminal);
    this.serializeAddons.set(sessionId, serializeAddon);

    this.log(`[DEBUG ${sessionId}] Server-side terminal created`, sessionId);
  }

  public getSerializedTerminalState(sessionId: string): string | null {
    const serializeAddon = this.serializeAddons.get(sessionId);
    if (!serializeAddon) {
      return null;
    }
    
    try {
      return serializeAddon.serialize();
    } catch (error) {
      this.log(`[ERROR ${sessionId}] Failed to serialize terminal state: ${error}`, sessionId);
      return null;
    }
  }

  public getCurrentLineCleanText(sessionId: string): string | null {
    const terminal = this.serverTerminals.get(sessionId);
    if (!terminal) {
      return null;
    }
    
    try {
      // Get the current line (where cursor is) as clean text (without ANSI codes)
      return terminal.buffer.active.getLine(terminal.buffer.active.baseY + terminal.buffer.active.cursorY)?.translateToString() || '';
    } catch (error) {
      this.log(`[ERROR ${sessionId}] Failed to get current line clean text: ${error}`, sessionId);
      return null;
    }
  }

  public getFullCleanText(sessionId: string): string | null {
    const terminal = this.serverTerminals.get(sessionId);
    if (!terminal) {
      return null;
    }
    
    try {
      // Get all visible lines as clean text
      const lines: string[] = [];
      for (let i = 0; i < terminal.buffer.active.length; i++) {
        const line = terminal.buffer.active.getLine(i);
        if (line) {
          const text = line.translateToString();
          if (text.trim()) {
            lines.push(text);
          }
        }
      }
      return lines.join('\n');
    } catch (error) {
      this.log(`[ERROR ${sessionId}] Failed to get full clean text: ${error}`, sessionId);
      return null;
    }
  }

  private setupOutputHandlers(sessionId: string, process: nodePty.IPty): void {
    const serverTerminal = this.serverTerminals.get(sessionId);
    
    const appendOutput = (data: string) => {
      // Always append to output buffer (complete output, no truncation during collection)
      const currentBuffer = this.outputBuffers.get(sessionId) || '';
      const newBuffer = currentBuffer + data;
      this.outputBuffers.set(sessionId, newBuffer);
      
      // Also send to server-side terminal for proper ANSI processing
      if (serverTerminal) {
        serverTerminal.write(data);
      }
    };

    // node-pty uses onData method instead of 'data' event
    process.onData((data) => {
      this.log(`[DEBUG ${sessionId}] Raw data received: ${JSON.stringify(data)}`, sessionId);
      appendOutput(data);
    });

    process.onExit((exitCode) => {
      const session = this.sessions.get(sessionId);
      if (session) {
        session.status = 'terminated';
        session.lastError = `Process exited with code ${exitCode.exitCode}`;
      }
    });
  }

  private async waitForShellReady(sessionId: string, timeout: number = 5000): Promise<void> {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      
      const checkReady = () => {
        if (Date.now() - startTime > timeout) {
          reject(new Error('Shell initialization timeout'));
          return;
        }

        const output = this.outputBuffers.get(sessionId) || '';
        // Simple check for shell prompt (can be improved)
        if (output.includes('$') || output.includes('>') || output.includes('#')) {
          resolve();
        } else {
          setTimeout(checkReady, 100);
        }
      };

      setTimeout(checkReady, 500); // Give shell time to initialize
    });
  }

  private async executeSetupCommand(sessionId: string, command: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session?.process) {
      throw new Error('Session process not found');
    }

    this.log(`[DEBUG ${sessionId}] Executing setup command: ${command}`, sessionId);

    // Clear buffer
    this.outputBuffers.set(sessionId, '');
    
    // Send command
    session.process!.write(command + '\r\n');
    
    // Wait for command to complete with proper prompt detection
    try {
      await this.waitForPrompt(sessionId, 5000);
      this.log(`[DEBUG ${sessionId}] Setup command completed: ${command}`, sessionId);
    } catch (error) {
      this.log(`[DEBUG ${sessionId}] Setup command timeout, continuing: ${command}`, sessionId);
      // Don't fail the entire session for setup command timeouts
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  private async startREPL(sessionId: string, replCommand: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session?.process) {
      throw new Error('Session process not found');
    }

    // Clear buffer
    this.outputBuffers.set(sessionId, '');
    
    // Start REPL
    session.process!.write(replCommand + '\r\n');
    
    // Wait for REPL prompt or specific signal
    // Wait for REPL prompt
    await this.waitForPrompt(sessionId, session.config.timeout || 10000);
  }

  private async waitForPrompt(sessionId: string, timeout: number): Promise<string> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      const initialOutputLength = (this.outputBuffers.get(sessionId) || '').length;
      let hasSeenOutput = false;
      
      const checkPrompt = () => {
        if (Date.now() - startTime > timeout) {
          const output = this.outputBuffers.get(sessionId) || '';
          reject(new Error(`Command execution timeout after ${timeout}ms. Output: "${output}"`));
          return;
        }

        const currentOutput = this.outputBuffers.get(sessionId) || '';
        
        // Check if we've seen new output since command was sent
        if (currentOutput.length > initialOutputLength) {
          hasSeenOutput = true;
        }

        // Use xterm.js clean text for prompt detection
        const cleanText = this.getCurrentLineCleanText(sessionId);
        if (cleanText) {
          this.log(`[DEBUG ${sessionId}] Testing clean text prompt detection: "${cleanText}"`, sessionId);
          const promptInfo = PromptDetector.detectPrompt(cleanText, session.config.type, session.learnedPromptPatterns, true); // isCleanText = true
          
          if (promptInfo.detected && promptInfo.ready && hasSeenOutput) {
            this.log(`[DEBUG ${sessionId}] Clean text prompt detected: ${promptInfo.type}`, sessionId);
            resolve(currentOutput);
            return;
          }
        }

        // Fallback to raw output if clean text is not available
        this.log(`[DEBUG ${sessionId}] Testing raw output prompt detection with expectedType: ${session.config.type}`, sessionId);
        
        const promptInfo = PromptDetector.detectPrompt(currentOutput, session.config.type, session.learnedPromptPatterns, false); // isCleanText = false
        
        if (promptInfo.detected && promptInfo.ready && hasSeenOutput) {
          resolve(currentOutput);
        } else {
          setTimeout(checkPrompt, 100);
        }
      };

      checkPrompt();
    });
  }

  private generateSessionId(): string {
    return Math.random().toString(36).substring(2, 8);
  }

  private async waitForPromptWithLLMFallback(sessionId: string, timeout: number): Promise<CommandResult> {
    try {
      const output = await this.waitForPrompt(sessionId, timeout);
      return {
        success: true,
        rawOutput: output,
        executionTime: 0
      };
    } catch (error) {
      // Timeout occurred - ask LLM for guidance
      const rawOutput = this.outputBuffers.get(sessionId) || '';
      return this.createLLMTimeoutQuestion(sessionId, rawOutput, error as Error);
    }
  }

  private createLLMTimeoutQuestion(sessionId: string, rawOutput: string, error: Error): CommandResult {
    const question = `Session timed out. Here's the raw output - please analyze and respond:

Raw output:
"""
${rawOutput}
"""

Timeout error: ${error.message}

Please respond with one of:
- READY:{pattern} - if you see a working prompt, specify the pattern
- SEND:{command} - if a command should be sent (e.g., \\n for Enter, \\x03 for Ctrl+C)
- WAIT:{seconds} - if we should wait longer (specify number of seconds)
- FAILED:{reason} - if this should be considered a failure

What should I do?`;

    return {
      success: false,
      rawOutput: '',
      error: 'Timeout - LLM guidance needed',
      executionTime: 0,
      question,
      questionType: 'timeout_analysis',
      context: { sessionId, rawOutput },
      canContinue: true
    };
  }

  private async handleLLMGuidance(sessionId: string, response: string): Promise<CommandResult> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const guidance = this.parseLLMResponse(response);
    
    switch (guidance.action) {
      case 'ready':
        // LLM says the session is ready with detected pattern
        const learnedPattern = guidance.payload?.pattern;
        if (learnedPattern && !session.learnedPromptPatterns.includes(learnedPattern)) {
          session.learnedPromptPatterns.push(learnedPattern);
          this.log(`[DEBUG ${sessionId}] Learned new prompt pattern: "${learnedPattern}"`, sessionId);
        }
        session.status = 'ready';
        session.lastActivity = new Date();
        this.log(`[DEBUG ${sessionId}] LLM declared session ready with pattern: ${learnedPattern}`, sessionId);
        return {
          success: true,
          rawOutput: this.outputBuffers.get(sessionId) || '',
          executionTime: 0
        };

      case 'send':
        // Send the command suggested by LLM
        const command = guidance.payload?.command || '';
        this.log(`[DEBUG ${sessionId}] LLM suggested sending command: ${JSON.stringify(command)}`, sessionId);
        session.process!.write(command);
        
        // Wait for response and potentially ask LLM again
        try {
          const output = await this.waitForPrompt(sessionId, 10000);
          session.status = 'ready';
          return {
            success: true,
            rawOutput: output,
            executionTime: 0
          };
        } catch (error) {
          // Still having issues, ask LLM again
          const newOutput = this.outputBuffers.get(sessionId) || '';
          return this.createLLMTimeoutQuestion(sessionId, newOutput, error as Error);
        }

      case 'wait':
        // Wait for specified duration then retry
        const seconds = guidance.payload?.seconds || 3;
        this.log(`[DEBUG ${sessionId}] LLM suggested waiting ${seconds} seconds`, sessionId);
        
        await new Promise(resolve => setTimeout(resolve, seconds * 1000));
        
        try {
          const output = await this.waitForPrompt(sessionId, 10000);
          session.status = 'ready';
          return {
            success: true,
            rawOutput: output,
            executionTime: seconds * 1000
          };
        } catch (error) {
          // Still timing out after wait, ask LLM again
          const newOutput = this.outputBuffers.get(sessionId) || '';
          return this.createLLMTimeoutQuestion(sessionId, newOutput, error as Error);
        }

      case 'failed':
        // LLM says this should be considered a failure
        const reason = guidance.payload?.reason || 'LLM determined session cannot be recovered';
        session.status = 'error';
        session.lastError = reason;
        return {
          success: false,
          rawOutput: '',
          error: reason,
          executionTime: 0
        };

      default:
        return {
          success: false,
          rawOutput: '',
          error: `Unknown LLM guidance action: ${response}`,
          executionTime: 0
        };
    }
  }

  private parseLLMResponse(response: string): LLMGuidance {
    const trimmed = response.trim();
    
    if (trimmed.startsWith('READY:')) {
      const pattern = trimmed.substring(6);
      return { action: 'ready', payload: { pattern } };
    }
    
    if (trimmed.startsWith('SEND:')) {
      const command = trimmed.substring(5);
      return { action: 'send', payload: { command } };
    }
    
    if (trimmed.startsWith('WAIT:')) {
      const seconds = parseInt(trimmed.substring(5)) || 3;
      return { action: 'wait', payload: { seconds } };
    }
    
    if (trimmed.startsWith('FAILED:')) {
      const reason = trimmed.substring(7);
      return { action: 'failed', payload: { reason } };
    }
    
    // Default fallback
    return { 
      action: 'failed', 
      payload: { reason: `Could not parse LLM response: ${response}` }
    };
  }
}

function getWindowsBuildNumber(): number {
  const osVersion = os.release();
  const buildNumber = parseInt(osVersion.split('.')[2]);
  return buildNumber;
}