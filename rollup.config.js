import babel from 'rollup-plugin-babel';
import resolve from "rollup-plugin-node-resolve";

const extensions = ['.js', '.ts'];

export default {
  input: ['./src/main.ts', './src/testProxies.js'],
  output: {
    dir: './dist',
    format: 'cjs'
  },
  plugins: [
    resolve({
      modulesOnly: true,
      extensions,
    }),
    babel({
      presets: [
        ['@babel/preset-env', {
          useBuiltIns: 'usage',
          corejs: {
            version: 3,
            proposals: true
          },
          targets: {
            node: 'current'
          },
          include: [
            'es.promise.finally',
            'esnext.promise.try',
          ]
        }]
      ],
      plugins: [
        '@babel/plugin-transform-typescript',
        ['@babel/plugin-proposal-class-properties', { "loose": true }]
      ],
      extensions,
    }),
  ]
};