# repl-mcp

A simple MCP server for managing REPL sessions. Provides basic tools to create and execute commands in various REPLs and shells, with an integrated Web UI for browser-based session monitoring.

## Motivation

Working with remote REPLs (like Rails console on production servers) often forces you to cram complex operations into single commands since losing connection means losing your session state. This tool enables persistent REPL sessions that survive individual command executions, allowing you to work naturally with interactive environments through AI agents. The integrated Web UI provides browser-based monitoring for session observation.

## Features

### Core Features

- **Multiple REPL Support**: Python, IPython, Node.js, Ruby (pry, irb), bash, zsh
- **Session Management**: Create, execute commands, and destroy REPL sessions
- **Web UI Integration**: Browser-based terminal monitoring for session observation
- **Customizable Setup**: Configure setup commands and environment variables
- **Cross-Platform**: Works on Windows, macOS, and Linux

### Additional Features

- **Timeout Recovery**: LLM assistance when commands timeout
- **Session Learning**: Remembers prompt patterns within sessions

### Browser-Based Session Monitoring

- **Session URLs**: `http://localhost:8023/session/SESSION_ID` - Monitor sessions in browser
- **Dynamic Ports**: Auto-selects available ports starting from 8023
- **Cross-Platform**: Works on any device with modern browser
- **Real-time**: Live terminal output via WebSocket connection

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

Create a new REPL session with predefined or custom configuration. Returns a webUrl that can be opened in a browser to monitor the session via Web UI.

**Parameters:**

- `configName` (optional): Name of predefined configuration
- `customConfig` (optional): Custom configuration object

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

**Response includes:**

- `sessionId`: Unique session identifier (6-character format)
- `webUrl`: Browser URL for session monitoring
- `config`: Configuration name used

### `send_input_to_session`

Send input to a REPL session.

**Parameters:**

- `sessionId`: The session ID
- `input`: Input text to send to the session
- `options` (optional): Input options object
  - `wait_for_prompt` (default: false): Wait for prompt to return
  - `timeout` (default: 30000): Timeout in milliseconds
  - `add_newline` (default: true): Add newline to input

**Example:**

```json
{
  "sessionId": "abc123",
  "input": "puts 'Hello, World!'",
  "options": {
    "wait_for_prompt": true
  }
}
```

### `list_repl_sessions`

List all active REPL sessions. Each session includes a webUrl for browser access.

**Response includes:**

- `sessions`: Array of session objects with webUrl for each
- Each session includes: id, name, type, status, webUrl, etc.

### `get_session_details`

Get detailed information about a specific session. Includes webUrl for browser access.

**Parameters:**

- `sessionId`: The session ID

**Response includes:**

- `session`: Detailed session information
- `webUrl`: Browser URL for session monitoring

### `destroy_repl_session`

Destroy an existing REPL session.

**Parameters:**

- `sessionId`: The session ID

### `list_repl_configurations`

List all available predefined REPL configurations.

### `send_signal_to_session`

Send a signal (like Ctrl+C, Ctrl+Z) to interrupt or control a REPL session process.

**Parameters:**

- `sessionId`: The session ID
- `signal`: Signal to send (`SIGINT`, `SIGTSTP`, `SIGQUIT`)

**Example:**

```json
{
  "sessionId": "abc123",
  "signal": "SIGINT"
}
```

**Note on Windows:** On Windows, only `SIGINT` is practically effective. It is sent as a `Ctrl+C` event and can be used to interrupt running commands or terminate compatible processes like Node.js REPLs. `SIGTSTP` and `SIGQUIT` have no effect.

### `set_session_ready`

Mark a session as ready with a specific prompt pattern. Used during session recovery.

**Parameters:**

- `sessionId`: The session ID
- `pattern`: Prompt pattern (regex or literal string)

**Example:**

```json
{
  "sessionId": "abc123",
  "pattern": "❯ "
}
```

### `wait_for_session`

Wait additional time for a session to become ready.

**Parameters:**

- `sessionId`: The session ID
- `seconds`: Number of seconds to wait

