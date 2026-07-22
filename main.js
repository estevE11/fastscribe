const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');

let mainWindow = null;
let pyProc = null;

const BACKEND_URL = 'http://127.0.0.1:8000';

function resolvePython() {
  // Prefer the project virtualenv interpreter, fall back to system python.
  const venvPython =
    process.platform === 'win32'
      ? path.join(__dirname, 'python_backend', 'venv', 'Scripts', 'python.exe')
      : path.join(__dirname, 'python_backend', 'venv', 'bin', 'python');

  try {
    require('fs').accessSync(venvPython);
    return venvPython;
  } catch (_) {
    return process.platform === 'win32' ? 'python' : 'python3';
  }
}

// Path to the PyInstaller-frozen backend bundled in packaged builds.
function bundledBackend() {
  const exe = process.platform === 'win32'
    ? 'fastscribe-backend.exe'
    : 'fastscribe-backend';
  return path.join(process.resourcesPath, 'backend', exe);
}

function startBackend() {
  // Packaged builds ship a frozen backend binary (no Python required).
  // In development we run the source with the venv/system interpreter.
  let command;
  let args;
  let cwd;

  if (app.isPackaged) {
    command = bundledBackend();
    args = [];
    cwd = path.dirname(command);
  } else {
    command = resolvePython();
    args = [path.join(__dirname, 'python_backend', 'main.py')];
    cwd = path.join(__dirname, 'python_backend');
  }

  pyProc = spawn(command, args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  pyProc.stdout.on('data', (data) => {
    process.stdout.write(`[backend] ${data}`);
  });
  pyProc.stderr.on('data', (data) => {
    process.stderr.write(`[backend] ${data}`);
  });
  pyProc.on('exit', (code) => {
    console.log(`[backend] process exited with code ${code}`);
    pyProc = null;
  });
}

function stopBackend() {
  if (pyProc) {
    pyProc.kill();
    pyProc = null;
  }
}

function waitForBackend(retries = 60) {
  return new Promise((resolve) => {
    const attempt = (left) => {
      const req = http.get(`${BACKEND_URL}/health`, (res) => {
        res.resume();
        resolve(true);
      });
      req.on('error', () => {
        if (left <= 0) {
          resolve(false);
          return;
        }
        setTimeout(() => attempt(left - 1), 1000);
      });
    };
    attempt(retries);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 720,
    minWidth: 640,
    minHeight: 480,
    backgroundColor: '#111318',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  startBackend();
  await waitForBackend();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', stopBackend);
app.on('will-quit', stopBackend);
process.on('exit', stopBackend);
