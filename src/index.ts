#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { SessionManager } from './session-manager.js'; // Remove writeFileSync import
import { REPLConfig } from './types.js';
import { DEFAULT_REPL_CONFIGS, createCustomConfig, getConfigByName, listAvailableConfigs } from './repl-configs.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Web server imports
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import url from 'url';

// Get version info from package.json
function getVersionInfo() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const packageJsonPath = join(__dirname, '..', 'package.json');
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    
    return {
      version: packageJson.version,
      name: packageJson.name,
      description: packageJson.description,
      author: packageJson.author,
      license: packageJson.license,
      repository: packageJson.repository?.url,
      homepage: packageJson.homepage
    };
  } catch (error) {
    return {
      version: "unknown",
      name: "repl-mcp",
      description: "Universal REPL session manager MCP server",
      error: "Failed to read package.json"
    };
  }
}

// Create MCP server
const server = new Server({
  name: "repl-mcp",
  version: getVersionInfo().version
}, {
  capabilities: {
    tools: {}
  }
});

// Create session manager
const sessionManager = new SessionManager();

// Schema definitions
const CreateSessionSchema = z.object({
  configName: z.string().optional().describe("Pre-defined configuration name"),
  displayName: z.string().optional().describe("Custom display name for the session (shown in browser tab)"),
  customConfig: z.object({
    name: z.string().describe("Session name"),
    type: z.enum(['pry', 'irb', 'ipython', 'node', 'python', 'bash', 'zsh', 'cmd', 'custom']).describe("REPL type"),
    shell: z.enum(['bash', 'zsh', 'cmd', 'powershell']).describe("Shell type"),
    commands: z.array(z.string()).describe("Commands to execute in order. The last command should start the REPL."),
    startingDirectory: z.string().optional().describe("Host directory where the shell process will start (must exist)"),
    environment: z.record(z.string()).optional().describe("Environment variables"),
    timeout: z.number().optional().describe("Command timeout in milliseconds")
  }).optional().describe("Custom configuration"),
  debug: z.boolean().optional().describe("Include debug logs in response (default: auto - included for failures/LLM assistance)")
});

const SendInputSchema = z.object({
  sessionId: z.string().describe("Session ID"),
  input: z.string().describe("Input text to send to the session"),
  options: z.object({
    wait_for_prompt: z.boolean().optional().describe("Wait for prompt to return (default: false)"),
    timeout: z.number().optional().describe("Timeout in milliseconds (default: 30000)"),
    add_newline: z.boolean().optional().describe("Add newline to input (default: true)")
  }).optional().describe("Input options")
});

const SendSignalSchema = z.object({
  sessionId: z.string().describe("Session ID"),
  signal: z.enum(['SIGINT', 'SIGTSTP', 'SIGQUIT']).describe("Signal to send to the process")
});

const SetSessionReadySchema = z.object({
  sessionId: z.string().describe("Session ID"),
  pattern: z.string().describe("Prompt pattern that was detected (can be regex like '[\\d]+] pry\\(main\\)> $' or literal like '$ ')")
});

const WaitForSessionSchema = z.object({
  sessionId: z.string().describe("Session ID"),
  seconds: z.number().describe("Number of seconds to wait")
});

const MarkSessionFailedSchema = z.object({
  sessionId: z.string().describe("Session ID"),
  reason: z.string().describe("Reason for failure")
});

const SessionIdSchema = z.object({
  sessionId: z.string().describe("Session ID"),
  debug: z.boolean().optional().describe("Include debug logs in response (default: false)")
});


const ListSessionsSchema = z.object({
  debug: z.boolean().optional().describe("Include debug logs in response (default: false)")
});

const ListConfigsSchema = z.object({
  debug: z.boolean().optional().describe("Include debug logs in response (default: false)")
});

const GetFullOutputSchema = z.object({
  sessionId: z.string().describe("Session ID"),
  offset: z.number().optional().describe("Starting position in characters (default: 0)"),
  limit: z.number().optional().describe("Number of characters to retrieve (default: 40000)")
});

const GetCleanTextSchema = z.object({
  sessionId: z.string().describe("Session ID"),
  fullText: z.boolean().optional().describe("Get full terminal text instead of current line (default: false)")
});

