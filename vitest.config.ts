import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';
import { config } from 'dotenv';

config({ path: '.env.local' });

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
