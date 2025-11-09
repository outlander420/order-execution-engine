const WebSocket = require('ws');

// Create order first using curl
const orderResponse = fetch('http://localhost:3000/api/orders/execute', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    tokenIn: 'SOL',
    tokenOut: 'USDC',
    amount: 1.5
  })
}).then(response => response.json())
  .then(data => {
    console.log('Order created:', data);
    
    // Connect to WebSocket using the endpoint from the response
    const ws = new WebSocket(data.wsEndpoint);

    ws.on('open', () => {
      console.log('WebSocket connected');
    });

    ws.on('message', (data) => {
      const message = JSON.parse(data);
      console.log('Received update:', message);

      // If order is in final state, close the connection
      if (['confirmed', 'failed'].includes(message.status)) {
        ws.close();
      }
    });

    ws.on('close', () => {
      console.log('WebSocket connection closed');
      process.exit(0);
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
      process.exit(1);
    });
  })
  .catch(error => {
    console.error('Error:', error);
    process.exit(1);
  });