import { ChildProcess } from 'child_process';
import * as nodePty from 'node-pty';
import { REPLConfig, SessionState, CommandResult } from './types.js';
import { PromptDetector } from './prompt-detector.js';
import * as os from 'os';

export class SessionManager {
  private sessions: Map<string, SessionState> = new Map();
  private outputBuffers: Map<string, string> = new Map();
  private debugLogs: string[] = []; // In-memory log storage

  private log(message: string) {
    const timestamp = new Date().toISOString();
    this.debugLogs.push(`${timestamp}: ${message}`);
    console.error(`${timestamp}: ${message}`); // Also log to console.error for immediate visibility
  }

  public getDebugLogs(): string[] {
    return this.debugLogs;
  }

  public clearDebugLogs(): void {
    this.debugLogs = [];
  }

  public async createSession(config: REPLConfig): Promise<string> {
    const sessionId = this.generateSessionId();
    const workingDir = config.workingDirectory || process.cwd();

    this.log(`[DEBUG ${sessionId}] Starting session creation for ${config.type}`);

    const sessionState: SessionState = {
      id: sessionId,
      config,
      status: 'initializing',
      currentDirectory: workingDir,
      history: [],
      lastOutput: '',
      createdAt: new Date(),
      lastActivity: new Date()
    };

    this.sessions.set(sessionId, sessionState);
    this.outputBuffers.set(sessionId, '');

    try {
      // Create shell process
      this.log(`[DEBUG ${sessionId}] Creating shell process`);
      const shellProcess = this.createShellProcess(config, workingDir);
      sessionState.process = shellProcess;

      // Setup output handlers
      this.log(`[DEBUG ${sessionId}] Setting up output handlers`);
      this.setupOutputHandlers(sessionId, shellProcess);

      // Wait for shell to be ready
      this.log(`[DEBUG ${sessionId}] Waiting for shell to be ready`);
      await this.waitForShellReady(sessionId);

      // Execute setup commands
      this.log(`[DEBUG ${sessionId}] Executing setup commands: ${config.setupCommands.length}`);
      for (const command of config.setupCommands) {
        await this.executeSetupCommand(sessionId, command);
      }

      // Start REPL or execute direct test commands for cmd_test
      // Start REPL
      this.log(`[DEBUG ${sessionId}] Starting REPL: ${config.replCommand}`);
      await this.startREPL(sessionId, config.replCommand);

      sessionState.status = 'ready';
      sessionState.lastActivity = new Date();

      this.log(`[DEBUG ${sessionId}] Session ready`);
      return sessionId;
    } catch (error) {
      this.log(`[DEBUG ${sessionId}] Session creation failed: ${error}`);
      sessionState.status = 'error';
      sessionState.lastError = error instanceof Error ? error.message : String(error);
      throw error;
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
      // Clear output buffer
      this.outputBuffers.set(sessionId, '');

      // Send command
      session.process!.write(command + '\r\n');

      // Wait for prompt to return
      const output = await this.waitForPrompt(sessionId, timeout);
      
      const executionTime = Date.now() - startTime;
      const isError = PromptDetector.isErrorOutput(output, session.config.type);

      session.status = 'ready';
      session.history.push(command);
      session.lastOutput = output;
      session.lastActivity = new Date();

      return {
        success: !isError,
        output: output.trim(),
        error: isError ? output.trim() : undefined,
        executionTime
      };
    } catch (error) {
      session.status = 'error';
      session.lastError = error instanceof Error ? error.message : String(error);
      
      return {
        success: false,
        output: '',
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
    
    return true;
  }

  private createShellProcess(config: REPLConfig, workingDir: string): nodePty.IPty {
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
      cols: 80,
      rows: 30,
      cwd: workingDir,
      env: { ...env, TERM: 'xterm' } as { [key: string]: string }, // Cast to string dictionary
      encoding: 'utf8',
      // Enable ConPTY on Windows if build number is high enough
      useConpty: process.platform === 'win32' && getWindowsBuildNumber() >= 18309,
      // useConptyDll: false // Keep this false for now unless explicitly needed
    });
  }

  private setupOutputHandlers(sessionId: string, process: nodePty.IPty): void {
    const appendOutput = (data: string) => {
      const currentBuffer = this.outputBuffers.get(sessionId) || '';
      this.outputBuffers.set(sessionId, currentBuffer + data);
    };

    // node-pty uses onData method instead of 'data' event
    process.onData((data) => {
      this.log(`[DEBUG ${sessionId}] Raw data received: ${JSON.stringify(data)}`);
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

    // Clear buffer
    this.outputBuffers.set(sessionId, '');
    
    // Send command
    session.process!.write(command + '\r\n');
    
    // Wait for command to complete (simple implementation)
    await new Promise(resolve => setTimeout(resolve, 1000));
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
      
      const checkPrompt = () => {
        if (Date.now() - startTime > timeout) {
          const output = this.outputBuffers.get(sessionId) || '';
          reject(new Error(`Command execution timeout after ${timeout}ms. Output: "${output}"`));
          return;
        }

        const output = this.outputBuffers.get(sessionId) || '';
        
        // Debug logging before prompt detection
        this.log(`[DEBUG ${sessionId}] Testing prompt detection with expectedType: ${session.config.type}`);
        this.log(`[DEBUG ${sessionId}] Output length: ${output.length}`);
        
        if (output.length > 0) {
          const lines = output.replace(/\r\n/g, '\n').split('\n').filter(line => line.trim());
          const lastLine = lines.length > 0 ? lines[lines.length - 1] : '';
          this.log(`[DEBUG ${sessionId}] Last line: "${lastLine}"`);
        }
        
        const promptInfo = PromptDetector.detectPrompt(output, session.config.type);
        
        // Debug logging for troubleshooting
        if (output.length > 0) {
          this.log(`[DEBUG ${sessionId}] Output: "${output}"`);
          this.log(`[DEBUG ${sessionId}] Prompt detected: ${promptInfo.detected}, ready: ${promptInfo.ready}, type: ${promptInfo.type}`);
        }
        
        if (promptInfo.detected && promptInfo.ready) {
          resolve(output);
        } else {
          setTimeout(checkPrompt, 100);
        }
      };

      checkPrompt();
    });
  }

  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

function getWindowsBuildNumber(): number {
  const osVersion = os.release();
  const buildNumber = parseInt(osVersion.split('.')[2]);
  return buildNumber;
}