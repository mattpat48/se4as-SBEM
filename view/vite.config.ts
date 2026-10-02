import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: { groups: [
          { name: 'three', test: /node_modules\/three\// },
          { name: 'mqtt', test: /node_modules\/mqtt\// },
        ] },
      },
    },
  },
  test: { environment: 'node', globals: true },
});