// Handle list tools request
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "create_repl_session",
        description: "Create a new REPL session with predefined or custom configuration. Use displayName to set a custom name that appears in the browser tab title. Returns a webUrl - you MUST display this URL to the user or open it in a browser. Note: If using zsh in custom commands, you may need to manually run 'histchars=' to disable history expansion.",
        inputSchema: zodToJsonSchema(CreateSessionSchema)
      },
      {
        name: "send_input_to_session",
        description: "Send input to a REPL session. Can either wait for prompt return (like execute_repl_command) or send input immediately for interactive programs. ALWAYS show the command output to the user after execution when wait_for_prompt is true.",
        inputSchema: zodToJsonSchema(SendInputSchema)
      },
      {
        name: "send_signal_to_session",
        description: "Send a signal (like Ctrl+C, Ctrl+Z) to a REPL session process. Can be used even when session is executing to interrupt long-running commands.",
        inputSchema: zodToJsonSchema(SendSignalSchema)
      },
      {
        name: "list_repl_sessions",
        description: "List all active REPL sessions. Each session includes a webUrl for browser access. Please show the webUrls to the user so they can open sessions in their browser.",
        inputSchema: zodToJsonSchema(ListSessionsSchema)
      },
      {
        name: "get_session_details",
        description: "Get detailed information about a specific session. Includes webUrl for browser access. Please show the webUrl to the user so they can open the session in their browser.",
        inputSchema: zodToJsonSchema(SessionIdSchema)
      },
      {
        name: "destroy_repl_session",
        description: "Destroy an existing REPL session",
        inputSchema: zodToJsonSchema(SessionIdSchema)
      },
      {
        name: "list_repl_configurations",
        description: "List all available predefined REPL configurations",
        inputSchema: zodToJsonSchema(ListConfigsSchema)
      },
      {
        name: "set_session_ready",
        description: "Mark a session as ready by specifying the detected prompt pattern. Supports regex patterns (e.g., '[\\d]+] pry\\(main\\)> $') or literal strings (e.g., '$ '). Used during LLM-assisted session recovery.",
        inputSchema: zodToJsonSchema(SetSessionReadySchema)
      },
      {
        name: "wait_for_session",
        description: "Wait additional seconds for a session to become ready. Used during LLM-assisted session recovery when more time is needed.",
        inputSchema: zodToJsonSchema(WaitForSessionSchema)
      },
      {
        name: "mark_session_failed",
        description: "Mark a session as failed with a specific reason. Used during LLM-assisted session recovery when recovery is not possible.",
        inputSchema: zodToJsonSchema(MarkSessionFailedSchema)
      },
      {
        name: "get_full_output",
        description: "Get the last command's output buffer for a session in chunks to avoid token limits. This returns the output from the most recent command execution. Use offset and limit parameters to retrieve specific portions of large outputs.",
        inputSchema: zodToJsonSchema(GetFullOutputSchema)
      },
      {
        name: "get_clean_text",
        description: "Get clean terminal text without ANSI escape codes. Returns either the current line (where cursor is) or full terminal content depending on the fullText parameter.",
        inputSchema: zodToJsonSchema(GetCleanTextSchema)
      },

    ]
  };
});

