import babel from 'rollup-plugin-babel';

export default {
  input: './src/main.js',
  output: {
    dir: './dist',
    format: 'cjs'
  },
  plugins: [
    babel({
      plugins: [
        ['@babel/plugin-proposal-class-properties', { "loose": true }]
      ]
    })
  ]
};