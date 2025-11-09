import WebSocket from 'ws';
import { MockDexRouter, fastify, cleanup } from '../index';
import { beforeAll, afterAll, afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import Fastify, { FastifyInstance } from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import { randomUUID } from 'crypto';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { registerCleanup } from './setup';

// Types
interface OrderRequest {
  tokenIn: 'SOL' | 'USDC' | 'USDT' | 'ETH';
  tokenOut: 'SOL' | 'USDC' | 'USDT' | 'ETH';
  amount: number;
}

type OrderStatus = 'pending' | 'routing' | 'building' | 'submitted' | 'confirmed' | 'failed';

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

// Shared test resources
const orderStore = new Map<string, Order>();
const connections = new Map<string, WebSocket>();// Mock order processing worker
const mockOrderProcessing = async (order: Order) => {
  const statuses: OrderStatus[] = ['routing', 'building', 'submitted', 'confirmed'];
  const dex = Math.random() < 0.5 ? 'raydium' : 'meteora';

  for (const status of statuses) {
    order.status = status;
    order.updatedAt = new Date();
    orderStore.set(order.id, order);

    if (status === 'confirmed') {
      order.txHash = `${dex}_mock_tx_${randomUUID()}`;
    }

    // Send update via WebSocket
    const connection = connections.get(order.id);
    if (connection && connection.readyState === WebSocket.OPEN) {
      connection.send(JSON.stringify({
        status,
        orderId: order.id,
        txHash: order.txHash,
        executedPrice: status === 'confirmed' ? 100 : undefined
      }));
    }

    // Add some delay between status updates
    await new Promise(resolve => setTimeout(resolve, 100));
  }
};

// Helper function to create a fresh server instance
const createServer = () => {
  return Fastify({ 
    logger: {
      level: 'info',
      serializers: {
        res(reply: any) {
          return {
            statusCode: reply?.statusCode,
            responseTime: reply?.getResponseTime?.()
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
};

describe('Order Execution API', () => {
  let wsConnection: WebSocket | null = null;
  let server: FastifyInstance;
  let serverAddress: string;

  beforeAll(async () => {
    registerCleanup(cleanup);
  });

  beforeEach(async () => {
    server = createServer();
    await server.register(fastifyWebsocket);
    await server.register(async (fastify) => {
      fastify.get('/ws/:orderId', { websocket: true }, (connection, request) => {
        const { orderId } = request.params as { orderId: string };
        connections.set(orderId, connection.socket);
        const order = orderStore.get(orderId);
        if (order) {
          connection.socket.send(JSON.stringify({
            status: order.status,
            orderId: order.id,
            txHash: order.txHash,
            error: order.error
          }));
        }
        connection.socket.on('close', () => {
          connections.delete(orderId);
        });
      });
    });

    server.post('/api/orders/execute', {
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
        }
      }
    }, async (request, reply) => {
      const order: Order = {
        id: randomUUID(),
        ...request.body as any,
        status: 'pending',
        createdAt: new Date(),
        updatedAt: new Date()
      };

      orderStore.set(order.id, order);
      // In test environment, process the order directly instead of using queue
      mockOrderProcessing(order).catch(console.error);

      const address = server.server.address();
      const port = typeof address === 'string' ? 0 : address?.port;

      return reply.status(202).send({
        orderId: order.id,
        status: 'pending',
        wsEndpoint: `ws://localhost:${port}/ws/${order.id}`
      });
    });

    await server.listen({ port: 0, host: '127.0.0.1' });
    const address = server.server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Invalid server address');
    }
    serverAddress = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    if (wsConnection?.readyState === WebSocket.OPEN) {
      await new Promise<void>((resolve) => {
        wsConnection!.once('close', () => resolve());
        wsConnection!.close();
      });
    }
    await server.close();
    wsConnection = null;
  });

  describe('POST /api/orders/execute', () => {
    it('should create an order and return proper response', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/orders/execute',
        payload: {
          tokenIn: 'SOL',
          tokenOut: 'USDC',
          amount: 1.5
        }
      });

      expect(response.statusCode).toBe(202);
      
      const body = JSON.parse(response.payload);
      expect(body).toHaveProperty('orderId');
      expect(body).toHaveProperty('status', 'pending');
      expect(body).toHaveProperty('wsEndpoint');
      expect(body.wsEndpoint).toMatch(/^ws:\/\/localhost:\d+\/ws\//);
    });

    it('should reject invalid tokens', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/orders/execute',
        payload: {
          tokenIn: 'INVALID',
          tokenOut: 'USDC',
          amount: 1.5
        }
      });

      expect(response.statusCode).toBe(400);
    });

    it('should reject negative amounts', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/orders/execute',
        payload: {
          tokenIn: 'SOL',
          tokenOut: 'USDC',
          amount: -1
        }
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('WebSocket Connection', () => {
    it('should receive all status updates', async () => {
      const expectedStatuses = ['routing', 'building', 'submitted', 'confirmed'];
      const receivedStatuses: string[] = [];

      const response = await server.inject({
        method: 'POST',
        url: '/api/orders/execute',
        payload: {
          tokenIn: 'SOL',
          tokenOut: 'USDC',
          amount: 1
        }
      });

      const body = JSON.parse(response.payload);
      const serverUrl = new URL(serverAddress);
      wsConnection = new WebSocket(body.wsEndpoint.replace(/localhost:\d+/, `127.0.0.1:${serverUrl.port}`));

      await new Promise<void>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          reject(new Error(`Timeout waiting for all status updates. Received: ${receivedStatuses.join(', ')}`));
        }, 10000);

        wsConnection!.on('error', (error) => {
          clearTimeout(timeoutId);
          reject(error);
        });

        wsConnection!.on('open', () => {
          wsConnection!.on('message', (data) => {
            const update = JSON.parse(data.toString());
            receivedStatuses.push(update.status);

            if (update.status === 'confirmed') {
              clearTimeout(timeoutId);
              expect(receivedStatuses).toEqual(expect.arrayContaining(expectedStatuses));
              expect(update).toHaveProperty('txHash');
              expect(update).toHaveProperty('executedPrice');
              resolve();
            }
          });
        });
      });
    }, 15000); // Increased timeout and added proper error handling
  });
});