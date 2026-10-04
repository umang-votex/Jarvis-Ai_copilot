import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const dataDir = join(root, '.jarvis-data');
mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(join(dataDir, 'jarvis.sqlite'));
db.exec(`PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_salt BLOB NOT NULL,
  password_hash BLOB NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS student_records (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
CREATE TABLE IF NOT EXISTS lms_items (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('lecture','test','coding')),
  title TEXT NOT NULL,
  course TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  content_json TEXT NOT NULL DEFAULT '{}',
  file_name TEXT,
  mime_type TEXT,
  file_data BLOB,
  author_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS lms_attempts (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES lms_items(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  response_json TEXT NOT NULL DEFAULT '{}',
  score INTEGER NOT NULL DEFAULT 0,
  max_score INTEGER NOT NULL DEFAULT 0,
  submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS lms_items_created_idx ON lms_items(created_at DESC);
CREATE INDEX IF NOT EXISTS lms_attempts_item_idx ON lms_attempts(item_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS lms_attempts_student_idx ON lms_attempts(student_id, submitted_at DESC);
CREATE TABLE IF NOT EXISTS lms_events (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('class','break','exam','test','assignment')),
  title TEXT NOT NULL,
  course TEXT NOT NULL DEFAULT '',
  start_at TEXT NOT NULL,
  end_at TEXT,
  details TEXT NOT NULL DEFAULT '',
  author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS lms_events_start_idx ON lms_events(start_at);
CREATE INDEX IF NOT EXISTS lms_events_teacher_idx ON lms_events(author_id,start_at);
CREATE TABLE IF NOT EXISTS lms_flashcard_decks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  course TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  cards_json TEXT NOT NULL,
  author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS lms_flashcards_created_idx ON lms_flashcard_decks(created_at DESC);`);
