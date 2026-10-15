const ts = { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }] };

module.exports = {
  testTimeout: 60000,
  projects: [
    // Pure unit tests: no database needed.
    { displayName: 'unit', testEnvironment: 'node', rootDir: '.', testMatch: ['<rootDir>/src/**/*.spec.ts'], transform: ts },
    // End-to-end tests against a real SQL Server (TEST_DATABASE_URL); the database is recreated.
    {
      displayName: 'e2e',
      testEnvironment: 'node',
      rootDir: '.',
      testMatch: ['<rootDir>/test/**/*.spec.ts'],
      transform: ts,
      globalSetup: '<rootDir>/test/global-setup.ts',
    },
  ],
};
