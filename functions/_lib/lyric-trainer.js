import { verifyPassword } from './auth.js';

// This module touches only its own D1 tables and this private R2 namespace.
// Existing homepage and settlement sessions, records and media are independent.
export const MAX_UPLOAD_BYTES = 80 * 1024 * 1024;
export const PRIVATE_PREFIX = 'lyric-trainer-private/';
export const SESSION_COOKIE = 'kenneth_lyric_trainer';
const SESSION_SECONDS = 8 * 60 * 60;
const COOKIE_PATH = '/api/lyric-trainer';
const SESSION_AUDIENCE = 'kenneth-lyric-trainer:v3:password-r1';
const LOGIN_WINDOW_SECONDS = 600;
const LOGIN_LIMIT = 8;
const schemaPromises = new WeakMap();
const encoder = new TextEncoder();

export const TRAINER_SCHEMA = `
CREATE TABLE IF NOT EXISTS lyric_trainer_tracks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  file_name TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  bytes INTEGER NOT NULL CHECK (bytes > 0),
  mime TEXT NOT NULL,
  bpm REAL,
  offset REAL NOT NULL DEFAULT 0,
  duration REAL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lyric_trainer_tracks_created_at ON lyric_trainer_tracks(created_at DESC);
CREATE TABLE IF NOT EXISTS lyric_trainer_login_attempts (
  key_hash TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  attempts INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS lyric_trainer_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS lyric_trainer_group_members (
  group_id TEXT NOT NULL,
  track_id TEXT NOT NULL,
  PRIMARY KEY (group_id, track_id),
  FOREIGN KEY (group_id) REFERENCES lyric_trainer_groups(id) ON DELETE CASCADE,
  FOREIGN KEY (track_id) REFERENCES lyric_trainer_tracks(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_lyric_trainer_group_members_track ON lyric_trainer_group_members(track_id);
`;

const AUDIO_FORMATS = new Map([
  ['mp3', ['audio/mpeg', 'audio/mp3', 'audio/x-mp3', 'audio/mpeg3']],
  ['wav', ['audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave']],
  ['m4a', ['audio/mp4', 'audio/x-m4a', 'video/mp4']],
  ['aac', ['audio/aac', 'audio/x-aac']],
  ['ogg', ['audio/ogg', 'application/ogg']],
  ['opus', ['audio/ogg', 'audio/opus']],
  ['flac', ['audio/flac', 'audio/x-flac']],
  ['webm', ['audio/webm', 'video/webm']],
  ['aiff', ['audio/aiff', 'audio/x-aiff']],
  ['aif', ['audio/aiff', 'audio/x-aiff']]
]);

class TrainerError extends Error {
  constructor(status, code, message, headers = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

function json(value, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      Vary: 'Cookie',
      ...extraHeaders
    }
  });
}

async function respond(context, callback) {
  let response;
  try {
    response = await callback();
  } catch (error) {
    response = error instanceof TrainerError
      ? json({ ok: false, error: error.message, code: error.code }, error.status, error.headers)
      : json({ ok: false, error: '음원 저장소에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.', code: 'STORAGE_ERROR' }, 503);
  }
  if (context.request.method === 'HEAD') return new Response(null, { status: response.status, headers: response.headers });
  return response;
}

export function methodNotAllowed(methods) {
  return json({ ok: false, error: '지원하지 않는 요청입니다.', code: 'METHOD_NOT_ALLOWED' }, 405, { Allow: methods.join(', ') });
}

function storageReady(env) {
  return !!env.DB && !!env.MEDIA;
}

function configured(env) {
  return !!env.SETTLEMENT_ADMIN_PASSWORD && !!env.SESSION_SECRET && storageReady(env);
}

function sameOrigin(request) {
  const expected = new URL(request.url).origin;
  const origin = request.headers.get('Origin');
  if (origin) return origin === expected;
  if (request.headers.get('Sec-Fetch-Site') === 'same-origin') return true;
  try {
    return new URL(request.headers.get('Referer') || '').origin === expected;
  } catch {
    return false;
  }
}

