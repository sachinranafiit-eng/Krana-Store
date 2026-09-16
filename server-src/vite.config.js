const {defineConfig}=require('vite');

// GitHub Pages serves the app from /ERP/ while local and server deployments
// serve it from /. Keep both targets working from the same source tree.
module.exports=defineConfig({
  base: process.env.VITE_BASE || '/',
  server:{proxy:{'/api':'http://127.0.0.1:4173','/health':'http://127.0.0.1:4173'}},
  build:{outDir: process.env.VITE_OUT_DIR || 'dist',assetsDir:''}
});
