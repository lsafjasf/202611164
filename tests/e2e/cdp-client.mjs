/* 极简 Chrome DevTools Protocol 客户端，仅依赖 Node 内置模块。 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

export function startChrome(chromePath, profileDir) {
  fs.rmSync(profileDir, { recursive: true, force: true });
  fs.mkdirSync(profileDir, { recursive: true });
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--user-data-dir=' + profileDir,
    '--remote-debugging-port=0'
  ];
  const proc = spawn(chromePath, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Chrome 启动超时')), 15000);
    let port = null;
    const discover = async () => {
      try {
        const info = await httpJson('http://127.0.0.1:' + port + '/json/version');
        clearTimeout(timer);
        resolve({ proc, browserWsUrl: info.webSocketDebuggerUrl });
        return true;
      } catch {
        return false;
      }
    };
    proc.stderr.on('data', (chunk) => {
      const match = chunk.toString().match(/DevTools listening on ws:\/\/[^\s]*?:(\d+)\//);
      if (match && !port) {
        port = Number(match[1]);
        const tick = async () => {
          if (await discover()) { return; }
          setTimeout(tick, 200);
        };
        tick();
      }
    });
    proc.on('exit', (code) => reject(new Error('Chrome 提前退出 code=' + code)));
  });
}

export function httpJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve(JSON.parse(body)));
    }).on('error', reject);
  });
}

export class CdpSession {
  constructor(ws, sessionId) {
    this.ws = ws;
    this.sessionId = sessionId || null;
    this.nextId = 1;
    this.pending = new Map();
    this.exceptions = [];
    this.consoleMessages = [];
  }

  attachMessageHandler() {
    this.ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.sessionId && msg.sessionId !== this.sessionId) {
        return;
      }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve: r, reject: j } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) { j(new Error(msg.error.message)); } else { r(msg.result); }
      } else if (msg.method === 'Runtime.exceptionThrown') {
        const detail = msg.params.exceptionDetails;
        this.exceptions.push(detail.exception
          ? (detail.exception.description || JSON.stringify(detail.exception.value))
          : detail.text);
      } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        this.consoleMessages.push(msg.params.args.map((a) => a.value || a.description || '').join(' '));
      }
    });
  }

  connect() {
    return new Promise((resolve, reject) => {
      if (this.ws.readyState === WebSocket.OPEN) { resolve(); return; }
      this.ws.addEventListener('open', () => resolve(), { once: true });
      this.ws.addEventListener('error', (e) => reject(e.error || new Error('ws error')), { once: true });
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const payload = { id, method, params };
      if (this.sessionId) { payload.sessionId = this.sessionId; }
      this.ws.send(JSON.stringify(payload));
    });
  }

  async evaluate(expression, awaitPromise = true) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise,
      userGesture: true
    });
    if (result.exceptionDetails) {
      const detail = result.exceptionDetails.exception
        ? JSON.stringify(result.exceptionDetails.exception.value || result.exceptionDetails.exception.description)
        : result.exceptionDetails.text;
      throw new Error('页面异常: ' + detail);
    }
    return result.result.value;
  }

  async click(cssSelector) {
    const box = await this.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(cssSelector)});
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`);
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
  }

  async tap(cssSelector) {
    const box = await this.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(cssSelector)});
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`);
    await this.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: box.x, y: box.y }]
    });
    await this.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }

  async typeText(cssSelector, text) {
    await this.click(cssSelector);
    await this.send('Input.dispatchKeyEvent', {
      type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2
    });
    await this.send('Input.dispatchKeyEvent', {
      type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2
    });
    await this.setInputValue(cssSelector, text);
  }

  async setInputValue(cssSelector, text) {
    await this.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(cssSelector)});
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, ${JSON.stringify(text)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
  }

  async setRawInputValue(cssSelector, text) {
    await this.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(cssSelector)});
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, ${JSON.stringify(text)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
  }

  async pressKey(key) {
    const map = {
      Escape: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 },
      Enter: { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 },
      Tab: { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }
    };
    const def = map[key] || { key, code: key };
    await this.send('Input.dispatchKeyEvent', Object.assign({ type: 'keyDown' }, def));
    await this.send('Input.dispatchKeyEvent', Object.assign({ type: 'keyUp' }, def));
  }

  async reload() {
    await this.send('Page.reload', { ignoreCache: true });
    await this.send('Runtime.enable');
    await this.waitForFunction('window.App && document.querySelectorAll("#result-tbody tr").length === 5');
  }

  waitForFunction(expression, timeoutMs = 8000) {
    const deadline = Date.now() + timeoutMs;
    return new Promise((resolve, reject) => {
      const poll = async () => {
        const value = await this.evaluate(expression).catch(() => false);
        if (value) { return resolve(value); }
        if (Date.now() > deadline) { return reject(new Error('waitForFunction 超时: ' + expression)); }
        setTimeout(poll, 150);
      };
      poll();
    });
  }

}

export async function newPageSession(chromeInfo) {
  const ws = new WebSocket(chromeInfo.browserWsUrl);
  const browser = new CdpSession(ws, null);
  browser.attachMessageHandler();
  await browser.connect();
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
  const page = new CdpSession(ws, sessionId);
  page.attachMessageHandler();
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.send('Log.enable');
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  page.close = () => ws.close();
  return { page, browser };
}

export function staticServer(rootDir, port = 0) {
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.png': 'image/png'
  };
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent(req.url.split('?')[0]);
      const filePath = path.join(rootDir, urlPath === '/' ? 'index.html' : urlPath);
      if (!filePath.startsWith(rootDir)) {
        res.writeHead(403); res.end(); return;
      }
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); res.end('not found'); return; }
        res.writeHead(200, { 'Content-Type': types[path.extname(filePath)] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.listen(port, '127.0.0.1', () => resolve({
      url: 'http://127.0.0.1:' + server.address().port + '/',
      stop: () => new Promise((r) => server.close(r))
    }));
  });
}
