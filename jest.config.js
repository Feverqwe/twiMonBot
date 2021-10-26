// For a detailed explanation regarding each configuration property, visit:
// https://jestjs.io/docs/en/configuration.html

process.env.IS_TEST_ENV = '1';

if (!process.env.DEBUG) {
  process.env.DEBUG = 'app:*';
}

module.exports = {
  preset: 'ts-jest',
};
