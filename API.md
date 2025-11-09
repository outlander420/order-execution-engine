# Order Execution Engine API Documentation

## REST API

### Create Order
```http
POST /api/orders/execute
```

Request Body:
```json
{
  "tokenIn": string,    // Input token symbol (e.g., "SOL", "USDT", "ETH")
  "tokenOut": string,   // Output token symbol (e.g., "USDC", "ETH", "SOL")
  "amount": number      // Amount of tokenIn to swap
}
```

Response:
```json
{
  "orderId": string,    // Unique order identifier
  "status": string,     // Initial status ("pending")
  "wsEndpoint": string  // WebSocket endpoint for real-time updates
}
```

## WebSocket Updates

Connect to the WebSocket endpoint provided in the order creation response to receive real-time updates.

### Status Updates Format
```json
{
  "status": string,     // Order status
  "orderId": string,    // Order identifier
  "txHash"?: string,    // Transaction hash (included in confirmed status)
  "error"?: string,     // Error message (included in failed status)
  "executedPrice"?: number // Final execution price (included in confirmed status)
}
```

### Order Statuses
- `pending`: Initial state after order creation
- `routing`: Comparing prices between DEXes
- `building`: Building the transaction
- `submitted`: Transaction submitted to blockchain
- `confirmed`: Transaction confirmed with execution details
- `failed`: Order failed with error details

### Example WebSocket Messages

Routing Status:
```json
{
  "status": "routing",
  "orderId": "123e4567-e89b-12d3-a456-426614174000"
}
```

Confirmed Status:
```json
{
  "status": "confirmed",
  "orderId": "123e4567-e89b-12d3-a456-426614174000",
  "txHash": "raydium_abc123...",
  "executedPrice": 100.50
}
```

Failed Status:
```json
{
  "status": "failed",
  "orderId": "123e4567-e89b-12d3-a456-426614174000",
  "error": "Insufficient liquidity"
}
```

## Error Handling

The system implements several error handling mechanisms:
1. Queue-based retries (up to 3 attempts with exponential backoff)
2. Real-time error status updates via WebSocket
3. HTTP error responses with appropriate status codes

Common HTTP Status Codes:
- 202: Order accepted for processing
- 400: Invalid request parameters
- 500: Internal server error

## DEX Integration

The system integrates with two mock DEXes:
- Raydium
- Meteora

Price simulation includes:
- Base price: 100 units
- Random variation: ±3%
- Realistic delays:
  - Quote retrieval: ~200ms
  - Transaction execution: 2-3 seconds