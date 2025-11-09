import WebSocket from 'ws';

async function connectToOrderSocket() {
  try {
    // Create order
    console.log('Creating order...');
    const response = await fetch('http://localhost:3000/api/orders/execute', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        tokenIn: 'USDT',
        tokenOut: 'ETH',
        amount: 5000 // Trying to swap 5000 USDT to ETH
      })
    });

    const data = await response.json();
    console.log('Order created:', data);
    
    // Extract orderId from the response
    const { orderId } = data;
    
    // Connect to WebSocket
    const ws = new WebSocket(`ws://localhost:3000/ws/${orderId}`);

    ws.on('open', () => {
      console.log('WebSocket connected, waiting for updates...');
    });

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        console.log('\nReceived update:', message);

        // Close connection if order is in final state
        if (['confirmed', 'failed'].includes(message.status)) {
          console.log('Order processing completed.');
          ws.close();
          process.exit(0);
        }
      } catch (error) {
        console.error('Error parsing message:', error);
      }
    });

    ws.on('close', () => {
      console.log('WebSocket connection closed');
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
    });
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

// Start the client
connectToOrderSocket();