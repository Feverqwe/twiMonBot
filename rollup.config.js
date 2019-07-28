import babel from 'rollup-plugin-babel';
import typescript from 'rollup-plugin-typescript';

export default {
  input: ['./src/main.ts', './src/testProxies.js'],
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
    })
  ]
};