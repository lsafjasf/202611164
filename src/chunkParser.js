/* 增量(分块)JSON 解析器:时间片推进,可暂停/恢复/取消。 */
(function (global) {
  'use strict';

  function isDigit(ch) {
    return ch >= '0' && ch <= '9';
  }

  class ChunkParser {
    constructor(text, options) {
      this.text = text;
      this.length = text.length;
      this.pos = 0;
      this.stack = [];
      this.rootSet = false;
      this.root = undefined;
      this.done = false;
      this.error = null;
      this.onElement = (options && options.onElement) || null;
      this._token = null;
    }

    _fail(message) {
      const err = new SyntaxError(
        'JSON 解析失败 @字符 ' + this.pos + ': ' + message
      );
      err.position = this.pos;
      throw err;
    }

    currentPath() {
      let path = 'root';
      for (const frame of this.stack) {
        if (frame.type === 'array') {
          path += '[' + frame.value.length + ']';
        } else if (frame.pendingKey != null) {
          path += '.' + frame.pendingKey;
        }
      }
      return path;
    }

    _attach(value) {
      if (this.stack.length === 0) {
        if (this.rootSet) this._fail('根级存在多个值');
        this.root = value;
        this.rootSet = true;
        return;
      }
      const top = this.stack[this.stack.length - 1];
      if (top.type === 'array') {
        const index = top.value.length;
        top.value.push(value);
        if (this.onElement) this.onElement(top, value, index);
      } else {
        top.value[top.pendingKey] = value;
        top.pendingKey = null;
      }
    }
    _parseString() {
      const text = this.text;
      const n = this.length;
      let i = this.pos + 1;
      let out = '';
      while (i < n) {
        const ch = text[i];
        if (ch === '"') {
          this.pos = i + 1;
          return out;
        }
        if (ch === '\\') {
          if (i + 1 >= n) this._fail('转义序列不完整');
          const esc = text[i + 1];
          switch (esc) {
            case '"': out += '"'; i += 2; break;
            case '\\': out += '\\'; i += 2; break;
            case '/': out += '/'; i += 2; break;
            case 'b': out += '\b'; i += 2; break;
            case 'f': out += '\f'; i += 2; break;
            case 'n': out += '\n'; i += 2; break;
            case 'r': out += '\r'; i += 2; break;
            case 't': out += '\t'; i += 2; break;
            case 'u': {
              if (i + 5 >= n) this._fail('\\u 转义不完整');
              const hex = text.slice(i + 2, i + 6);
              if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
                this._fail('非法 \\u 转义: ' + hex);
              }
              out += String.fromCharCode(parseInt(hex, 16));
              i += 6;
              break;
            }
            default:
              this._fail('非法转义字符: \\' + esc);
          }
        } else if (ch < ' ') {
          this._fail('字符串中含未转义控制字符');
        } else {
          out += ch;
          i += 1;
        }
      }
      this._fail('字符串未闭合(文件可能被截断)');
      return null;
    }

    _parseNumber() {
      const text = this.text;
      const n = this.length;
      let i = this.pos;
      const start = i;
      if (text[i] === '-') i += 1;
      if (i >= n) this._fail('数字不完整');
      if (text[i] === '0') {
        i += 1;
      } else if (isDigit(text[i])) {
        while (i < n && isDigit(text[i])) i += 1;
      } else {
        this._fail('非法数字');
      }
      if (text[i] === '.') {
        i += 1;
        if (i >= n || !isDigit(text[i])) this._fail('小数点后缺少数字');
        while (i < n && isDigit(text[i])) i += 1;
      }
      if (text[i] === 'e' || text[i] === 'E') {
        i += 1;
        if (text[i] === '+' || text[i] === '-') i += 1;
        if (i >= n || !isDigit(text[i])) this._fail('指数部分缺少数字');
        while (i < n && isDigit(text[i])) i += 1;
      }
      const raw = text.slice(start, i);
      this.pos = i;
      return Number(raw);
    }

    _expectLiteral(word, value) {
      if (this.text.startsWith(word, this.pos)) {
        this.pos += word.length;
        return value;
      }
      this._fail('非法字面量,期望 ' + word);
      return undefined;
    }
    _parseValue() {
      const ch = this.text[this.pos];
      if (ch === '{') {
        this.pos += 1;
        this.stack.push({ type: 'object', value: {}, pendingKey: null });
        return;
      }
      if (ch === '[') {
        this.pos += 1;
        this.stack.push({ type: 'array', value: [] });
        return;
      }
      if (ch === '"') {
        this._attach(this._parseString());
        return;
      }
      if (ch === 't') { this._attach(this._expectLiteral('true', true)); return; }
      if (ch === 'f') { this._attach(this._expectLiteral('false', false)); return; }
      if (ch === 'n') { this._attach(this._expectLiteral('null', null)); return; }
      if (ch === '-' || isDigit(ch)) {
        this._attach(this._parseNumber());
        return;
      }
      this._fail('非法字符: ' + JSON.stringify(ch));
    }

    _closeContainer() {
      const frame = this.stack.pop();
      this._attach(frame.value);
    }

    step(budgetMs) {
      const deadline = Date.now() + budgetMs;
      const text = this.text;
      const n = this.length;
      try {
        for (;;) {
          while (this.pos < n) {
            const c = text[this.pos];
            if (c === ' ' || c === '\t' || c === '\n' || c === '\r') this.pos += 1;
            else break;
          }
          if (this.pos >= n) {
            if (this.stack.length > 0) {
              this._fail('JSON 未闭合(可能被截断),剩余 ' +
                this.stack.length + ' 层容器');
            }
            if (!this.rootSet) this._fail('空输入');
            this.done = true;
            return { done: true, progress: 1 };
          }
          const top = this.stack[this.stack.length - 1];
          if (!top) {
            this._parseValue();
          } else if (top.type === 'object') {
            if (top.pendingKey == null) {
              const c = text[this.pos];
              if (c === '}') {
                this.pos += 1;
                this._closeContainer();
              } else if (c === '"') {
                top.pendingKey = this._parseString();
                let p = this.pos;
                while (p < n && ' \t\n\r'.indexOf(text[p]) >= 0) p += 1;
                if (text[p] !== ':') this._fail('对象键后期望冒号');
                this.pos = p + 1;
              } else if (c === ',' && Object.keys(top.value).length > 0) {
                this.pos += 1;
              } else {
                this._fail('对象内非法字符: ' + JSON.stringify(c));
              }
            } else {
              this._parseValue();
            }
          } else {
            const c = text[this.pos];
            if (c === ']') {
              this.pos += 1;
              this._closeContainer();
            } else if (c === ',' && top.value.length > 0) {
              this.pos += 1;
            } else {
              this._parseValue();
            }
          }
          if (Date.now() >= deadline) {
            return { done: false, progress: this.pos / n };
          }
        }
      } catch (err) {
        this.error = err;
        throw err;
      }
    }
  }

  const api = { ChunkParser };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.ChunkJson = api;
})(typeof window !== 'undefined' ? window : globalThis);
