const WebSocket = require('ws');

// First create an order
async function connectToOrder() {
  try {
    console.log('Creating order...');
    const response = await fetch('http://localhost:3000/api/orders/execute', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        tokenIn: 'SOL',
        tokenOut: 'USDC',
        amount: 1.5
      })
    });

    const data = await response.json();
    console.log('Order created:', data);

    // Connect to WebSocket
    const ws = new WebSocket(`ws://localhost:3000/ws/${data.orderId}`);

    // Connection opened
    ws.on('open', () => {
      console.log('Connected to WebSocket');
    });

    // Listen for messages
    ws.on('message', (message) => {
      const update = JSON.parse(message.toString());
      console.log('Received update:', update);

      // Close connection if order is in final state
      if (['confirmed', 'failed'].includes(update.status)) {
        console.log('Order processing completed');
        ws.close();
        process.exit(0);
      }
    });

    // Handle errors
    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
    });

    // Connection closed
    ws.on('close', () => {
      console.log('Connection closed');
    });
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

// Run the client
connectToOrder();