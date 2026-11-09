import { join } from 'node:path'
import { app, BrowserWindow, ipcMain, session, systemPreferences } from 'electron'
import { IPC } from '../shared/ipc'
import { loadApiKey } from './config'
import { registerIpc } from './ipc'
import { loadSdkRuntime } from './sdk-runtime'
import { SmartSpectraService } from './smartspectra-service'

const service = new SmartSpectraService({
  apiKey: loadApiKey(join(app.getAppPath(), '.env')),
  loadRuntime: loadSdkRuntime,
  ensureCameraAccess,
  // Timing/stability statistics are only collected in development builds.
  diagnostics: !app.isPackaged
})

/** Native capture in the main process needs OS camera permission for this app. */
async function ensureCameraAccess(): Promise<{ granted: boolean; message?: string }> {
  if (process.platform !== 'darwin') return { granted: true }
  const status = systemPreferences.getMediaAccessStatus('camera')
  if (status === 'granted') return { granted: true }
  if (status === 'not-determined') {
    const guidance =
      'macOS did not grant camera access. Quit PAWSE and start it from the macOS Terminal app ' +
      '(npm run dev) so the system can show the camera prompt, or enable the camera for the launching app in ' +
      'System Settings > Privacy & Security > Camera.'
    const timeout = new Promise<false>((resolve) => setTimeout(() => resolve(false), 45_000))
    const granted = await Promise.race([systemPreferences.askForMediaAccess('camera'), timeout])
    return granted ? { granted: true } : { granted: false, message: guidance }
  }
  return {
    granted: false,
    message:
      'Camera access is blocked. Enable it in System Settings > Privacy & Security > Camera, then try again.'
  }
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 960,
    height: 720,
    minWidth: 720,
    minHeight: 560,
    backgroundColor: '#1b1d1c',
    title: 'PAWSE',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault()
  })

  service.onChange((state) => {
    if (!win.isDestroyed()) win.webContents.send(IPC.stateChanged, state)
  })

  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (!app.isPackaged && devUrl) void win.loadURL(devUrl)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
  return win
}

void app.whenReady().then(async () => {
  // The renderer never needs the camera or any other permission.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  registerIpc(ipcMain, service)
  await service.probe()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

let quitting = false
app.on('before-quit', (event) => {
  if (quitting) return
  event.preventDefault()
  quitting = true
  void service.dispose().finally(() => app.quit())
})

app.on('window-all-closed', () => {
  void service.stop().finally(() => {
    if (process.platform !== 'darwin') app.quit()
  })
})
