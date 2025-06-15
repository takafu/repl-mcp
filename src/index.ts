#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { SessionManager } from './session-manager.js'; // Remove writeFileSync import
import { REPLConfig } from './types.js';
import { DEFAULT_REPL_CONFIGS, createCustomConfig, getConfigByName, listAvailableConfigs } from './repl-configs.js';

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
    setupCommands: z.array(z.string()).describe("Commands to run before starting REPL"),
    replCommand: z.string().describe("Command to start REPL"),
    workingDirectory: z.string().optional().describe("Working directory"),
    environment: z.record(z.string()).optional().describe("Environment variables"),
    timeout: z.number().optional().describe("Command timeout in milliseconds")
  }).optional().describe("Custom configuration"),
});

const ExecuteCommandSchema = z.object({
  sessionId: z.string().describe("Session ID"),
  command: z.string().describe("Command to execute"),
  timeout: z.number().optional().describe("Timeout in milliseconds (default: 30000)")
});

const SessionIdSchema = z.object({
  sessionId: z.string().describe("Session ID")
});

// Handle list tools request
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "create_repl_session",
        description: "Create a new REPL session with predefined or custom configuration",
        inputSchema: CreateSessionSchema
      },
      {
        name: "execute_repl_command",
        description: "Execute a command in an existing REPL session",
        inputSchema: ExecuteCommandSchema
      },
      {
        name: "list_repl_sessions",
        description: "List all active REPL sessions",
        inputSchema: z.object({})
      },
      {
        name: "get_session_details",
        description: "Get detailed information about a specific session",
        inputSchema: SessionIdSchema
      },
      {
        name: "destroy_repl_session",
        description: "Destroy an existing REPL session",
        inputSchema: SessionIdSchema
      },
      {
        name: "list_repl_configurations",
        description: "List all available predefined REPL configurations",
        inputSchema: z.object({})
      }
    ]
  };
});

// Handle call tool request
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "create_repl_session": {
        const params = CreateSessionSchema.parse(args);
        const { configName, customConfig } = params;

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

        const sessionId = await sessionManager.createSession(config);
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                sessionId,
                config: config.name,
                message: `REPL session created successfully`
              }, null, 2)
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
                executionTime: result.executionTime
              }, null, 2)
            }
          ]
        };
      }

      case "list_repl_sessions": {
        const sessions = sessionManager.listSessions();
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                sessions: sessions.map(session => ({
                  id: session.id,
                  name: session.config.name,
                  type: session.config.type,
                  status: session.status,
                  createdAt: session.createdAt,
                  lastActivity: session.lastActivity,
                  historyCount: session.history.length
                })),
                debugLogs: sessionManager.getDebugLogs() // Include debug logs
              }, null, 2)
            }
          ]
        };
      }

      case "get_session_details": {
        const params = SessionIdSchema.parse(args);
        const { sessionId } = params;

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

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
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
                  lastActivity: session.lastActivity
                },
                debugLogs: sessionManager.getDebugLogs() // Include debug logs
              }, null, 2)
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
        const configs = listAvailableConfigs();
        const configDetails = configs.map((name: string) => ({
          name,
          config: DEFAULT_REPL_CONFIGS[name]
        }));
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                configurations: configDetails,
                debugLogs: sessionManager.getDebugLogs() // Include debug logs
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
            debugLogs: sessionManager.getDebugLogs() // Include debug logs
          }, null, 2)
        }
      ],
      isError: true
    };
  } finally {
    // sessionManager.clearDebugLogs(); // Clear logs after each request
  }
});

// Start the server
async function main() {
  // No longer clearing debug.log file, as logs are in-memory
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('REPL MCP server running on stdio');
}

main().catch(console.error);