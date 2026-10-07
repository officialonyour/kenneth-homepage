import { buildTargets, barSeconds, pickTarget } from './engine.js';

const $ = id => document.getElementById(id);
const ids = ['fileInput','storageState','trackCount','trackList','demoBtn','analyzeBtn','analysisState','bpm','beatsPerBar','offset','tempoAlternatives','tapBtn','markBeatBtn','nudgeBackBtn','nudgeNextBtn','metronome','attempts','successes','misses','resetStatsBtn','modeGrid','modeDescription','nowTitle','roundLabel','stageStatus','count','beatDots','message','submessage','revealBtn','progressBar','randomBtn','replayBtn','pauseBtn','stopBtn','successBtn','missBtn','previewBtn','waveform','waveformEmpty','previewTime','seek','durationLabel','countdown','preRollBars','lengthBars','targetType','rangeStart','rangeEnd','fullRangeBtn','hidePosition','autoHideLyrics','gridSummary','toggleLyricsBtn','editLyricsBtn','lyricsHidden','lyricsView','lyricsEdit','lyricsInput','saveLyricsBtn','markerName','addMarkerBtn','markerList','weakCount','clearWeakBtn','toast'];
const ui = Object.fromEntries(ids.map(id => [id, $(id)]));
const descriptions = {
  random: '선택한 범위에서 마디의 첫 박을 랜덤으로 고릅니다. 한 마디 전부터 듣고, GO에 맞춰 가사를 시작하세요.',
  weak: '막힘으로 표시한 구간을 다시 고릅니다. 성공을 두 번 연속 체크하면 약점 목록에서 빠집니다.',
  loop: '선택한 구간을 세 번 반복합니다. 매번 준비 시간과 미리 듣기를 거친 뒤 같은 지점에서 시작해요.',
  recall: '가사와 시작 위치를 숨깁니다. 한 마디를 듣고 다음 가사를 떠올린 뒤, 필요할 때만 가사를 확인해요.',
  gap: '연습 중간에 한 마디 동안 반주를 끕니다. 멈추지 말고 부르다가 반주가 돌아올 때 박자를 확인해요. 최소 4마디를 골라 주세요.',
  stage: '연습 중 두 마디마다 시선 방향을 바꿉니다. 화면의 짧은 신호를 확인하고 그쪽 관객을 바라보며 이어 불러요.'
};
const DB = 'kenneth_lyric_trainer'; // V1's database and store remain intact.
const SETTINGS = 'kenneth_lyric_trainer_settings_v3';
let db, tracks = [], selected = null, buffer = null, context = null;
let source = null, gain = null, clickNodes = [], session = null, raf = 0, lastPlan = null, lastTrial = null;
let generation = 0, analysisGeneration = 0, activeWorker = null, activeAnalysisCancel = null, mode = 'random', previewOffset = 0, revealed = false;
let waveformPeaks = [], toastTimer, taps = [], loadGeneration = 0, busyImport = false;
let stats = { attempts: 0, successes: 0, misses: 0 };
let writeQueue = Promise.resolve();
const selectedKey = 'kenneth_lyric_trainer_selected_v2';
const fmt = (seconds, decimal = false) => {
  const s = Math.max(0, Number(seconds) || 0);
  return Math.floor(s / 60) + ':' + (decimal ? (s % 60).toFixed(1).padStart(4, '0') : String(Math.floor(s % 60)).padStart(2, '0'));
};
const size = n => (n / 1048576).toFixed(1) + ' MB';
const act = fn => (...args) => Promise.resolve().then(() => fn(...args)).catch(reportError);
function reportError(error) {
  console.error(error);
  toast(error.name === 'QuotaExceededError' ? '브라우저 저장 공간이 부족해요. 사용하지 않는 음원을 삭제해 주세요.' : (error.message || '처리하지 못했어요. 다시 시도해 주세요.'));
}
function toast(text) {
  ui.toast.textContent = text;
  ui.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.remove('show'), 3600);
}
function safeGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
function safeSet(key, value) { try { localStorage.setItem(key, value); } catch { /* IndexedDB still works when localStorage is restricted. */ } }
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('tracks')) request.result.createObjectStore('tracks', { keyPath: 'id', autoIncrement: true });
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => toast('다른 가사연습 탭을 닫고 새로고침해 주세요.');
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}
function storeAction(action, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('tracks', action === 'getAll' ? 'readonly' : 'readwrite');
    const store = tx.objectStore('tracks');
    const request = value === undefined ? store[action]() : store[action](value);
    let result;
    request.onsuccess = () => { result = request.result; };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error || request.error);
    tx.onabort = () => reject(tx.error || new Error('저장을 완료하지 못했습니다.'));
  });
}
async function persist(track = selected) {
  if (!track) return;
  // Clone metadata now; serialized saves keep ratings, analysis and lyrics in order.
  const snapshot = { ...track, markers: structuredClone(track.markers || []), practice: structuredClone(track.practice || []) };
  const next = writeQueue.catch(() => {}).then(() => storeAction('put', snapshot));
  writeQueue = next;
  await next;
}
function prepareTrack(track) {
  track.markers ||= [];
  track.practice ||= [];
  track.lyrics ||= '';
  track.beatsPerBar ||= 4;
  return track;
}
async function refreshTracks() {
  tracks = (await storeAction('getAll')).map(prepareTrack);
  tracks.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  renderTracks();
}
function renderTracks() {
  ui.trackList.replaceChildren();
  ui.trackCount.textContent = tracks.length + '곡';
  if (!tracks.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = '내 곡을 넣고 첫 연습을 시작해 보세요.';
    ui.trackList.append(empty);
  }
  for (const track of tracks) {
    const row = document.createElement('div');
    row.className = 'track' + (selected?.id === track.id ? ' selected' : '');
    const choose = document.createElement('button');
    choose.className = 'track-select';
    choose.setAttribute('aria-label', track.name + ' 선택');
    const icon = document.createElement('span');
    icon.className = 'track-icon';
    icon.textContent = selected?.id === track.id ? '♫' : '♪';
    const copy = document.createElement('span');
    copy.className = 'track-copy';
    const name = document.createElement('span');
    name.className = 'track-name'; name.textContent = track.name;
    const meta = document.createElement('span');
    meta.className = 'track-meta';
    meta.textContent = (track.duration ? fmt(track.duration) + ' · ' : '') + size(track.size) + (track.bpm ? ' · ' + track.bpm + ' BPM' : '');
    copy.append(name, meta); choose.append(icon, copy);
    choose.onclick = act(() => selectTrack(track.id));
    const remove = document.createElement('button');
    remove.className = 'delete-track'; remove.textContent = '×';
    remove.setAttribute('aria-label', track.name + ' 삭제');
    remove.onclick = act(async () => {
      if (!confirm('이 브라우저에서 "' + track.name + '" 음원과 연습 기록을 삭제할까요?')) return;
      await writeQueue.catch(() => {});
      await storeAction('delete', track.id);
      if (selected?.id === track.id) {
        clearPlayback(); cancelAnalysis(); resetTaps(); ++loadGeneration;
        selected = null; buffer = null; lastPlan = null; lastTrial = null; waveformPeaks = [];
        safeSet(selectedKey, '');
        ui.nowTitle.textContent = '음원을 추가해 주세요';
        ui.lyricsInput.value = ''; ui.lyricsView.textContent = ''; hideLyrics();
        ui.markerList.replaceChildren(); ui.weakCount.textContent = '약점 0개';
        ui.analysisState.textContent = '음원을 넣으면 BPM을 자동으로 추정해요.';
        readyStage(); drawWaveform(); updateControls();
      }
      await refreshTracks();
    });
    row.append(choose, remove); ui.trackList.append(row);
  }
}
function getContext() {
  if (!context) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) throw new Error('이 브라우저는 오디오 재생을 지원하지 않아요. 최신 Chrome 또는 Edge를 사용해 주세요.');
    context = new Ctor({ latencyHint: 'interactive' });
    context.onstatechange = () => {
      if (context.state === 'suspended' && session && !session.paused) {
        pauseSession(); toast('오디오가 일시정지됐어요. 재개 버튼을 눌러 주세요.');
      }
    };
  }
  return context;
}
function updateControls() {
  const hasTrack = !!selected, ready = hasTrack && !!buffer && Number(selected.bpm) > 0;
  for (const id of ['bpm','offset','beatsPerBar','tapBtn','nudgeBackBtn','nudgeNextBtn','metronome','markerName','lyricsInput','saveLyricsBtn','toggleLyricsBtn','editLyricsBtn','clearWeakBtn']) ui[id].disabled = !hasTrack;
  ui.analyzeBtn.disabled = !buffer || !!activeWorker;
  ui.previewBtn.disabled = !buffer;
  ui.seek.disabled = !buffer || isPositionHidden();
  ui.markBeatBtn.disabled = !buffer;
  ui.addMarkerBtn.disabled = !ready;
  ui.randomBtn.disabled = !ready || !!activeWorker;
  ui.replayBtn.disabled = !ready || !lastPlan || !!activeWorker;
  ui.revealBtn.disabled = !lastPlan;
  ui.stopBtn.disabled = !session;
  ui.pauseBtn.disabled = !session;
  ui.pauseBtn.textContent = session?.paused ? '▶ 재개' : 'Ⅱ 일시정지';
  const rating = !!lastTrial && !lastTrial.rated && lastTrial.trackId === selected?.id && lastTrial.reachedTarget && (!session || session.type !== 'preview');
  ui.successBtn.disabled = !rating;
  ui.missBtn.disabled = !rating;
}
function readyStage(message = '시작은 어디든, 가사는 자연스럽게.') {
  ui.stageStatus.textContent = selected && buffer ? '첫 박을 확인하고 시작해요' : '준비됐나요?';
  ui.count.textContent = 'READY'; ui.count.className = 'big-count idle';
  ui.message.textContent = message; ui.submessage.textContent = '3초 준비 → 1마디 미리 듣기 → 가사 시작';
  ui.roundLabel.textContent = 'READY TO PRACTICE';
  ui.progressBar.style.width = '0%';
  setBeat(-1);
}
function cancelAnalysis() {
  ++analysisGeneration;
  if (activeWorker) activeWorker.terminate();
  activeWorker = null;
  const cancel = activeAnalysisCancel;
  activeAnalysisCancel = null;
  if (cancel) cancel();
}
async function selectTrack(id) {
  if (id === selected?.id && buffer) return;
  clearPlayback(); cancelAnalysis(); resetTaps();
  const myLoad = ++loadGeneration;
  selected = tracks.find(t => t.id === id);
  if (!selected) return;
  const track = selected;
  buffer = null; lastPlan = null; lastTrial = null; revealed = false; previewOffset = 0; taps = [];
  safeSet(selectedKey, String(id));
  ui.nowTitle.textContent = track.name;
  ui.bpm.value = track.bpm || 96;
  ui.beatsPerBar.value = track.beatsPerBar || 4;
  ui.offset.value = Number(track.offset || 0).toFixed(3);
  ui.rangeStart.value = track.rangeStart || 0;
  ui.rangeEnd.value = track.rangeEnd || track.duration || 0;
  ui.lyricsInput.value = track.lyrics;
  ui.lyricsView.textContent = track.lyrics || '저장된 가사가 없어요. 편집을 눌러 가사를 붙여넣어 주세요.';
  hideLyrics(); renderTracks(); renderMarkers(); readyStage('음원을 준비하고 있어요.'); updateControls();
  ui.analysisState.textContent = '음원 읽는 중…';
  ui.tempoAlternatives.replaceChildren();
  try {
    const decoded = await getContext().decodeAudioData(await track.blob.arrayBuffer());
    if (myLoad !== loadGeneration || selected?.id !== track.id) return;
    buffer = decoded;
    track.duration = decoded.duration;
    if (!(Number(track.rangeEnd) > 0) || track.rangeEnd > track.duration) track.rangeEnd = track.duration;
    ui.rangeEnd.value = Number(track.rangeEnd).toFixed(1);
    ui.seek.max = decoded.duration; ui.seek.value = 0;
    ui.durationLabel.textContent = fmt(decoded.duration);
    waveformPeaks = makePeaks(decoded); drawWaveform(); renderAnalysis(track); updateSummary();
    await persist(track);
    if (myLoad !== loadGeneration) return;
    readyStage(); updateControls();
    if (!track.bpm) await analyzeTrack();
  } catch (error) {
    if (myLoad !== loadGeneration) return;
    buffer = null; ui.analysisState.textContent = '이 음원은 읽지 못했어요. MP3 또는 WAV로 변환해 주세요.';
    readyStage('음원 형식을 확인해 주세요.'); updateControls();
    reportError(error);
  }
}
function makePeaks(audioBuffer) {
  const data = audioBuffer.getChannelData(0), count = 550, chunk = Math.ceil(data.length / count), peaks = [];
  for (let i = 0; i < count; i++) {
    let peak = 0;
    for (let j = i * chunk; j < Math.min(data.length, (i + 1) * chunk); j += 8) peak = Math.max(peak, Math.abs(data[j]));
    peaks.push(peak);
  }
  return peaks;
}
function drawWaveform() {
  const canvas = ui.waveform, c = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
  c.clearRect(0, 0, w, h);
  ui.waveformEmpty.hidden = !!waveformPeaks.length;
  if (!waveformPeaks.length || !buffer) return;
  const max = Math.max(...waveformPeaks, .01), dur = buffer.duration;
  const start = Number(ui.rangeStart.value) / dur * w, end = Number(ui.rangeEnd.value) / dur * w;
  c.fillStyle = '#d7f57107'; c.fillRect(start, 0, end - start, h);
  waveformPeaks.forEach((peak, i) => {
    const x = i / waveformPeaks.length * w, height = Math.max(2, peak / max * h * .72);
    c.fillStyle = x >= start && x <= end ? '#92a47a' : '#454f45';
    c.fillRect(x, (h - height) / 2, Math.max(1, w / waveformPeaks.length - .55), height);
  });
  // Hide session position when the exercise intentionally conceals it.
  if (!isPositionHidden()) {
    const x = previewOffset / dur * w;
    c.strokeStyle = '#d7f571'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.stroke();
  }
  if (selected?.bpm) {
    const b = barSeconds(selected.bpm, selected.beatsPerBar);
    const step = Math.max(1, Math.ceil(dur / b / 70));
    for (let t = Number(selected.offset || 0); t < dur; t += b * step) {
      c.fillStyle = '#c1abe655'; c.fillRect(t / dur * w, 0, 1, 6);
    }
  }
}
function monoForAnalysis(audioBuffer) {
  // Average samples in each resampling window to reduce aliasing and worker memory.
  const targetRate = Math.min(11025, audioBuffer.sampleRate);
  const length = Math.floor(Math.min(audioBuffer.length, audioBuffer.sampleRate * 180) * targetRate / audioBuffer.sampleRate);
  const out = new Float32Array(length), channels = audioBuffer.numberOfChannels;
  const data = Array.from({ length: channels }, (_, i) => audioBuffer.getChannelData(i));
  const ratio = audioBuffer.sampleRate / targetRate;
  for (let i = 0; i < length; i++) {
    const first = Math.floor(i * ratio), end = Math.min(audioBuffer.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = first; j < end; j++) for (let k = 0; k < channels; k++) sum += data[k][j];
    out[i] = sum / Math.max(1, (end - first) * channels);
  }
  return { samples: out, sampleRate: targetRate };
}
async function analyzeTrack() {
  if (!buffer || !selected) return;
  clearPlayback(); cancelAnalysis();
  const track = selected, audioBuffer = buffer, id = analysisGeneration;
  const revision = track.gridRevision || 0;
  ui.analysisState.textContent = '박자를 분석하고 있어요…';
  let worker;
  try {
    worker = new Worker(new URL('./beat-worker.js', import.meta.url), { type: 'module' });
    activeWorker = worker; updateControls();
    const data = monoForAnalysis(audioBuffer);
    const result = await new Promise((resolve, reject) => {
      let settled = false, timeout;
      const complete = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (activeAnalysisCancel === cancel) activeAnalysisCancel = null;
        error ? reject(error) : resolve(value);
      };
      const cancel = () => complete(new Error('분석이 취소됐어요.'));
      activeAnalysisCancel = cancel;
      timeout = setTimeout(() => { worker.terminate(); complete(new Error('분석이 오래 걸려요. BPM과 첫 박을 직접 입력해 주세요.')); }, 45000);
      worker.onmessage = event => complete(event.data.error ? new Error(event.data.error) : null, event.data.result);
      worker.onerror = () => complete(new Error('자동 분석을 실행하지 못했어요. BPM을 직접 입력해 주세요.'));
      try { worker.postMessage({ id, ...data }, [data.samples.buffer]); }
      catch (error) { complete(error); }
    });
    if (id !== analysisGeneration || selected?.id !== track.id || (track.gridRevision || 0) !== revision) return;
    track.bpm = result.bpm; track.offset = result.offset; track.analysis = result; track.manualGrid = false;
    ui.bpm.value = track.bpm; ui.offset.value = Number(track.offset).toFixed(3);
    await persist(track);
    if (id !== analysisGeneration || selected?.id !== track.id || (track.gridRevision || 0) !== revision) return;
    renderAnalysis(track); updateSummary(); renderTracks(); drawWaveform();
  } catch (error) {
    if (id !== analysisGeneration || selected?.id !== track.id) return;
    ui.analysisState.textContent = '자동 추정 실패 · BPM과 첫 박을 직접 입력해 주세요.';
    reportError(error);
  } finally {
    worker?.terminate();
    if (activeWorker === worker) activeWorker = null;
    updateControls();
  }
}
function renderAnalysis(track) {
  if (track.manualGrid) ui.analysisState.textContent = '직접 설정한 박자 · 첫 박을 들어서 확인해 주세요.';
  else if (track.analysis) {
    const confidence = track.analysis.confidence || 0;
    ui.analysisState.textContent = '추정 ' + track.bpm + ' BPM · 분석 일관성 ' + Math.round(confidence * 100) + '% · 첫 박 확인 필요';
  } else if (track.bpm) ui.analysisState.textContent = track.bpm + ' BPM · 저장된 박자';
  else ui.analysisState.textContent = '자동 분석을 준비하고 있어요.';
  ui.tempoAlternatives.replaceChildren();
  for (const candidate of (track.analysis?.candidates || []).slice(0, 3)) {
    const btn = document.createElement('button');
    btn.textContent = candidate.bpm + ' BPM'; btn.title = '이 BPM으로 바꾸기';
    btn.onclick = act(async () => { ui.bpm.value = candidate.bpm; await saveGrid(); });
    ui.tempoAlternatives.append(btn);
  }
}
async function saveGrid() {
  if (!selected) return;
  const bpm = Number(ui.bpm.value), offset = Number(ui.offset.value), beats = Number(ui.beatsPerBar.value);
  if (!Number.isFinite(bpm) || bpm < 40 || bpm > 240) throw new Error('BPM은 40~240 사이로 입력해 주세요.');
  if (!Number.isFinite(offset) || offset < 0 || (buffer && offset >= buffer.duration)) throw new Error('첫 박은 곡 안의 시간으로 입력해 주세요.');
  if (![3,4,6].includes(beats)) throw new Error('한 마디의 박 수를 선택해 주세요.');
  clearPlayback(); cancelAnalysis(); lastPlan = null; lastTrial = null;
  const track = selected;
  Object.assign(track, { bpm, offset, beatsPerBar: beats, manualGrid: true, gridRevision: (track.gridRevision || 0) + 1 });
  resetTaps();
  await persist(track);
  if (selected !== track) return;
  renderAnalysis(track); drawWaveform(); updateSummary(); renderTracks(); readyStage('박자 설정을 저장했어요.'); updateControls();
}
function resetTaps() {
  clearTimeout(tapTempo.timer); tapTempo.timer = null; taps = [];
  ui.tapBtn.textContent = '박자 탭';
}
function tapTempo() {
  const now = performance.now();
  if (taps.length && now - taps[taps.length - 1] > 2200) taps = [];
  taps.push(now); if (taps.length > 9) taps.shift();
  ui.tapBtn.textContent = '탭 ' + taps.length + '번';
  if (taps.length >= 4) {
    const intervals = taps.slice(1).map((t, i) => t - taps[i]).sort((a, b) => a - b);
    const interval = intervals[Math.floor(intervals.length / 2)];
    const bpm = Math.round(60000 / interval * 10) / 10;
    if (bpm >= 40 && bpm <= 240) {
      ui.bpm.value = bpm;
      ui.analysisState.textContent = '탭 추정 ' + bpm + ' BPM · 탭을 마치면 저장돼요.';
      clearTimeout(tapTempo.timer);
      const track = selected;
      tapTempo.timer = setTimeout(() => { if (selected === track) act(saveGrid)(); ui.tapBtn.textContent = '박자 탭'; }, 1600);
    }
  }
}
function currentPosition() {
  if (!session || session.paused) return previewOffset;
  return Math.min(session.end, buffer?.duration || Infinity, session.offset + Math.max(0, context.currentTime - session.when));
}
function setBeat(active) {
  const beats = Number(selected?.beatsPerBar || 4);
  if (ui.beatDots.children.length !== beats) {
    ui.beatDots.replaceChildren(...Array.from({ length: beats }, () => document.createElement('i')));
  }
  [...ui.beatDots.children].forEach((dot, i) => dot.classList.toggle('active', i === active));
}
function clearPlayback() {
  ++generation;
  cancelAnimationFrame(raf); raf = 0;
  if (source) {
    source.onended = null;
    try { source.stop(); } catch { /* Source may already have ended. */ }
    source.disconnect(); source = null;
  }
  if (gain) { gain.disconnect(); gain = null; }
  for (const node of clickNodes) { try { node.stop(); } catch {} node.disconnect(); }
  clickNodes = [];
  session = null;
  ui.previewBtn.textContent = '▶ 음원 듣기'; updatePreviewUI();
  updateControls();
}
function createSource(offset, when, end, s) {
  const ctx = getContext();
  const node = ctx.createBufferSource(), volume = ctx.createGain();
  node.buffer = buffer; node.connect(volume); volume.connect(ctx.destination);
  source = node; gain = volume;
  volume.gain.setValueAtTime(1, ctx.currentTime);
  const gapStart = s.gapStart, gapEnd = s.gapEnd;
  if (s.mode === 'gap' && Number.isFinite(gapStart)) {
    const absolute = pos => when + pos - offset;
    if (offset >= gapStart && offset < gapEnd) volume.gain.setValueAtTime(0, when);
    if (gapStart > offset) {
      volume.gain.setValueAtTime(1, Math.max(when, absolute(gapStart) - .008));
      volume.gain.linearRampToValueAtTime(0, absolute(gapStart));
    }
    if (gapEnd > offset) {
      volume.gain.setValueAtTime(0, Math.max(when, absolute(gapEnd) - .008));
      volume.gain.linearRampToValueAtTime(1, absolute(gapEnd));
    }
  }
  const my = generation;
  node.onended = () => {
    if (my !== generation || session !== s || s.paused) return;
    finishSession(s);
  };
  node.start(when, offset, Math.max(.001, end - offset));
  scheduleClicks(s, offset, when, end);
}
function scheduleClicks(s, offset, when, end) {
  if (!ui.metronome.checked || !selected?.bpm) return;
  const ctx = getContext(), beat = 60 / selected.bpm, origin = Number(selected.offset || 0);
  const firstIndex = Math.max(0, Math.ceil((offset - origin) / beat - 1e-6));
  let count = 0;
  for (let i = firstIndex; origin + i * beat < end && count < 1600; i++, count++) {
    const position = origin + i * beat;
    // The silent-bar exercise really is silent; no metronome is played in the gap.
    if (s.mode === 'gap' && position >= s.gapStart && position < s.gapEnd) continue;
    const at = when + position - offset;
    const oscillator = ctx.createOscillator(), envelope = ctx.createGain();
    oscillator.frequency.value = i % selected.beatsPerBar === 0 ? 1350 : 950;
    envelope.gain.setValueAtTime(0, at);
    envelope.gain.linearRampToValueAtTime(.10, at + .002);
    envelope.gain.exponentialRampToValueAtTime(.001, at + .045);
    oscillator.connect(envelope); envelope.connect(ctx.destination);
    oscillator.onended = () => envelope.disconnect();
    oscillator.start(at); oscillator.stop(at + .05);
    clickNodes.push(oscillator);
  }
}
async function startPreview(position = previewOffset) {
  if (!buffer) return;
  clearPlayback(); hidePositionInfo();
  const my = generation, trackId = selected?.id;
  const ctx = getContext(); await ctx.resume();
  if (my !== generation || !buffer || selected?.id !== trackId) return;
  const offset = Math.max(0, Math.min(buffer.duration - .02, Number(position) || 0));
  const s = { type: 'preview', offset, when: ctx.currentTime + .035, end: buffer.duration, paused: false, mode: 'preview' };
  session = s; previewOffset = offset;
  createSource(offset, s.when, s.end, s);
  ui.previewBtn.textContent = '■ 음원 멈추기';
  ui.stageStatus.textContent = '음원 확인 중'; ui.count.textContent = 'LISTEN'; ui.count.className = 'big-count idle';
  ui.message.textContent = '마디의 첫 박을 찾아 주세요.'; ui.submessage.textContent = '정확한 첫 박에서 [듣는 지점을 첫 박으로]를 눌러요.';
  updateControls(); frame();
}
function stopPlayback() {
  if (session) previewOffset = currentPosition();
  clearPlayback(); ui.previewBtn.textContent = '▶ 음원 듣기';
  readyStage('잠시 멈췄어요.'); updateControls(); updatePreviewUI(); drawWaveform();
}
function isPositionHidden() {
  return session?.type === 'training' && (ui.hidePosition.checked || session.mode === 'recall') && !revealed;
}
function updatePreviewUI() {
  const hidden = isPositionHidden();
  ui.previewTime.textContent = hidden ? '••:••' : fmt(previewOffset, true);
  ui.seek.style.visibility = hidden ? 'hidden' : '';
  ui.seek.disabled = !buffer || hidden;
  if (!hidden) ui.seek.value = previewOffset;
}
function hidePositionInfo() {
  revealed = false;
  ui.revealBtn.classList.remove('revealed');
  ui.revealBtn.textContent = '시작 위치 숨김 · 눌러서 확인';
}
function revealPosition() {
  if (!lastPlan) return;
  revealed = true; ui.revealBtn.classList.add('revealed');
  ui.revealBtn.textContent = '가사 시작 ' + fmt(lastPlan.target, true) + ' · 재생 ' + fmt(lastPlan.start, true) + (lastPlan.label ? ' · ' + lastPlan.label : '');
  updatePreviewUI(); drawWaveform();
}
function trainingPlans() {
  if (!selected || !buffer) return [];
  const plans = buildTargets({
    duration: buffer.duration, bpm: selected.bpm, beatsPerBar: selected.beatsPerBar,
    offset: selected.offset || 0, rangeStart: Number(ui.rangeStart.value), rangeEnd: Number(ui.rangeEnd.value),
    lengthBars: Number(ui.lengthBars.value), preRollBars: Number(ui.preRollBars.value)
  });
  if (ui.targetType.value === 'markers') {
    const b = barSeconds(selected.bpm, selected.beatsPerBar);
    return plans.filter(p => selected.markers.some(m => Math.abs(m.target - p.target) < b * .08)).map(p => ({ ...p, label: selected.markers.find(m => Math.abs(m.target - p.target) < b * .08)?.name }));
  }
  return plans;
}
function activeWeaknesses() { return (selected?.practice || []).filter(p => p.misses > 0 && (p.streak || 0) < 2); }
function eligibleWeakPlans(plans) {
  const weak = activeWeaknesses(), b = barSeconds(selected.bpm, selected.beatsPerBar);
  return plans.filter(plan => weak.some(p => Math.abs(p.target - plan.target) <= b / 2));
}
async function startTraining(replay = false, forcePlan = null, round = 1, frozen = null) {
  if (!selected || !buffer || !selected.bpm) return;
  const plans = trainingPlans();
  if (!plans.length) throw new Error(ui.targetType.value === 'markers' ? '이 범위에서 재생 가능한 저장 구간이 없어요. 구간을 저장하거나 시작 기준을 모든 마디로 바꿔 주세요.' : '연습 범위가 짧아요. 범위를 넓히거나 연습 길이·미리 듣기를 줄여 주세요.');
  const requestedMode = frozen?.mode || mode;
  if (requestedMode === 'gap' && Number(ui.lengthBars.value) < 4) throw new Error('반주 공백은 연습 길이 4마디 이상에서 시작할 수 있어요.');
  let candidates = requestedMode === 'weak' ? eligibleWeakPlans(plans) : plans;
  if (!candidates.length && requestedMode === 'weak') throw new Error('현재 범위에는 약점 구간이 없어요. 랜덤 연습에서 막힘을 체크하면 이곳에서 복습할 수 있어요.');
  let plan = forcePlan || (replay ? lastPlan : pickTarget(candidates, { lastTarget: lastPlan?.target }));
  if (!plan) throw new Error('먼저 연습 구간을 골라 주세요.');
  // Revalidate stored plans after ranges or calibration change.
  plan = plans.find(p => Math.abs(p.target - plan.target) < .015) || (forcePlan && frozen ? forcePlan : null);
  if (!plan || plan.end > buffer.duration || plan.start < 0) throw new Error('이 구간은 현재 설정에 맞지 않아요. 새 연습을 시작해 주세요.');
  const trackId = selected.id;
  clearPlayback();
  const my = generation, ctx = getContext();
  await ctx.resume();
  if (my !== generation || selected?.id !== trackId) return;
  const bar = barSeconds(selected.bpm, selected.beatsPerBar), delay = Number(ui.countdown.value);
  lastPlan = { ...plan }; hidePositionInfo();
  if (!ui.hidePosition.checked && requestedMode !== 'recall') revealPosition();
  if (ui.autoHideLyrics.checked || requestedMode === 'recall' || requestedMode === 'stage') hideLyrics();
  const when = ctx.currentTime + (delay > 0 ? delay : .035);
  const s = {
    type: 'training', mode: requestedMode, plan, offset: plan.start, when, end: plan.end, bar,
    paused: false, round, trackId, totalRounds: requestedMode === 'loop' ? 3 : 1,
    gapStart: plan.target + bar * Math.floor(Number(ui.lengthBars.value) / 2),
    gapEnd: plan.target + bar * (Math.floor(Number(ui.lengthBars.value) / 2) + 1),
    started: false, targetSeen: false, lastBeat: -1
  };
  lastTrial = { trackId, target: plan.target, rated: false, reachedTarget: false };
  session = s; previewOffset = plan.start; updatePreviewUI(); drawWaveform();
  createSource(plan.start, when, plan.end, s);
  ui.previewBtn.textContent = '▶ 음원 듣기';
  ui.roundLabel.textContent = requestedMode === 'loop' ? round + ' / 3 REPEATS' : 'ON YOUR BEAT';
  ui.stageStatus.textContent = delay > 0 ? '준비 시간' : '미리 듣기';
  ui.count.className = 'big-count'; ui.count.textContent = delay > 0 ? String(delay) : '1';
  ui.message.textContent = delay > 0 ? '숨 고르고, 귀를 열어요.' : '한 마디 듣고 들어가요.';
  ui.submessage.textContent = Number(ui.preRollBars.value) + '마디 미리 듣기 후 GO에 맞춰 가사 시작';
  ui.progressBar.style.width = '0%'; updateControls(); frame();
}
function frame() {
  if (!session || session.paused || !context) return;
  const s = session, remaining = s.when - context.currentTime;
  if (remaining > 0) {
    if (s.type === 'training') {
      ui.count.textContent = String(Math.max(1, Math.ceil(remaining)));
      ui.stageStatus.textContent = '준비 시간'; setBeat(-1);
    }
  } else {
    const position = currentPosition();
    previewOffset = position; updatePreviewUI();
    if (s.type === 'training') {
      if (!s.started) { s.started = true; stats.attempts++; saveStats(); }
      const beatSeconds = 60 / selected.bpm;
      const index = Math.floor((position - selected.offset + .015) / beatSeconds);
      setBeat(((index % selected.beatsPerBar) + selected.beatsPerBar) % selected.beatsPerBar);
      if (position < s.plan.target - .005) {
        const left = Math.max(1, Math.ceil((s.plan.target - position - .01) / beatSeconds));
        ui.stageStatus.textContent = '미리 듣기 · 박자 잡기';
        ui.count.className = 'big-count'; ui.count.textContent = String(left);
        ui.message.textContent = '다음 첫 박부터 가사를 시작해요.';
      } else {
        if (!s.targetSeen) {
          s.targetSeen = true; lastTrial.reachedTarget = true; updateControls();
        }
        const elapsed = position - s.plan.target;
        ui.stageStatus.textContent = '가사 연습 중';
        if (s.mode === 'gap' && position >= s.gapStart && position < s.gapEnd) {
          ui.count.className = 'big-count cue'; ui.count.textContent = '계속';
          ui.message.textContent = '반주 없이도 박자를 유지해요.';
          ui.submessage.textContent = '한 마디 뒤에 반주가 돌아와요. 멈추지 말고 이어 불러요.';
        } else if (s.mode === 'stage' && elapsed > s.bar * .5) {
          const cues = ['정면','왼쪽','오른쪽','멀리'];
          const cue = Math.floor(elapsed / (s.bar * 2)) % cues.length;
          ui.count.className = 'big-count cue'; ui.count.textContent = cues[cue];
          ui.message.textContent = '그쪽 관객을 보며 이어 불러요.';
          ui.submessage.textContent = '눈은 관객에게, 박자는 몸에 남겨두세요.';
        } else {
          ui.count.className = 'big-count'; ui.count.textContent = elapsed < beatSeconds ? 'GO' : String(Math.floor(elapsed / s.bar) + 1);
          ui.message.textContent = s.mode === 'gap' && position >= s.gapEnd ? '반주가 돌아왔어요. 박자가 맞나요?' : '기억한 가사를 자연스럽게 이어가요.';
          ui.submessage.textContent = s.mode === 'recall' ? '막혔을 때만 가사 노트를 열어 확인해요.' : '흐름이 끊겨도 박자를 놓치지 말고 다음 가사로.';
        }
      }
      const percent = Math.min(100, Math.max(0, (position - s.plan.start) / (s.plan.end - s.plan.start) * 100));
      ui.progressBar.style.width = percent + '%';
    } else if (selected?.bpm) {
      const index = Math.floor((position - selected.offset) / (60 / selected.bpm));
      setBeat(((index % selected.beatsPerBar) + selected.beatsPerBar) % selected.beatsPerBar);
    }
    drawWaveform();
  }
  raf = requestAnimationFrame(frame);
}
function finishSession(s) {
  if (s.type === 'training' && !s.targetSeen) {
    // Background tabs can skip UI frames; the audio still reached its scheduled end.
    s.targetSeen = true;
    if (lastTrial?.trackId === s.trackId) lastTrial.reachedTarget = true;
    if (!s.started) { stats.attempts++; saveStats(); }
  }
  previewOffset = s.end;
  clearPlayback(); ui.previewBtn.textContent = '▶ 음원 듣기'; updatePreviewUI(); drawWaveform();
  if (s.type === 'preview') { readyStage('음원 확인을 마쳤어요.'); return; }
  if (s.mode === 'loop' && s.round < s.totalRounds && selected?.id === s.trackId) {
    // Each repetition gets the same audible pre-roll and selected countdown.
    act(() => startTraining(true, s.plan, s.round + 1, s))();
    return;
  }
  ui.count.textContent = 'DONE'; ui.count.className = 'big-count idle';
  ui.stageStatus.textContent = '구간 완료'; ui.message.textContent = '이번 구간, 잘 이어졌나요?';
  ui.submessage.textContent = '성공 또는 막힘을 체크하세요. 막힌 구간은 약점 복습에 모아둘게요.';
  ui.progressBar.style.width = '100%'; setBeat(-1); updateControls();
}
function pauseSession() {
  if (!session) return;
  if (session.paused) { act(resumeSession)(); return; }
  const s = session;
  s.remainingDelay = Math.max(0, s.when - context.currentTime);
  previewOffset = currentPosition();
  ++generation;
  if (source) { source.onended = null; try { source.stop(); } catch {} source.disconnect(); source = null; }
  if (gain) { gain.disconnect(); gain = null; }
  for (const node of clickNodes) { try { node.stop(); } catch {} node.disconnect(); } clickNodes = [];
  cancelAnimationFrame(raf); s.paused = true; s.offset = previewOffset;
  ui.stageStatus.textContent = '일시정지'; ui.pauseBtn.textContent = '▶ 재개'; updateControls();
}
async function resumeSession() {
  const s = session;
  if (!s?.paused || !buffer) return;
  const my = generation; await getContext().resume();
  if (my !== generation || session !== s) return;
  if (s.offset >= s.end - .01) { finishSession(s); return; }
  s.paused = false; s.when = context.currentTime + (s.remainingDelay > 0 ? s.remainingDelay : .035); s.remainingDelay = 0;
  createSource(s.offset, s.when, s.end, s);
  ui.pauseBtn.textContent = 'Ⅱ 일시정지'; updateControls(); frame();
}
async function rateTrial(success) {
  if (!selected || !lastTrial || lastTrial.rated || !lastTrial.reachedTarget || lastTrial.trackId !== selected.id) return;
  lastTrial.rated = true; updateControls();
  const target = lastTrial.target, b = barSeconds(selected.bpm, selected.beatsPerBar);
  let row = selected.practice.find(p => Math.abs(p.target - target) < Math.min(.08, b / 10));
  if (!row) { row = { target, misses: 0, successes: 0, streak: 0 }; selected.practice.push(row); }
  if (success) { row.successes++; row.streak = (row.streak || 0) + 1; stats.successes++; }
  else { row.misses++; row.streak = 0; stats.misses++; }
  row.updatedAt = Date.now(); saveStats();
  await persist(); renderMarkers();
  toast(success ? (row.misses > 0 && row.streak >= 2 ? '두 번 연속 성공! 약점 복습에서 졸업했어요.' : '성공으로 기록했어요.') : '약점 구간으로 저장했어요. 같은 구간을 다시 연습해 보세요.');
}
function hideLyrics() {
  ui.lyricsHidden.hidden = false; ui.lyricsView.hidden = true; ui.lyricsEdit.hidden = true;
  ui.toggleLyricsBtn.textContent = '가사 보기';
}
function showLyrics() {
  if (!selected) return;
  if (!ui.lyricsView.hidden) { hideLyrics(); return; }
  ui.lyricsView.textContent = selected.lyrics || '저장된 가사가 없어요. 편집을 눌러 붙여넣어 주세요.';
  ui.lyricsHidden.hidden = true; ui.lyricsEdit.hidden = true; ui.lyricsView.hidden = false;
  ui.toggleLyricsBtn.textContent = '가사 숨기기';
}
function editLyrics() {
  if (!selected) return;
  ui.lyricsInput.value = selected.lyrics;
  ui.lyricsHidden.hidden = true; ui.lyricsView.hidden = true; ui.lyricsEdit.hidden = false; ui.lyricsInput.focus();
}
async function saveLyrics() {
  if (!selected) return;
  selected.lyrics = ui.lyricsInput.value;
  await persist(); ui.lyricsView.textContent = selected.lyrics;
  ui.lyricsEdit.hidden = true; ui.lyricsView.hidden = false; ui.lyricsHidden.hidden = true;
  ui.toggleLyricsBtn.textContent = '가사 숨기기'; toast('가사를 저장했어요.');
}
function snapTarget(position) {
  if (!selected?.bpm) return null;
  const bar = barSeconds(selected.bpm, selected.beatsPerBar), origin = Number(selected.offset || 0);
  const index = Math.max(0, Math.round((position - origin) / bar));
  return origin + index * bar;
}
async function addMarker() {
  if (!selected || !buffer) return;
  const target = snapTarget(currentPosition()), name = ui.markerName.value.trim() || '연습 구간 ' + (selected.markers.length + 1);
  if (target >= buffer.duration) throw new Error('곡 안의 위치를 선택해 주세요.');
  const existing = selected.markers.find(m => Math.abs(m.target - target) < .04);
  if (existing) existing.name = name; else selected.markers.push({ name, target, id: Date.now() + '-' + Math.random().toString(36).slice(2, 7) });
  await persist(); ui.markerName.value = ''; renderMarkers();
  toast(fmt(target, true) + ' · 가장 가까운 마디의 첫 박에 저장했어요.');
}
function renderMarkers() {
  ui.markerList.replaceChildren();
  const weak = activeWeaknesses(); ui.weakCount.textContent = '약점 ' + weak.length + '개';
  const rows = [
    ...(selected?.markers || []).map(m => ({ ...m, kind: 'marker' })),
    ...weak.filter(p => !(selected?.markers || []).some(m => Math.abs(m.target - p.target) < .04)).map(p => ({ ...p, name: '약점 구간', id: String(p.target), kind: 'weak' }))
  ].sort((a, b) => a.target - b.target);
  if (!rows.length) {
    const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = '저장한 구간과 막힘 기록이 여기에 표시돼요.'; ui.markerList.append(empty);
  }
  for (const row of rows) {
    const wrap = document.createElement('div'); wrap.className = 'marker-item';
    const play = document.createElement('button'); play.className = 'marker-main';
    const time = document.createElement('span'); time.textContent = fmt(row.target, true);
    play.append(time, document.createTextNode(row.name));
    play.title = '이 구간 연습';
    play.onclick = act(() => {
      const target = snapTarget(row.target), plans = trainingPlans();
      const plan = plans.find(p => Math.abs(p.target - target) < .04);
      if (!plan) throw new Error('이 구간은 현재 범위·길이 설정에서 재생할 수 없어요. 전체 곡 또는 짧은 길이를 선택해 주세요.');
      return startTraining(false, { ...plan, label: row.name });
    });
    const weakness = weak.find(p => Math.abs(p.target - row.target) < .04);
    if (weakness) { const badge = document.createElement('small'); badge.textContent = '막힘 ' + weakness.misses; wrap.append(badge); }
    const remove = document.createElement('button'); remove.textContent = '×'; remove.setAttribute('aria-label', row.name + ' 삭제');
    remove.onclick = act(async () => {
      if (!selected) return;
      if (row.kind === 'marker') selected.markers = selected.markers.filter(m => m.id !== row.id);
      else selected.practice = selected.practice.filter(p => Math.abs(p.target - row.target) >= .04);
      await persist(); renderMarkers();
    });
    wrap.prepend(play); wrap.append(remove); ui.markerList.append(wrap);
  }
}
function setMode(next) {
  clearPlayback(); readyStage(); mode = next;
  ui.modeGrid.querySelectorAll('.mode').forEach(button => {
    const active = button.dataset.mode === next; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
  });
  ui.modeDescription.textContent = descriptions[next]; ui.randomBtn.innerHTML = '<span>▶</span> ' + (next === 'weak' ? '약점 복습 시작' : next === 'loop' ? '3회 반복 시작' : '연습 시작') + ' <kbd>N</kbd>';
  if (next === 'recall' || next === 'stage') hideLyrics();
  updateControls(); saveSettings();
}
function saveSettings() {
  const value = { mode };
  for (const id of ['countdown','preRollBars','lengthBars','targetType']) value[id] = ui[id].value;
  for (const id of ['hidePosition','autoHideLyrics','metronome']) value[id] = ui[id].checked;
  safeSet(SETTINGS, JSON.stringify(value));
}
function loadSettings() {
  try {
    const data = JSON.parse(safeGet(SETTINGS) || '{}');
    for (const id of ['countdown','preRollBars','lengthBars','targetType']) if ([...ui[id].options].some(o => o.value === String(data[id]))) ui[id].value = data[id];
    for (const id of ['hidePosition','autoHideLyrics','metronome']) if (typeof data[id] === 'boolean') ui[id].checked = data[id];
    if (descriptions[data.mode]) mode = data.mode;
  } catch { /* Use defaults for malformed settings. */ }
}
async function saveRange() {
  clearPlayback(); lastPlan = null; lastTrial = null;
  if (selected && buffer) {
    const start = Number(ui.rangeStart.value), end = Number(ui.rangeEnd.value);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > buffer.duration + .1 || start >= end) throw new Error('범위는 0초부터 곡 끝 사이에서, 시작보다 끝이 크게 입력해 주세요.');
    selected.rangeStart = start; selected.rangeEnd = Math.min(end, buffer.duration); await persist();
  }
  readyStage(); updateSummary(); updateControls(); drawWaveform();
}
function updateSummary() {
  if (!selected?.bpm || !buffer) { ui.gridSummary.textContent = '기본 설정: 3초 준비 → 1마디 미리 듣기 → 4마디 연습'; return; }
  const bar = barSeconds(selected.bpm, selected.beatsPerBar), count = trainingPlans().length;
  ui.gridSummary.textContent = '1마디 ' + bar.toFixed(2) + '초 · ' + ui.countdown.value + '초 준비 → ' + (Number(ui.preRollBars.value) * bar).toFixed(2) + '초 미리 듣기 → ' + (Number(ui.lengthBars.value) * bar).toFixed(2) + '초 연습 · 시작점 ' + count + '개';
}
function dayKey() {
  const now = new Date();
  return 'kenneth_practice_stats_' + now.getFullYear() + '-' + (now.getMonth() + 1) + '-' + now.getDate();
}
function saveStats() {
  safeSet(dayKey(), JSON.stringify(stats));
  for (const key of ['attempts','successes','misses']) ui[key].textContent = stats[key];
}
function loadStats() {
  try {
    const saved = JSON.parse(safeGet(dayKey()) || '{}');
    for (const key of ['attempts','successes','misses']) stats[key] = Math.max(0, Number(saved[key]) || 0);
  } catch {}
  saveStats();
}
async function importFiles(files) {
  if (busyImport) return;
  busyImport = true; ui.fileInput.disabled = true; ui.storageState.textContent = '음원 저장 중…';
  let added = 0, firstId;
  try {
    for (const file of [...files]) {
      if (!(file.type.startsWith('audio/') || /\.(mp3|wav|m4a|ogg|flac|aac)$/i.test(file.name))) continue;
      if (file.size > 150 * 1048576) { toast(file.name + '은 150MB를 넘어요. 압축한 음원을 사용해 주세요.'); continue; }
      const id = await storeAction('add', { name: file.name, type: file.type, size: file.size, blob: file, lyrics: '', updatedAt: Date.now(), markers: [], practice: [] });
      firstId ??= id; added++;
    }
    await refreshTracks();
    if (firstId) await selectTrack(firstId);
    if (added) toast(added + '곡을 저장했어요. 추정 박자와 첫 박을 확인해 주세요.');
  } finally {
    busyImport = false; ui.fileInput.disabled = false; ui.fileInput.value = ''; ui.storageState.textContent = '이 브라우저에 저장';
  }
}
function makeDemoFile() {
  const rate = 22050, seconds = 65, samples = new Float32Array(rate * seconds);
  const bpm = 96, beat = 60 / bpm, offset = 1.25;
  for (let t = offset, i = 0; t < seconds - 2; t += beat, i++) {
    const start = Math.round(t * rate);
    for (let j = 0; j < rate * .18 && start + j < samples.length; j++) {
      const x = j / rate;
      samples[start + j] += Math.sin(2 * Math.PI * (68 * x - 22 * x * x)) * Math.exp(-x * 32) * (i % 4 === 0 ? .6 : .38);
      samples[start + j] += Math.sin(2 * Math.PI * 1100 * x) * Math.exp(-x * 140) * .09;
    }
    const freq = [130.81,155.56,174.61,155.56][Math.floor(i / 4) % 4];
    for (let j = 0; j < rate * beat * .72 && start + j < samples.length; j++) {
      const x = j / rate, fade = Math.min(1, x * 50) * Math.exp(-x * 7);
      samples[start + j] += (Math.sin(2 * Math.PI * freq * x) + .25 * Math.sin(2 * Math.PI * freq * 2 * x)) * fade * .18;
    }
  }
  const raw = new ArrayBuffer(44 + samples.length * 2), view = new DataView(raw);
  const text = (at, s) => [...s].forEach((v, i) => view.setUint8(at + i, v.charCodeAt(0)));
  text(0,'RIFF'); view.setUint32(4,36 + samples.length * 2,true); text(8,'WAVE'); text(12,'fmt ');
  view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,1,true); view.setUint32(24,rate,true); view.setUint32(28,rate * 2,true); view.setUint16(32,2,true); view.setUint16(34,16,true); text(36,'data'); view.setUint32(40,samples.length * 2,true);
  for (let i = 0; i < samples.length; i++) view.setInt16(44 + i * 2, Math.max(-1,Math.min(1,samples[i])) * 32767, true);
  return new File([raw], '데모 반주 · 96 BPM.wav', { type: 'audio/wav' });
}
async function loadDemo() {
  if (busyImport) return;
  const existing = tracks.find(t => t.demo);
  if (existing) { await selectTrack(existing.id); return; }
  ui.demoBtn.disabled = true;
  try {
    const file = makeDemoFile();
    const id = await storeAction('add', { name: file.name, type: file.type, size: file.size, blob: file, bpm:96, offset:1.25, beatsPerBar:4, demo:true, manualGrid:true, markers:[],practice:[],lyrics:'[데모 연습 안내]\n이 반주는 박자와 재생 동작을 확인하는 샘플이에요.\n\nGO가 뜨면 아는 가사를 4마디 이어 불러 보세요.\n원하는 곡의 음원을 넣으면 내 가사로 연습할 수 있어요.',updatedAt:Date.now() });
    await refreshTracks(); await selectTrack(id); toast('96 BPM 데모예요. 첫 박은 1.250초로 맞춰 두었어요.');
  } finally { ui.demoBtn.disabled = false; }
}

