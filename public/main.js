// Terminal configuration with improved settings
const term = new Terminal({
  cols: 132,
  rows: 43
});

term.open(document.getElementById('terminal'));

// Extract sessionId from URL path
const pathSegments = window.location.pathname.split('/');
const sessionId = pathSegments[2]; // /session/SESSION_ID

if (!sessionId) {
  term.write('Error: sessionId is required\r\n');
  term.write('Usage: http://localhost:8023/session/YOUR_SESSION_ID\r\n');
} else {
  // Connect to WebSocket endpoint with sessionId
  const ws = new WebSocket(`ws://${location.host}/terminal?sessionId=${sessionId}`);

  ws.onopen = () => {
    term.write(`Connected to session: ${sessionId}\r\n`);
  };

  ws.onmessage = (event) => {
    term.write(event.data);
  };

  ws.onclose = () => {
    term.write('\r\n\r\nWebSocket connection closed\r\n');
  };

  ws.onerror = (error) => {
    term.write(`WebSocket error: ${error}\r\n`);
  };

  // Send user input to server
  term.onData(data => {
    console.log('Input data:', data, 'char codes:', [...data].map(c => c.charCodeAt(0)));
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });
} 