if (!db.prepare('PRAGMA table_info(users)').all().some(column => column.name === 'role')) {
  db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'student'");
}
const sessionMaxAge = 7 * 24 * 60 * 60;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const hashSession = token => createHash('sha256').update(token).digest('hex');
function sessionUser(req) {
  const token = String(req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith('jarvis_session='))?.slice('jarvis_session='.length);
  if (!token) return null;
  const row = db.prepare('SELECT users.id, users.email, users.name, users.role FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.token_hash=? AND sessions.expires_at>?').get(hashSession(token), Date.now());
  return row || null;
}
function createSession(res, userId, req) {
  const token = randomBytes(32).toString('base64url');
  db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(Date.now());
  db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(hashSession(token), userId, Date.now() + sessionMaxAge * 1000);
  const secure = process.env.RENDER || req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `jarvis_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${sessionMaxAge}${secure}`);
}
async function requestJSON(req, limit = 64 * 1024) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > limit) throw Object.assign(new Error('Request is too large.'), { statusCode: 413 });
  }
  try { return JSON.parse(raw || '{}'); } catch { throw Object.assign(new Error('Invalid JSON request.'), { statusCode: 400 }); }
}
function setStudentData(userId, data) {
  db.prepare(`INSERT INTO student_records(user_id,data,updated_at) VALUES(?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(user_id) DO UPDATE SET data=excluded.data, updated_at=CURRENT_TIMESTAMP`).run(userId, JSON.stringify(data));
}
const envPath = join(root, '.env.local');
try {
  for (const line of (await readFile(envPath, 'utf8')).split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
} catch { /* Environment variables can be used instead of .env.local. */ }

const mime = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
const send = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
const maxBody = 18 * 1024 * 1024;
const assistantRequests = new Map();
let dailyCount = 0;
let quotaDay = new Date().toISOString().slice(0, 10);
const dailyLimit = Math.max(1, Number(process.env.DAILY_AI_LIMIT || 120));

function assistantLimitReached(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',').map(value => value.trim()).filter(Boolean);
  const ip = forwarded.at(-1) || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const minute = Math.floor(now / 60_000);
  const currentDay = new Date().toISOString().slice(0, 10);
  if (currentDay !== quotaDay) { quotaDay = currentDay; dailyCount = 0; }
  for (const [key, value] of assistantRequests) if (value.minute !== minute) assistantRequests.delete(key);
  const record = assistantRequests.get(ip) || { minute, count: 0 };
  if (record.minute !== minute) { record.minute = minute; record.count = 0; }
  if (record.count >= 8 || dailyCount >= dailyLimit) return true;
  record.count++;
  dailyCount++;
  assistantRequests.set(ip, record);
  return false;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    const host = String(req.headers.host || '').toLowerCase();
    const origin = req.headers.origin;
    let originHost = '';
    try { originHost = origin ? new URL(origin).host.toLowerCase() : ''; } catch { return send(res, 403, { error: 'Invalid request origin.' }); }
    if (!host || (originHost && originHost !== host)) {
      return send(res, 403, { error: 'Same-origin requests only.' });
    }
  }
  if (url.pathname === '/healthz' && req.method === 'GET') return send(res, 200, { ok: true });
  if (url.pathname === '/api/status' && req.method === 'GET') {
    let local = { available: false, models: [] };
    try {
      const response = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(1300) });
      if (response.ok) { const data = await response.json(); local = { available: true, models: (data.models || []).map(m => m.name).filter(Boolean) }; }
    } catch { /* Ollama is optional and may not be installed yet. */ }
    return send(res, 200, { providers: { local, openai: { available: Boolean(process.env.OPENAI_API_KEY) } } });
  }
  if (url.pathname === '/api/auth/me' && req.method === 'GET') {
    const user = sessionUser(req);
    return send(res, 200, { user: user ? { id: user.id, name: user.name, email: user.email, role: user.role } : null });
  }
  if ((url.pathname === '/api/auth/signup' || url.pathname === '/api/auth/login') && req.method === 'POST') {
    try {
      const body = await requestJSON(req);
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      if (!emailPattern.test(email) || email.length > 254) return send(res, 400, { error: 'Enter a valid email address.' });
      if (password.length < 8 || password.length > 128) return send(res, 400, { error: 'Use a password between 8 and 128 characters.' });
      if (url.pathname.endsWith('/signup')) {
        const name = String(body.name || '').trim().replace(/\s+/g, ' ').replace(/[^\p{L}\p{M}\s'.-]/gu, '').slice(0, 40);
        if (!name) return send(res, 400, { error: 'Enter your name.' });
        if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) return send(res, 409, { error: 'An account with that email already exists. Sign in instead.' });
        const id = randomUUID(), salt = randomBytes(16), passwordHash = scryptSync(password, salt, 64);
        const role = body.role === 'teacher' ? 'teacher' : 'student';
        db.prepare('INSERT INTO users(id,email,name,password_salt,password_hash,role) VALUES(?,?,?,?,?,?)').run(id, email, name, salt, passwordHash, role);
        createSession(res, id, req);
        return send(res, 201, { user: { id, name, email, role } });
      }
      const account = db.prepare('SELECT id,email,name,password_salt,password_hash,role FROM users WHERE email=?').get(email);
      if (!account) return send(res, 401, { error: 'Email or password is incorrect.' });
      const candidate = scryptSync(password, account.password_salt, 64);
      if (!timingSafeEqual(candidate, account.password_hash)) return send(res, 401, { error: 'Email or password is incorrect.' });
      createSession(res, account.id, req);
      return send(res, 200, { user: { id: account.id, name: account.name, email: account.email, role: account.role } });
    } catch (error) { return send(res, error.statusCode || 400, { error: error.message || 'Could not create your account.' }); }
  }
  if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
    const token = String(req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith('jarvis_session='))?.slice('jarvis_session='.length);
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hashSession(token));
    res.setHeader('Set-Cookie', 'jarvis_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
    return send(res, 200, { ok: true });
  }
  if (url.pathname === '/api/lms/items' && req.method === 'GET') {
    const user = sessionUser(req);
    if (!user) return send(res, 401, { error: 'Sign in to open the classroom.' });
    const filter = user.role === 'teacher' ? 'WHERE i.author_id=?' : '';
    const items = db.prepare(`SELECT i.id,i.kind,i.title,i.course,i.description,i.content_json,i.file_name,i.author_id,i.created_at,u.name AS teacher_name
      FROM lms_items i JOIN users u ON u.id=i.author_id ${filter} ORDER BY i.created_at DESC`).all(...(user.role === 'teacher' ? [user.id] : [])).map(item => {
      const content = JSON.parse(item.content_json || '{}');
      if (item.kind === 'test') content.questions = (content.questions || []).map(({ answer, ...question }) => question);
      return { ...item, content };
    });
    return send(res, 200, { items, role: user.role, name: user.name });
  }
  if (url.pathname === '/api/lms/events' && req.method === 'GET') {
    const user = sessionUser(req);
    if (!user) return send(res, 401, { error: 'Sign in to view the class planner.' });
    const where = user.role === 'teacher' ? 'WHERE e.author_id=?' : '';
    const events = db.prepare(`SELECT e.id,e.kind,e.title,e.course,e.start_at,e.end_at,e.details,e.author_id,e.created_at,u.name AS teacher_name
      FROM lms_events e JOIN users u ON u.id=e.author_id ${where} ORDER BY e.start_at ASC LIMIT 300`).all(...(user.role === 'teacher' ? [user.id] : []));
    return send(res, 200, { events, role: user.role });
  }
  if (url.pathname === '/api/lms/events' && req.method === 'POST') {
    const user = sessionUser(req);
    if (!user) return send(res, 401, { error: 'Sign in to plan a class.' });
    if (user.role !== 'teacher') return send(res, 403, { error: 'Only teachers can publish calendar events.' });
    try {
      const body = await requestJSON(req);
      const kind = String(body.kind || ''), title = String(body.title || '').trim().slice(0, 120), course = String(body.course || '').trim().slice(0, 100);
      const startAt = String(body.startAt || ''), endAt = String(body.endAt || ''), details = String(body.details || '').trim().slice(0, 1200);
      if (!['class','break','exam','test','assignment'].includes(kind) || !title || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(startAt) || Number.isNaN(new Date(startAt).getTime())) return send(res, 400, { error: 'Enter an event type, title, and valid date and time.' });
      if (endAt && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(endAt) || Number.isNaN(new Date(endAt).getTime()) || new Date(endAt) <= new Date(startAt))) return send(res, 400, { error: 'End time must be after the start time.' });
      const id = randomUUID();
      db.prepare('INSERT INTO lms_events(id,kind,title,course,start_at,end_at,details,author_id) VALUES(?,?,?,?,?,?,?,?)').run(id, kind, title, course, startAt, endAt || null, details, user.id);
      return send(res, 201, { ok: true, id });
    } catch (error) { return send(res, error.statusCode || 400, { error: error.message || 'Could not save the calendar event.' }); }
  }
  const eventMatch = url.pathname.match(/^\/api\/lms\/events\/([0-9a-f-]{36})$/i);
  if (eventMatch && req.method === 'DELETE') {
    const user = sessionUser(req);
    if (!user) return send(res, 401, { error: 'Sign in to update your planner.' });
    if (user.role !== 'teacher') return send(res, 403, { error: 'Only teachers can remove planner events.' });
    const result = db.prepare('DELETE FROM lms_events WHERE id=? AND author_id=?').run(eventMatch[1], user.id);
    return result.changes ? send(res, 200, { ok: true }) : send(res, 404, { error: 'Planner event not found.' });
  }
  if (url.pathname === '/api/lms/flashcards' && req.method === 'GET') {
    const user = sessionUser(req);
    if (!user) return send(res, 401, { error: 'Sign in to open flashcards.' });
    const filter = user.role === 'teacher' ? 'WHERE d.author_id=?' : '';
    const decks = db.prepare(`SELECT d.id,d.title,d.course,d.description,d.cards_json,d.author_id,d.created_at,u.name AS teacher_name FROM lms_flashcard_decks d JOIN users u ON u.id=d.author_id ${filter} ORDER BY d.created_at DESC`).all(...(user.role === 'teacher' ? [user.id] : []));
    return send(res, 200, { decks: decks.map(deck => ({ id: deck.id, title: deck.title, course: deck.course, description: deck.description, cards: JSON.parse(deck.cards_json), author_id: deck.author_id, created_at: deck.created_at, teacher_name: deck.teacher_name })) });
  }
  if (url.pathname === '/api/lms/flashcards' && req.method === 'POST') {
    const user = sessionUser(req);
    if (!user) return send(res, 401, { error: 'Sign in to create flashcards.' });
    if (user.role !== 'teacher') return send(res, 403, { error: 'Only teachers can publish flashcard decks.' });
    try {
      const body = await requestJSON(req, 256 * 1024), title = String(body.title || '').trim().slice(0, 120), course = String(body.course || '').trim().slice(0, 100);
      const description = String(body.description || '').trim().slice(0, 1200), cards = Array.isArray(body.cards) ? body.cards : [];
      if (!title || !course || cards.length < 2 || cards.length > 100 || cards.some(card => !String(card.front || '').trim() || !String(card.back || '').trim())) return send(res, 400, { error: 'Enter a title, course, and 2 to 100 flashcards with both sides filled in.' });
      const normalized = cards.map(card => ({ front: String(card.front).trim().slice(0, 1200), back: String(card.back).trim().slice(0, 2400) }));
      const id = randomUUID();
      db.prepare('INSERT INTO lms_flashcard_decks(id,title,course,description,cards_json,author_id) VALUES(?,?,?,?,?,?)').run(id, title, course, description, JSON.stringify(normalized), user.id);
      return send(res, 201, { ok: true, id });
    } catch (error) { return send(res, error.statusCode || 400, { error: error.message || 'Could not publish flashcards.' }); }
  }
  if (url.pathname === '/api/lms/items' && req.method === 'POST') {
    const user = sessionUser(req);
    if (!user) return send(res, 401, { error: 'Sign in to publish classroom content.' });
    if (user.role !== 'teacher') return send(res, 403, { error: 'Only teacher accounts can publish classroom content.' });
    try {
      const body = await requestJSON(req, 16 * 1024 * 1024);
      const kind = String(body.kind || ''), title = String(body.title || '').trim().slice(0, 120), course = String(body.course || '').trim().slice(0, 100);
      const description = String(body.description || '').trim().slice(0, 3000);
      const content = body.content && typeof body.content === 'object' && !Array.isArray(body.content) ? body.content : {};
      if (!['lecture','test','coding'].includes(kind) || !title || !course) return send(res, 400, { error: 'Choose a content type and enter its title and course.' });
      let fileName = null, mimeType = null, fileData = null;
      if (kind === 'lecture' || kind === 'test') {
        if (body.fileData) {
          fileName = String(body.fileName || 'lecture.pdf').replace(/[\\/\r\n]/g, '_').slice(0, 180);
          mimeType = String(body.mimeType || 'application/pdf');
          if (mimeType !== 'application/pdf' || !fileName.toLowerCase().endsWith('.pdf')) return send(res, 400, { error: 'Upload a PDF file.' });
          const encoded = String(body.fileData).replace(/^data:application\/pdf;base64,/i, '');
          if (encoded.length > 14 * 1024 * 1024) return send(res, 413, { error: 'PDF must be smaller than 10 MB.' });
          fileData = Buffer.from(encoded, 'base64');
          if (fileData.subarray(0, 5).toString() !== '%PDF-') return send(res, 400, { error: 'That file is not a valid PDF.' });
        }
        if (kind === 'lecture' && !fileData) return send(res, 400, { error: 'Choose a lecture PDF to upload.' });
        if (kind === 'test' && (!Array.isArray(content.questions) || content.questions.length < 1 || content.questions.length > 30 || content.questions.some(q => !q.question || !q.answer))) return send(res, 400, { error: 'A test needs 1 to 30 questions, each with an answer key.' });
      }
      if (kind === 'coding') {
        if (!/^[A-Za-z_$][\w$]{0,50}$/.test(String(content.functionName || '')) || typeof content.starterCode !== 'string' || !Array.isArray(content.tests) || content.tests.length < 1 || content.tests.length > 20) return send(res, 400, { error: 'Coding problem needs a function name, starter code, and 1 to 20 tests.' });
        for (const test of content.tests) if (!Array.isArray(test.input) || !Object.hasOwn(test, 'expected')) return send(res, 400, { error: 'Each coding test needs an input array and expected result.' });
      }
      const id = randomUUID();
      db.prepare('INSERT INTO lms_items(id,kind,title,course,description,content_json,file_name,mime_type,file_data,author_id) VALUES(?,?,?,?,?,?,?,?,?,?)')
        .run(id, kind, title, course, description, JSON.stringify(content), fileName, mimeType, fileData, user.id);
      return send(res, 201, { ok: true, id });
    } catch (error) { return send(res, error.statusCode || 400, { error: error.message || 'Could not publish classroom content.' }); }
  }
  const fileMatch = url.pathname.match(/^\/api\/lms\/items\/([0-9a-f-]{36})\/file$/i);
  if (fileMatch && req.method === 'GET') {
    if (!sessionUser(req)) return send(res, 401, { error: 'Sign in to open this PDF.' });
    const item = db.prepare('SELECT file_name,mime_type,file_data FROM lms_items WHERE id=?').get(fileMatch[1]);
    if (!item?.file_data) return send(res, 404, { error: 'PDF not found.' });
    res.writeHead(200, { 'Content-Type': item.mime_type || 'application/pdf', 'Content-Disposition': `inline; filename="${String(item.file_name || 'lecture.pdf').replace(/["\r\n]/g, '')}"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
    return res.end(item.file_data);
  }
  const attemptMatch = url.pathname.match(/^\/api\/lms\/items\/([0-9a-f-]{36})\/attempts$/i);
  if (attemptMatch && req.method === 'GET') {
    const user = sessionUser(req);
    if (!user) return send(res, 401, { error: 'Sign in to view attempts.' });
    if (user.role !== 'teacher') return send(res, 403, { error: 'Only teachers can review submissions.' });
    const owns = db.prepare('SELECT 1 FROM lms_items WHERE id=? AND author_id=?').get(attemptMatch[1], user.id);
    if (!owns) return send(res, 404, { error: 'Assignment not found.' });
    const attempts = db.prepare('SELECT a.id,a.response_json,a.score,a.max_score,a.submitted_at,u.name AS student_name FROM lms_attempts a JOIN users u ON u.id=a.student_id WHERE a.item_id=? ORDER BY a.submitted_at DESC').all(attemptMatch[1]);
    return send(res, 200, { attempts: attempts.map(a => ({ ...a, response: JSON.parse(a.response_json) })) });
  }
  if (attemptMatch && req.method === 'POST') {
    const user = sessionUser(req);
    if (!user) return send(res, 401, { error: 'Sign in to submit your work.' });
    if (user.role !== 'student') return send(res, 403, { error: 'Teacher accounts cannot submit student attempts.' });
    try {
      const body = await requestJSON(req, 128 * 1024);
      const item = db.prepare('SELECT id,kind,content_json FROM lms_items WHERE id=?').get(attemptMatch[1]);
      if (!item || !['test','coding'].includes(item.kind)) return send(res, 404, { error: 'Assessment not found.' });
      const content = JSON.parse(item.content_json), response = body.response && typeof body.response === 'object' ? body.response : {};
      let score = 0, maxScore = 0, saved = {};
      if (item.kind === 'test') {
        const questions = content.questions || {}, answers = response.answers || {};
        maxScore = questions.length;
        questions.forEach((question, index) => { if (String(answers[index] ?? '').trim().toLowerCase() === String(question.answer).trim().toLowerCase()) score++; });
        saved = { answers };
      } else {
        const code = String(response.code || '').slice(0, 10000);
        score = Math.max(0, Math.min(content.tests.length, Number(response.passed) || 0));
        maxScore = content.tests.length;
        saved = { code, passed: score, note: 'Code results were evaluated in the student browser for this prototype.' };
      }
      const id = randomUUID();
      db.prepare('INSERT INTO lms_attempts(id,item_id,student_id,response_json,score,max_score) VALUES(?,?,?,?,?,?)').run(id, item.id, user.id, JSON.stringify(saved), score, maxScore);
      return send(res, 201, { ok: true, id, score, maxScore });
    } catch (error) { return send(res, error.statusCode || 400, { error: error.message || 'Could not save your submission.' }); }
  }
  if (url.pathname === '/api/campus' && (req.method === 'GET' || req.method === 'PUT')) {
    const user = sessionUser(req);
    if (!user) return send(res, 401, { error: 'Sign in to access your student hub.' });
    if (req.method === 'GET') {
      const row = db.prepare('SELECT data FROM student_records WHERE user_id=?').get(user.id);
      return send(res, 200, { data: row ? JSON.parse(row.data) : null });
    }
    try {
      const { data } = await requestJSON(req, 2 * 1024 * 1024);
      if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).length > 40 || Object.values(data).some(rows => !Array.isArray(rows) || rows.length > 1000)) return send(res, 400, { error: 'Student hub data format is invalid.' });
      setStudentData(user.id, data);
      return send(res, 200, { ok: true });
    } catch (error) { return send(res, error.statusCode || 400, { error: error.message || 'Could not save student hub data.' }); }
  }
  if (url.pathname === '/api/assistant' && req.method === 'POST') {
    if (!sessionUser(req)) return send(res, 401, { error: 'Sign in to use JARVIS AI.' });
    if (assistantLimitReached(req)) return send(res, 429, { error: `JARVIS has reached its request limit. Try again later (daily service cap: ${dailyLimit}).` });
    try {
      let raw = '';
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > maxBody) return send(res, 413, { error: 'That upload is too large. Try a file under 12 MB.' });
      }
      const { action = 'chat', question = '', noteText = '', fileData = '', fileName = '', context = '', provider = 'local', model = '' } = JSON.parse(raw || '{}');
      const tasks = {
        chat: 'Answer the student question using their notes when provided. Cite the relevant idea in plain language, including a page number when notes contain [Page N] markers. If the notes do not contain the answer, say so clearly.',
        summary: 'Summarize the uploaded study material into clear, exam-focused key ideas and definitions.',
        quiz: 'Create 5 multiple-choice questions from the uploaded study material. Include four choices per question, mark the correct answer, and give a one-sentence explanation.',
        flashcards: 'Create 6 concise study flashcards from the topic or uploaded study material. Return only valid JSON shaped as {"cards":[{"front":"question or term","back":"concise answer"}]}.',
        explain: 'Explain the most important difficult idea in the uploaded material in plain language. Include a small example.',
        plan: 'Make a realistic plan for the rest of the student’s day. Respect class times and deadlines. Suggest one immediate action and explain why it comes first.',
      };
      const quizTask = !noteText && action === 'quiz' ? 'Create a 5-question multiple-choice quiz about the student topic in the request. Use clear, accurate concepts at the requested difficulty. Return only valid JSON shaped as {"questions":[{"question":"...","choices":["...","...","...","..."],"answer":"exact matching choice","explanation":"..."}]}. Make exactly five questions and four choices each.' : tasks.quiz;
      const instruction = `You are JARVIS, a careful student copilot. Be concise, useful, and encouraging. Never invent class or deadline data. ${action === 'quiz' ? quizTask : tasks[action] || tasks.chat}`;
      const prompt = `Student context:\n${context.slice(0, 12000)}\n\nStudent request: ${String(question).slice(0, 3000)}${noteText ? `\n\nUploaded notes (${fileName}):\n${String(noteText).slice(0, 60000)}` : ''}`;
      if (provider === 'local') {
        if (fileData) return send(res, 400, { error: 'For local AI, use TXT or Markdown notes. PDF study files are supported with the OpenAI provider.' });
        const tags = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(2000) }).then(r => r.ok ? r.json() : Promise.reject(new Error('Ollama did not respond.'))).catch(() => null);
        if (!tags) return send(res, 503, { error: 'Ollama is not running. Install Ollama, download a local model, and restart JARVIS.' });
        const availableModels = (tags.models || []).map(m => m.name).filter(Boolean);
        const selected = String(model || process.env.LOCAL_MODEL || availableModels[0] || '');
        if (!availableModels.includes(selected)) return send(res, 503, { error: availableModels.length ? 'Choose one of the installed local models.' : 'Ollama is running but has no model. Pull a model first, then refresh JARVIS.' });
        const local = await fetch('http://127.0.0.1:11434/api/chat', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(180000),
          body: JSON.stringify({ model: selected, stream: false, think: false, options: { num_predict: 1024, temperature: 0.4 }, messages: [{ role: 'system', content: instruction }, { role: 'user', content: prompt }] }),
        });
        const data = await local.json();
        if (!local.ok) return send(res, local.status, { error: data.error || 'The local model could not complete this request.' });
        return send(res, 200, { answer: data.message?.content || 'The local model returned an empty answer.', model: selected, provider: 'local' });
      }
      if (!process.env.OPENAI_API_KEY) return send(res, 503, { error: 'OpenAI is not configured. Choose Local AI or add an API key in .env.local.' });
      const content = [{ type: 'input_text', text: prompt }];
      if (fileData) content.push({ type: 'input_file', filename: String(fileName || 'study-notes.pdf').slice(0, 160), file_data: fileData });
      const upstream = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(120000),
        body: JSON.stringify({ model: process.env.OPENAI_MODEL || 'gpt-4.1-mini', instructions: instruction, input: [{ role: 'user', content }] }),
      });
      const data = await upstream.json();
      if (!upstream.ok) return send(res, upstream.status, { error: data.error?.message || 'The AI service could not complete the request.' });
      const answer = data.output_text || data.output?.flatMap(item => item.content || []).map(item => item.text || '').filter(Boolean).join('\n') || 'I could not find a text answer in that response.';
      return send(res, 200, { answer, model: process.env.OPENAI_MODEL || 'gpt-4.1-mini' });
    } catch (error) {
      return send(res, 400, { error: error.message || 'Could not process this AI request.' });
    }
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed.' });
  const requested = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
  if (requested.split(/[\\/]/).some(part => part.startsWith('.'))) return send(res, 404, { error: 'Not found.' });
  const path = normalize(join(root, requested));
  if (!path.startsWith(root)) return send(res, 403, { error: 'Forbidden.' });
  try {
    const body = await readFile(path);
    res.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    return req.method === 'HEAD' ? res.end() : res.end(body);
  } catch { return send(res, 404, { error: 'Not found.' }); }
});

server.listen(Number(process.env.PORT || 8765), process.env.HOST || (process.env.RENDER ? '0.0.0.0' : '127.0.0.1'), () => {
  console.log(`JARVIS is running at http://127.0.0.1:${server.address().port}`);
  console.log(process.env.OPENAI_API_KEY ? `Live AI ready (${process.env.OPENAI_MODEL || 'gpt-4.1-mini'}).` : 'Live AI is off. Add OPENAI_API_KEY to .env.local to enable it.');
});
