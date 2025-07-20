#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { SessionManager } from './session-manager.js'; // Remove writeFileSync import
import { REPLConfig } from './types.js';
import { DEFAULT_REPL_CONFIGS, createCustomConfig, getConfigByName, listAvailableConfigs } from './repl-configs.js';

// Web server imports
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import url from 'url';

// Create MCP server
const server = new Server({
  name: "repl-mcp",
  version: "1.0.0"
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
  customConfig: z.object({
    name: z.string().describe("Session name"),
    type: z.enum(['pry', 'irb', 'ipython', 'node', 'python', 'custom']).describe("REPL type"),
    shell: z.enum(['bash', 'zsh', 'cmd', 'powershell']).describe("Shell type"),
    commands: z.array(z.string()).describe("Commands to execute in order. The last command should start the REPL."),
    startingDirectory: z.string().optional().describe("Host directory where the shell process will start (must exist)"),
    environment: z.record(z.string()).optional().describe("Environment variables"),
    timeout: z.number().optional().describe("Command timeout in milliseconds")
  }).optional().describe("Custom configuration"),
  debug: z.boolean().optional().describe("Include debug logs in response (default: auto - included for failures/LLM assistance)")
});

const ExecuteCommandSchema = z.object({
  sessionId: z.string().describe("Session ID"),
  command: z.string().describe("Command to execute"),
  timeout: z.number().optional().describe("Timeout in milliseconds (default: 30000)")
});

const SessionIdSchema = z.object({
  sessionId: z.string().describe("Session ID"),
  debug: z.boolean().optional().describe("Include debug logs in response (default: false)")
});

const AnswerSessionQuestionSchema = z.object({
  sessionId: z.string().describe("Session ID"),
  answer: z.string().describe("LLM guidance response. Use READY:pattern to specify detected prompt (e.g. 'READY:❯' means ❯ is the prompt), SEND:command to send input (SEND:\\n for Enter, SEND:\\x03 for Ctrl+C), WAIT:seconds to wait longer (e.g. WAIT:10), or FAILED:reason to mark as failed"),
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

// Handle list tools request
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "create_repl_session",
        description: "Create a new REPL session with predefined or custom configuration. Returns a webUrl that can be opened in a browser to access the session via Web UI. Please show the webUrl to the user so they can open it in their browser.",
        inputSchema: zodToJsonSchema(CreateSessionSchema)
      },
      {
        name: "execute_repl_command",
        description: "Execute a command in an existing REPL session. ALWAYS show the command output to the user after execution. Decode ANSI escape codes if present and format the output for readability. For lengthy outputs, summarize key results while preserving important details.",
        inputSchema: zodToJsonSchema(ExecuteCommandSchema)
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
        name: "answer_session_question",
        description: "Answer a question from session creation or command execution during LLM-assisted recovery. Use one of these response formats: READY:pattern (specify detected prompt like 'READY:❯'), SEND:command (send input like 'SEND:\\n' for Enter), WAIT:seconds (wait longer like 'WAIT:10'), FAILED:reason (mark as failed with explanation)",
        inputSchema: zodToJsonSchema(AnswerSessionQuestionSchema)
      },
      {
        name: "get_full_output",
        description: "Get the complete output buffer for a session in chunks to avoid token limits. Use offset and limit parameters to retrieve specific portions of large outputs.",
        inputSchema: zodToJsonSchema(GetFullOutputSchema)
      }
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
        const { configName, customConfig, debug } = params;

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

        const result = await sessionManager.createSession(config);
        attemptedSessionId = result.sessionId;
        
        const response: any = {
          ...result,
          config: config.name
        };
        
        // Add Web UI URL if session was created successfully
        if (result.success && result.sessionId) {
          response.webUrl = `http://localhost:8023/session/${result.sessionId}`;
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

      case "execute_repl_command": {
        const params = ExecuteCommandSchema.parse(args);
        const { sessionId, command, timeout } = params;

        const result = await sessionManager.executeCommand(sessionId, command, timeout);
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: result.success,
                output: result.output,
                error: result.error,
                executionTime: result.executionTime,
                // LLM assistance fields
                question: result.question,
                questionType: result.questionType,
                context: result.context,
                canContinue: result.canContinue,
                // Hint for agent behavior
                hint: result.success ? "Please show this command output to the user in a readable format" : undefined
              }, null, 2)
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
            type: session.config.type,
            status: session.status,
            createdAt: session.createdAt,
            lastActivity: session.lastActivity,
            historyCount: session.history.length,
            webUrl: `http://localhost:8023/session/${session.id}`
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
            status: session.status,
            currentDirectory: session.currentDirectory,
            history: session.history,
            lastOutput: session.lastOutput,
            lastError: session.lastError,
            createdAt: session.createdAt,
            lastActivity: session.lastActivity,
            webUrl: `http://localhost:8023/session/${session.id}`
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

      case "answer_session_question": {
        const params = AnswerSessionQuestionSchema.parse(args);
        const { sessionId, answer, debug } = params;

        // Use the dedicated answerSessionQuestion method to handle the answer
        const result = await sessionManager.answerSessionQuestion(sessionId, answer);
        
        const response: any = { ...result };
        
        // Always include debug logs for LLM-assisted operations or when explicitly requested
        if (debug || !result.success || result.question) {
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
  const port = 8023; // HTTP (80) + Telnet (23) = Terminal-like port
  
  // Serve static files from public/ at root level  
  app.use(express.static(path.join(__dirname, '../public')));
  
  // Route for root page (server status)
  app.get('/', (_req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
  });
  
  // Route for session pages
  app.get('/session/:sessionId', (_req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
  });
  
  const httpServer = createServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: '/terminal' });
  
  wss.on('connection', (ws: WebSocket, req) => {
    // Extract sessionId from URL query
    const parsedUrl = url.parse(req.url || '', true);
    const sessionId = parsedUrl.query.sessionId as string;
    
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
  
    if (session.status !== 'ready') {
      ws.send(`Error: Session ${sessionId} is not ready (status: ${session.status})\r\n`);
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
      ptyProcess.write(msg.toString());
    });
  
    ws.on('close', () => {
      console.error(`WebSocket disconnected from session ${sessionId}`);
      // Keep session alive, only disconnect WebSocket
      // TODO: Remove dataHandler from ptyProcess if needed
    });
  });
  
  httpServer.listen(port, () => {
    console.error(`Web UI available at http://localhost:${port}`);
    console.error(`Connect to session: http://localhost:${port}/session/YOUR_SESSION_ID`);
    console.error(`Use --no-web-ui to disable Web UI`);
  });
}

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
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