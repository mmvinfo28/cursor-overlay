// Electron 32 removed File.path. Use the native-backed File API on Windows/macOS.
function installFileDrop(document, onFiles, onError, webUtils = require('electron').webUtils) {
  let depth = 0;
  const isFiles = event => Array.from(event.dataTransfer?.types || []).includes('Files');
  const clear = () => { depth = 0; document.body.classList.remove('file-drag'); };
  document.addEventListener('dragenter', event => {
    if (!isFiles(event)) return;
    event.preventDefault(); depth++; document.body.classList.add('file-drag');
  });
  document.addEventListener('dragover', event => {
    if (!isFiles(event)) return;
    event.preventDefault(); event.dataTransfer.dropEffect = 'copy';
  });
  document.addEventListener('dragleave', () => { if (--depth <= 0) clear(); });
  document.addEventListener('dragend', clear);
  document.addEventListener('drop', event => {
    event.preventDefault(); clear(); // Never navigate a privileged renderer to a dropped URL/file.
    const files = Array.from(event.dataTransfer?.files || []);
    if (!files.length) return;
    try {
      const paths = [...new Set(files.map(file => webUtils.getPathForFile(file)).filter(Boolean))];
      if (!paths.length) throw new Error('Drop files from Explorer or Finder, or use the File button.');
      Promise.resolve(onFiles(paths)).catch(onError);
    } catch (error) { onError(error); }
  });
}
module.exports = { installFileDrop };
