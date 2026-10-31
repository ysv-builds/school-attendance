// Uses the SQLite database built into Node.js (node:sqlite), so no extra package
// or C++ build tools are needed. Requires Node 22.5 or newer.
process.removeAllListeners('warning'); // hides the "SQLite is experimental" notice
const { DatabaseSync } = require('node:sqlite');

const db = new DatabaseSync(process.env.DB_FILE || 'school.db');
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

// Small helper so the rest of the code can use db.transaction(fn) like before.
db.transaction = fn => (...args) => {
  db.exec('BEGIN');
  try {
    const result = fn(...args);
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
};

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','teacher')),
  phone TEXT,
  subject TEXT
);

CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  roll TEXT,
  class_name TEXT NOT NULL,
  parent_name TEXT,
  parent_phone TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_students_class ON students(class_name);

CREATE TABLE IF NOT EXISTS class_teachers (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  class_name TEXT NOT NULL,
  PRIMARY KEY (user_id, class_name)
);

CREATE TABLE IF NOT EXISTS student_attendance (
  date TEXT NOT NULL,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('P','A')),
  marked_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (date, student_id)
);

CREATE TABLE IF NOT EXISTS teacher_attendance (
  date TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('P','A')),
  PRIMARY KEY (date, user_id)
);

CREATE TABLE IF NOT EXISTS sms_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  text TEXT NOT NULL,
  status TEXT NOT NULL,          -- sent | failed
  response TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (date, student_id)
);
`);

module.exports = db;
