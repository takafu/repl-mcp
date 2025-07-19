import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import url from 'url';
import { SessionManager } from './session-manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = 3000;
const sessionManager = new SessionManager();

// Serve static files from public/ at root level  
app.use(express.static(path.join(__dirname, '../public')));

// Route for session pages
app.get('/session/:sessionId', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/terminal' });

wss.on('connection', (ws: WebSocket, req) => {
  // Extract sessionId from URL path
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

  console.log(`WebSocket connected to session ${sessionId}`);

  // Restore terminal state from server-side terminal
  const serializedState = sessionManager.getSerializedTerminalState(sessionId);
  if (serializedState) {
    console.log(`Restoring terminal state for session ${sessionId}`);
    ws.send(serializedState);
  } else {
    console.log(`No terminal state to restore for session ${sessionId}`);
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
    console.log(`WebSocket disconnected from session ${sessionId}`);
    // Keep session alive, only disconnect WebSocket
    // TODO: Remove dataHandler from ptyProcess if needed
  });
});

server.listen(port, () => {
  console.log(`Web UI available at http://localhost:${port}`);
  console.log(`Connect to session: http://localhost:${port}/session/YOUR_SESSION_ID`);
}); 