function requireOrigin(request) {
  if (!sameOrigin(request)) throw new TrainerError(403, 'ORIGIN_REJECTED', '이 홈페이지에서 다시 요청해 주세요.');
}

function base64Url(bytes) {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function unbase64Url(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid base64.');
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const binary = atob(normalized.padEnd(normalized.length + (4 - normalized.length % 4) % 4, '='));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

async function sessionKey(secret, uses) {
  // Existing admin verification accepts a raw-secret signature plus exp. A
  // separate signing key prevents renaming this longer-lived cookie to admin.
  return crypto.subtle.importKey('raw', encoder.encode(`${SESSION_AUDIENCE}\0${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, uses);
}

async function sessionToken(secret) {
  const now = Math.floor(Date.now() / 1000);
  const payload = base64Url(encoder.encode(JSON.stringify({ aud: SESSION_AUDIENCE, iat: now, exp: now + SESSION_SECONDS, nonce: crypto.randomUUID() })));
  const key = await sessionKey(secret, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return `${payload}.${base64Url(signature)}`;
}

async function authenticated(request, secret) {
  if (!secret) return false;
  try {
    const header = request.headers.get('Cookie') || '';
    if (header.length > 16384) return false;
    const cookies = header.split(';').map(part => part.trim());
    const matching = cookies.filter(part => part.startsWith(`${SESSION_COOKIE}=`));
    if (matching.length !== 1) return false;
    const token = matching[0].slice(SESSION_COOKIE.length + 1);
    if (token.length > 2048) return false;
    const pieces = token.split('.');
    if (pieces.length !== 2) return false;
    const [payload, signature] = pieces;
    const signatureBytes = unbase64Url(signature);
    if (signatureBytes.length !== 32) return false;
    const key = await sessionKey(secret, ['verify']);
    if (!await crypto.subtle.verify('HMAC', key, signatureBytes, encoder.encode(payload))) return false;
    const parsed = JSON.parse(new TextDecoder().decode(unbase64Url(payload)));
    const now = Math.floor(Date.now() / 1000);
    return parsed.aud === SESSION_AUDIENCE && typeof parsed.nonce === 'string' &&
      Number.isInteger(parsed.iat) && Number.isInteger(parsed.exp) &&
      parsed.iat <= now + 60 && parsed.exp > now && parsed.exp - parsed.iat === SESSION_SECONDS;
  } catch {
    // Cookie decoding errors are an unauthenticated request, not a server error.
    return false;
  }
}

function cookie(token = '', maxAge = SESSION_SECONDS) {
  return `${SESSION_COOKIE}=${token}; Path=${COOKIE_PATH}; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;
}

async function requireAccess(context, mutation = false) {
  if (!await authenticated(context.request, context.env.SESSION_SECRET)) throw new TrainerError(401, 'AUTH_REQUIRED', '가사 트레이닝 로그인이 필요합니다.');
  if (mutation) requireOrigin(context.request);
  if (!configured(context.env)) throw new TrainerError(503, 'NOT_CONFIGURED', '홈페이지의 음원 저장소 연결을 확인해 주세요.');
}

async function ensureSchema(db) {
  let promise = schemaPromises.get(db);
  if (!promise) {
    // D1 exec accepts statements separated by newlines. Keep every complete
    // CREATE statement on a single line for that API's script parser.
    const script = TRAINER_SCHEMA.split(';').map(statement => statement.trim().replace(/\s+/g, ' ')).filter(Boolean).join(';\n') + ';';
    promise = db.exec(script).then(result => {
      if (result?.success === false) throw new Error('Schema initialization failed.');
    }).catch(error => { schemaPromises.delete(db); throw error; });
    schemaPromises.set(db, promise);
  }
  return promise;
}

async function statusFields(context) {
  return {
    ok: true,
    version: 4,
    revision: 'groups-click-v4',
    passwordSource: 'settlement',
    capabilities: { groups: true, countdownClick: true },
    configured: configured(context.env),
    authenticated: await authenticated(context.request, context.env.SESSION_SECRET),
    storageReady: storageReady(context.env),
    maxUploadBytes: MAX_UPLOAD_BYTES
  };
}

export async function status(context) {
  return respond(context, async () => json(await statusFields(context)));
}

async function readJson(request, maximumBytes = 4096) {
  if ((request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase() !== 'application/json') throw new TrainerError(415, 'JSON_REQUIRED', 'JSON 형식으로 요청해 주세요.');
  if (!request.body) throw new TrainerError(400, 'INVALID_JSON', '요청 내용을 확인해 주세요.');
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumBytes) {
        await reader.cancel();
        throw new TrainerError(413, 'REQUEST_TOO_LARGE', '요청 내용이 너무 큽니다.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const buffer = new Uint8Array(size);
  let position = 0;
  for (const chunk of chunks) { buffer.set(chunk, position); position += chunk.byteLength; }
  try {
    const value = JSON.parse(new TextDecoder().decode(buffer));
    if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('Expected object.');
    return value;
  } catch {
    throw new TrainerError(400, 'INVALID_JSON', '요청 내용을 확인해 주세요.');
  }
}

async function run(statement) {
  const result = await statement.run();
  if (result?.success === false) throw new Error('D1 operation failed.');
  return result;
}

export async function login(context) {
  return respond(context, async () => {
    requireOrigin(context.request);
    if (!configured(context.env)) throw new TrainerError(503, 'NOT_CONFIGURED', '홈페이지의 로그인 및 음원 저장소 연결을 확인해 주세요.');
    const body = await readJson(context.request);
    if (typeof body.password !== 'string' || body.password.length > 1000) throw new TrainerError(400, 'INVALID_PASSWORD', '비밀번호를 입력해 주세요.');
    await ensureSchema(context.env.DB);
    const now = Math.floor(Date.now() / 1000);
    const ip = context.request.headers.get('CF-Connecting-IP') || 'unknown';
    const digest = await crypto.subtle.digest('SHA-256', encoder.encode(`${SESSION_AUDIENCE}\n${context.env.SESSION_SECRET}\n${ip}`));
    const hash = base64Url(digest);
    const attempt = await context.env.DB.prepare(`INSERT INTO lyric_trainer_login_attempts (key_hash, window_start, attempts)
      VALUES (?, ?, 1) ON CONFLICT(key_hash) DO UPDATE SET
      attempts = CASE WHEN window_start <= ? THEN 1 ELSE attempts + 1 END,
      window_start = CASE WHEN window_start <= ? THEN excluded.window_start ELSE window_start END
      RETURNING attempts, window_start`).bind(hash, now, now - LOGIN_WINDOW_SECONDS, now - LOGIN_WINDOW_SECONDS).first();
    if (!attempt || !Number.isFinite(Number(attempt.attempts))) throw new Error('Login limiter unavailable.');
    if (Number(attempt.attempts) > LOGIN_LIMIT) {
      const retry = Math.max(1, Number(attempt.window_start) + LOGIN_WINDOW_SECONDS - now);
      throw new TrainerError(429, 'LOGIN_RATE_LIMIT', '로그인 시도가 많습니다. 잠시 후 다시 시도해 주세요.', { 'Retry-After': String(retry) });
    }
    // Remove old limiter rows only in this feature's own table.
    await run(context.env.DB.prepare('DELETE FROM lyric_trainer_login_attempts WHERE window_start < ?').bind(now - LOGIN_WINDOW_SECONDS * 2));
    if (!await verifyPassword(body.password, context.env.SETTLEMENT_ADMIN_PASSWORD)) throw new TrainerError(401, 'INVALID_PASSWORD', '비밀번호가 맞지 않습니다.');
    const token = await sessionToken(context.env.SESSION_SECRET);
    await run(context.env.DB.prepare('DELETE FROM lyric_trainer_login_attempts WHERE key_hash = ?').bind(hash));
    return json({ ...await statusFields(context), authenticated: true }, 200, { 'Set-Cookie': cookie(token) });
  });
}

export async function logout(context) {
  return respond(context, async () => {
    requireOrigin(context.request);
    return json({ ok: true }, 200, { 'Set-Cookie': cookie('', 0) });
  });
}

function trackDto(row) {
  return {
    id: row.id,
    name: row.name,
    fileName: row.file_name,
    bytes: Number(row.bytes),
    mime: row.mime,
    bpm: row.bpm == null ? null : Number(row.bpm),
    offset: Number(row.offset),
    duration: row.duration == null ? null : Number(row.duration),
    createdAt: row.created_at,
    audioUrl: `/api/lyric-trainer/audio/${row.id}`
  };
}

export async function listTracks(context) {
  return respond(context, async () => {
    await requireAccess(context);
    await ensureSchema(context.env.DB);
    const result = await context.env.DB.prepare('SELECT * FROM lyric_trainer_tracks ORDER BY created_at DESC, id DESC').all();
    if (result?.success === false) throw new Error('D1 read failed.');
    return json({ ok: true, tracks: (result.results || []).map(trackDto) });
  });
}

function uploadDescription(request) {
  const lengthHeader = request.headers.get('Content-Length');
  const sizeHeader = request.headers.get('X-File-Size');
  const value = lengthHeader ?? sizeHeader;
  if (!value || !/^\d+$/.test(value)) throw new TrainerError(411, 'LENGTH_REQUIRED', '음원 파일 크기를 확인하지 못했습니다. 파일을 다시 선택해 주세요.');
  const bytes = Number(value);
  if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > MAX_UPLOAD_BYTES) throw new TrainerError(413, 'FILE_TOO_LARGE', '음원 파일은 80MB 이하로 선택해 주세요.');
  if (sizeHeader && (!/^\d+$/.test(sizeHeader) || Number(sizeHeader) !== bytes)) throw new TrainerError(400, 'LENGTH_MISMATCH', '파일 크기 정보가 일치하지 않습니다. 파일을 다시 선택해 주세요.');
  let fileName;
  try { fileName = decodeURIComponent(request.headers.get('X-File-Name') || ''); } catch { throw new TrainerError(400, 'INVALID_FILE_NAME', '파일 이름을 확인해 주세요.'); }
  if (!fileName || fileName.length > 240 || /[\x00-\x1f\x7f/\\]/.test(fileName) || !fileName.trim()) throw new TrainerError(400, 'INVALID_FILE_NAME', '파일 이름을 확인해 주세요.');
  fileName = fileName.trim();
  const extension = fileName.split('.').at(-1).toLowerCase();
  const formats = AUDIO_FORMATS.get(extension);
  const supplied = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (!formats || (supplied && supplied !== 'application/octet-stream' && !formats.includes(supplied))) throw new TrainerError(415, 'UNSUPPORTED_AUDIO', 'MP3, WAV, M4A, AAC, OGG, OPUS, FLAC, WEBM, AIFF 음원을 선택해 주세요.');
  if (!request.body) throw new TrainerError(400, 'EMPTY_FILE', '업로드할 음원 파일을 선택해 주세요.');
  return { bytes, fileName, extension, mime: formats[0], name: fileName.replace(/\.[^.]+$/, '').slice(0, 160) || fileName };
}

function fixedLengthStream(bytes) {
  if (typeof FixedLengthStream === 'function') return new FixedLengthStream(bytes);
  // Portable local-test equivalent. Cloudflare uses FixedLengthStream so R2
  // receives a known-length readable, with streaming backpressure throughout.
  let received = 0;
  return new TransformStream({
    transform(chunk, controller) {
      if (!(chunk instanceof Uint8Array)) throw new Error('Expected audio bytes.');
      received += chunk.byteLength;
      if (received > bytes) throw new Error('Audio exceeds its declared length.');
      controller.enqueue(chunk);
    },
    flush() { if (received !== bytes) throw new Error('Audio is shorter than its declared length.'); }
  });
}

async function storeStream(request, bucket, key, description) {
  const fixed = fixedLengthStream(description.bytes);
  const abort = new AbortController();
  const copying = request.body.pipeTo(fixed.writable, { signal: abort.signal });
  try {
    const [stored] = await Promise.all([
      bucket.put(key, fixed.readable, {
        httpMetadata: { contentType: description.mime, cacheControl: 'private, no-store' },
        customMetadata: { originalName: description.fileName }
      }),
      copying
    ]);
    if (!stored || Number(stored.size) !== description.bytes) throw new Error('Audio storage length mismatch.');
  } catch (error) {
    abort.abort();
    await copying.catch(() => {});
    throw error;
  }
}

export async function uploadTrack(context) {
  return respond(context, async () => {
    await requireAccess(context, true);
    const description = uploadDescription(context.request);
    await ensureSchema(context.env.DB);
    const id = crypto.randomUUID();
    const key = `${PRIVATE_PREFIX}${crypto.randomUUID()}.${description.extension}`;
    const row = { id, name: description.name, file_name: description.fileName, object_key: key, bytes: description.bytes, mime: description.mime, bpm: null, offset: 0, duration: null, created_at: new Date().toISOString() };
    try {
      await storeStream(context.request, context.env.MEDIA, key, description);
      await run(context.env.DB.prepare(`INSERT INTO lyric_trainer_tracks (id, name, file_name, object_key, bytes, mime, bpm, offset, duration, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(row.id, row.name, row.file_name, row.object_key, row.bytes, row.mime, row.bpm, row.offset, row.duration, row.created_at));
    } catch (error) {
      // R2 is written first; failed/partial uploads or failed D1 insertion must
      // not leave a reachable shared track or a normal orphaned object.
      await context.env.MEDIA.delete(key).catch(() => {});
      throw error;
    }
    return json({ ok: true, track: trackDto(row) }, 201);
  });
}

function trackId(context) {
  const id = String(context.params?.id || '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new TrainerError(404, 'TRACK_NOT_FOUND', '음원을 찾지 못했습니다.');
  return id;
}

async function findTrack(context) {
  const id = trackId(context);
  const row = await context.env.DB.prepare('SELECT * FROM lyric_trainer_tracks WHERE id = ?').bind(id).first();
  if (!row || !row.object_key.startsWith(PRIVATE_PREFIX)) throw new TrainerError(404, 'TRACK_NOT_FOUND', '음원을 찾지 못했습니다.');
  return row;
}

function metadata(body, current) {
  const allowed = ['name', 'bpm', 'offset', 'duration'];
  const keys = Object.keys(body);
  if (!keys.length || keys.some(key => !allowed.includes(key))) throw new TrainerError(400, 'INVALID_METADATA', '음원 설정 항목을 확인해 주세요.');
  const next = { ...current };
  if ('name' in body) {
    if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 160 || /[\x00-\x1f\x7f]/.test(body.name)) throw new TrainerError(400, 'INVALID_METADATA', '곡 이름은 1~160자로 입력해 주세요.');
    next.name = body.name.trim();
  }
  if ('bpm' in body) {
    if (body.bpm !== null && (typeof body.bpm !== 'number' || !Number.isFinite(body.bpm) || body.bpm < 40 || body.bpm > 240)) throw new TrainerError(400, 'INVALID_METADATA', 'BPM은 40~240 사이로 입력해 주세요.');
    next.bpm = body.bpm;
  }
  if ('duration' in body) {
    if (body.duration !== null && (typeof body.duration !== 'number' || !Number.isFinite(body.duration) || body.duration <= 0 || body.duration > 86400)) throw new TrainerError(400, 'INVALID_METADATA', '음원 재생 시간을 확인해 주세요.');
    next.duration = body.duration;
  }
  if ('offset' in body) {
    if (typeof body.offset !== 'number' || !Number.isFinite(body.offset) || body.offset < 0 || body.offset > 86400) throw new TrainerError(400, 'INVALID_METADATA', '첫 마디 시작점을 확인해 주세요.');
    next.offset = body.offset;
  }
  if (next.duration != null && next.offset >= next.duration) throw new TrainerError(400, 'INVALID_METADATA', '첫 마디 시작점은 음원 재생 시간보다 앞이어야 합니다.');
  return next;
}

export async function updateTrack(context) {
  return respond(context, async () => {
    await requireAccess(context, true);
    const row = await findTrack(context);
    const body = await readJson(context.request);
    const next = metadata(body, row);
    const fields = ['name', 'bpm', 'offset', 'duration'].filter(field => field in body);
    // Write only supplied columns: a metadata refresh from another device must
    // not overwrite a simultaneous manual BPM/first-bar correction.
    const durationSet = 'duration' in body ? 1 : 0;
    const offsetSet = 'offset' in body ? 1 : 0;
    const saved = await context.env.DB.prepare(`UPDATE lyric_trainer_tracks SET ${fields.map(field => `${field} = ?`).join(', ')} WHERE id = ?
      AND ((CASE WHEN ? THEN ? ELSE duration END) IS NULL OR
        (CASE WHEN ? THEN ? ELSE offset END) < (CASE WHEN ? THEN ? ELSE duration END)) RETURNING *`)
      .bind(...fields.map(field => next[field]), row.id, durationSet, next.duration, offsetSet, next.offset, durationSet, next.duration).first();
    if (!saved) {
      await findTrack(context);
      throw new TrainerError(409, 'METADATA_CONFLICT', '다른 기기에서 곡 설정이 바뀌었습니다. 목록을 새로고침한 뒤 다시 저장해 주세요.');
    }
    return json({ ok: true, track: trackDto(saved) });
  });
}

export async function deleteTrack(context) {
  return respond(context, async () => {
    await requireAccess(context, true);
    await ensureSchema(context.env.DB);
    const row = await findTrack(context);
    // Preserve metadata if R2 deletion fails, so a retry can still find it.
    await context.env.MEDIA.delete(row.object_key);
    try {
      await batch(context.env.DB, [
        context.env.DB.prepare(`UPDATE lyric_trainer_groups SET updated_at = ? WHERE id IN
          (SELECT group_id FROM lyric_trainer_group_members WHERE track_id = ?)`).bind(new Date().toISOString(), row.id),
        context.env.DB.prepare('DELETE FROM lyric_trainer_group_members WHERE track_id = ?').bind(row.id),
        context.env.DB.prepare('DELETE FROM lyric_trainer_tracks WHERE id = ?').bind(row.id)
      ]);
    } catch {
      throw new TrainerError(503, 'DELETE_METADATA_FAILED', '음원 파일은 삭제되었지만 목록을 갱신하지 못했습니다. 다시 삭제해 주세요.');
    }
    return json({ ok: true });
  });
}

const MAX_GROUP_TRACKS = 500;
const GROUP_JSON_BYTES = 64 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function batch(db, statements) {
  const results = await db.batch(statements);
  if (!Array.isArray(results) || results.some(result => result?.success === false)) throw new Error('D1 transaction failed.');
  return results;
}

function groupId(context) {
  const id = String(context.params?.id || '');
  if (!UUID_PATTERN.test(id)) throw new TrainerError(404, 'GROUP_NOT_FOUND', '그룹을 찾지 못했습니다.');
  return id.toLowerCase();
}

function groupChanges(body, creation = false) {
  const keys = Object.keys(body);
  if (!keys.length || keys.some(key => !['name', 'trackIds'].includes(key)) || (creation && !('name' in body))) {
    throw new TrainerError(400, 'INVALID_GROUP', '그룹 이름과 선택한 음원을 확인해 주세요.');
  }
  const changes = {};
  if ('name' in body) {
    if (typeof body.name !== 'string') throw new TrainerError(400, 'INVALID_GROUP', '그룹 이름은 1~80자로 입력해 주세요.');
    const name = body.name.trim().normalize('NFC');
    if (!name || name.length > 80 || /[\x00-\x1f\x7f]/.test(name)) throw new TrainerError(400, 'INVALID_GROUP', '그룹 이름은 1~80자로 입력해 주세요.');
    changes.name = name;
  }
  if ('trackIds' in body || creation) {
    const values = 'trackIds' in body ? body.trackIds : [];
    if (!Array.isArray(values) || values.some(id => typeof id !== 'string' || !UUID_PATTERN.test(id))) {
      throw new TrainerError(400, 'INVALID_GROUP_TRACKS', '그룹에 넣을 음원을 다시 선택해 주세요.');
    }
    changes.trackIds = [...new Set(values.map(id => id.toLowerCase()))];
    if (changes.trackIds.length > MAX_GROUP_TRACKS) throw new TrainerError(400, 'INVALID_GROUP_TRACKS', '한 그룹에는 음원을 500곡까지 넣을 수 있습니다.');
  }
  return changes;
}

async function validateGroupTracks(db, ids) {
  const found = new Set();
  // D1 allows at most 100 bound parameters per query. This also keeps a
  // 500-track request comfortably below the Free plan's query-call limit.
  for (let index = 0; index < ids.length; index += 90) {
    const chunk = ids.slice(index, index + 90);
    const result = await db.prepare(`SELECT id FROM lyric_trainer_tracks WHERE id IN (${chunk.map(() => '?').join(', ')})`).bind(...chunk).all();
    if (result?.success === false) throw new Error('Track validation failed.');
    for (const row of result.results || []) found.add(row.id);
  }
  if (ids.some(id => !found.has(id))) throw new TrainerError(400, 'INVALID_GROUP_TRACKS', '삭제되었거나 찾지 못한 음원이 있습니다. 음원 목록을 새로고침해 주세요.');
}

function memberInserts(db, id, trackIds) {
  const statements = [];
  for (let index = 0; index < trackIds.length; index += 45) {
    const chunk = trackIds.slice(index, index + 45);
    statements.push(db.prepare(`INSERT INTO lyric_trainer_group_members (group_id, track_id) VALUES ${chunk.map(() => '(?, ?)').join(', ')}`)
      .bind(...chunk.flatMap(trackId => [id, trackId])));
  }
  return statements;
}

const GROUP_SELECT = `SELECT g.id, g.name, g.updated_at, t.id AS track_id
  FROM lyric_trainer_groups AS g
  LEFT JOIN lyric_trainer_group_members AS m ON m.group_id = g.id
  LEFT JOIN lyric_trainer_tracks AS t ON t.id = m.track_id`;

function groupDtos(rows) {
  const groups = new Map();
  for (const row of rows) {
    let group = groups.get(row.id);
    if (!group) {
      group = { id: row.id, name: row.name, trackIds: [], updatedAt: row.updated_at };
      groups.set(row.id, group);
    }
    if (row.track_id) group.trackIds.push(row.track_id);
  }
  return [...groups.values()];
}

async function findGroup(context, id = groupId(context)) {
  const result = await context.env.DB.prepare(`${GROUP_SELECT} WHERE g.id = ? ORDER BY m.track_id`).bind(id).all();
  if (result?.success === false) throw new Error('Group read failed.');
  const group = groupDtos(result.results || [])[0];
  if (!group) throw new TrainerError(404, 'GROUP_NOT_FOUND', '그룹을 찾지 못했습니다.');
  return group;
}

function rethrowGroupMutation(error) {
  if (error instanceof TrainerError) throw error;
  const detail = `${error?.message || ''} ${error?.cause?.message || ''}`;
  if (/UNIQUE constraint failed:\s*lyric_trainer_groups\.name/i.test(detail)) {
    throw new TrainerError(409, 'GROUP_NAME_EXISTS', '같은 이름의 그룹이 있습니다. 다른 이름을 입력해 주세요.');
  }
  if (/FOREIGN KEY constraint failed/i.test(detail)) {
    throw new TrainerError(409, 'GROUP_CONFLICT', '선택한 그룹이나 음원이 변경되었습니다. 목록을 새로고침한 뒤 다시 저장해 주세요.');
  }
  throw error;
}

export async function listGroups(context) {
  return respond(context, async () => {
    await requireAccess(context);
    await ensureSchema(context.env.DB);
    const result = await context.env.DB.prepare(`${GROUP_SELECT} ORDER BY g.name COLLATE NOCASE, g.id, m.track_id`).all();
    if (result?.success === false) throw new Error('Group list failed.');
    return json({ ok: true, groups: groupDtos(result.results || []) });
  });
}

export async function createGroup(context) {
  return respond(context, async () => {
    await requireAccess(context, true);
    const changes = groupChanges(await readJson(context.request, GROUP_JSON_BYTES), true);
    await ensureSchema(context.env.DB);
    await validateGroupTracks(context.env.DB, changes.trackIds);
    const id = crypto.randomUUID();
    const updatedAt = new Date().toISOString();
    try {
      await batch(context.env.DB, [
        context.env.DB.prepare('INSERT INTO lyric_trainer_groups (id, name, updated_at) VALUES (?, ?, ?)').bind(id, changes.name, updatedAt),
        ...memberInserts(context.env.DB, id, changes.trackIds)
      ]);
    } catch (error) {
      rethrowGroupMutation(error);
    }
    return json({ ok: true, group: await findGroup(context, id) }, 201);
  });
}

export async function updateGroup(context) {
  return respond(context, async () => {
    await requireAccess(context, true);
    const id = groupId(context);
    const changes = groupChanges(await readJson(context.request, GROUP_JSON_BYTES));
    await ensureSchema(context.env.DB);
    await findGroup(context, id);
    if ('trackIds' in changes) await validateGroupTracks(context.env.DB, changes.trackIds);
    const statements = [context.env.DB.prepare(`UPDATE lyric_trainer_groups SET updated_at = ?${'name' in changes ? ', name = ?' : ''} WHERE id = ?`)
      .bind(new Date().toISOString(), ...('name' in changes ? [changes.name] : []), id)];
    if ('trackIds' in changes) statements.push(
      context.env.DB.prepare('DELETE FROM lyric_trainer_group_members WHERE group_id = ?').bind(id),
      ...memberInserts(context.env.DB, id, changes.trackIds)
    );
    try {
      await batch(context.env.DB, statements);
    } catch (error) {
      rethrowGroupMutation(error);
    }
    return json({ ok: true, group: await findGroup(context, id) });
  });
}

export async function deleteGroup(context) {
  return respond(context, async () => {
    await requireAccess(context, true);
    const id = groupId(context);
    await ensureSchema(context.env.DB);
    await findGroup(context, id);
    await batch(context.env.DB, [
      context.env.DB.prepare('DELETE FROM lyric_trainer_group_members WHERE group_id = ?').bind(id),
      context.env.DB.prepare('DELETE FROM lyric_trainer_groups WHERE id = ?').bind(id)
    ]);
    return json({ ok: true });
  });
}

function byteRange(header, size) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return false;
  const first = match[1] ? Number(match[1]) : null;
  const second = match[2] ? Number(match[2]) : null;
  if ((first !== null && !Number.isSafeInteger(first)) || (second !== null && !Number.isSafeInteger(second))) return false;
  if (first === null) {
    if (second <= 0) return false;
    return { start: Math.max(0, size - second), end: size - 1 };
  }
  if (first >= size || (second !== null && second < first)) return false;
  return { start: first, end: Math.min(size - 1, second ?? size - 1) };
}

export async function serveAudio(context) {
  return respond(context, async () => {
    await requireAccess(context);
    const row = await findTrack(context);
    const head = await context.env.MEDIA.head(row.object_key);
    if (!head || Number(head.size) <= 0) throw new TrainerError(404, 'AUDIO_NOT_FOUND', '저장된 음원을 찾지 못했습니다. 목록을 새로고침해 주세요.');
    const size = Number(head.size);
    const range = byteRange(context.request.headers.get('Range'), size);
    const headers = new Headers({
      'Content-Type': row.mime,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(row.file_name)}`,
      Vary: 'Cookie'
    });
    if (range === false) {
      headers.set('Content-Range', `bytes */${size}`);
      headers.set('Content-Length', '0');
      return new Response(null, { status: 416, headers });
    }
    const statusCode = range ? 206 : 200;
    const length = range ? range.end - range.start + 1 : size;
    headers.set('Content-Length', String(length));
    if (range) headers.set('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
    if (context.request.method === 'HEAD') return new Response(null, { status: statusCode, headers });
    const object = await context.env.MEDIA.get(row.object_key, range ? { range: { offset: range.start, length } } : undefined);
    if (!object?.body) throw new TrainerError(404, 'AUDIO_NOT_FOUND', '저장된 음원을 찾지 못했습니다. 목록을 새로고침해 주세요.');
    return new Response(object.body, { status: statusCode, headers });
  });
}
