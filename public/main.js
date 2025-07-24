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
    
    // Send initial terminal size
    const message = {
      type: 'resize',
      data: {
        cols: term.cols,
        rows: term.rows
      }
    };
    ws.send(JSON.stringify(message));
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

  // Send user input to server using structured message format
  term.onData(data => {
    console.log('Input data:', data, 'char codes:', [...data].map(c => c.charCodeAt(0)));
    if (ws.readyState === WebSocket.OPEN) {
      // Check for control characters that should be sent as signals
      if (data === '\x03') {
        // Ctrl+C → Send SIGINT signal
        console.log('Detected Ctrl+C, sending SIGINT signal');
        const message = {
          type: 'send_signal',
          signal: 'SIGINT'
        };
        ws.send(JSON.stringify(message));
      } else if (data === '\x1A') {
        // Ctrl+Z → Send SIGTSTP signal
        console.log('Detected Ctrl+Z, sending SIGTSTP signal');
        const message = {
          type: 'send_signal',
          signal: 'SIGTSTP'
        };
        ws.send(JSON.stringify(message));
      } else if (data === '\x1C') {
        // Ctrl+\ → Send SIGQUIT signal
        console.log('Detected Ctrl+\\, sending SIGQUIT signal');
        const message = {
          type: 'send_signal',
          signal: 'SIGQUIT'
        };
        ws.send(JSON.stringify(message));
      } else {
        // Send as regular terminal input
        const message = {
          type: 'terminal_input',
          data: data
        };
        ws.send(JSON.stringify(message));
      }
    }
  });
  
  // Handle terminal resize
  const sendResize = () => {
    if (ws.readyState === WebSocket.OPEN) {
      const message = {
        type: 'resize',
        data: {
          cols: term.cols,
          rows: term.rows
        }
      };
      ws.send(JSON.stringify(message));
    }
  };
  
  // Listen for terminal resize events
  term.onResize(sendResize);
  
  // Listen for window resize events
  window.addEventListener('resize', () => {
    // Terminal will auto-resize, then send the new size
    setTimeout(sendResize, 100);
  });
} 