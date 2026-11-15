// 工程持久化：localStorage 自动保存、JSON 文件导入导出、重载前后基线对照。
import { serializeProject, deserializeProject, projectStats, compareProjects } from './core.js';

const LS_KEY = 'musicbox.project.v1';
const LS_BASELINE = 'musicbox.baseline.v1';

export const storage = {
  save(project) {
    localStorage.setItem(LS_KEY, serializeProject(project));
  },
  load() {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? deserializeProject(raw) : null;
  },
  clear() {
    localStorage.removeItem(LS_KEY);
  },
  setBaseline(project) {
    localStorage.setItem(LS_BASELINE, serializeProject(project));
  },
  getBaseline() {
    const raw = localStorage.getItem(LS_BASELINE);
    return raw ? deserializeProject(raw) : null;
  },
  clearBaseline() {
    localStorage.removeItem(LS_BASELINE);
  },
};

export function downloadProject(project) {
  const blob = new Blob([serializeProject(project)], { type: 'application/json' });
  triggerDownload(blob, `music-box-${Date.now()}.json`);
}

export function readProjectFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(deserializeProject(String(reader.result)));
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

export function downloadWav(blob) {
  triggerDownload(blob, `music-box-${Date.now()}.wav`);
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// 重载对照：拿刷新前保存的基线与当前工程逐项比较。
export function reloadComparison(current) {
  const baseline = storage.getBaseline();
  if (!baseline) return null;
  const cmp = compareProjects(baseline, current);
  return {
    baseline: projectStats(baseline),
    current: projectStats(current),
    ...cmp,
  };
}
