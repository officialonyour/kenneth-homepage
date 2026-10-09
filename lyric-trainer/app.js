import { buildTargets, barSeconds, pickTarget, shuffleCycle } from './engine.js?v=6-full-shuffle';
import { PreparationClicks } from './preparation-clicks.js';

const ids = ['servicePanel','serviceTitle','serviceMessage','reloadBtn','loginPanel','loginForm','password','loginBtn','loginMessage','workspace','logoutBtn','trackCount','groupSelect','groupStatus','groupManager','groupForm','groupEditSelect','groupName','groupTrackList','saveGroupBtn','deleteGroupBtn','groupMessage','trackSelect','libraryStatus','trackMeta','fileInfo','deleteBtn','uploadLabel','fileInput','uploadLimit','uploadPanel','uploadName','uploadPercent','uploadProgress','uploadMessage','retryUploadBtn','retryTracksBtn','legacyDetails','legacyMessage','legacyBtn','nowTitle','cloudState','stageStatus','count','beatDots','stageMessage','stageDetail','seek','currentTime','startInfo','totalTime','randomBtn','fullRandomBtn','fullRandomNote','pauseBtn','stopBtn','autoRandom','autoRandomNote','playbackMessage','beatSettings','gridBadge','gridNote','gridForm','bpm','offset','previewBtn','markBeatBtn','saveGridBtn','player','toast'];
const ui = Object.fromEntries(ids.map(id => [id, document.getElementById(id)]));
const audio = ui.player;
const API = '/api/lyric-trainer';
const SELECTED_KEY = 'kenneth_lyric_trainer_cloud_selected_v3';
const GROUP_KEY = 'kenneth_lyric_trainer_group_v4';
const AUTO_RANDOM_KEY = 'kenneth_lyric_trainer_auto_random_v5';
// Only the zero-valued same-origin WAV is played to prime this media element.
// Song audio stays muted and paused until the complete countdown has finished.
const SILENT_PRIME_URL = new URL('/lyric-trainer/silent-prime.wav?v=5-media-repeat', location.origin).href;
audio.muted = true;
const preparationClicks = new PreparationClicks();
let groups = [], selectedGroupId = '', editingGroupId = '', groupsLoading = false, groupSaving = false;
const groupCheckboxes = new Map();
const lastSuccessfulSongs = new Map();
const MAX_ANALYSIS_BYTES = 8 * 1048576;
let tracks = [], selected = null, session = null, generation = 0, countdownTimer = 0, frame = 0, toastTimer = 0;
let autoRandomEnabled = false, autoNextTimer = 0;
let playbackMode = 'training', fullShuffle = null;
const pendingMediaWaits = new Set();
try { autoRandomEnabled = localStorage.getItem(AUTO_RANDOM_KEY) === '1'; } catch { /* Optional device preference. */ }
let authGeneration = 0, maxUploadBytes = 80 * 1048576, uploadGeneration = 0, uploading = false, uploadQueue = [], uploadXHR = null;
let analysisGeneration = 0, analysisWorker = null, analysisContext = null, analysisCancel = null, legacyTracks = null;
const lastTargets = new Map();
const gridRevisions = new Map();
const localFiles = new Map();
const metadataWrites = new Map();
const fmt = seconds => {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  return Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0');
};
const size = bytes => (Number(bytes) / 1048576).toFixed(1) + ' MB';
const now = () => performance.now();
const duration = () => currentResource() && Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : Number(selected?.duration) || 0;
function remember(id) { try { localStorage.setItem(SELECTED_KEY, id || ''); } catch { /* Restricted storage is optional. */ } }
function remembered() { try { return localStorage.getItem(SELECTED_KEY); } catch { return null; } }
function toast(message) {
  ui.toast.textContent = message;
  ui.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.remove('show'), 4200);
}
function report(error) {
  if (error?.name !== 'AbortError') toast(error?.message || '처리하지 못했어요. 다시 시도해 주세요.');
}
function abortError() { return new DOMException('작업을 취소했습니다.', 'AbortError'); }
async function api(path, { method = 'GET', body } = {}) {
  const requestAuth = authGeneration;
  const response = await fetch(API + path, { method, credentials: 'same-origin', cache: 'no-store', ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  let data;
  try { data = await response.json(); } catch { throw new Error('연습실 응답을 읽지 못했어요. 잠시 후 다시 시도해 주세요.'); }
  if (!response.ok || data.ok === false) {
    if (response.status === 401 && requestAuth === authGeneration) showLogin('로그인이 만료됐어요. 다시 로그인해 주세요.');
    const error = new Error(data.error || '요청을 완료하지 못했어요.');
    error.status = response.status;
    throw error;
  }
  return data;
}
function trackURL(track) {
  const url = new URL(track.audioUrl || API + '/audio/' + encodeURIComponent(track.id), location.origin);
  if (url.origin !== location.origin || !url.pathname.startsWith(API + '/audio/')) throw new Error('음원 주소를 확인해 주세요.');
  return url.href;
}
function cancelAnalysis() {
  analysisGeneration += 1;
  analysisWorker?.terminate(); analysisWorker = null;
  analysisCancel?.(); analysisCancel = null;
  if (analysisContext) analysisContext.close().catch(() => {});
  analysisContext = null;
}
function clearClock() {
  preparationClicks.cancel();
  clearTimeout(countdownTimer); countdownTimer = 0;
  clearTimeout(autoNextTimer); autoNextTimer = 0;
  for (const cancel of [...pendingMediaWaits]) cancel();
  cancelAnimationFrame(frame); frame = 0;
}
function mediaState(value) {
  try { if (navigator.mediaSession) navigator.mediaSession.playbackState = value; } catch { /* Optional browser integration. */ }
}
function renderAutoRandom() {
  ui.autoRandom.checked = autoRandomEnabled;
  ui.autoRandomNote.textContent = autoRandomEnabled ? '곡이 끝나면 같은 그룹에서 새 곡·마디를 고르고 3·2·1부터 이어져요.' : '곡이 끝나면 DONE에서 기다려요.';
}
function changeAutoRandom() {
  autoRandomEnabled = ui.autoRandom.checked;
  try { localStorage.setItem(AUTO_RANDOM_KEY, autoRandomEnabled ? '1' : '0'); } catch { /* Optional device preference. */ }
  if (!autoRandomEnabled && autoNextTimer && playbackMode !== 'full') { clearTimeout(autoNextTimer); autoNextTimer = 0; mediaState('paused'); }
  renderAutoRandom(); renderTransport();
}
function setStage(status, count, message, detail, idle = false) {
  if (ui.stageStatus.textContent !== status) ui.stageStatus.textContent = status;
  if (ui.count.textContent !== count) ui.count.textContent = count;
  if (ui.count.classList.contains('idle') !== idle) ui.count.classList.toggle('idle', idle);
  if (ui.stageMessage.textContent !== message) ui.stageMessage.textContent = message;
  if (ui.stageDetail.textContent !== detail) ui.stageDetail.textContent = detail;
}
function resetStage() {
  const full = playbackMode === 'full';
  setStage('준비됐나요?', 'READY', availableGroupTracks().length ? full ? '그룹의 음원을 처음부터 끝까지 들어요.' : '그룹에서 곡과 마디를 랜덤으로 골라요.' : '음원을 추가하거나 그룹에 곡을 넣어 주세요.', full ? '모든 곡을 한 번씩 듣고, 다시 섞어 계속 이어져요.' : '딱, 딱, 딱 · 3초 준비 → 한 마디 먼저 → 곡 끝까지', true);
  ui.startInfo.textContent = full ? '처음부터 → 곡 끝까지 → 다음 곡' : '3초 준비 → 1마디 먼저 → 곡 끝까지';
  Array.from(ui.beatDots.children).forEach(dot => dot.classList.remove('active'));
}
function stopPlayback({ resetPosition = true, render = true } = {}) {
  generation += 1; clearClock(); session = null; fullShuffle = null;
  audio.muted = true; audio.pause(); audio.loop = false;
  if (selected && audio.src !== trackURL(selected)) { audio.src = trackURL(selected); audio.load(); }
  if (resetPosition) { try { audio.currentTime = 0; } catch { /* Metadata may be loading. */ } }
  mediaState(selected ? 'paused' : 'none');
  if (render) { resetStage(); renderTransport(); renderTime(); }
}
function renderTransport() {
  const available = !!selected, ready = available && duration() > 0;
  const choices = availableGroupTracks(), canRandom = choices.some(eligibleTrack);
  const preparing = session?.phase === 'unlock' || session?.phase === 'starting';
  ui.randomBtn.disabled = !canRandom || groupsLoading || groupSaving || preparing;
  ui.fullRandomBtn.disabled = !choices.length || groupsLoading || groupSaving || preparing;
  ui.fullRandomBtn.classList.toggle('active', playbackMode === 'full');
  ui.fullRandomBtn.setAttribute?.('aria-pressed', String(playbackMode === 'full'));
  ui.fullRandomNote.textContent = !choices.length ? '그룹에 음원을 추가해 주세요.' : choices.length === 1 ? '한 곡을 처음부터 끝까지 반복 재생해요.' : choices.length + '곡을 한 번씩 듣고, 순서를 다시 섞어 계속 재생해요.';
  ui.pauseBtn.disabled = !session && !autoNextTimer;
  ui.stopBtn.disabled = !session && !autoNextTimer;
  const paused = session && ['paused','blocked'].includes(session.phase);
  ui.pauseBtn.textContent = paused ? '▶ 이어 재생' : 'Ⅱ 일시정지';
  ui.seek.disabled = !ready || !!session && ['unlock','countdown','starting'].includes(session.phase);
  for (const name of ['bpm','offset','previewBtn','markBeatBtn','saveGridBtn']) ui[name].disabled = !available;
  ui.deleteBtn.disabled = !available;
}
function renderTime() {
  const total = duration();
  ui.seek.max = String(total || 1);
  ui.seek.value = String(Math.min(total, Math.max(0, audio.currentTime || 0)));
  ui.currentTime.textContent = fmt(audio.currentTime);
  ui.totalTime.textContent = fmt(total);
  if ('mediaSession' in navigator && navigator.mediaSession.setPositionState && total > 0) {
    try { navigator.mediaSession.setPositionState({ duration: total, playbackRate: audio.playbackRate || 1, position: Math.min(total, Math.max(0, audio.currentTime || 0)) }); } catch { /* Older browsers do not support every state. */ }
  }
}
function renderGrid() {
  ui.bpm.value = String(selected?.bpm || 96);
  ui.offset.value = String(selected?.offset || 0);
  ui.gridBadge.textContent = (selected?.bpm || 96) + ' BPM · 4박';
  ui.gridNote.textContent = selected?.bpm ? '저장된 박자예요. 첫 마디 첫 박이 맞는지 들어서 확인해 주세요.' : '96 BPM은 기본값이에요. 곡의 BPM과 초반 첫 마디의 첫 박을 확인해 주세요.';
}
function availableGroupTracks() {
  if (!selectedGroupId) return tracks;
  const membership = new Set(groups.find(group => group.id === selectedGroupId)?.trackIds || []);
  return tracks.filter(track => membership.has(track.id));
}
function eligibleTrack(track) {
  const total = selected === track ? duration() : Number(track.duration) || 0;
  if (!(total > 0)) return true; // Native metadata is loaded after the synchronous gesture unlock.
  try { return buildTargets({ duration: total, bpm: track.bpm || 96, offset: track.offset || 0 }).length > 0; } catch { return false; }
}
function rememberGroup() { try { localStorage.setItem(GROUP_KEY, selectedGroupId); } catch { /* Optional device preference. */ } }
function renderGroupEditor({ preserveDraft = false } = {}) {
  const draftName = ui.groupName.value, draftChecks = new Map([...groupCheckboxes].map(([id,checkbox]) => [id, checkbox.checked]));
  const group = groups.find(item => item.id === editingGroupId);
  ui.groupName.value = preserveDraft ? draftName : group?.name || '';
  ui.deleteGroupBtn.hidden = !group;
  ui.groupTrackList.replaceChildren(); groupCheckboxes.clear();
  const members = new Set(group?.trackIds || []);
  for (const track of tracks) {
    const label = document.createElement('label'), checkbox = document.createElement('input'), name = document.createElement('span');
    checkbox.type = 'checkbox'; checkbox.checked = preserveDraft && draftChecks.has(track.id) ? draftChecks.get(track.id) : members.has(track.id); checkbox.disabled = groupSaving;
    name.textContent = track.name || track.fileName; label.append(checkbox, name); ui.groupTrackList.append(label); groupCheckboxes.set(track.id, checkbox);
  }
  if (!tracks.length) { const empty = document.createElement('p'); empty.className = 'hint'; empty.textContent = '먼저 음원을 추가해 주세요.'; ui.groupTrackList.append(empty); }
  ui.groupName.disabled = groupSaving; ui.groupEditSelect.disabled = groupSaving || groupsLoading;
  ui.saveGroupBtn.disabled = groupSaving || groupsLoading; ui.deleteGroupBtn.disabled = groupSaving;
}
function renderGroups({ editor = true } = {}) {
  if (selectedGroupId && !groups.some(group => group.id === selectedGroupId)) { selectedGroupId = ''; rememberGroup(); }
  if (editingGroupId && !groups.some(group => group.id === editingGroupId)) editingGroupId = '';
  ui.groupSelect.replaceChildren(); ui.groupEditSelect.replaceChildren();
  for (const [select, name] of [[ui.groupSelect, '전체 음원'], [ui.groupEditSelect, '새 그룹 만들기']]) { const option = document.createElement('option'); option.value = ''; option.textContent = name; select.append(option); }
  for (const group of groups) {
    const option = document.createElement('option'); option.value = group.id; option.textContent = group.name + ' · ' + group.trackIds.length + '곡'; ui.groupSelect.append(option);
    const editOption = document.createElement('option'); editOption.value = group.id; editOption.textContent = group.name; ui.groupEditSelect.append(editOption);
  }
  ui.groupSelect.value = selectedGroupId; ui.groupSelect.disabled = groupsLoading; ui.groupEditSelect.value = editingGroupId;
  const choices = availableGroupTracks(), usable = choices.filter(eligibleTrack).length;
  ui.randomBtn.innerHTML = '<span>↝</span> ' + (selectedGroupId ? '그룹 랜덤 연습' : '랜덤 연습');
  ui.groupStatus.textContent = groupsLoading ? '그룹을 불러오고 있어요.' : !choices.length ? (selectedGroupId ? '이 그룹에는 곡이 없어요. 그룹 편집에서 음원을 선택해 주세요.' : '내 음원을 올리면 곡과 마디를 함께 랜덤으로 골라요.') : !usable ? '한 마디를 먼저 들을 수 있는 음원이 없어요. 곡 길이와 박자 설정을 확인해 주세요.' : choices.length + '곡에서 곡과 시작 마디를 랜덤으로 골라요.';
  if (editor) renderGroupEditor();
}
function changeGroup(id) {
  selectedGroupId = groups.some(group => group.id === id) ? id : ''; rememberGroup();
  stopPlayback(); cancelAnalysis();
  const choices = availableGroupTracks();
  if (!choices.includes(selected)) selectTrack(choices[0]?.id);
  else { resetStage(); renderTracks(); }
}
async function saveGroup(event) {
  event.preventDefault(); if (groupSaving) return;
  const name = ui.groupName.value.trim();
  if (!name || name.length > 80) { ui.groupMessage.textContent = '그룹 이름을 1~80자로 입력해 주세요.'; return; }
  const trackIds = [...groupCheckboxes].filter(([,checkbox]) => checkbox.checked).map(([id]) => id);
  if (trackIds.length > 500) { ui.groupMessage.textContent = '한 그룹에는 최대 500곡을 넣을 수 있어요.'; return; }
  stopPlayback();
  const token = authGeneration, id = editingGroupId; groupSaving = true; ui.groupMessage.textContent = '그룹을 저장하고 있어요.'; ui.saveGroupBtn.disabled = true; ui.deleteGroupBtn.disabled = true; ui.groupEditSelect.disabled = true;
  try {
    const result = await api('/groups' + (id ? '/' + encodeURIComponent(id) : ''), { method: id ? 'PATCH' : 'POST', body: { name, trackIds } });
    if (token !== authGeneration) return;
    groups = [...groups.filter(group => group.id !== result.group.id), result.group].sort((a,b) => a.name.localeCompare(b.name)); editingGroupId = result.group.id;
    changeGroup(result.group.id); renderGroupEditor(); ui.groupMessage.textContent = '그룹을 저장했어요. 다른 기기에서도 같은 그룹을 불러와요.';
  } catch (error) { if (token === authGeneration) ui.groupMessage.textContent = error.message; }
  finally { if (token === authGeneration) { groupSaving = false; ui.saveGroupBtn.disabled = false; ui.deleteGroupBtn.disabled = false; ui.groupEditSelect.disabled = groupsLoading; ui.groupName.disabled = false; for (const checkbox of groupCheckboxes.values()) checkbox.disabled = false; } }
}
async function deleteGroup() {
  const group = groups.find(item => item.id === editingGroupId);
  if (!group || groupSaving || !confirm('‘' + group.name + '’ 그룹을 삭제할까요? 음원 파일은 그대로 남아요.')) return;
  if (selectedGroupId === group.id) stopPlayback();
  const token = authGeneration; groupSaving = true; ui.deleteGroupBtn.disabled = true;
  try {
    await api('/groups/' + encodeURIComponent(group.id), { method: 'DELETE' });
    if (token !== authGeneration) return;
    groups = groups.filter(item => item.id !== group.id); editingGroupId = ''; lastSuccessfulSongs.delete(group.id);
    if (selectedGroupId === group.id) changeGroup(''); else renderGroups();
    ui.groupMessage.textContent = '그룹을 삭제했어요. 음원 파일은 그대로 남아 있어요.';
  } catch (error) { if (token === authGeneration) ui.groupMessage.textContent = error.message; }
  finally { if (token === authGeneration) { groupSaving = false; renderGroupEditor(); } }
}
function renderTracks() {
  renderGroups({ editor: false });
  const visibleTracks = availableGroupTracks();
  ui.trackSelect.replaceChildren();
  if (!visibleTracks.length) {
    const option = document.createElement('option'); option.value = ''; option.textContent = '음원을 추가해 주세요'; ui.trackSelect.append(option);
  } else {
    for (const track of visibleTracks) {
      const option = document.createElement('option'); option.value = track.id; option.textContent = track.name || track.fileName; ui.trackSelect.append(option);
    }
  }
  ui.trackCount.textContent = tracks.length + '곡';
  ui.trackSelect.disabled = !visibleTracks.length;
  ui.trackSelect.value = selected?.id || '';
  ui.libraryStatus.textContent = tracks.length ? '한 번 올린 음원을 다른 기기에서도 불러와요.' : '내 곡을 올려 첫 연습을 시작해 보세요.';
  ui.trackMeta.hidden = !selected;
  ui.fileInfo.textContent = selected ? size(selected.bytes) : '';
  ui.nowTitle.textContent = selected?.name || selected?.fileName || '음원을 추가해 주세요';
  renderGrid(); renderTransport(); renderTime();
}
function selectTrack(id) {
  stopPlayback({ render: false }); cancelAnalysis();
  selected = tracks.find(track => String(track.id) === String(id)) || null;
  audio.removeAttribute('src');
  if (selected) audio.src = trackURL(selected);
  audio.load();
  remember(selected?.id);
  resetStage(); renderTracks();
  if ('mediaSession' in navigator && typeof MediaMetadata !== 'undefined') navigator.mediaSession.metadata = selected ? new MediaMetadata({ title: selected.name || selected.fileName, artist: 'KENNETH · 랜덤 가사 연습' }) : null;
  mediaState(selected ? 'paused' : 'none');
}
function cancelUploads() {
  uploadGeneration += 1; uploadXHR?.abort(); uploadXHR = null;
  uploading = false; uploadQueue = [];
  ui.fileInput.disabled = false; ui.uploadLabel.classList.remove('busy'); ui.retryUploadBtn.hidden = true;
}
function showLogin(message = '') {
  authGeneration += 1;
  stopPlayback(); cancelAnalysis(); cancelUploads();
  selected = null; tracks = []; groups = []; selectedGroupId = ''; editingGroupId = ''; groupsLoading = false; groupSaving = false; audio.removeAttribute('src'); audio.load(); localFiles.clear();
  ui.workspace.hidden = true; ui.servicePanel.hidden = true; ui.loginPanel.hidden = false; ui.logoutBtn.hidden = true;
  ui.loginMessage.textContent = message;
}
async function loadTracks(token = authGeneration) {
  ui.retryTracksBtn.hidden = true; ui.libraryStatus.textContent = '음원과 그룹을 불러오고 있어요.'; groupsLoading = true; renderGroups(); renderTransport();
  try {
    const [result, groupResult] = await Promise.all([api('/tracks'), api('/groups')]);
    if (token !== authGeneration) return;
    tracks = Array.isArray(result.tracks) ? result.tracks : []; groups = Array.isArray(groupResult.groups) ? groupResult.groups : [];
    try { selectedGroupId = localStorage.getItem(GROUP_KEY) || ''; } catch { selectedGroupId = ''; }
    if (!groups.some(group => group.id === selectedGroupId)) selectedGroupId = '';
    groupsLoading = false; renderGroupEditor();
    const choices = availableGroupTracks(), id = selected?.id || remembered();
    selectTrack(choices.some(track => track.id === id) ? id : choices[0]?.id);
  } catch (error) {
    if (token !== authGeneration || error.status === 401) return;
    groupsLoading = false; ui.libraryStatus.textContent = error.message; ui.groupStatus.textContent = '그룹을 불러오지 못했어요. 곡 목록 다시 불러오기를 눌러 주세요.'; ui.retryTracksBtn.hidden = false; renderTransport();
  }
}
async function initialize() {
  const token = ++authGeneration;
  ui.servicePanel.hidden = false; ui.loginPanel.hidden = true; ui.workspace.hidden = true; ui.reloadBtn.hidden = true;
  ui.serviceTitle.textContent = '내 연습실을 불러오고 있어요.'; ui.serviceMessage.textContent = '잠시만 기다려 주세요.';
  try {
    const status = await api('/status');
    if (token !== authGeneration) return;
    maxUploadBytes = Number(status.maxUploadBytes) || 80 * 1048576;
    ui.uploadLimit.textContent = String(Math.floor(maxUploadBytes / 1048576));
    if (!status.configured || !status.storageReady) {
      ui.serviceTitle.textContent = '연습실을 준비하고 있어요.';
      ui.serviceMessage.textContent = '음원 저장 연결이 완료되면 이곳에서 바로 연습할 수 있어요.';
      ui.reloadBtn.hidden = false; return;
    }
    if (!status.authenticated) { showLogin(); return; }
    ui.servicePanel.hidden = true; ui.loginPanel.hidden = true; ui.workspace.hidden = false; ui.logoutBtn.hidden = false;
    await loadTracks(token);
  } catch (error) {
    if (token !== authGeneration) return;
    ui.serviceTitle.textContent = '연습실에 연결하지 못했어요.'; ui.serviceMessage.textContent = error.message; ui.reloadBtn.hidden = false;
  }
}
async function login(event) {
  event.preventDefault(); ui.loginBtn.disabled = true; ui.loginMessage.textContent = '';
  const token = authGeneration;
  try {
    await api('/login', { method: 'POST', body: { password: ui.password.value } });
    ui.password.value = '';
    if (token === authGeneration) await initialize();
  } catch (error) { ui.loginMessage.textContent = error.message; }
  finally { ui.loginBtn.disabled = false; }
}
async function logout() {
  authGeneration += 1;
  stopPlayback(); cancelAnalysis(); cancelUploads();
  ui.logoutBtn.disabled = true;
  try { await api('/logout', { method: 'POST' }); showLogin(); }
  catch (error) { report(error); }
  finally { ui.logoutBtn.disabled = false; }
}
function currentResource() { return !!selected && audio.currentSrc === trackURL(selected); }
function active(token, current) { return token === generation && session === current; }
function waitForMedia(current, token, predicate) {
  return new Promise((resolve, reject) => {
    let timer = 0, settled = false;
    const deadline = now() + 15000;
    const finish = error => {
      if (settled) return;
      settled = true; clearTimeout(timer); pendingMediaWaits.delete(cancel);
      if (error) reject(error); else resolve();
    };
    const cancel = () => finish(abortError());
    const check = () => {
      if (!active(token, current)) { cancel(); return; }
      if (audio.error) { finish(new Error('음원을 불러오지 못했어요. 연결을 확인해 주세요.')); return; }
      if (predicate()) { finish(); return; }
      if (now() >= deadline) { finish(new Error('음원 준비가 지연됐어요. 이어 재생을 눌러 다시 시도해 주세요.')); return; }
      timer = setTimeout(check, 50);
    };
    pendingMediaWaits.add(cancel); check();
  });
}
function blocked(current, token, error, resumeFrom) {
  if (!active(token, current)) return;
  current.phase = 'blocked'; current.resumeFrom = resumeFrom;
  clearClock(); audio.muted = true; audio.pause(); audio.loop = false; mediaState('paused');
  setStage('한 번 더 눌러 주세요', '▶', '이어 재생을 누르면 시작해요.', error?.name === 'NotAllowedError' ? '브라우저가 자동 재생을 막았어요. 아래 버튼으로 재생해 주세요.' : error?.countdownSound ? error.message : '음원을 재생하지 못했어요. 연결을 확인한 뒤 이어 재생을 눌러 주세요.');
  ui.playbackMessage.textContent = '이어 재생 버튼을 누르면 같은 시작점에서 계속합니다.'; renderTransport();
}
function startAudio(current, token) {
  if (!active(token, current)) return;
  preparationClicks.cancel();
  current.phase = 'starting'; audio.loop = false; audio.muted = false; mediaState('playing'); renderTransport();
  let promise;
  try { promise = audio.play(); } catch (error) { blocked(current, token, error, 'audio'); return; }
  Promise.resolve(promise).then(() => {
    if (!active(token, current)) return;
    current.phase = current.type === 'preview' ? 'preview' : current.type === 'full' ? 'playing' : 'preroll';
    if (current.type === 'training') lastSuccessfulSongs.set(current.groupKey, current.trackId);
    if (current.type === 'full' && fullShuffle) fullShuffle.lastTrackId = current.trackId;
    ui.playbackMessage.textContent = current.type === 'full' ? '곡이 끝나면 다음 곡으로 자동 이동해요. 모든 곡을 들으면 다시 섞어 계속 재생합니다.' : '시작한 음원은 곡 끝까지 계속 재생합니다. 준비할 때는 화면을 켜 두세요.';
    mediaState('playing'); renderTransport(); paintPlayback();
  }).catch(error => blocked(current, token, error, 'audio'));
}
function countdownTick(current, token) {
  if (!active(token, current) || current.phase !== 'countdown') return;
  current.remaining = Math.max(0, current.deadline - now());
  if (current.remaining <= 0) { countdownTimer = 0; startAudio(current, token); return; }
  setStage('곧 시작해요', String(Math.ceil(current.remaining / 1000)), '한 마디 듣고, GO에 맞춰 들어가요.', '시작점 ' + fmt(current.plan.target) + ' · 한 마디 미리 듣기');
  countdownTimer = setTimeout(() => countdownTick(current, token), Math.min(100, current.remaining));
}
function beginCountdown(current, token) {
  if (!active(token, current)) return;
  audio.muted = true; mediaState('playing');
  current.phase = 'countdown'; current.deadline = now() + current.remaining;
  current.deadline = preparationClicks.start({ remainingMs: current.remaining, deadline: current.deadline });
  ui.playbackMessage.textContent = '3, 2, 1에 한 번씩 준비 박자 소리가 나요. 준비 중에는 화면을 켜 두세요.';
  renderTransport(); countdownTick(current, token);
}
// Only zero-valued PCM is played to unlock media. The song remains paused and
// muted until the countdown finishes AND its exact pre-roll seek has settled.
function unlockForCountdown(current, token) {
  current.phase = 'unlock'; audio.muted = true;
  mediaState('playing');
  setStage('음원 준비 중', '…', '랜덤 곡의 재생을 준비하고 있어요.', '준비가 끝나면 딱, 딱, 딱 · 3초 카운트다운이 시작됩니다.'); renderTransport();
  let soundPromise, playPromise;
  try {
    soundPromise = preparationClicks.unlock();
    audio.pause(); audio.loop = true; audio.src = SILENT_PRIME_URL; audio.load();
    playPromise = audio.play();
  } catch (error) { blocked(current, token, error, 'countdown'); return; }
  Promise.all([Promise.resolve(playPromise), Promise.resolve(soundPromise).then(ready => {
    if (!ready) { const error = new Error('준비 박자 소리를 재생하지 못했어요. 이어 재생을 눌러 다시 시도해 주세요.'); error.countdownSound = true; throw error; }
  })]).then(async () => {
    if (!active(token, current)) return;
    audio.muted = true; audio.pause(); audio.loop = false;
    audio.src = trackURL(selected); audio.load();
    await waitForMedia(current, token, () => currentResource() && audio.readyState >= 1 && Number.isFinite(audio.duration) && audio.duration > 0);
    if (!active(token, current)) return;
    if (!current.plan) {
      // Use one consistent grid snapshot after native metadata and optional analysis settle.
      current.bpm = selected.bpm || 96; current.offset = selected.offset || 0;
      try {
        current.plan = pickTarget(buildTargets({ duration: duration(), bpm: current.bpm, offset: current.offset }), { lastTarget: lastTargets.get(current.trackId) });
      } catch {
        stopPlayback(); toast('선택된 곡의 길이나 박자를 확인해 주세요. 한 마디를 먼저 들을 수 있는 길이가 필요해요.'); return;
      }
      lastTargets.set(current.trackId, current.plan.target);
    }
    audio.currentTime = current.plan.start;
    await waitForMedia(current, token, () => currentResource() && !audio.seeking && audio.readyState >= 2 && Math.abs(audio.currentTime - current.plan.start) < 0.05);
    if (!active(token, current)) return;
    ui.startInfo.textContent = '시작점 ' + fmt(current.plan.target) + ' → 곡 끝까지';
    renderTime(); beginCountdown(current, token);
  }).catch(error => blocked(current, token, error, 'countdown'));
}
function startTraining({ scroll = true } = {}) {
  if (ui.workspace.hidden || groupsLoading || groupSaving) return;
  const eligible = availableGroupTracks().filter(eligibleTrack);
  if (!eligible.length) { toast('그룹에 연습할 곡을 넣어 주세요. 한 마디를 먼저 들을 수 있는 음원이 필요해요.'); return; }
  const groupKey = selectedGroupId || 'all', previous = lastSuccessfulSongs.get(groupKey);
  const alternatives = eligible.filter(track => track.id !== previous);
  const choices = alternatives.length ? alternatives : eligible;
  const track = choices[Math.min(choices.length - 1, Math.floor(Math.random() * choices.length))];
  playbackMode = 'training';
  if (selected !== track) selectTrack(track.id);
  else stopPlayback({ resetPosition: false, render: false });
  const token = generation;
  session = { type: 'training', phase: 'unlock', plan: null, remaining: 3000, bpm: track.bpm || 96, trackId: track.id, groupKey };
  unlockForCountdown(session, token);
  if (scroll && matchMedia('(max-width: 780px)').matches) ui.count.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
}
function startFullShuffle({ scroll = true, continueCycle = false } = {}) {
  if (ui.workspace.hidden || groupsLoading || groupSaving) return;
  const choices = availableGroupTracks();
  if (!choices.length) { toast('그룹에 재생할 음원을 넣어 주세요.'); return; }
  const groupKey = selectedGroupId || 'all', membership = JSON.stringify(choices.map(track => track.id).sort());
  let cycle = continueCycle && fullShuffle?.groupKey === groupKey && fullShuffle.membership === membership ? fullShuffle : { queue: [], cycle: 0, total: choices.length, lastTrackId: session?.type === 'full' ? selected?.id : null, groupKey, membership };
  if (!cycle.queue.length) {
    cycle.queue = shuffleCycle(choices.map(track => track.id), { previous: cycle.lastTrackId });
    cycle.cycle += 1; cycle.total = choices.length;
  }
  const nextId = cycle.queue.shift();
  const track = choices.find(item => item.id === nextId);
  playbackMode = 'full';
  if (selected !== track) selectTrack(track.id);
  else stopPlayback({ render: false });
  fullShuffle = cycle;
  // Use the same media element and call play in the gesture/ended callback.
  // No BPM, countdown, silent priming, or random seek is needed in this mode.
  audio.currentTime = 0;
  session = { type: 'full', phase: 'starting', trackId: track.id, groupKey, cycle: cycle.cycle, position: cycle.total - cycle.queue.length, total: cycle.total };
  ui.startInfo.textContent = '처음부터 → 곡 끝까지 → 다음 곡';
  setStage('전체곡 랜덤 재생', '♫', '처음부터 끝까지, 계속 이어져요.', cycle.cycle + '회차 · ' + session.position + '/' + cycle.total + '곡');
  Array.from(ui.beatDots.children).forEach(dot => dot.classList.remove('active'));
  if ('mediaSession' in navigator && typeof MediaMetadata !== 'undefined') navigator.mediaSession.metadata = new MediaMetadata({ title: track.name || track.fileName, artist: 'KENNETH · 전체곡 랜덤 재생' });
  startAudio(session, generation);
  if (scroll && matchMedia('(max-width: 780px)').matches) ui.count.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
}
function pausePlayback() {
  if (autoNextTimer) { generation += 1; clearClock(); mediaState('paused'); renderTransport(); return; }
  if (!session || ['paused','blocked'].includes(session.phase)) return;
  const current = session;
  if (current.phase === 'countdown') current.remaining = Math.max(0, current.deadline - now());
  current.resumeFrom = current.phase === 'countdown' || current.phase === 'unlock' ? 'countdown' : 'audio';
  generation += 1; clearClock(); current.phase = 'paused';
  audio.muted = true; audio.pause(); audio.loop = false;
  mediaState('paused');
  setStage('잠시 쉬어가요', 'Ⅱ', '이어 재생으로 계속해요.', current.resumeFrom === 'countdown' ? '남은 준비 시간부터 이어집니다.' : fmt(audio.currentTime) + '에서 계속합니다.'); renderTransport(); renderTime();
}
function resumePlayback() {
  if (!session || !['paused','blocked'].includes(session.phase)) return;
  const current = session, token = ++generation;
  if (current.resumeFrom === 'countdown') unlockForCountdown(current, token);
  else startAudio(current, token);
}
function togglePause() { if (session && ['paused','blocked'].includes(session.phase)) resumePlayback(); else pausePlayback(); }
function startPreview() {
  if (!selected) return;
  stopPlayback({ render: false });
  session = { type: 'preview', phase: 'starting' };
  ui.startInfo.textContent = '첫 마디 첫 박을 들어서 확인해 주세요.';
  startAudio(session, generation);
}
function paintPlayback() {
  cancelAnimationFrame(frame); frame = 0;
  if (!session || !['preroll','playing','preview'].includes(session.phase)) return;
  renderTime();
  if (session.type === 'full') {
    setStage('전체곡 랜덤 재생', '♫', '처음부터 끝까지, 계속 이어져요.', session.cycle + '회차 · ' + session.position + '/' + session.total + '곡 · 모두 들으면 다시 섞어요.');
    Array.from(ui.beatDots.children).forEach(dot => dot.classList.remove('active'));
  } else if (session.type === 'preview') {
    setStage('박자 확인 중', '♫', '첫 마디 첫 박을 찾아 주세요.', '원하는 위치에서 ‘지금 위치를 첫 박으로’를 누르세요.');
  } else {
    const remaining = session.plan.target - audio.currentTime, beat = 60 / session.bpm;
    if (remaining > 0.002) {
      session.phase = 'preroll';
      const count = Math.min(4, Math.max(1, Math.ceil(remaining / beat)));
      setStage('한 마디 미리 듣기', String(count), '박자를 듣고, 다음 첫 박에 들어가요.', 'GO부터 곡 끝까지 이어 불러요.');
      Array.from(ui.beatDots.children).forEach((dot, index) => dot.classList.toggle('active', index === 4 - count));
    } else {
      session.phase = 'playing';
      setStage('내 가사로 이어가기', remaining > -beat ? 'GO' : '♫', '멈추지 말고, 곡 끝까지.', '막혔다면 다시 랜덤 버튼을 눌러 연습해 보세요.');
      Array.from(ui.beatDots.children).forEach(dot => dot.classList.remove('active'));
    }
  }
  frame = requestAnimationFrame(paintPlayback);
}
function ended() {
  if (!audio.ended || !currentResource()) return;
  if (!session || !['preroll','playing','preview','starting'].includes(session.phase)) return;
  const wasFull = session.type === 'full', wasTraining = session.type === 'training';
  const repeat = wasFull || wasTraining && autoRandomEnabled;
  generation += 1; clearClock(); session = null; audio.muted = true;
  mediaState(repeat ? 'playing' : 'paused');
  setStage('끝까지 왔어요', wasFull ? '♫' : 'DONE', wasFull ? '다음 곡으로 이어가요.' : repeat ? '다음 랜덤 연습으로 이어가요.' : wasTraining ? '다른 시작점도 연습해 볼까요?' : '박자를 확인했다면 랜덤으로 시작해요.', wasFull ? '모든 곡을 들으면 순서를 다시 섞어 계속 재생해요.' : repeat ? '새 곡·마디를 고른 뒤 3·2·1부터 시작합니다.' : '랜덤 버튼이나 차량·이어폰의 재생 버튼으로 다음 연습을 시작해요.', true);
  Array.from(ui.beatDots.children).forEach(dot => dot.classList.remove('active'));
  if (repeat) {
    const token = generation, authToken = authGeneration;
    autoNextTimer = setTimeout(() => {
      autoNextTimer = 0;
      if (token !== generation || authToken !== authGeneration || session || ui.workspace.hidden) return;
      if (wasFull && playbackMode === 'full') startFullShuffle({ scroll: false, continueCycle: true });
      else if (!wasFull && autoRandomEnabled) startTraining({ scroll: false });
    }, 0);
  }
  renderTransport(); renderTime();
}
function seekTo(value) {
  if (!selected || duration() <= 0) return;
  if (session && ['unlock','countdown','starting'].includes(session.phase)) return;
  const playing = session && !audio.paused && ['preroll','playing','preview'].includes(session.phase);
  if (session?.type === 'full') {
    audio.currentTime = Math.max(0, Math.min(duration(), Number(value) || 0));
    renderTime(); if (playing) paintPlayback();
    return;
  }
  stopPlayback({ resetPosition: false, render: false });
  audio.currentTime = Math.max(0, Math.min(duration(), Number(value) || 0));
  if (playing) { session = { type: 'preview', phase: 'starting' }; startAudio(session, generation); }
  else { resetStage(); renderTransport(); renderTime(); }
}
async function patchTrack(track, fields) {
  const token = authGeneration;
  // Keep writes ordered per song so a manual grid save follows an in-flight estimate.
  const write = (metadataWrites.get(track.id) || Promise.resolve()).catch(() => {}).then(async () => {
    if (token !== authGeneration || !tracks.includes(track)) return false;
    await api('/tracks/' + encodeURIComponent(track.id), { method: 'PATCH', body: fields });
    if (token !== authGeneration || !tracks.includes(track)) return false;
    // Merge only this request's fields: a late duration response cannot overwrite BPM.
    Object.assign(track, fields);
    return true;
  });
  metadataWrites.set(track.id, write);
  try { return await write; } finally { if (metadataWrites.get(track.id) === write) metadataWrites.delete(track.id); }
}
async function saveGrid(event) {
  event?.preventDefault();
  if (!selected) return;
  const track = selected, bpm = Number(ui.bpm.value), offset = Number(ui.offset.value);
  if (!Number.isFinite(bpm) || bpm < 40 || bpm > 240 || !Number.isFinite(offset) || offset < 0 || duration() > 0 && offset >= duration()) { toast('BPM은 40~240, 첫 박은 곡이 끝나기 전의 시간으로 입력해 주세요.'); return; }
  cancelAnalysis(); gridRevisions.set(track.id, (gridRevisions.get(track.id) || 0) + 1); stopPlayback(); ui.saveGridBtn.disabled = true;
  try { if (await patchTrack(track, { bpm, offset })) { if (selected === track) renderGrid(); toast('박자를 저장했어요.'); } }
  catch (error) { report(error); }
  finally { renderTransport(); }
}
async function deleteTrack() {
  if (!selected || !confirm('이 공유 연습실에서 ‘' + (selected.name || selected.fileName) + '’ 음원을 삭제할까요?')) return;
  const track = selected, token = authGeneration;
  stopPlayback(); cancelAnalysis(); ui.deleteBtn.disabled = true;
  try {
    await api('/tracks/' + encodeURIComponent(track.id), { method: 'DELETE' });
    if (token !== authGeneration) return;
    tracks = tracks.filter(item => item !== track);
    groups.forEach(group => { group.trackIds = group.trackIds.filter(id => id !== track.id); });
    localFiles.delete(track.id); lastTargets.delete(track.id);
    renderGroupEditor({ preserveDraft: true });
    if (selected === track) selectTrack(availableGroupTracks()[0]?.id);
    else renderTracks(); // A late delete response cannot stop a newer selection/session.
    toast('공유 연습실에서 음원을 삭제했어요.');
  } catch (error) { report(error); renderTransport(); }
}

function rawUpload(file, token) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest(); uploadXHR = xhr;
    xhr.open('POST', API + '/tracks'); xhr.withCredentials = true; xhr.timeout = 300000;
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
    xhr.setRequestHeader('X-File-Size', String(file.size));
    xhr.upload.onprogress = event => {
      if (token !== uploadGeneration) return;
      const progress = event.lengthComputable ? Math.min(100, Math.round(event.loaded / event.total * 100)) : 0;
      ui.uploadProgress.value = progress; ui.uploadPercent.textContent = progress + '%';
      if (progress === 100) ui.uploadMessage.textContent = '음원을 저장하고 있어요. 잠시만 기다려 주세요.';
    };
    xhr.onload = () => {
      if (token !== uploadGeneration) { reject(abortError()); return; }
      if (uploadXHR === xhr) uploadXHR = null;
      let data;
      try { data = JSON.parse(xhr.responseText); } catch { reject(new Error('업로드 응답을 읽지 못했어요. 다시 시도해 주세요.')); return; }
      if (xhr.status === 401) showLogin('로그인이 만료됐어요. 다시 로그인해 주세요.');
      if (xhr.status < 200 || xhr.status >= 300 || data.ok === false || !data.track) { reject(new Error(data.error || '음원을 저장하지 못했어요. 다시 시도해 주세요.')); return; }
      resolve(data.track);
    };
    xhr.onerror = () => reject(new Error('연결이 끊겼어요. 같은 파일로 다시 시도해 주세요.'));
    xhr.ontimeout = () => reject(new Error('업로드 시간이 초과됐어요. 연결을 확인하고 다시 시도해 주세요.'));
    xhr.onabort = () => reject(abortError());
    xhr.send(file);
  });
}
async function processUploads() {
  if (uploading || !uploadQueue.length) return;
  const token = ++uploadGeneration;
  uploading = true; ui.fileInput.disabled = true; ui.uploadLabel.classList.add('busy'); ui.retryUploadBtn.hidden = true; ui.uploadPanel.hidden = false;
  try {
    while (uploadQueue.length && token === uploadGeneration) {
      const entry = uploadQueue[0], file = entry.file;
      ui.uploadName.textContent = file.name; ui.uploadProgress.value = 0; ui.uploadPercent.textContent = '0%'; ui.uploadMessage.textContent = '음원을 업로드하고 있어요.';
      const track = await rawUpload(file, token);
      if (token !== uploadGeneration) return;
      tracks.unshift(track); localFiles.set(track.id, file); uploadQueue.shift();
      if (entry.grid && entry.grid.bpm >= 40 && entry.grid.bpm <= 240) {
        try { await patchTrack(track, entry.grid); } catch { toast('음원은 올렸어요. 박자 설정은 다시 확인해 주세요.'); }
      }
      if (token !== uploadGeneration) return;
      if (selectedGroupId) { selectedGroupId = ''; rememberGroup(); }
      renderGroupEditor({ preserveDraft: true });
      selectTrack(track.id);
      ui.uploadPercent.textContent = '100%'; ui.uploadProgress.value = 100;
      ui.uploadMessage.textContent = '저장됐어요. 다른 기기에서도 이 곡을 불러올 수 있어요.';
    }
  } catch (error) {
    if (token !== uploadGeneration) return;
    ui.uploadMessage.textContent = error.message; ui.retryUploadBtn.hidden = false;
  } finally {
    if (token === uploadGeneration) { uploading = false; ui.fileInput.disabled = false; ui.uploadLabel.classList.remove('busy'); }
  }
}
function enqueueFiles(files, grid = null) {
  const valid = [];
  for (const file of Array.from(files)) {
    if (!/\.(mp3|wav|m4a|aac|ogg|opus|flac|webm|aiff|aif)$/i.test(file.name)) { toast(file.name + ': 지원하는 음원 파일을 선택해 주세요.'); continue; }
    if (!file.size || file.size > maxUploadBytes) { toast(file.name + ': 파일당 최대 ' + Math.floor(maxUploadBytes / 1048576) + ' MB까지 올릴 수 있어요.'); continue; }
    valid.push({ file, grid });
  }
  uploadQueue.push(...valid); void processUploads();
}
async function maybeAnalyze(track) {
  const file = localFiles.get(track.id);
  if (!file || track.bpm || selected !== track || !Number.isFinite(audio.duration) || audio.duration <= 4 || audio.duration > 300 || file.size > MAX_ANALYSIS_BYTES || matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 1 || !window.AudioContext || !window.Worker) return;
  localFiles.delete(track.id); cancelAnalysis();
  const token = analysisGeneration, revision = gridRevisions.get(track.id) || 0;
  ui.gridNote.textContent = '박자를 가볍게 추정하고 있어요. 재생은 바로 할 수 있어요.';
  let context;
  try {
    context = new AudioContext(); analysisContext = context;
    const bytes = await file.arrayBuffer();
    if (token !== analysisGeneration || selected !== track) return;
    const buffer = await context.decodeAudioData(bytes);
    if (token !== analysisGeneration || selected !== track) return;
    const sampleRate = 11025, length = Math.min(Math.floor(buffer.duration * sampleRate), 180 * sampleRate), samples = new Float32Array(length);
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const pcm = buffer.getChannelData(channel);
      for (let index = 0; index < length; index += 1) samples[index] += (pcm[Math.min(pcm.length - 1, Math.floor(index * buffer.sampleRate / sampleRate))] || 0) / buffer.numberOfChannels;
    }
    await context.close(); if (analysisContext === context) analysisContext = null;
    if (token !== analysisGeneration || selected !== track || (gridRevisions.get(track.id) || 0) !== revision) return;
    const result = await new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./beat-worker.js', import.meta.url), { type: 'module' }); analysisWorker = worker;
      analysisCancel = () => reject(abortError());
      worker.onmessage = ({ data }) => { worker.terminate(); if (analysisWorker === worker) { analysisWorker = null; analysisCancel = null; } data.error ? reject(new Error(data.error)) : resolve(data.result); };
      worker.onerror = () => { worker.terminate(); if (analysisWorker === worker) { analysisWorker = null; analysisCancel = null; } reject(new Error('박자는 직접 입력해 주세요.')); };
      worker.postMessage({ id: track.id, samples, sampleRate }, [samples.buffer]);
    });
    if (token !== analysisGeneration || selected !== track || (gridRevisions.get(track.id) || 0) !== revision) return;
    if (result.confidence < 0.35 || !Number.isFinite(result.bpm)) { ui.gridNote.textContent = '박자를 확실히 찾지 못했어요. 기본 96 BPM 대신 곡의 BPM을 입력해 주세요.'; return; }
    if (await patchTrack(track, { bpm: result.bpm, offset: result.offset })) {
      if (token === analysisGeneration && selected === track) { renderGrid(); ui.gridNote.textContent = '자동 추정 ' + result.bpm + ' BPM이에요. 첫 마디 첫 박은 직접 들어서 맞춰 주세요.'; }
    }
  } catch (error) {
    if (token === analysisGeneration && selected === track && error.name !== 'AbortError') ui.gridNote.textContent = '자동 추정이 어려운 음원이에요. 곡의 BPM과 첫 박을 직접 입력해 주세요.';
  } finally {
    if (context && context.state !== 'closed') await context.close().catch(() => {});
    if (analysisContext === context) analysisContext = null;
  }
}
async function readLegacy() {
  if (legacyTracks !== null || !ui.legacyDetails.open) return;
  legacyTracks = [];
  try {
    if (!window.indexedDB) return;
    if (indexedDB.databases && !(await indexedDB.databases()).some(db => db.name === 'kenneth_lyric_trainer')) return;
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('kenneth_lyric_trainer');
      request.onupgradeneeded = () => { request.transaction.abort(); };
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); request.onblocked = () => reject(new Error('이전 연습 탭을 닫고 다시 시도해 주세요.'));
    });
    try {
      if (!db.objectStoreNames.contains('tracks')) return;
      legacyTracks = await new Promise((resolve, reject) => {
        const tx = db.transaction('tracks', 'readonly'), request = tx.objectStore('tracks').getAll();
        request.onsuccess = () => resolve((request.result || []).filter(track => track.blob && track.blob.size)); request.onerror = () => reject(request.error);
      });
    } finally { db.close(); }
    if (legacyTracks.length) {
      ui.legacyMessage.textContent = '이 브라우저에 저장된 ' + legacyTracks.length + '곡이 있어요. 공유 연습실로 올려도 이전 저장본은 그대로 남습니다.'; ui.legacyBtn.hidden = false;
    } else ui.legacyMessage.textContent = '이 브라우저에서 이전 음원을 찾지 못했어요. 원본 음원 파일을 위에서 추가해 주세요.';
  } catch { ui.legacyMessage.textContent = '이전 저장본을 읽지 못했어요. 원본 음원 파일을 위에서 추가해 주세요. 이전 저장본은 그대로 남아 있어요.'; }
}
function transferLegacy() {
  ui.legacyBtn.disabled = true;
  for (const track of legacyTracks || []) {
    const file = new File([track.blob], track.fileName || track.name || '이전 음원.mp3', { type: track.blob.type || track.type || '' });
    const grid = track.bpm ? { bpm: Number(track.bpm), offset: Math.max(0, Number(track.offset) || 0), ...(Number(track.duration) > 0 ? { duration: Number(track.duration) } : {}) } : null;
    enqueueFiles([file], grid);
  }
  ui.legacyMessage.textContent = '이전 음원을 순서대로 업로드합니다. 이 브라우저의 저장본은 그대로 남아 있어요.';
}
function bindMediaSession() {
  if (!('mediaSession' in navigator)) return;
  const handlers = { play: mediaPlay, pause: pausePlayback, stop: () => stopPlayback(), nexttrack: mediaNext, previoustrack: mediaNext, seekto: data => seekTo(data.seekTime), seekbackward: data => seekTo(audio.currentTime - (data.seekOffset || 10)), seekforward: data => seekTo(audio.currentTime + (data.seekOffset || 10)) };
  for (const [action, handler] of Object.entries(handlers)) { try { navigator.mediaSession.setActionHandler(action, handler); } catch { /* An unsupported action is optional. */ } }
}
function mediaPlay() {
  if (session && ['paused','blocked'].includes(session.phase)) resumePlayback();
  else if (!session) {
    if (playbackMode === 'full') startFullShuffle({ scroll: false, continueCycle: true });
    else startTraining({ scroll: false });
  }
}
function mediaNext() {
  if (playbackMode === 'full') startFullShuffle({ scroll: false, continueCycle: true });
  else startTraining({ scroll: false });
}
ui.loginForm.addEventListener('submit', login);
ui.logoutBtn.addEventListener('click', logout);
ui.reloadBtn.addEventListener('click', initialize);
ui.retryTracksBtn.addEventListener('click', () => loadTracks());
ui.groupSelect.addEventListener('change', () => changeGroup(ui.groupSelect.value));
ui.groupEditSelect.addEventListener('change', () => { stopPlayback(); editingGroupId = ui.groupEditSelect.value; ui.groupMessage.textContent = ''; renderGroupEditor(); });
ui.groupForm.addEventListener('submit', saveGroup);
ui.deleteGroupBtn.addEventListener('click', deleteGroup);
ui.trackSelect.addEventListener('change', () => { try { selectTrack(ui.trackSelect.value); } catch (error) { report(error); } });
ui.randomBtn.addEventListener('click', startTraining);
ui.fullRandomBtn.addEventListener('click', () => startFullShuffle());
ui.pauseBtn.addEventListener('click', togglePause);
ui.stopBtn.addEventListener('click', () => stopPlayback());
ui.autoRandom.addEventListener('change', changeAutoRandom);
ui.previewBtn.addEventListener('click', startPreview);
ui.seek.addEventListener('change', () => seekTo(ui.seek.value));
ui.gridForm.addEventListener('submit', saveGrid);
ui.markBeatBtn.addEventListener('click', () => { ui.offset.value = (audio.currentTime || 0).toFixed(3); toast('현재 위치를 입력했어요. 박자 저장을 눌러 주세요.'); });
ui.deleteBtn.addEventListener('click', deleteTrack);
ui.fileInput.addEventListener('change', () => { enqueueFiles(ui.fileInput.files); ui.fileInput.value = ''; });
ui.retryUploadBtn.addEventListener('click', () => processUploads());
ui.legacyDetails.addEventListener('toggle', readLegacy);
ui.legacyBtn.addEventListener('click', transferLegacy);
audio.addEventListener('loadedmetadata', () => {
  if (!currentResource() || audio.readyState < 1) return;
  const track = selected, total = audio.duration;
  renderTransport(); renderTime();
  if (Number.isFinite(total) && total > 0 && Math.abs(total - (Number(track.duration) || 0)) > 0.1) void patchTrack(track, { duration: total }).catch(report);
  void maybeAnalyze(track);
});
audio.addEventListener('durationchange', () => { renderTime(); renderTransport(); });
audio.addEventListener('timeupdate', () => { renderTime(); if (session && ['preroll','playing','preview'].includes(session.phase)) paintPlayback(); });
audio.addEventListener('ended', ended);
audio.addEventListener('pause', () => { if (audio.paused && !audio.ended && session && ['starting','preroll','playing','preview'].includes(session.phase)) pausePlayback(); });
audio.addEventListener('error', () => { if (!audio.error || !currentResource()) return; stopPlayback(); ui.playbackMessage.textContent = '음원을 불러오지 못했어요. 연결이나 로그인을 확인해 주세요.'; toast('음원을 재생하지 못했어요. 다른 형식의 음원으로 시도해 주세요.'); });
audio.addEventListener('waiting', () => { if (session && ['starting','preroll','playing','preview'].includes(session.phase)) ui.playbackMessage.textContent = '음원을 불러오는 중이에요. 연결이 돌아오면 이어집니다.'; });
audio.addEventListener('play', () => {
  // Native events are queued: an old play event may arrive after a user stop.
  if (audio.paused) return;
  if (session && ['unlock','starting','preroll','playing','preview'].includes(session.phase)) return;
  audio.muted = true; audio.pause(); mediaPlay();
});
audio.addEventListener('playing', () => {
  if (!session || !['unlock','starting','preroll','playing','preview'].includes(session.phase)) { audio.muted = true; audio.pause(); return; }
  if (session.phase !== 'unlock') ui.playbackMessage.textContent = session.type === 'full' ? '곡이 끝나면 다음 곡으로 자동 이동해요. 모든 곡을 들으면 다시 섞어 계속 재생합니다.' : '시작한 음원은 곡 끝까지 계속 재생합니다. 준비할 때는 화면을 켜 두세요.';
});
document.addEventListener('visibilitychange', () => { if (!document.hidden && session && ['preroll','playing','preview'].includes(session.phase)) paintPlayback(); });
bindMediaSession();
renderAutoRandom();
void initialize();
