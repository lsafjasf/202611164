/*
 * Web Audio 雾笛合成：低频基频 + 五度谐波，包络避免爆音。
 * 同时通过 AnalyserNode 实时测频（自相关），频率数值由程序现场计算，
 * 不直接读取案件参数，保证线索来自真实声音。
 */
(function (root) {
  'use strict';

  function Foghorn() {
    this.ctx = null;
    this.analyser = null;
    this.buf = null;
    this.onMeasured = null;
  }

  Foghorn.prototype.ensure = function () {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    var AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();

    var master = this.ctx.createGain();
    master.gain.value = 0.45;

    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.buf = new Float32Array(this.analyser.fftSize);

    master.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
    this.master = master;
  };

  Foghorn.prototype.now = function () {
    return this.ctx ? this.ctx.currentTime : 0;
  };

  // 在音频时钟 when（秒）处触发一次雾笛，时长 0.9s，返回实际发声时间。
  Foghorn.prototype.blare = function (when, freq) {
    this.ensure();
    var ctx = this.ctx;
    var osc = ctx.createOscillator();
    var fifth = ctx.createOscillator();
    var gain = ctx.createGain();
    var gain2 = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.value = freq;
    fifth.type = 'triangle';
    fifth.frequency.value = freq * 1.5;
    gain2.gain.value = 0.25;

    var dur = 0.9;
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(0.9, when + 0.08);
    gain.gain.setValueAtTime(0.9, when + dur - 0.18);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + dur);

    osc.connect(gain);
    fifth.connect(gain2);
    gain2.connect(gain);
    gain.connect(this.master);

    osc.start(when);
    fifth.start(when);
    osc.stop(when + dur + 0.05);
    fifth.stop(when + dur + 0.05);
    return when;
  };

  // 基频测量：阈值法找首个有效滞后，再在相关峰附近做抛物线插值。
  // 雾笛含五度谐波，普通自相关会误锁次谐波，因此用动态阈值锁定基频峰。
  Foghorn.prototype.measure = function () {
    if (!this.analyser) return null;
    this.analyser.getFloatTimeDomainData(this.buf);
    var data = this.buf;
    var n = data.length;
    var energy = 0;
    for (var i = 0; i < n; i++) energy += data[i] * data[i];
    if (energy / n < 0.01) return null;

    var sampleRate = this.ctx.sampleRate;
    // 过零法：雾笛以正弦基频为主（五度谐波仅 0.25 增益），
    // 线性插值定位每个正向过零点，取过零间隔中位数估计周期。
    var crossings = [];
    for (var i = 1; i < n; i++) {
      if (data[i - 1] <= 0 && data[i] > 0) {
        var frac = -data[i - 1] / (data[i] - data[i - 1]);
        crossings.push((i - 1) + frac);
      }
    }
    if (crossings.length < 2) return null;
    var periods = [];
    for (var k = 1; k < crossings.length; k++) {
      periods.push(crossings[k] - crossings[k - 1]);
    }
    periods.sort(function (a, b) { return a - b; });
    var median = periods[Math.floor(periods.length / 2)];
    var hz = sampleRate / median;
    if (hz < 45 || hz > 480) return null;
    if (this.onMeasured) this.onMeasured(Math.round(hz));
    return Math.round(hz);
  };

  Foghorn.prototype.suspend = function () {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend();
  };

  Foghorn.prototype.resume = function () {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  };

  root.LHFoghorn = Foghorn;
})(window);