ui.fileInput.onchange = act(() => importFiles(ui.fileInput.files));
ui.demoBtn.onclick = act(loadDemo);
ui.analyzeBtn.onclick = act(analyzeTrack);
for (const id of ['bpm','offset','beatsPerBar']) ui[id].onchange = act(saveGrid);
ui.tapBtn.onclick = tapTempo;
ui.markBeatBtn.onclick = act(async () => { ui.offset.value = currentPosition().toFixed(3); await saveGrid(); toast('이 지점을 기준 마디의 첫 박으로 저장했어요.'); });
for (const [id, delta] of [['nudgeBackBtn',-.01],['nudgeNextBtn',.01]]) ui[id].onclick = act(async () => { ui.offset.value = Math.max(0, Number(ui.offset.value) + delta).toFixed(3); await saveGrid(); });
ui.modeGrid.querySelectorAll('.mode').forEach(button => button.onclick = () => setMode(button.dataset.mode));
ui.randomBtn.onclick = act(() => startTraining());
ui.replayBtn.onclick = act(() => startTraining(true));
ui.pauseBtn.onclick = pauseSession; ui.stopBtn.onclick = stopPlayback; ui.revealBtn.onclick = revealPosition;
ui.previewBtn.onclick = act(() => session?.type === 'preview' ? stopPlayback() : startPreview());
ui.seek.oninput = act(async () => {
  const position = Number(ui.seek.value), playingPreview = session?.type === 'preview' && !session.paused;
  if (session?.type === 'training') { clearPlayback(); readyStage(); }
  previewOffset = position; updatePreviewUI(); drawWaveform();
  if (playingPreview) await startPreview(position);
});
ui.waveform.onclick = act(async event => {
  if (!buffer) return;
  const rect = ui.waveform.getBoundingClientRect(), position = Math.max(0,Math.min(buffer.duration - .02,(event.clientX - rect.left) / rect.width * buffer.duration));
  const playingPreview = session?.type === 'preview' && !session.paused;
  if (session) { clearPlayback(); readyStage(); }
  previewOffset = position; updatePreviewUI(); drawWaveform();
  if (playingPreview) await startPreview(position);
});
ui.successBtn.onclick = act(() => rateTrial(true)); ui.missBtn.onclick = act(() => rateTrial(false));
ui.toggleLyricsBtn.onclick = showLyrics; ui.editLyricsBtn.onclick = editLyrics; ui.saveLyricsBtn.onclick = act(saveLyrics);
ui.addMarkerBtn.onclick = act(addMarker);
ui.clearWeakBtn.onclick = act(async () => {
  if (!selected || !confirm('이 곡의 약점·성공 기록을 초기화할까요? 저장한 구간과 가사는 유지돼요.')) return;
  selected.practice = []; await persist(); renderMarkers(); toast('약점 기록을 초기화했어요.');
});
ui.resetStatsBtn.onclick = () => {
  if (!confirm('오늘의 시도·성공·막힘 집계를 초기화할까요? 곡별 약점 기록은 유지돼요.')) return;
  stats = {attempts:0,successes:0,misses:0}; saveStats();
};
for (const id of ['countdown','preRollBars','lengthBars','targetType']) ui[id].onchange = () => {
  clearPlayback(); lastPlan = null; lastTrial = null; readyStage(); saveSettings(); updateSummary(); updateControls();
};
for (const id of ['hidePosition','autoHideLyrics','metronome']) ui[id].onchange = () => {
  // A changed click setting is applied to the next play; existing scheduled clicks are canceled.
  if (id === 'metronome' && session) stopPlayback();
  if (id === 'hidePosition') { hidePositionInfo(); if (!ui.hidePosition.checked && mode !== 'recall') revealPosition(); updatePreviewUI(); drawWaveform(); }
  saveSettings();
};
ui.rangeStart.onchange = act(saveRange); ui.rangeEnd.onchange = act(saveRange);
ui.fullRangeBtn.onclick = act(async () => { if (!buffer) return; ui.rangeStart.value=0; ui.rangeEnd.value=buffer.duration.toFixed(1); await saveRange(); });
document.addEventListener('keydown', event => {
  if (event.ctrlKey || event.metaKey || event.altKey || event.repeat || ['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)) return;
  if (document.activeElement?.tagName === 'BUTTON' && ['Space','Enter'].includes(event.code)) return;
  const actions = { KeyN: () => !ui.randomBtn.disabled && act(() => startTraining())(), KeyR: () => !ui.replayBtn.disabled && act(() => startTraining(true))(), KeyL: showLyrics, KeyP: revealPosition, Digit1: () => !ui.successBtn.disabled && act(() => rateTrial(true))(), Digit2: () => !ui.missBtn.disabled && act(() => rateTrial(false))(), Space: pauseSession };
  if (actions[event.code]) { event.preventDefault(); actions[event.code](); }
});
window.addEventListener('pagehide', () => { clearPlayback(); cancelAnalysis(); resetTaps(); });
(async () => {
  try {
    loadSettings(); loadStats();
    db = await openDB(); await refreshTracks();
    setMode(mode);
    const id = Number(safeGet(selectedKey)), first = tracks.find(t => t.id === id) || tracks[0];
    if (first) await selectTrack(first.id);
    else { renderMarkers(); updateControls(); }
  } catch (error) {
    ui.storageState.textContent = '브라우저 저장소 오류';
    ui.message.textContent = '브라우저 저장소를 열지 못했어요.';
    ui.submessage.textContent = '일반 브라우저 탭에서 열고, 사이트 저장 권한을 확인해 주세요.';
    ui.fileInput.disabled = true; ui.demoBtn.disabled = true; reportError(error);
  }
})();
