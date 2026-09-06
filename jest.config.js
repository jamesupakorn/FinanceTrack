const nextJest = require('next/jest');

const createJestConfig = nextJest({ dir: './' });

// Custom Jest config layered on top of next/jest's Next.js-aware defaults
// (SWC transform, CSS Module stubs, static asset mocks — see next/jest docs).
const customJestConfig = {
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  // Default environment is jsdom (needed for future component tests). Tests that touch the
  // Mongo driver or other Node-only server modules opt into `/** @jest-environment node */`
  // per-file, since jsdom lacks the `net`/`tls` modules the `mongodb` package needs.
  testEnvironment: 'jest-environment-jsdom',
  testPathIgnorePatterns: ['<rootDir>/.next/', '<rootDir>/node_modules/'],
};

module.exports = createJestConfig(customJestConfig);
