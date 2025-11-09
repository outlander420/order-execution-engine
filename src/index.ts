import Fastify, { FastifyRequest, FastifyReply } from 'fastify';
import fastifyWebsocket, { SocketStream } from '@fastify/websocket';
import { Queue, Worker, Job } from 'bullmq';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { WebSocket } from 'ws';

// Types
interface OrderRequest {
  tokenIn: 'SOL' | 'USDC' | 'USDT' | 'ETH';
  tokenOut: 'SOL' | 'USDC' | 'USDT' | 'ETH';
  amount: number;
}

interface Order {
  id: string;
  tokenIn: string;
  tokenOut: string;
  amount: number;
  status: OrderStatus;
  txHash?: string;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

type OrderStatus = 'pending' | 'routing' | 'building' | 'submitted' | 'confirmed' | 'failed';

// Mock DEX Router implementation
class MockDexRouter {
  async getRaydiumQuote(tokenIn: string, tokenOut: string, amount: number): Promise<number> {
    await new Promise(resolve => setTimeout(resolve, 200)); // Simulate network delay
    const basePrice = 100;
    return basePrice * (1 + (Math.random() * 0.06 - 0.03)); // ±3% variation
  }

  async getMeteoraQuote(tokenIn: string, tokenOut: string, amount: number): Promise<number> {
    await new Promise(resolve => setTimeout(resolve, 200)); // Simulate network delay
    const basePrice = 100;
    return basePrice * (1 + (Math.random() * 0.06 - 0.03)); // ±3% variation
  }

  async executeSwap(dex: string, order: Order): Promise<{ txHash: string; executedPrice: number }> {
    // Simulate transaction delay (2-3 seconds)
    await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 1000));
    return {
      txHash: `${dex}_${randomUUID()}`,
      executedPrice: 100 * (1 + (Math.random() * 0.06 - 0.03))
    };
  }
}

// In-memory store
const orderStore = new Map<string, Order>();

// Initialize Fastify with detailed logging
const fastify = Fastify({ 
  logger: {
    level: 'info',
      serializers: {
      res(reply: any) {
        return {
          statusCode: reply?.statusCode,
          responseTime: reply?.elapsedTime
        };
      },
      req(request) {
        return {
          method: request.method,
          url: request.url,
          parameters: request.params,
          headers: request.headers
        };
      }
    }
  }
});

// Register WebSocket plugin
fastify.register(fastifyWebsocket);

// Initialize Redis connection
const redis = new Redis({
  host: '127.0.0.1',
  port: 6379,
  maxRetriesPerRequest: null
});

// Initialize BullMQ queue
const orderQueue = new Queue('orders', { 
  connection: {
    host: '127.0.0.1',
    port: 6379,
    maxRetriesPerRequest: null
  }
});

// WebSocket connections store
const connections = new Map<string, WebSocket>();

// Order processing worker
const worker = new Worker('orders', async (job) => {
  const order = job.data.order as Order;
  const router = new MockDexRouter();

  try {
    // Update and notify function
    const updateStatus = (status: OrderStatus, additionalData: object = {}) => {
      order.status = status;
      order.updatedAt = new Date();
      orderStore.set(order.id, order);
      
      const connection = connections.get(order.id);
      if (connection) {
        connection.send(JSON.stringify({
          status,
          orderId: order.id,
          ...additionalData
        }));
      }
    };

    // Start routing
    updateStatus('routing');

    // Get quotes from both DEXes
    const [raydiumPrice, meteoraPrice] = await Promise.all([
      router.getRaydiumQuote(order.tokenIn, order.tokenOut, order.amount),
      router.getMeteoraQuote(order.tokenIn, order.tokenOut, order.amount)
    ]);

    // Choose best DEX
    const bestDex = raydiumPrice <= meteoraPrice ? 'raydium' : 'meteora';
    fastify.log.info(`Routing order ${order.id} to ${bestDex}`);

    // Build transaction
    updateStatus('building');

    // Submit transaction
    updateStatus('submitted');
    const result = await router.executeSwap(bestDex, order);

    // Update with confirmation
    order.txHash = result.txHash;
    updateStatus('confirmed', {
      txHash: result.txHash,
      executedPrice: result.executedPrice
    });

    return { success: true, order };

  } catch (error) {
    // Handle failures
    order.status = 'failed';
    order.error = error instanceof Error ? error.message : 'Unknown error';
    order.updatedAt = new Date();
    orderStore.set(order.id, order);
    
    const connection = connections.get(order.id);
    if (connection) {
      connection.send(JSON.stringify({ 
        status: 'failed', 
        orderId: order.id, 
        error: order.error 
      }));
    }
    
    throw error;
  }
}, {
  connection: {
    host: '127.0.0.1',
    port: 6379,
    maxRetriesPerRequest: null
  },
  concurrency: 10,
  limiter: {
    max: 10,
    duration: 1000
  }
});

