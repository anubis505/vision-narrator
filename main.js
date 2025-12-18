const { app, BrowserWindow, shell, dialog } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 850,
    minWidth: 900,
    minHeight: 700,
    title: "VisionNarrator Pro",
    backgroundColor: "#0f172a",
    show: false, // No mostrar hasta que esté listo
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    }
  });

  // Quitar menú de navegador
  win.setMenuBarVisibility(false);

  win.loadFile('index.html');

  win.once('ready-to-show', () => {
    win.show();
    
    // Verificar si existe la API_KEY
    if (!process.env.API_KEY) {
      dialog.showErrorBox(
        'Falta API_KEY',
        'No se ha detectado la variable de entorno API_KEY. La aplicación no podrá procesar vídeos. Por favor, configúrala en el sistema.'
      );
    }
  });

  // Abrir enlaces externos en el navegador del sistema
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});