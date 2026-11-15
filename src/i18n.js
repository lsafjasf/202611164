export const LANGS = ['zh', 'en'];

export const I18N = {
  zh: {
    appTitle: '双语海报编辑器',
    langLabel: '语言',
    addRect: '添加矩形',
    addCircle: '添加圆形',
    addText: '添加文字',
    delete: '删除所选',
    exportPng: '导出 PNG',
    exportSvg: '导出 SVG',
    undo: '撤销',
    redo: '重做',
    textContent: '文字内容',
    fontSize: '字号',
    fill: '填充色',
    canvasAria: '海报画布，可使用方向键移动所选图形，Delete 键删除',
    shapeRect: '矩形',
    shapeCircle: '圆形',
    shapeText: '文字块',
    selected: '已选中',
    layer: '图层',
    statusReady: '就绪',
    statusAdded: '已添加 {type}',
    statusDeleted: '已删除所选图形',
    statusMoved: '已移动到 x={x}, y={y}',
    statusExported: '已导出 {format}，编辑状态已保留',
    statusExportFail: '导出失败：{reason}',
    statusRecovered: '已从上次会话恢复工程',
    statusStorageError: '本地存储不可用，进度将无法在刷新后保留',
    statusRestored: '已恢复到出错前的状态',
    runTests: '运行自检',
    testSummary: '自检结果：{passed}/{total} 通过（{rate}%）',
    testFail: '失败：{name} —— {reason}',
    testsDefault: '默认用例',
    testsBoundary: '边界用例',
    testsError: '错误恢复用例',
    a11yNote: '焦点与读屏公告随操作实时更新',
    defaultText: '海报标题 Poster 2026',
    longText: '这是一段用于验证自动换行的长文本 Mixed CJK 与 English words 以及数字 12345，需要在边界宽度下正确折行且不出现孤字。',
    confirmDelete: '确定删除所选图形吗？'
  },
  en: {
    appTitle: 'Bilingual Poster Editor',
    langLabel: 'Language',
    addRect: 'Add rectangle',
    addCircle: 'Add circle',
    addText: 'Add text',
    delete: 'Delete selection',
    exportPng: 'Export PNG',
    exportSvg: 'Export SVG',
    undo: 'Undo',
    redo: 'Redo',
    textContent: 'Text content',
    fontSize: 'Font size',
    fill: 'Fill color',
    canvasAria: 'Poster canvas. Use arrow keys to move the selected shape and Delete to remove it',
    shapeRect: 'rectangle',
    shapeCircle: 'circle',
    shapeText: 'text block',
    selected: 'selected',
    layer: 'Layer',
    statusReady: 'Ready',
    statusAdded: '{type} added',
    statusDeleted: 'Selected shape deleted',
    statusMoved: 'Moved to x={x}, y={y}',
    statusExported: '{format} exported; editing state preserved',
    statusExportFail: 'Export failed: {reason}',
    statusRecovered: 'Project restored from previous session',
    statusStorageError: 'Local storage unavailable; progress cannot survive a refresh',
    statusRestored: 'Restored to the state before the error',
    runTests: 'Run self-check',
    testSummary: 'Self-check: {passed}/{total} passed ({rate}%)',
    testFail: 'Failed: {name} — {reason}',
    testsDefault: 'Default cases',
    testsBoundary: 'Boundary cases',
    testsError: 'Error recovery cases',
    a11yNote: 'Focus and screen-reader announcements update with every action',
    defaultText: 'Poster Title 海报 2026',
    longText: 'This is a long string used to verify automatic wrapping of mixed CJK 中文内容 and English words plus digits 12345, which must wrap at the boundary width without leaving an orphan character.',
    confirmDelete: 'Delete the selected shape?'
  }
};

export function translate(lang, key, params = {}) {
  const dict = I18N[lang] || I18N.zh;
  let str = dict[key] ?? I18N.zh[key] ?? key;
  for (const [name, value] of Object.entries(params)) {
    str = str.replaceAll(`{${name}}`, String(value));
  }
  return str;
}

export function t(lang, key, params) {
  return translate(lang, key, params);
}
