// For a detailed explanation regarding each configuration property, visit:
// https://jestjs.io/docs/en/configuration.html

process.env.IS_TEST_ENV = '1';

if (!process.env.DEBUG) {
  process.env.DEBUG = 'app:*';
}

module.exports = {
  roots: ['<rootDir>/test'],
  transform: {
    '^.+\\.tsx?$': [
      '@swc/jest',
      {
        jsc: {
          parser: {
            syntax: 'typescript',
          },
          target: 'es2024',
        },
        module: {
          type: 'commonjs',
        },
      },
    ],
  },
};
