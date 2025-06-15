# REPL MCP Server

A universal REPL session manager MCP server that provides tools for creating and managing interactive shell sessions with various REPLs including pry, irb, python, and node.

## Features

- **Multiple REPL Support**: pry, irb, python, and node
- **Session Management**: Create, manage, and destroy multiple concurrent REPL sessions
- **Customizable Setup**: Configure shell type, setup commands, and environment variables
- **Cross-Platform**: Works on Windows, macOS, and Linux
- **Error Handling**: Proper error detection and reporting

## Installation

1. Clone or download this repository to your MCP servers directory
2. Install dependencies:

   ```bash
   npm install
   ```

3. Build the project:

   ```bash
   npm run build
   ```

## Configuration

Add the server to your MCP settings file (e.g., `mcp_settings.json`):

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

Create a new REPL session with predefined or custom configuration.

**Parameters:**

- `configName` (optional): Name of predefined configuration
- `customConfig` (optional): Custom configuration object

**Example:**

```json
{
  "configName": "pry"
}
```

Or with custom config:

```json
{
  "customConfig": {
    "name": "Custom Ruby Session",
    "type": "pry",
    "shell": "bash",
    "setupCommands": ["cd /path/to/project", "bundle install"],
    "replCommand": "bundle exec pry"
  }
}
```

### `execute_repl_command`

Execute a command in an existing REPL session.

**Parameters:**

- `sessionId`: The session ID
- `command`: Command to execute
- `timeout` (optional): Timeout in milliseconds

**Example:**

```json
{
  "sessionId": "session_1234567890_abc123",
  "command": "puts 'Hello, World!'"
}
```

### `list_repl_sessions`

List all active REPL sessions.

### `get_session_details`

Get detailed information about a specific session.

**Parameters:**

- `sessionId`: The session ID

### `destroy_repl_session`

Destroy an existing REPL session.

**Parameters:**

- `sessionId`: The session ID

### `list_repl_configurations`

List all available predefined REPL configurations.

## Predefined Configurations

- **pry**: Basic Pry REPL
- **irb**: Basic IRB REPL
- **ipython**: IPython REPL
- **node**: Node.js REPL
- **python**: Basic Python REPL

## Usage Examples

### Create a Python Session

```json
{
  "tool": "create_repl_session",
  "arguments": {
    "configName": "python"
  }
}
```

### Execute Ruby Code

```json
{
  "tool": "execute_repl_command",
  "arguments": {
    "sessionId": "session_1234567890_abc123",
    "command": "User.count"
  }
}
```

### Create Custom Python Environment

```json
{
  "tool": "create_repl_session",
  "arguments": {
    "customConfig": {
      "name": "Data Science Environment",
      "type": "ipython",
      "shell": "bash",
      "setupCommands": [
        "cd /path/to/data/project",
        "source venv/bin/activate"
      ],
      "replCommand": "ipython",
      "environment": {
        "PYTHONPATH": "/path/to/custom/modules"
      }
    }
  }
}
```

## Session Management

Each session maintains:

- Unique session ID
- Configuration details
- Current status (initializing, ready, executing, error, terminated)
- Command history
- Last output and errors
- Creation and last activity timestamps

## Error Handling

The server provides comprehensive error handling:

- Session creation failures
- Command execution timeouts
- REPL crashes and recovery
- Invalid command detection
- Proper error reporting with context

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

1. **Session creation fails**: Check that the required REPL command is installed and accessible
2. **Commands timeout**: Increase timeout value or check REPL responsiveness

## License

MIT License