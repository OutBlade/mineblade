const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow () {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 1024,
    minHeight: 576,
    show: false, // Don't show until ready
    autoHideMenuBar: true, // Hide the typical File/Edit view
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  // Remove standard window menu
  mainWindow.setMenuBarVisibility(false);

  // Load the launcher index.html of the app.
  mainWindow.loadFile(path.join(__dirname, 'src', 'launcher', 'index.html'));

  // Show window seamlessly once it's loaded to avoid visual flash
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });
}

// This method will be called when Electron has finished initialization
app.whenReady().then(() => {
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Quit when all windows are closed, except on macOS
app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});
