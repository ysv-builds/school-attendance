require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const path = require('path');
const db = require('./db');
const { sendAbsenceSms } = require('./sms');

const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';
let SECRET = process.env.JWT_SECRET;
if (!SECRET) {
  SECRET = crypto.randomBytes(32).toString('hex');
  console.warn('WARNING: JWT_SECRET not set. Users will be logged out on every restart. Set it in .env.');
}

const app = express();
app.set('trust proxy', 1); // the host's HTTPS proxy sits in front; needed so login limits work per user, not per proxy
app.get('/healthz', (req, res) => res.send('ok'));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- helpers ----------
const isDate = d => /^\d{4}-\d{2}-\d{2}$/.test(d || '') && !isNaN(new Date(d));
const todayStr = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const cleanPhone = p => {
  const n = String(p || '').replace(/\D/g, '').slice(-10);
  return /^[6-9]\d{9}$/.test(n) ? n : null;
};
const wrap = fn => (req, res) => Promise.resolve(fn(req, res)).catch(e => {
  console.error(e);
  res.status(500).json({ error: 'Server error' });
});

// ---------- first-run admin ----------
if (!db.prepare('SELECT 1 FROM users LIMIT 1').get()) {
  const pw = process.env.ADMIN_PASSWORD || crypto.randomBytes(5).toString('hex');
  db.prepare('INSERT INTO users (name, username, password_hash, role) VALUES (?,?,?,?)')
    .run('Administrator', 'admin', bcrypt.hashSync(pw, 10), 'admin');
  console.log('==============================================');
  console.log(' First run: admin account created');
  console.log('   username: admin');
  console.log('   password: ' + pw);
  console.log(' Log in and change the password now.');
  console.log('==============================================');
}

// ---------- auth ----------
const attempts = new Map();
function loginLimited(ip) {
  const now = Date.now();
  const a = attempts.get(ip) || { n: 0, reset: now + 15 * 60 * 1000 };
  if (now > a.reset) { a.n = 0; a.reset = now + 15 * 60 * 1000; }
  attempts.set(ip, a);
  return a.n >= 10;
}

app.post('/api/login', (req, res) => {
  if (loginLimited(req.ip)) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  const { username, password } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username || '').trim());
  if (!u || !bcrypt.compareSync(String(password || ''), u.password_hash)) {
    attempts.get(req.ip).n++;
    return res.status(401).json({ error: 'Wrong username or password' });
  }
  const token = jwt.sign({ id: u.id }, SECRET, { expiresIn: '12h' });
  res.cookie('token', token, { httpOnly: true, sameSite: 'strict', secure: IS_PROD, maxAge: 12 * 3600 * 1000 });
  res.json({ id: u.id, name: u.name, role: u.role });
});

app.post('/api/logout', (req, res) => { res.clearCookie('token'); res.json({ ok: true }); });

function auth(req, res, next) {
  try {
    const { id } = jwt.verify(req.cookies.token, SECRET);
    const u = db.prepare('SELECT id, name, username, role FROM users WHERE id = ?').get(id);
    if (!u) throw new Error('no user');
    req.user = u;
    next();
  } catch (_) { res.status(401).json({ error: 'Please log in' }); }
}
const adminOnly = (req, res, next) =>
  req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Admin only' });

app.get('/api/me', auth, (req, res) => res.json(req.user));

app.post('/api/change-password', auth, (req, res) => {
  const { old_password, new_password } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(String(old_password || ''), u.password_hash)) return res.status(400).json({ error: 'Old password is wrong' });
  if (String(new_password || '').length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(new_password, 10), u.id);
  res.json({ ok: true });
});

// ---------- classes & attendance ----------
function canAccessClass(user, cls) {
  if (user.role === 'admin') return true;
  return !!db.prepare('SELECT 1 FROM class_teachers WHERE user_id = ? AND class_name = ?').get(user.id, cls);
}

