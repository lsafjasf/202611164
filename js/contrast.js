/*
 * WCAG 2.1 对比度计算，纯本地实现，不依赖任何外部检查库。
 * 参考公式：https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
 */
(function () {
  'use strict';

  function clamp8(value) {
    return Math.max(0, Math.min(255, Math.round(value)));
  }

  function hexToRgb(hex) {
    let text = String(hex || '').trim().replace(/^#/, '');
    if (text.length === 3) {
      text = text.split('').map(function (ch) { return ch + ch; }).join('');
    }
    if (!/^[0-9a-fA-F]{6}$/.test(text)) {
      return null;
    }
    return {
      r: parseInt(text.slice(0, 2), 16),
      g: parseInt(text.slice(2, 4), 16),
      b: parseInt(text.slice(4, 6), 16)
    };
  }

  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(function (v) {
      return clamp8(v).toString(16).padStart(2, '0');
    }).join('').toUpperCase();
  }

  function isValidHex(hex) {
    return hexToRgb(hex) !== null;
  }

  function channelLuminance(channel) {
    const srgb = channel / 255;
    return srgb <= 0.03928
      ? srgb / 12.92
      : Math.pow((srgb + 0.055) / 1.055, 2.4);
  }

  function relativeLuminance(rgb) {
    return 0.2126 * channelLuminance(rgb.r)
      + 0.7152 * channelLuminance(rgb.g)
      + 0.0722 * channelLuminance(rgb.b);
  }

  function contrastRatio(hexA, hexB) {
    const a = hexToRgb(hexA);
    const b = hexToRgb(hexB);
    if (!a || !b) {
      return null;
    }
    const la = relativeLuminance(a);
    const lb = relativeLuminance(b);
    const lighter = Math.max(la, lb);
    const darker = Math.min(la, lb);
    return (lighter + 0.05) / (darker + 0.05);
  }

  function formatRatio(ratio) {
    if (ratio === null || ratio === undefined || Number.isNaN(ratio)) {
      return '无效';
    }
    return ratio.toFixed(2) + ':1';
  }

  const WCAG = {
    BODY_TEXT: { id: 'body', label: '正文文本', min: 4.5, rule: 'WCAG 2.1 AA 正文文本 4.5:1' },
    LARGE_TEXT: { id: 'large', label: '大号文本 (18.66px 粗体 / 24px 及以上)', min: 3, rule: 'WCAG 2.1 AA 大号文本 3:1' },
    BUTTON_TEXT: { id: 'button', label: '按钮文字 / 背景', min: 4.5, rule: 'WCAG 2.1 AA 组件文本 4.5:1' },
    UI_COMPONENT: { id: 'component', label: '按钮描边等非文本组件', min: 3, rule: 'WCAG 2.1 SC 1.4.11 非文本对比 3:1' },
    FOCUS_RING: { id: 'focus', label: '焦点指示器 / 背景', min: 3, rule: 'WCAG 2.1 SC 2.4.7 焦点可见 (3:1 参照 1.4.11)' }
  };

  window.Contrast = {
    hexToRgb: hexToRgb,
    rgbToHex: rgbToHex,
    isValidHex: isValidHex,
    relativeLuminance: relativeLuminance,
    contrastRatio: contrastRatio,
    formatRatio: formatRatio,
    clamp8: clamp8,
    WCAG: WCAG
  };
})();
