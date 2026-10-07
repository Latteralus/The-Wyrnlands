import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { rendererContentSecurityPolicy } from './src/electron/contentSecurity.ts';

// The production renderer carries its Content-Security-Policy as a meta tag
// too (main.ts's app:// handler also sends it as a header). Not in dev: the
// Vite dev server injects inline scripts for React fast refresh.
function contentSecurityPolicyMeta(): Plugin {
  return {
    name: 'wyrnlands-csp-meta',
    apply: 'build',
    transformIndexHtml: () => [
      {
        tag: 'meta',
        attrs: {
          'http-equiv': 'Content-Security-Policy',
          content: rendererContentSecurityPolicy({ meta: true }),
        },
        injectTo: 'head-prepend',
      },
    ],
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), contentSecurityPolicyMeta()],
  build: { outDir: 'dist', emptyOutDir: true },
});