// Handle call tool request
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  let attemptedSessionId: string | undefined;

  try {
    switch (name) {
      case "create_repl_session": {
        const params = CreateSessionSchema.parse(args);
        const { configName, displayName, customConfig, debug } = params;

        let config: REPLConfig;

        if (configName) {
          const predefinedConfig = getConfigByName(configName);
          if (!predefinedConfig) {
            return {
              content: [
                {
                  type: "text",
                  text: `Configuration '${configName}' not found. Available configurations: ${listAvailableConfigs().join(', ')}`
                }
              ],
              isError: true
            };
          }
          config = predefinedConfig;
        } else if (customConfig) {
          config = customConfig as REPLConfig;
        } else {
          return {
            content: [
              {
                type: "text",
                text: "Either configName or customConfig must be provided"
              }
            ],
            isError: true
          };
        }

        const result = await sessionManager.createSession(config, displayName);
        attemptedSessionId = result.sessionId;
        
        const response: any = {
          ...result,
          config: config.name
        };
        
        // Add Web UI URL if session ID exists (even for LLM assistance cases)
        if (result.sessionId) {
          const port = (global as any).webServerPort || 8023;
          response.webUrl = `http://localhost:${port}/session/${result.sessionId}`;
        }
        
        // Auto-include debug logs for failures, LLM assistance, or when explicitly requested
        if (debug || !result.success || result.question) {
          response.debugLogs = sessionManager.getDebugLogs(result.sessionId);
        }
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(response, null, 2)
            }
          ]
        };
      }

      case "send_input_to_session": {
        const params = SendInputSchema.parse(args);
        const { sessionId, input, options = {} } = params;
        const { wait_for_prompt = false, timeout = 30000, add_newline = true } = options;

        const result = await sessionManager.sendInput(sessionId, input, { wait_for_prompt, timeout, add_newline });
        
        const response: any = {
          success: result.success,
          rawOutput: result.rawOutput,
          error: result.error,
          executionTime: result.executionTime,
          // LLM assistance fields
          question: result.question,
          questionType: result.questionType,
          context: result.context,
          canContinue: result.canContinue,
          // Hint for agent behavior
          hint: result.success && wait_for_prompt ? "Decode ANSI escape codes, extract meaningful output, and present it to the user in a clean, readable format" : undefined
        };
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(response, null, 2)
            }
          ]
        };
      }

      case "send_signal_to_session": {
        const params = SendSignalSchema.parse(args);
        const { sessionId, signal } = params;

        const result = await sessionManager.sendSignal(sessionId, signal);
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      }

      case "set_session_ready": {
        const params = SetSessionReadySchema.parse(args);
        const { sessionId, pattern } = params;

        const result = await sessionManager.setSessionReady(sessionId, pattern);
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      }

      case "wait_for_session": {
        const params = WaitForSessionSchema.parse(args);
        const { sessionId, seconds } = params;

        const result = await sessionManager.waitForSession(sessionId, seconds);
        
        return {
          content: [
            {
              type: "text", 
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      }

      case "mark_session_failed": {
        const params = MarkSessionFailedSchema.parse(args);
        const { sessionId, reason } = params;

        const result = await sessionManager.markSessionFailed(sessionId, reason);
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      }

      case "list_repl_sessions": {
        const params = ListSessionsSchema.parse(args);
        const sessions = sessionManager.listSessions();
        
        const response: any = {
          success: true,
          sessions: sessions.map(session => ({
            id: session.id,
            name: session.config.name,
            displayName: session.displayName,
            type: session.config.type,
            status: session.status,
            createdAt: session.createdAt,
            lastActivity: session.lastActivity,
            historyCount: session.history.length,
            webUrl: `http://localhost:${(global as any).webServerPort || 8023}/session/${session.id}`
          }))
        };
        
        // Only include debug logs if explicitly requested
        if (params.debug) {
          response.debugLogs = sessionManager.getDebugLogs();
        }
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(response, null, 2)
            }
          ]
        };
      }

      case "get_session_details": {
        const params = SessionIdSchema.parse(args);
        const { sessionId, debug } = params;

        const session = sessionManager.getSession(sessionId);
        
        if (!session) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  success: false,
                  error: `Session ${sessionId} not found`
                }, null, 2)
              }
            ],
            isError: true
          };
        }

        const response: any = {
          success: true,
          session: {
            id: session.id,
            config: session.config,
            displayName: session.displayName,
            status: session.status,
            currentDirectory: session.currentDirectory,
            history: session.history,
            lastOutput: session.lastOutput,
            lastError: session.lastError,
            createdAt: session.createdAt,
            lastActivity: session.lastActivity,
            webUrl: `http://localhost:${(global as any).webServerPort || 8023}/session/${session.id}`
          }
        };
        
        // Only include debug logs if explicitly requested
        if (debug) {
          response.debugLogs = sessionManager.getDebugLogs(sessionId);
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(response, null, 2)
            }
          ]
        };
      }

      case "destroy_repl_session": {
        const params = SessionIdSchema.parse(args);
        const { sessionId } = params;

        const success = await sessionManager.destroySession(sessionId);
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success,
                message: success ? 
                  `Session ${sessionId} destroyed successfully` : 
                  `Session ${sessionId} not found`
              }, null, 2)
            }
          ]
        };
      }

      case "list_repl_configurations": {
        const params = ListConfigsSchema.parse(args);
        const configs = listAvailableConfigs();
        const configDetails = configs.map((name: string) => ({
          name,
          config: DEFAULT_REPL_CONFIGS[name]
        }));
        
        const response: any = {
          success: true,
          configurations: configDetails
        };
        
        // Only include debug logs if explicitly requested  
        if (params.debug) {
          response.debugLogs = sessionManager.getDebugLogs();
        }
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(response, null, 2)
            }
          ]
        };
      }


      case "get_full_output": {
        const params = GetFullOutputSchema.parse(args);
        const { sessionId, offset = 0, limit = 40000 } = params;

        const result = sessionManager.getFullOutput(sessionId, offset, limit);
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      }

      case "get_clean_text": {
        const params = GetCleanTextSchema.parse(args);
        const { sessionId, fullText = false } = params;

        const cleanText = fullText 
          ? sessionManager.getFullCleanText(sessionId)
          : sessionManager.getCurrentLineCleanText(sessionId);
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: cleanText !== null,
                cleanText: cleanText || '',
                fullText
              }, null, 2)
            }
          ]
        };
      }



      default:
        return {
          content: [
            {
              type: "text",
              text: `Unknown tool: ${name}`
            }
          ],
          isError: true
        };
    }
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error),
            debugLogs: attemptedSessionId 
              ? sessionManager.getDebugLogs(attemptedSessionId)
              : sessionManager.getDebugLogs() // Fallback to global logs only if no sessionId
          }, null, 2)
        }
      ],
      isError: true
    };
  } finally {
    // sessionManager.clearDebugLogs(); // Clear logs after each request
  }
});

