/**
 * Jest Configuration for ParadoxFX Tests
 */

module.exports = {
    testEnvironment: 'node',
    testMatch: [
        '**/test/**/*.test.js',
        '**/test/**/*.spec.js'
    ],
    collectCoverageFrom: [
        'lib/**/*.js',
        'pfx.js',
        '!lib/**/*.test.js',
        '!lib/**/*.spec.js',
        '!**/node_modules/**'
    ],
    coverageDirectory: 'coverage',
    coverageReporters: [
        'text',
        'lcov',
        'html'
    ],
    coverageThreshold: {
        global: {
            branches: 30,
            functions: 30,
            lines: 30,
            statements: 30
        }
    },
    setupFilesAfterEnv: [
        '<rootDir>/test/setup.js'
    ],
    testTimeout: 10000,
    verbose: true,
    clearMocks: true,
    restoreMocks: true
};
