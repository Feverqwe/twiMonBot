import babel from 'rollup-plugin-babel';
import typescript from 'rollup-plugin-typescript';
import run from '@rollup/plugin-run';

const isWatch = process.argv.includes('-w');

export default {
  input: './src/main.ts',
  output: {
    dir: './dist',
    format: 'cjs'
  },
  plugins: [
    typescript(),
    babel({
      plugins: [
        ['@babel/plugin-proposal-class-properties', { "loose": true }]
      ]
    }),
    isWatch && run({
      options: {
        execArgv: ['--inspect']
      }
    }),
  ]
};