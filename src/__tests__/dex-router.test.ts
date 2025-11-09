import { MockDexRouter } from '../index';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { Worker, Queue } from 'bullmq';
import Redis from 'ioredis';

describe('MockDexRouter', () => {
  let router: MockDexRouter;
  let redis: Redis;
  let orderQueue: Queue;
  let worker: Worker;

  beforeAll(() => {
    redis = new Redis({
      host: '127.0.0.1',
      port: 6379,
      maxRetriesPerRequest: null,
    });
    orderQueue = new Queue('orders', {
      connection: {
        host: '127.0.0.1',
        port: 6379,
        maxRetriesPerRequest: null,
      },
    });
    worker = new Worker('orders', async () => {}, {
      connection: {
        host: '127.0.0.1',
        port: 6379,
        maxRetriesPerRequest: null,
      },
    });
  });

  afterAll(async () => {
    await redis.quit();
    await orderQueue.close();
    await worker.close();
  });

  beforeEach(() => {
    router = new MockDexRouter();
  });

  describe('getRaydiumQuote', () => {
    it('should return a price within ±3% of base price', async () => {
      const quote = await router.getRaydiumQuote('SOL', 'USDC', 1);
      expect(quote).toBeGreaterThanOrEqual(97); // 100 - 3%
      expect(quote).toBeLessThanOrEqual(103); // 100 + 3%
    });
  });

  describe('getMeteoraQuote', () => {
    it('should return a price within ±3% of base price', async () => {
      const quote = await router.getMeteoraQuote('SOL', 'USDC', 1);
      expect(quote).toBeGreaterThanOrEqual(97);
      expect(quote).toBeLessThanOrEqual(103);
    });
  });

  describe('executeSwap', () => {
    it('should return a transaction hash and executed price', async () => {
      const order = {
        id: '123',
        tokenIn: 'SOL',
        tokenOut: 'USDC',
        amount: 1,
        status: 'submitted' as const,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const result = await router.executeSwap('raydium', order);
      
      expect(result.txHash).toContain('raydium_');
      expect(result.executedPrice).toBeGreaterThanOrEqual(97);
      expect(result.executedPrice).toBeLessThanOrEqual(103);
    });
  });
});