// Web server setup
function setupWebServer() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  
  const app = express();
  const basePort = 8023; // HTTP (80) + Telnet (23) = Terminal-like port
  
  // Serve static files from public/ at root level  
  app.use(express.static(path.join(__dirname, '../public')));
  
  // Route for root page (server status)
  app.get('/', (_req, res) => {
    const indexPath = path.resolve(__dirname, '../public/index.html');
    try {
      const fileContent = readFileSync(indexPath, 'utf8');
      res.setHeader('Content-Type', 'text/html');
      res.send(fileContent);
    } catch (err) {
      console.error(`Error reading file: ${indexPath}`, err);
      res.status(500).send('Internal Server Error');
    }
  });
  
  // API endpoint to get session info
  app.get('/api/session/:sessionId', (req, res) => {
    const sessionId = req.params.sessionId;
    const session = sessionManager.getSession(sessionId);
    
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    
    res.json({
      id: session.id,
      displayName: session.displayName,
      configName: session.config.name
    });
  });

  // Route for session pages
  app.get('/session/:sessionId', (_req, res) => {
    const sessionPath = path.resolve(__dirname, '../public/session.html');
    try {
      const fileContent = readFileSync(sessionPath, 'utf8');
      res.setHeader('Content-Type', 'text/html');
      res.send(fileContent);
    } catch (err) {
      console.error(`Error reading file: ${sessionPath}`, err);
      res.status(500).send('Internal Server Error');
    }
  });
  
  const httpServer = createServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: '/terminal' });
  
  wss.on('connection', (ws: WebSocket, req) => {
    // Extract sessionId from URL query
    const parsedUrl = url.parse(req.url || '', true);
    const sessionId = parsedUrl.query.sessionId as string;
    
    console.error(`[DEBUG] WebSocket connection established for session: ${sessionId}`);
    
    if (!sessionId) {
      ws.send('Error: sessionId is required\r\n');
      ws.close();
      return;
    }
  
    // Get existing session
    const session = sessionManager.getSession(sessionId);
    if (!session) {
      ws.send(`Error: Session ${sessionId} not found\r\n`);
      ws.close();
      return;
    }
  
    // Allow WebUI access for sessions that can potentially be recovered via LLM assistance
    if (session.status !== 'ready' && session.status !== 'error') {
      ws.send(`Error: Session ${sessionId} is not ready (status: ${session.status})\r\n`);
      ws.close();
      return;
    }
    
    // For error status sessions, check if they have an active process (indicating they might be recoverable)
    if (session.status === 'error' && !session.process) {
      ws.send(`Error: Session ${sessionId} is in error state and cannot be accessed (no active process)\r\n`);
      ws.close();
      return;
    }
  
    if (!session.process) {
      ws.send(`Error: Session ${sessionId} has no active process\r\n`);
      ws.close();
      return;
    }
  
    console.error(`WebSocket connected to session ${sessionId}`);
  
    // Restore terminal state from server-side terminal
    const serializedState = sessionManager.getSerializedTerminalState(sessionId);
    if (serializedState) {
      console.error(`Restoring terminal state for session ${sessionId}`);
      ws.send(serializedState);
    } else {
      console.error(`No terminal state to restore for session ${sessionId}`);
    }
  
    // Connect to existing session's pty process
    const ptyProcess = session.process;
  
    // pty output → WebSocket
    const dataHandler = (data: string) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    };
    
    ptyProcess.onData(dataHandler);
  
    // WebSocket input → pty
    ws.on('message', (msg: Buffer) => {
      const message = msg.toString();
      // Log WebSocket input using the built-in log system
      sessionManager.log(`WebSocket received: "${message}" (length: ${message.length}, char codes: [${[...message].map(c => c.charCodeAt(0)).join(', ')}])`, sessionId);
      
      try {
        // Parse as structured JSON message
        const data = JSON.parse(message);
        
        if (data && typeof data === 'object' && data.type) {
          switch (data.type) {
            case 'terminal_input':
              // Terminal text input (all characters sent as-is)
              if (typeof data.data === 'string') {
                sessionManager.log(`Processing terminal input: "${data.data}"`, sessionId);
                try {
                  ptyProcess.write(data.data);
                  sessionManager.log(`Successfully wrote to pty: "${data.data}"`, sessionId);
                } catch (writeError) {
                  sessionManager.log(`ERROR writing to pty: ${writeError}`, sessionId);
                }
              } else {
                sessionManager.log(`Invalid terminal_input data type: ${typeof data.data}`, sessionId);
              }
              return;
              
            case 'send_signal':
              // Signal sending (Ctrl+C, Ctrl+Z, etc.)
              if (typeof data.signal === 'string') {
                sessionManager.sendSignal(sessionId, data.signal);
              } else {
                sessionManager.log(`Invalid send_signal data type: ${typeof data.signal}`, sessionId);
              }
              return;
              
            case 'resize':
              // Terminal resize
              if (data.data && typeof data.data === 'object' && data.data.cols && data.data.rows) {
                sessionManager.log(`Resizing terminal to ${data.data.cols}x${data.data.rows}`, sessionId);
                ptyProcess.resize(data.data.cols, data.data.rows);
              } else {
                sessionManager.log(`Invalid resize data format`, sessionId);
              }
              return;
              
            default:
              sessionManager.log(`Unknown message type: ${data.type}`, sessionId);
              return;
          }
        }
        
        // Invalid JSON structure - missing or invalid type field
        sessionManager.log(`Invalid message format - missing or invalid type field: "${message}"`, sessionId);
        
      } catch (e) {
        // Invalid JSON format
        sessionManager.log(`Invalid JSON format: "${message}", error: ${e}`, sessionId);
      }
    });
  
    ws.on('close', () => {
      console.error(`WebSocket disconnected from session ${sessionId}`);
      // Keep session alive, only disconnect WebSocket
      // TODO: Remove dataHandler from ptyProcess if needed
    });
  });
  
  // Find available port starting from basePort
  function findAvailablePort(startPort: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = createServer();
      
      server.listen(startPort, () => {
        const port = (server.address() as any).port;
        server.close(() => {
          resolve(port);
        });
      });
      
      server.on('error', (err: any) => {
        if (err.code === 'EADDRINUSE') {
          // Try next port
          findAvailablePort(startPort + 1).then(resolve).catch(reject);
        } else {
          reject(err);
        }
      });
    });
  }
  
  // Start server with dynamic port selection
  findAvailablePort(basePort).then(port => {
    httpServer.listen(port, () => {
      console.error(`Web UI available at http://localhost:${port}`);
      console.error(`Connect to session: http://localhost:${port}/session/YOUR_SESSION_ID`);
      console.error(`Use --no-web-ui to disable Web UI`);
      
      // Update global port for URL generation
      (global as any).webServerPort = port;
    });
  }).catch(error => {
    console.error(`Failed to start Web server: ${error}`);
  });
}

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  
  // Handle --version flag
  if (args.includes('--version')) {
    const versionInfo = getVersionInfo();
    console.log(`${versionInfo.name} v${versionInfo.version}`);
    console.log(versionInfo.description);
    console.log(`Author: ${versionInfo.author}`);
    console.log(`License: ${versionInfo.license}`);
    console.log(`Repository: ${versionInfo.repository}`);
    console.log(`Homepage: ${versionInfo.homepage}`);
    process.exit(0);
  }
  
  return {
    noWebUI: args.includes('--no-web-ui')
  };
}

// Start the server
async function main() {
  const { noWebUI } = parseArgs();
  
  // Start MCP server on stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('REPL MCP server running on stdio');
  
  // Start Web server on HTTP (unless disabled)
  if (!noWebUI) {
    setupWebServer();
  } else {
    console.error('Web UI disabled by --no-web-ui flag');
  }
}

main().catch(console.error);