**Example:**

```json
{
  "sessionId": "abc123",
  "seconds": 5
}
```

### `mark_session_failed`

Mark a session as failed with a reason.

**Parameters:**

- `sessionId`: The session ID
- `reason`: Reason for failure

**Example:**

```json
{
  "sessionId": "abc123",
  "reason": "Process crashed"
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

## Session Recovery

When sessions timeout or become unresponsive, you can use recovery tools:

- **`send_signal_to_session`** - Send Ctrl+C, Ctrl+Z, or other signals to interrupt processes
- **`set_session_ready`** - Mark session ready when you detect a working prompt
- **`wait_for_session`** - Wait longer for slow commands to complete
- **`mark_session_failed`** - Mark session as failed when recovery isn't possible

Prompt patterns learned during recovery are remembered for the session duration.

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
  "tool": "send_input_to_session",
  "arguments": {
    "sessionId": "xyz789",
    "input": "print('Hello from REPL!')",
    "options": {
      "wait_for_prompt": true
    }
  }
}
```

### Web UI Session Monitoring

To monitor a session, create it using MCP tools and open the `webUrl` from the response in a browser. This allows you to observe real-time terminal activity.

**Example Workflow:**

1. **Create session** via MCP to get a `webUrl`.
2. **Open URL** in a browser (e.g., `http://localhost:8023/session/xyz789`), manually or using automation tools like Playwright MCP.
3. **Observe** the live terminal.

### Session Recovery Example

When a command times out or hangs, you can recover the session:

**Interrupt with Ctrl+C:**
```json
{
  "tool": "send_signal_to_session",
  "arguments": {
    "sessionId": "xyz789",
    "signal": "SIGINT"
  }
}
```

**Mark session ready:**
```json
{
  "tool": "set_session_ready",
  "arguments": {
    "sessionId": "xyz789",
    "pattern": "❯ "
  }
}
```

## Session Management

Each session maintains:

- **Unique session ID**: 6-character format for easy identification and management
- **Configuration details**: REPL type, shell, setup commands, etc.
- **Current status**: initializing, ready, executing, error, terminated
- **Command history**: Record of executed commands
- **Last output and errors**: Most recent execution results
- **Creation and activity timestamps**: Session lifecycle tracking
- **Learned prompt patterns**: Custom patterns discovered through LLM assistance
- **Web UI access**: Browser URL for session monitoring

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
- **Signal Handling:** Only `SIGINT` is effectively supported. It is translated to a `Ctrl+C` event, which can stop most command-line tools and exit REPLs like Node.js. `SIGTSTP` (`Ctrl+Z`) and `SIGQUIT` (`Ctrl+\`) are not supported by the Windows console and will have no effect.

### macOS/Linux

- Uses `bash` or `zsh` as default shell
- Full feature support

## Troubleshooting

### Common Issues

1. **Session creation fails**: Check that the required REPL command is installed and accessible
2. **Commands timeout consistently**: Increase timeout value or check REPL responsiveness
3. **REPL not found**: Ensure the REPL executable is in your PATH

#### Web UI Issues

1. **Port conflicts**: The server automatically finds available ports starting from 8023
2. **Browser terminal not responsive**: Check that JavaScript is enabled and try refreshing
3. **Session URL not working**: Verify the session is still active and the port is correct
4. **Terminal size issues**: The terminal uses 132x43 size for better application compatibility

#### Session Recovery Issues

1. **Session hangs**: Use `send_signal_to_session` with `SIGINT` to interrupt stuck processes
2. **Pattern not working**: Use `set_session_ready` with the correct prompt pattern
3. **Commands timeout**: Try `wait_for_session` for slow commands or `send_signal_to_session` to interrupt

### Best Practices

#### For Complex Shells

- **Custom prompts**: Use `set_session_ready` to specify your prompt pattern
- **Nested environments**: Use `wait_for_session` for environments that need time to settle
- **Stuck processes**: Use `send_signal_to_session` to interrupt long-running commands

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
