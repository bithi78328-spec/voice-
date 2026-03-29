import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, (process as any).cwd(), '');
  return {
    plugins: [
      react(),
      tailwindcss(),
    ],
    define: {
      // This exposes the API_KEY to the client-side bundle. 
      // Ensure you set API_KEY in your Netlify Environment Variables.
      'process.env.API_KEY': JSON.stringify(env.API_KEY)
    }
  };
});