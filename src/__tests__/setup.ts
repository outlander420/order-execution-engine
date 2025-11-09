import { fastify, cleanup as mainCleanup } from '../index';
import { beforeAll, afterAll } from '@jest/globals';

let cleanupFunctions: (() => Promise<void>)[] = [];

// Register cleanup function
export function registerCleanup(fn: () => Promise<void>) {
  cleanupFunctions.push(fn);
}

beforeAll(async () => {
  // Register main cleanup
  cleanupFunctions.push(mainCleanup);
  
  // Clear any existing data
  try {
    await fastify.close();
  } catch (err) {
    // Ignore if server wasn't running
  }
});

afterAll(async () => {
  // Run all cleanup functions
  const errors = [];
  
  for (const fn of cleanupFunctions) {
    try {
      await fn();
    } catch (err) {
      console.error('Error during cleanup:', err);
      errors.push(err);
    }
  }

  // Give connections time to close
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  cleanupFunctions = [];
  
  if (errors.length > 0) {
    console.error('Cleanup completed with errors:', errors);
  }
}, 30000);