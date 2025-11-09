module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  transform: {
    '^.+\\.ts$': 'ts-jest'
  },
  setupFilesAfterEnv: ['<rootDir>/src/__tests__/setup.ts'],
  maxConcurrency: 1, // Run tests sequentially to avoid port conflicts
  maxWorkers: 1      // Run tests in a single process
};