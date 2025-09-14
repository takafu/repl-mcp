# Claude Development Guidelines

## Development Workflow

### Important: MCP Server Restart Required After Build

After making code changes and running `npm run build`, the MCP server MUST be restarted to reflect the changes.

**Workflow:**
1. Make TypeScript code changes
2. Run `npm run build`
3. **Request MCP server restart** (user needs to restart `/mcp` command)
4. Test changes

**Why restart is needed:**
- TypeScript compiles to JavaScript in `build/` directory
- MCP server loads the compiled JS files at startup
- Changes only take effect after server restart

## Commit Message Format

Follow semantic commit conventions with the format used in this repository:

### Format
```
<type>: <description>
```

### Types
- `feat`: new feature
- `fix`: bug fix
- `docs`: documentation changes
- `refactor`: code refactoring without functional changes
- `improve`: enhancements to existing functionality
- `perf`: performance improvements
- `test`: adding or updating tests
- `chore`: maintenance tasks

### Examples from this repository
- `fix: support HTTPS WebSocket connections in browser UI`
- `docs: update README for API changes in v0.3.5`
- `feat: add displayName support for custom session naming`
- `improve: enhance favicon visibility with subtle border`
- `refactor: simplify session API and improve naming clarity`

### Guidelines
- Use lowercase for type and description
- Keep description concise but descriptive
- Use imperative mood ("add" not "added")
- No period at the end