app.get('/api/classes', auth, (req, res) => {
  const rows = req.user.role === 'admin'
    ? db.prepare('SELECT DISTINCT class_name FROM students ORDER BY class_name').all()
    : db.prepare('SELECT class_name FROM class_teachers WHERE user_id = ? ORDER BY class_name').all(req.user.id);
  res.json(rows.map(r => r.class_name));
});

app.get('/api/attendance', auth, (req, res) => {
  const { date, class_name } = req.query;
  if (!isDate(date) || !class_name) return res.status(400).json({ error: 'date and class_name required' });
  if (!canAccessClass(req.user, class_name)) return res.status(403).json({ error: 'Not your class' });
  const rows = db.prepare(`
    SELECT s.id, s.name, s.roll, s.parent_name, s.parent_phone,
           a.status, (SELECT status FROM sms_log l WHERE l.date = ? AND l.student_id = s.id) AS sms_status
    FROM students s
    LEFT JOIN student_attendance a ON a.student_id = s.id AND a.date = ?
    WHERE s.class_name = ?
    ORDER BY CAST(s.roll AS INTEGER), s.name`).all(date, date, class_name);
  res.json(rows);
});

app.post('/api/attendance', auth, wrap(async (req, res) => {
  const { date, class_name, records } = req.body || {};
  if (!isDate(date) || !class_name || !Array.isArray(records)) return res.status(400).json({ error: 'Invalid data' });
  if (date > todayStr()) return res.status(400).json({ error: 'Cannot mark attendance for a future date' });
  if (!canAccessClass(req.user, class_name)) return res.status(403).json({ error: 'Not your class' });

  const inClass = new Set(db.prepare('SELECT id FROM students WHERE class_name = ?').all(class_name).map(r => r.id));
  const upsert = db.prepare(`INSERT INTO student_attendance (date, student_id, status, marked_by) VALUES (?,?,?,?)
    ON CONFLICT(date, student_id) DO UPDATE SET status = excluded.status, marked_by = excluded.marked_by`);
  const saveAll = db.transaction(list => {
    for (const r of list) {
      if (!inClass.has(r.student_id) || !['P', 'A'].includes(r.status)) continue;
      upsert.run(date, r.student_id, r.status, req.user.id);
    }
  });
  saveAll(records);

  // SMS for absent students that have not been successfully messaged for this date
  const toNotify = db.prepare(`
    SELECT s.id, s.name, s.class_name, s.parent_phone FROM students s
    JOIN student_attendance a ON a.student_id = s.id AND a.date = ? AND a.status = 'A'
    LEFT JOIN sms_log l ON l.student_id = s.id AND l.date = ?
    WHERE s.class_name = ? AND (l.id IS NULL OR l.status = 'failed')`).all(date, date, class_name);

  const results = { saved: records.length, sms_sent: 0, sms_failed: 0,
    test_mode: (process.env.SMS_PROVIDER || 'console').toLowerCase() === 'console' };
  for (const s of toNotify) {
    const r = await sendAbsenceSms(s.parent_phone, { student: s.name, class_name: s.class_name, date });
    db.prepare(`INSERT INTO sms_log (date, student_id, phone, text, status, response) VALUES (?,?,?,?,?,?)
      ON CONFLICT(date, student_id) DO UPDATE SET phone = excluded.phone, text = excluded.text,
        status = excluded.status, response = excluded.response, created_at = datetime('now')`)
      .run(date, s.id, s.parent_phone, r.text, r.ok ? 'sent' : 'failed', r.response);
    r.ok ? results.sms_sent++ : results.sms_failed++;
  }
  res.json(results);
}));

// ---------- SMS log (admin) ----------
app.get('/api/sms-log', auth, adminOnly, (req, res) => {
  const { date } = req.query;
  const rows = isDate(date)
    ? db.prepare(`SELECT l.*, s.name AS student, s.class_name FROM sms_log l JOIN students s ON s.id = l.student_id
                  WHERE l.date = ? ORDER BY l.id DESC`).all(date)
    : db.prepare(`SELECT l.*, s.name AS student, s.class_name FROM sms_log l JOIN students s ON s.id = l.student_id
                  ORDER BY l.id DESC LIMIT 200`).all();
  res.json(rows);
});

