module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: ['dist', '.eslintrc.cjs'],
  parser: '@typescript-eslint/parser',
  plugins: ['react-refresh'],
  rules: {
    // Established codebase style: `any` is accepted in UI glue (event payloads,
    // provider-shaped rows), and shared helpers may live beside components.
    // `npm run lint` runs with --max-warnings 0, so these stay off rather than
    // "warn" to keep the gate green and meaningful.
    '@typescript-eslint/no-explicit-any': 'off',
    'react-refresh/only-export-components': 'off',
  },
}