// REST API endpoint for order creation
fastify.post('/api/orders/execute', {
  schema: {
    body: {
      type: 'object',
      required: ['tokenIn', 'tokenOut', 'amount'],
      properties: {
        tokenIn: { 
          type: 'string',
          enum: ['SOL', 'USDC', 'USDT', 'ETH'],
          description: 'Input token symbol'
        },
        tokenOut: { 
          type: 'string',
          enum: ['SOL', 'USDC', 'USDT', 'ETH'],
          description: 'Output token symbol'
        },
        amount: { 
          type: 'number', 
          minimum: 0.000001,
          maximum: 1000000,
          description: 'Amount of tokenIn to swap'
        }
      },
      additionalProperties: false
    },
    response: {
      202: {
        type: 'object',
        properties: {
          orderId: { type: 'string', format: 'uuid' },
          status: { type: 'string', enum: ['pending'] },
          wsEndpoint: { type: 'string', format: 'uri' }
        }
      }
    }
  }
}, async (request: FastifyRequest<{
  Body: OrderRequest;
}>, reply: FastifyReply) => {
  const order: Order = {
    id: randomUUID(),
    ...request.body as any,
    status: 'pending',
    createdAt: new Date(),
    updatedAt: new Date()
  };

  // Store order
  orderStore.set(order.id, order);

  // Add to queue with retry configuration
  await orderQueue.add('execute_order', { order }, {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1000
    }
  });

  return reply.status(202).send({
    orderId: order.id,
    status: 'pending',
    wsEndpoint: `ws://localhost:3000/ws/${order.id}`
  });
});

// WebSocket endpoint for order status updates
fastify.register(async (fastify) => {
  fastify.get('/ws/:orderId', { websocket: true }, (connection, request) => {
    const { orderId } = request.params as { orderId: string };
    
    // Store connection
    connections.set(orderId, connection.socket);

    // Send initial order state if exists
    const order = orderStore.get(orderId);
    if (order) {
      connection.socket.send(JSON.stringify({
        status: order.status,
        orderId: order.id,
        txHash: order.txHash,
        error: order.error
      }));
    }

    // Clean up on close
    connection.socket.on('close', () => {
      connections.delete(orderId);
    });
  });
});

// Start server
const start = async () => {
  try {
    // In test environment, always use a random port
    const port = process.env.JEST_WORKER_ID ? 0 : (process.env.PORT ? parseInt(process.env.PORT) : 3000);
    const address = await fastify.listen({ port, host: '127.0.0.1' });
    fastify.log.info(`Server is running on ${address}`);
    return address;
  } catch (err) {
    fastify.log.error(err);
    if (!process.env.JEST_WORKER_ID) { // Don't exit if running in Jest
      process.exit(1);
    }
    throw err; // Rethrow for tests to handle
  }
};

start();

// Handle graceful shutdown
const cleanup = async () => {
  // Clean up each resource independently to prevent cascade failures
  const errors = [];
  
  // Close WebSocket connections first
  for (const [orderId, connection] of connections.entries()) {
    try {
      connection.close();
      connections.delete(orderId);
    } catch (err) {
      errors.push(['WebSocket', err]);
    }
  }

  // Worker cleanup
  try {
    await worker.close();
    await worker.disconnect();
  } catch (err) {
    errors.push(['Worker', err]);
  }

  // Queue cleanup
  try {
    await orderQueue.close();
    await orderQueue.disconnect();
  } catch (err) {
    errors.push(['Queue', err]);
  }

  // Redis cleanup
  try {
    // Force disconnect if quit fails
    await Promise.race([
      redis.quit(),
      new Promise(resolve => setTimeout(resolve, 1000))
    ]);
    if (redis.status !== 'end') {
      redis.disconnect();
    }
  } catch (err) {
    errors.push(['Redis', err]);
  }

  // Server cleanup
  try {
    await fastify.close();
  } catch (err) {
    errors.push(['Fastify', err]);
  }

  // Report any errors
  if (errors.length > 0) {
    console.error('Cleanup completed with errors:', errors);
  }

  // Give connections time to close
  await new Promise(resolve => setTimeout(resolve, 1000));
};

process.on('SIGTERM', cleanup);
process.on('SIGINT', cleanup);

// Export for testing
export { MockDexRouter, Order, OrderStatus, fastify, cleanup, redis, orderQueue };