app.post('/api/sms-retry', auth, adminOnly, wrap(async (req, res) => {
  const { date } = req.body || {};
  if (!isDate(date)) return res.status(400).json({ error: 'date required' });
  const failed = db.prepare(`SELECT l.id, l.phone, s.name, s.class_name FROM sms_log l JOIN students s ON s.id = l.student_id
                             WHERE l.date = ? AND l.status = 'failed'`).all(date);
  let sent = 0, still = 0;
  for (const f of failed) {
    const r = await sendAbsenceSms(f.phone, { student: f.name, class_name: f.class_name, date });
    db.prepare(`UPDATE sms_log SET status = ?, response = ?, created_at = datetime('now') WHERE id = ?`)
      .run(r.ok ? 'sent' : 'failed', r.response, f.id);
    r.ok ? sent++ : still++;
  }
  res.json({ sent, still_failed: still });
}));

// ---------- students (admin) ----------
app.get('/api/students', auth, adminOnly, (req, res) => {
  res.json(db.prepare('SELECT * FROM students ORDER BY class_name, CAST(roll AS INTEGER), name').all());
});

app.post('/api/students', auth, adminOnly, (req, res) => {
  const { name, roll, class_name, parent_name, parent_phone } = req.body || {};
  const phone = cleanPhone(parent_phone);
  if (!String(name || '').trim() || !String(class_name || '').trim()) return res.status(400).json({ error: 'Name and class are required' });
  if (!phone) return res.status(400).json({ error: 'Enter a valid 10-digit parent mobile number' });
  const r = db.prepare('INSERT INTO students (name, roll, class_name, parent_name, parent_phone) VALUES (?,?,?,?,?)')
    .run(name.trim(), String(roll || '').trim(), class_name.trim(), String(parent_name || '').trim(), phone);
  res.json({ id: r.lastInsertRowid });
});

