const { contextBridge } = require('electron');

// Expose a minimal, safe API surface to the renderer.
// The backend base URL is the only thing the UI needs from the main process.
contextBridge.exposeInMainWorld('fastscribe', {
  backendUrl: 'http://127.0.0.1:8000',
});
