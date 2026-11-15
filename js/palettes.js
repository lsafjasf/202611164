/* 色板键定义、三组可重复测试场景、检查项定义与修复算法。 */
(function () {
  'use strict';

  const KEYS = [
    { id: 'pageBg', label: '页面背景', role: 'background' },
    { id: 'panelBg', label: '面板背景', role: 'background' },
    { id: 'bodyText', label: '正文文字', role: 'foreground' },
    { id: 'largeText', label: '大号文字', role: 'foreground' },
    { id: 'btnBg', label: '按钮背景', role: 'background' },
    { id: 'btnText', label: '按钮文字', role: 'foreground' },
    { id: 'btnBorder', label: '按钮描边', role: 'foreground' },
    { id: 'focusRing', label: '焦点指示环', role: 'foreground' }
  ];

  const CHECKS = [
    { id: 'body', label: '正文文本 vs 页面背景', fg: 'bodyText', bg: 'pageBg', rule: 'BODY_TEXT' },
    { id: 'large', label: '大号文本 vs 页面背景', fg: 'largeText', bg: 'pageBg', rule: 'LARGE_TEXT' },
    { id: 'button', label: '按钮文字 vs 按钮背景', fg: 'btnText', bg: 'btnBg', rule: 'BUTTON_TEXT' },
    { id: 'component', label: '按钮描边 vs 页面背景', fg: 'btnBorder', bg: 'pageBg', rule: 'UI_COMPONENT' },
    { id: 'focus', label: '焦点指示环 vs 页面背景', fg: 'focusRing', bg: 'pageBg', rule: 'FOCUS_RING' }
  ];

  const SCENARIOS = {
    default: {
      name: '默认场景（全部达标）',
      description: '产品初始推荐色板，五项检查均应通过。',
      colors: {
        pageBg: '#FFFFFF', panelBg: '#F4F6F8', bodyText: '#1F2328', largeText: '#767676',
        btnBg: '#0B5CAD', btnText: '#FFFFFF', btnBorder: '#0B5CAD', focusRing: '#0B5CAD'
      },
      expected: [
        { id: 'body', pass: true }, { id: 'large', pass: true }, { id: 'button', pass: true },
        { id: 'component', pass: true }, { id: 'focus', pass: true }
      ]
    },
    boundary: {
      name: '边界场景（临界值，含 1 项不达标）',
      description: '对比度贴近 4.5:1 / 3:1 阈值：正文与描边勉强达标，焦点环略低于 3:1。',
      colors: {
        pageBg: '#FFFFFF', panelBg: '#FFFFFF', bodyText: '#767676', largeText: '#949494',
        btnBg: '#595959', btnText: '#FFFFFF', btnBorder: '#949494', focusRing: '#959595'
      },
      expected: [
        { id: 'body', pass: true, ratioMin: 4.5, ratioMax: 4.6 },
        { id: 'large', pass: true, ratioMin: 3.0, ratioMax: 3.1 },
        { id: 'button', pass: true },
        { id: 'component', pass: true, ratioMin: 3.0, ratioMax: 3.1 },
        { id: 'focus', pass: false, ratioMin: 2.85, ratioMax: 3.0 }
      ]
    },
    error: {
      name: '错误场景（多项不达标）',
      description: '浅灰文字与浅蓝按钮组合，五项检查全部失败，用于验证错误标记与恢复流程。',
      colors: {
        pageBg: '#FFFFFF', panelBg: '#FFFFFF', bodyText: '#D0D0D0', largeText: '#B0B0B0',
        btnBg: '#9EC7F2', btnText: '#FFFFFF', btnBorder: '#C4D6EE', focusRing: '#BFD4F0'
      },
      expected: [
        { id: 'body', pass: false }, { id: 'large', pass: false }, { id: 'button', pass: false },
        { id: 'component', pass: false }, { id: 'focus', pass: false }
      ]
    }
  };

  function cloneColors(colors) {
    return JSON.parse(JSON.stringify(colors));
  }

  function evaluate(colors) {
    return CHECKS.map(function (check) {
      const rule = window.Contrast.WCAG[check.rule];
      const ratio = window.Contrast.contrastRatio(colors[check.fg], colors[check.bg]);
      const pass = ratio !== null && ratio + 1e-9 >= rule.min;
      return {
        id: check.id,
        label: check.label,
        fgKey: check.fg,
        bgKey: check.bg,
        fg: colors[check.fg],
        bg: colors[check.bg],
        ratio: ratio,
        min: rule.min,
        rule: rule.rule,
        pass: pass
      };
    });
  }

  function mix(hexRgb, targetRgb, amount) {
    return {
      r: hexRgb.r + (targetRgb.r - hexRgb.r) * amount,
      g: hexRgb.g + (targetRgb.g - hexRgb.g) * amount,
      b: hexRgb.b + (targetRgb.b - hexRgb.b) * amount
    };
  }

  /* 对不达标检查项，逐步把前景色推向黑或白，直到达标或迭代上限。 */
  function repairColors(colors) {
    const next = cloneColors(colors);
    const repairedKeys = [];
    evaluate(next).forEach(function (result) {
      if (result.pass) {
        return;
      }
      const key = result.fgKey;
      const bgRgb = window.Contrast.hexToRgb(next[result.bgKey]);
      const bgLum = window.Contrast.relativeLuminance(bgRgb);
      const target = bgLum > 0.18 ? { r: 0, g: 0, b: 0 } : { r: 255, g: 255, b: 255 };
      let current = window.Contrast.hexToRgb(next[key]);
      let attempts = 0;
      while (attempts < 240) {
        current = mix(current, target, 0.08);
        const candidate = window.Contrast.rgbToHex(current.r, current.g, current.b);
        next[key] = candidate;
        const ratio = window.Contrast.contrastRatio(candidate, next[result.bgKey]);
        attempts += 1;
        if (ratio !== null && ratio >= result.min) {
          repairedKeys.push(key);
          break;
        }
      }
    });
    return { colors: next, repairedKeys: repairedKeys };
  }

  window.Palettes = {
    KEYS: KEYS,
    CHECKS: CHECKS,
    SCENARIOS: SCENARIOS,
    cloneColors: cloneColors,
    evaluate: evaluate,
    repairColors: repairColors
  };
})();
