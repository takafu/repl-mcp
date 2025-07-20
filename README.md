# repl-mcp

A simple MCP server for managing REPL sessions. Provides basic tools to create and execute commands in various REPLs and shells, with integrated Web UI for browser-based terminal access.

## Motivation

Working with remote REPLs (like Rails console on production servers) often forces you to cram complex operations into single commands since losing connection means losing your session state. This tool enables persistent REPL sessions that survive individual command executions, allowing you to work naturally with interactive environments through AI agents. The integrated Web UI provides browser-based terminal access for direct interaction.

## Features

### Core Features

- **Multiple REPL Support**: Python, IPython, Node.js, Ruby (pry, irb), bash, zsh
- **Session Management**: Create, execute commands, and destroy REPL sessions
- **Web UI Integration**: Browser-based terminal access for direct session interaction
- **Dynamic Port Selection**: Automatically finds available ports starting from 8023
- **Customizable Setup**: Configure setup commands and environment variables
- **Cross-Platform**: Works on Windows, macOS, and Linux

### Additional Features

- **Timeout Recovery**: LLM assistance when commands timeout
- **Session Learning**: Remembers prompt patterns within sessions
- **Responsive Terminal**: 132x43 terminal size for better application compatibility
- **Session URL Sharing**: Easy sharing of session URLs for browser access

## Web UI Features

### Browser-Based Terminal Access

repl-mcp includes an integrated Web UI that provides browser-based terminal access to your REPL sessions:

- **Direct Session Access**: Open session URLs in your browser for direct terminal interaction
- **Real-time Terminal**: Full xterm.js terminal with real-time input/output
- **Session Management**: View and manage all active sessions through the web interface
- **Responsive Design**: Terminal adapts to browser window size
- **Cross-Platform**: Works on any device with a modern web browser

### Web UI Usage

1. **Create a Session**: Use MCP tools to create a REPL session
2. **Get Session URL**: The response includes a `webUrl` field
3. **Open in Browser**: Copy the URL and open it in your browser
4. **Direct Interaction**: Use the browser terminal for direct session interaction

### Web UI URLs

- **Root URL**: `http://localhost:8023/` - Shows server status and basic information
- **Session URL**: `http://localhost:8023/session/SESSION_ID` - Direct terminal access to a specific session

### Dynamic Port Selection

The Web UI automatically finds available ports:
- Starts with port 8023
- If port is in use, tries 8024, 8025, etc.
- URLs are automatically updated with the correct port

## Installation

