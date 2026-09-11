import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.UI_PORT ?? 5178),
    // deployments.json lives at the repo root, one level above this app. Importing it directly
    // means a fresh deploy reconfigures the board with no hand-editing and no backend.
    fs: { allow: ['..'] },
  },
});
