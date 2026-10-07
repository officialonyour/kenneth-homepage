/**
 * Three short preparation knocks, synchronized with a performance.now deadline.
 * Call unlock() directly inside the user's click handler, then await its result
 * before start(). Call cancel() on pause/stop and before starting the song.
 * The helper never schedules a click at GO or any beat during the song.
 */
export class PreparationClicks {
  constructor({ AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext, now = () => performance.now(), onError = null } = {}) {
    this.AudioContextClass = AudioContextClass;
    this.now = now;
    this.onError = onError;
    this.context = null;
    this.lastError = null;
    this.nodes = new Set();
    this.generation = 0;
  }

  fail(error) {
    this.lastError = error instanceof Error ? error : new Error(String(error));
    try { this.onError?.(this.lastError); } catch { /* Error reporting must not reject unlock/release. */ }
    return false;
  }

  unlock() {
    const token = this.generation;
    let context;
    try {
      if (!this.context || this.context.state === 'closed') {
        if (typeof this.AudioContextClass !== 'function') throw new Error('준비 박자 소리를 지원하지 않는 브라우저예요.');
        this.context = new this.AudioContextClass();
      }
      context = this.context;
      // Keep resume() in this synchronous call, inside the user's activation.
      const resumed = context.resume();
      return Promise.resolve(resumed).then(() => {
        if (token !== this.generation || context !== this.context) return false;
        if (context.state !== 'running') return this.fail(new Error('준비 박자 소리를 켜지 못했어요. 다시 시작을 눌러 주세요.'));
        this.lastError = null;
        return true;
      }).catch(error => token === this.generation && context === this.context ? this.fail(error) : false);
    } catch (error) {
      return Promise.resolve(this.fail(error));
    }
  }

  start({ remainingMs, deadline } = {}) {
    this.cancel();
    const timestamp = Number(this.now());
    if (!Number.isFinite(timestamp)) throw new RangeError('준비 시간 기준값이 올바르지 않아요.');
    if (remainingMs !== undefined && (!Number.isFinite(remainingMs) || remainingMs < 0 || remainingMs > 3000)) {
      throw new RangeError('남은 준비 시간은 0~3000ms여야 해요.');
    }
    const end = deadline === undefined ? timestamp + Number(remainingMs) : Number(deadline);
    if (!Number.isFinite(end)) throw new RangeError('준비 종료 시간이 올바르지 않아요.');
    const remaining = Math.max(0, end - timestamp);
    if (remaining > 3000) throw new RangeError('준비 시간은 최대 3초예요.');
    if (!remaining) return end;
    const context = this.context;
    if (!context || context.state !== 'running') {
      const error = new Error('준비 박자 소리를 켜지 못했어요. 다시 시작을 눌러 주세요.');
      this.fail(error);
      throw error;
    }
    const base = context.currentTime;
    const count = Math.ceil(remaining / 1000);
    const nextBoundary = count > 1 ? (remaining - (count - 1) * 1000) / 1000 : Infinity;
    try {
      // On resume, a fleeting label immediately before an integer boundary
      // should not produce two overlapping knocks. Keep its upcoming boundary
      // click instead; a normal full-second label still clicks immediately.
      if (nextBoundary >= 0.04) this.click(base);
      for (let number = count - 1; number >= 1; number -= 1) {
        this.click(base + (remaining - number * 1000) / 1000);
      }
    } catch (error) {
      this.cancel(); this.fail(error);
      throw error;
    }
    return end;
  }

  click(when) {
    const context = this.context;
    let oscillator, filter, gain, entry;
    try {
      oscillator = context.createOscillator();
      filter = context.createBiquadFilter();
      gain = context.createGain();
      entry = { oscillator, filter, gain };
      this.nodes.add(entry);
      // A short pitched transient remains audible on small phone speakers.
      oscillator.type = 'triangle';
      oscillator.frequency.setValueAtTime(1800, when);
      oscillator.frequency.exponentialRampToValueAtTime(700, when + 0.022);
      filter.type = 'highpass';
      filter.frequency.setValueAtTime(700, when);
      filter.Q.setValueAtTime(0.7, when);
      gain.gain.setValueAtTime(0, when);
      gain.gain.linearRampToValueAtTime(0.35, when + 0.001);
      gain.gain.exponentialRampToValueAtTime(0.001, when + 0.027);
      gain.gain.linearRampToValueAtTime(0, when + 0.035);
      oscillator.connect(filter); filter.connect(gain); gain.connect(context.destination);
      oscillator.onended = () => this.dispose(entry);
      oscillator.start(when);
      oscillator.stop(when + 0.036);
    } catch (error) {
      if (entry) this.stop(entry);
      else for (const node of [oscillator, filter, gain]) { try { node?.disconnect(); } catch { /* Partially built graph. */ } }
      throw error;
    }
  }

  dispose(entry) {
    this.nodes.delete(entry);
    entry.oscillator.onended = null;
    for (const node of [entry.oscillator, entry.filter, entry.gain]) {
      try { node.disconnect(); } catch { /* Already disconnected. */ }
    }
  }

  stop(entry) {
    entry.oscillator.onended = null;
    try { entry.oscillator.stop(); } catch { /* It may have ended or failed to start. */ }
    this.dispose(entry);
  }

  cancel() {
    this.generation += 1;
    for (const entry of Array.from(this.nodes)) this.stop(entry);
  }

  release() {
    this.cancel();
    const context = this.context;
    this.context = null;
    if (!context || context.state === 'closed') return Promise.resolve(true);
    try { return Promise.resolve(context.close()).then(() => true).catch(error => this.fail(error)); }
    catch (error) { return Promise.resolve(this.fail(error)); }
  }
}
