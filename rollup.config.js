import babel from 'rollup-plugin-babel';
import typescript from 'rollup-plugin-typescript';

export default {
  input: './src/main.ts',
  output: {
    dir: './dist',
    format: 'cjs'
  },
  plugins: [
    typescript({target: 'ES2019', tsconfig: false}),
    babel({
      plugins: [
        ['@babel/plugin-proposal-class-properties', { "loose": true }]
      ]
    })
  ]
};