# Order Execution Engine

A mock order execution engine that simulates routing orders between different Solana DEXes (Raydium and Meteora).

## Features

- REST API for order submission
- Real-time order status updates via WebSocket
- Automatic price comparison between DEXes
- Simulated transaction execution
- Queue-based order processing with retries
- In-memory order tracking

## Prerequisites

- Node.js 16+
- Redis server
- TypeScript

## Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Make sure Redis is running:
   ```bash
   sudo service redis-server start
   ```
4. Start the server:
   ```bash
   npm run dev
   ```

## API Documentation

### Submit Order

**POST** `/api/orders/execute`

Request body:
```json
{
  "tokenIn": "SOL",
  "tokenOut": "USDC",
  "amount": 1.5
}
```

Response:
```json
{
  "orderId": "uuid",
  "status": "pending",
  "wsEndpoint": "ws://localhost:3000/ws/uuid"
}
```

### WebSocket Updates

Connect to the WebSocket endpoint provided in the order submission response to receive real-time updates.

Order statuses:
- pending: Initial state
- routing: Comparing prices between DEXes
- building: Preparing transaction
- submitted: Transaction sent
- confirmed: Transaction confirmed
- failed: Order failed

Example WebSocket message:
```json
{
  "status": "confirmed",
  "orderId": "uuid",
  "txHash": "raydium_xxx",
  "executedPrice": 100.5
}
```

## Error Handling

- Failed orders will be retried up to 3 times with exponential backoff
- WebSocket connections are automatically cleaned up
- Graceful shutdown handling for queue and connections

## Development

Build:
```bash
npm run build
```

Run tests:
```bash
npm test
```