[![npm version](https://img.shields.io/npm/v/repl-mcp)](https://www.npmjs.com/package/repl-mcp)
[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_Server-0098FF?style=flat-square&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=repl-mcp&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22repl-mcp%40latest%22%5D%7D)  
[![Install MCP Server](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/install-mcp?name=repl-mcp&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsInJlcGwtbWNwQGxhdGVzdCJdfQo=)


### VS Code

Click the button above or add to your `.vscode/mcp.json`:

```json
{
  "servers": {
    "repl-mcp": {
      "command": "npx",
      "args": ["-y", "repl-mcp@latest"]
    }
  }
}
```

### Claude Code

```bash
claude mcp add repl-mcp -- npx -y repl-mcp@latest
```

### Manual MCP Configuration

Add to your MCP settings file:

```json
{
  "mcpServers": {
    "repl-mcp": {
      "command": "npx",
      "args": ["-y", "repl-mcp@latest"]
    }
  }
}
```

### From Source

1. Clone this repository
2. Install dependencies: `npm install`
3. Build the project: `npm run build`
4. Add to your MCP settings:

```json
{
  "mcpServers": {
    "repl-mcp": {
      "command": "node",
      "args": ["path/to/repl-mcp/build/index.js"]
    }
  }
}
```

## Available Tools

### `create_repl_session`

Create a new REPL session with predefined or custom configuration. Returns a webUrl that can be opened in a browser to access the session via Web UI. Please show the webUrl to the user so they can open it in their browser.

**Parameters:**

- `configName` (optional): Name of predefined configuration
- `customConfig` (optional): Custom configuration object

**Response includes:**

- `sessionId`: Unique session identifier (6-character format)
- `webUrl`: Browser URL for direct terminal access
- `config`: Configuration name used

**Example:**

```json
{
  "configName": "pry"
}
```

Response:
```json
{
  "success": true,
  "sessionId": "abc123",
  "config": "Ruby Pry REPL",
  "webUrl": "http://localhost:8023/session/abc123"
}
```

### `execute_repl_command`

Execute a command in an existing REPL session.

**Parameters:**

- `sessionId`: The session ID
- `command`: Command to execute
- `timeout` (optional): Timeout in milliseconds (default: 30000)

**Example:**

```json
{
  "sessionId": "abc123",
  "command": "puts 'Hello, World!'"
}
```

**Response with LLM Question:**

When timeout occurs, the response may include an LLM question:

```json
{
  "success": false,
  "question": "Session timed out. Raw output: '❯ '. What should I do?",
  "questionType": "timeout_analysis",
  "canContinue": true
}
```

**How to respond:** Use `answer_session_question` with one of these formats:

- `READY:❯` - The prompt "❯" is ready for commands
- `SEND:\n` - Send Enter key (use `\x03` for Ctrl+C)
- `WAIT:5` - Wait 5 more seconds for completion
- `FAILED:reason` - Mark the session as failed

### `list_repl_sessions`

List all active REPL sessions. Each session includes a webUrl for browser access. Please show the webUrls to the user so they can open sessions in their browser.

**Response includes:**

- `sessions`: Array of session objects with webUrl for each
- Each session includes: id, name, type, status, webUrl, etc.

### `get_session_details`

Get detailed information about a specific session. Includes webUrl for browser access. Please show the webUrl to the user so they can open the session in their browser.

**Parameters:**

- `sessionId`: The session ID

**Response includes:**

- `session`: Detailed session information
- `webUrl`: Browser URL for direct terminal access

### `destroy_repl_session`

Destroy an existing REPL session.

**Parameters:**

- `sessionId`: The session ID

### `list_repl_configurations`

List all available predefined REPL configurations.

### `answer_session_question`

Answer a question from session creation or command execution during LLM-assisted recovery.

**Parameters:**

- `sessionId`: The session ID
- `answer`: LLM guidance response in one of these formats:
  - `READY:pattern` - Specify the detected prompt pattern (e.g., `READY:❯` means "❯" is the prompt)
  - `SEND:command` - Send specific input (e.g., `SEND:\n` for Enter, `SEND:\x03` for Ctrl+C)
  - `WAIT:seconds` - Wait longer for completion (e.g., `WAIT:10`)
  - `FAILED:reason` - Mark session as failed with explanation

**Example:**

```json
{
  "sessionId": "abc123",
  "answer": "READY:∙"
}
```

## Predefined Configurations

*Note: Each REPL tool must be installed and available in your PATH.*

### REPL Configurations

- **pry**: Ruby Pry REPL with advanced debugging features
- **irb**: Ruby IRB REPL with standard functionality
- **ipython**: Enhanced Python REPL with rich features
- **node**: Node.js JavaScript REPL
- **python**: Standard Python REPL

### Shell Configurations

- **bash**: Bash shell environment
- **zsh**: Zsh shell environment (with Oh My Zsh support)

### Advanced Configurations

- **rails_console**: Rails console with bundle exec
- **rails_console_production**: Production Rails console

## LLM-Assisted Recovery

### How It Works

When command execution times out, the server can request LLM assistance:

1. **Captures Raw Output**: Collects terminal output for analysis
2. **LLM Analysis**: LLM examines the output and provides guidance
3. **Response Types**: Four response patterns for different situations:
   - `READY:pattern` - Prompt detected, specify the pattern
   - `SEND:command` - Send a specific command (e.g., `\n` for Enter)
   - `WAIT:seconds` - Wait longer for command completion
   - `FAILED:reason` - Mark as failure with explanation

### Session Learning

Patterns identified by LLM are remembered for the session duration to improve subsequent command performance.

## Usage Examples

### Basic REPL Usage

#### Create a Python Session

```json
{
  "tool": "create_repl_session",
  "arguments": {
    "configName": "python"
  }
}
```

Response:
```json
{
  "success": true,
  "sessionId": "xyz789",
  "config": "Python REPL",
  "webUrl": "http://localhost:8023/session/xyz789"
}
```

#### Execute Python Code

```json
{
  "tool": "execute_repl_command",
  "arguments": {
    "sessionId": "xyz789",
    "command": "print('Hello from REPL!')"
  }
}
```

### Web UI Usage

#### Open Session in Browser

1. Create a session and get the webUrl
2. Open the webUrl in your browser
3. Use the browser terminal for direct interaction

Example workflow:
```bash
# 1. Create session via MCP
# 2. Copy webUrl from response
# 3. Open in browser: http://localhost:8023/session/xyz789
# 4. Use browser terminal for direct interaction
```

### LLM-Assisted Recovery Example

When a command times out, you can use LLM assistance:

```json
{
  "tool": "answer_session_question",
  "arguments": {
    "sessionId": "xyz789",
    "answer": "READY:❯"
  }
}
```

The session will remember this pattern for future commands.

## Session Management

Each session maintains:

- **Unique session ID**: 6-character format for easy identification and management
- **Configuration details**: REPL type, shell, setup commands, etc.
- **Current status**: initializing, ready, executing, error, terminated
- **Command history**: Record of executed commands
- **Last output and errors**: Most recent execution results
- **Creation and activity timestamps**: Session lifecycle tracking
- **Learned prompt patterns**: Custom patterns discovered through LLM assistance
- **Web UI access**: Browser URL for direct terminal interaction

### Session Lifecycle

1. **Initialization**: Session created with specified configuration
2. **Ready**: Session prepared for command execution
3. **Executing**: Command being processed
4. **Learning**: LLM assistance for prompt detection (when needed)
5. **Optimized**: Learned patterns enable fast execution

## Error Handling

The server provides comprehensive error handling with intelligent recovery:

### Traditional Error Handling

- **Session creation failures**: Clear error messages with diagnostic information
- **Command execution timeouts**: Graceful timeout handling with retry options
- **REPL crashes and recovery**: Automatic detection and session state management
- **Invalid command detection**: Input validation and error reporting

### LLM-Enhanced Recovery

- **Prompt detection failures**: Automatic LLM consultation for unknown prompts
- **Adaptive timeout handling**: Smart waiting based on command complexity
- **Custom environment support**: Dynamic learning for non-standard shells
- **Contextual error analysis**: Rich error information for troubleshooting

### Error Response Format

**Standard Error:**

```json
{
  "success": false,
  "error": "Session not found",
  "executionTime": 0
}
```

**LLM-Assisted Error:**

```json
{
  "success": false,
  "error": "Timeout - LLM guidance needed",
  "question": "Session timed out. What should I do?",
  "questionType": "timeout_analysis",
  "canContinue": true,
  "context": { "sessionId": "...", "rawOutput": "..." }
}
```

## Development

### Building

```bash
npm run build
```

### Development Mode

```bash
npm run dev
```

This will start TypeScript in watch mode for development.

## Platform-Specific Notes

### Windows

- Uses `cmd` or `powershell` as default shell
- Some REPL features may behave differently

### macOS/Linux

- Uses `bash` or `zsh` as default shell
- Full feature support

## Troubleshooting

### Common Issues

#### Traditional Issues

1. **Session creation fails**: Check that the required REPL command is installed and accessible
2. **Commands timeout consistently**: Increase timeout value or check REPL responsiveness
3. **REPL not found**: Ensure the REPL executable is in your PATH

#### Web UI Issues

1. **Port conflicts**: The server automatically finds available ports starting from 8023
2. **Browser terminal not responsive**: Check that JavaScript is enabled and try refreshing
3. **Session URL not working**: Verify the session is still active and the port is correct
4. **Terminal size issues**: The terminal uses 132x43 size for better application compatibility

#### LLM-Assisted Issues

1. **LLM guidance not working**: Ensure you're using the `answer_session_question` tool with proper response format
2. **Pattern not learned**: Check that the LLM response follows the `READY:pattern` format exactly
3. **Timeout questions ignored**: Use `answer_session_question` tool to provide LLM guidance

### Best Practices

#### For Complex Shells

- **Custom prompts**: Use `READY:pattern` to teach the system your prompt when timeouts occur
- **Nested environments**: Use `WAIT:seconds` for environments that need time to settle

#### Web UI Best Practices

- **Session sharing**: Share webUrl with team members for collaborative debugging
- **Browser compatibility**: Use modern browsers (Chrome, Firefox, Safari, Edge)
- **Direct interaction**: Use browser terminal for complex interactive sessions
- **Multiple sessions**: Open multiple browser tabs for different sessions

#### Performance Tips

- **Session learning**: Patterns learned during LLM assistance improve subsequent commands
- **Multiple sessions**: Each session learns independently

### Debug Information

Enable detailed debugging by checking the `debugLogs` field in responses:

```json
{
  "success": true,
  "output": "...",
  "debugLogs": [
    "2025-06-22T15:31:15.504Z: [DEBUG session_xxx] Prompt detected: true",
    "2025-06-22T15:31:15.505Z: [DEBUG session_xxx] Learned new prompt pattern: '∙'"
  ]
}
```

## Contributing

Contributions are welcome! The LLM-assisted features make it easy to add support for new shell environments and REPL types. When contributing:

1. **Test with different shells**: Ensure compatibility across bash, zsh, and other environments
2. **Consider prompt variations**: Test with custom prompts and themes
3. **Update configurations**: Add new predefined configs for common setups
4. **Document LLM patterns**: Share successful prompt patterns for others

## License

MIT License