// CSV columns: name,roll,class,parent_name,parent_phone  (header row optional)
app.post('/api/students/import', auth, adminOnly, (req, res) => {
  const lines = String(req.body?.csv || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const ins = db.prepare('INSERT INTO students (name, roll, class_name, parent_name, parent_phone) VALUES (?,?,?,?,?)');
  let added = 0; const errors = [];
  db.transaction(() => {
    lines.forEach((line, i) => {
      const c = line.split(',').map(x => x.trim());
      if (i === 0 && /name/i.test(c[0]) && /phone/i.test(c[4] || '')) return; // header
      const phone = cleanPhone(c[4]);
      if (!c[0] || !c[2] || !phone) { errors.push(`Line ${i + 1}: needs name, class and a valid 10-digit phone`); return; }
      ins.run(c[0], c[1] || '', c[2], c[3] || '', phone);
      added++;
    });
  })();
  res.json({ added, errors: errors.slice(0, 20) });
});

app.delete('/api/students/:id', auth, adminOnly, (req, res) => {
  db.prepare('DELETE FROM students WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- teachers (admin) ----------
app.get('/api/teachers', auth, adminOnly, (req, res) => {
  const teachers = db.prepare(`SELECT id, name, username, phone, subject FROM users WHERE role = 'teacher' ORDER BY name`).all();
  const cl = db.prepare('SELECT class_name FROM class_teachers WHERE user_id = ? ORDER BY class_name');
  res.json(teachers.map(t => ({ ...t, classes: cl.all(t.id).map(r => r.class_name) })));
});

function setClasses(userId, classes) {
  db.prepare('DELETE FROM class_teachers WHERE user_id = ?').run(userId);
  const ins = db.prepare('INSERT OR IGNORE INTO class_teachers (user_id, class_name) VALUES (?,?)');
  (classes || []).map(c => String(c).trim()).filter(Boolean).forEach(c => ins.run(userId, c));
}

app.post('/api/teachers', auth, adminOnly, (req, res) => {
  const { name, username, password, phone, subject, classes } = req.body || {};
  if (!String(name || '').trim() || !String(username || '').trim()) return res.status(400).json({ error: 'Name and username are required' });
  if (String(password || '').length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username.trim())) return res.status(400).json({ error: 'Username already taken' });
  const id = db.transaction(() => {
    const r = db.prepare('INSERT INTO users (name, username, password_hash, role, phone, subject) VALUES (?,?,?,?,?,?)')
      .run(name.trim(), username.trim(), bcrypt.hashSync(password, 10), 'teacher', String(phone || '').trim(), String(subject || '').trim());
    setClasses(r.lastInsertRowid, classes);
    return r.lastInsertRowid;
  })();
  res.json({ id });
});

app.put('/api/teachers/:id/classes', auth, adminOnly, (req, res) => {
  setClasses(Number(req.params.id), req.body?.classes);
  res.json({ ok: true });
});

app.post('/api/teachers/:id/reset-password', auth, adminOnly, (req, res) => {
  const pw = String(req.body?.password || '');
  if (pw.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  db.prepare(`UPDATE users SET password_hash = ? WHERE id = ? AND role = 'teacher'`).run(bcrypt.hashSync(pw, 10), req.params.id);
  res.json({ ok: true });
});

app.delete('/api/teachers/:id', auth, adminOnly, (req, res) => {
  db.prepare(`DELETE FROM users WHERE id = ? AND role = 'teacher'`).run(req.params.id);
  res.json({ ok: true });
});

// ---------- teacher attendance (admin) ----------
app.get('/api/teacher-attendance', auth, adminOnly, (req, res) => {
  if (!isDate(req.query.date)) return res.status(400).json({ error: 'date required' });
  res.json(db.prepare(`SELECT u.id, u.name, u.subject, a.status FROM users u
    LEFT JOIN teacher_attendance a ON a.user_id = u.id AND a.date = ?
    WHERE u.role = 'teacher' ORDER BY u.name`).all(req.query.date));
});

app.post('/api/teacher-attendance', auth, adminOnly, (req, res) => {
  const { date, records } = req.body || {};
  if (!isDate(date) || !Array.isArray(records)) return res.status(400).json({ error: 'Invalid data' });
  const up = db.prepare(`INSERT INTO teacher_attendance (date, user_id, status) VALUES (?,?,?)
    ON CONFLICT(date, user_id) DO UPDATE SET status = excluded.status`);
  db.transaction(() => records.forEach(r => { if (['P', 'A'].includes(r.status)) up.run(date, r.user_id, r.status); }))();
  res.json({ ok: true });
});

// ---------- report (admin) ----------
app.get('/api/report', auth, adminOnly, (req, res) => {
  const { from, to } = req.query;
  if (!isDate(from) || !isDate(to)) return res.status(400).json({ error: 'from and to required' });
  res.json(db.prepare(`
    SELECT s.class_name, s.roll, s.name,
      SUM(a.status = 'P') AS present, SUM(a.status = 'A') AS absent
    FROM students s LEFT JOIN student_attendance a ON a.student_id = s.id AND a.date BETWEEN ? AND ?
    GROUP BY s.id ORDER BY s.class_name, CAST(s.roll AS INTEGER), s.name`).all(from, to));
});

// ---------- backup (admin): downloads a copy of the whole database ----------
app.get('/api/backup', auth, adminOnly, (req, res) => {
  const fs = require('fs');
  const os = require('os');
  const file = path.join(os.tmpdir(), `backup-${Date.now()}.db`);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  res.download(file, `school-backup-${todayStr()}.db`, () => fs.unlink(file, () => {}));
});

app.listen(PORT, () => console.log(`Attendance system running on http://localhost:${PORT}`));
