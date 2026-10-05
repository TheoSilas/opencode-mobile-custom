// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'dist-e2e/*', '.expo/*', 'test-results/**', 'playwright-report/**'],
  },
  {
    // The provider deliberately mirrors frequently-changing state into refs
    // (latest-ref pattern) so realtime callbacks never capture stale closures.
    // React Compiler cannot verify that pattern; migrate it in a dedicated,
    // well-tested change rather than under a dependency bump.
    files: ['providers/opencode-provider.tsx', 'providers/use-transcript-state.ts', 'providers/use-opencode-provider-state.ts', 'providers/use-connection-actions.ts', 'providers/use-connection-connect-actions.ts'],
    rules: {
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'off',
    },
  },
  {
    // These provider-owned state machines reconcile external events into state.
    files: ['providers/use-conversation-state.ts', 'providers/use-opencode-realtime.ts'],
    rules: { 'react-hooks/set-state-in-effect': 'off' },
  },
]);
