// Save/load: localStorage snapshots plus JSON export/import.

const STORAGE_KEY = 'seeded-map-scene-v1';

export const persistence = {
  save(scene) {
    const payload = JSON.stringify(scene.toJSON());
    localStorage.setItem(STORAGE_KEY, payload);
    return payload.length;
  },

  load() {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  },

  clear() {
    localStorage.removeItem(STORAGE_KEY);
  },

  exportFile(scene) {
    const blob = new Blob([JSON.stringify(scene.toJSON(), null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `map-scene-${scene.seed}.json`;
    link.click();
    URL.revokeObjectURL(url);
  },

  importFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          resolve(JSON.parse(reader.result));
        } catch (err) {
          reject(new Error('JSON 解析失败: ' + err.message));
        }
      };
      reader.onerror = () => reject(new Error('文件读取失败'));
      reader.readAsText(file);
    });
  },
};
