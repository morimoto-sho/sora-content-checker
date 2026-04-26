const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3456;

// DB
const db = new Database(path.join(__dirname, 'data.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Init tables
db.exec(`
  CREATE TABLE IF NOT EXISTS sheets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    sort_order INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS contents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sheet_id INTEGER NOT NULL,
    row_number INTEGER NOT NULL,
    col_data TEXT NOT NULL,    status TEXT NOT NULL DEFAULT 'draft',
    memo TEXT DEFAULT '',
    updated_at TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (sheet_id) REFERENCES sheets(id)
  );
  CREATE INDEX IF NOT EXISTS idx_contents_sheet ON contents(sheet_id);
  CREATE INDEX IF NOT EXISTS idx_contents_status ON contents(status);
`);

app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// --- API ---

// GET all sheets
app.get('/api/sheets', (req, res) => {
  const sheets = db.prepare('SELECT * FROM sheets ORDER BY sort_order').all();
  const counts = db.prepare(`
    SELECT sheet_id, status, COUNT(*) as cnt
    FROM contents GROUP BY sheet_id, status
  `).all();
  const countMap = {};
  counts.forEach(c => {
    if (!countMap[c.sheet_id]) countMap[c.sheet_id] = {};
    countMap[c.sheet_id][c.status] = c.cnt;
  });
  sheets.forEach(s => { s.counts = countMap[s.id] || {}; });
  res.json(sheets);
});

// GET contents by sheet
app.get('/api/sheets/:id/contents', (req, res) => {
  const { status } = req.query;
  let sql = 'SELECT * FROM contents WHERE sheet_id = ?';
  const params = [req.params.id];
  if (status && status !== 'all') {
    sql += ' AND status = ?';
    params.push(status);
  }
  sql += ' ORDER BY row_number';
  res.json(db.prepare(sql).all(params));
});

// GET single content
app.get('/api/contents/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM contents WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

// PATCH update content (status, col_data, memo)
app.patch('/api/contents/:id', (req, res) => {
  const { status, col_data, memo } = req.body;
  const row = db.prepare('SELECT * FROM contents WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const newStatus = status || row.status;
  const newData = col_data !== undefined ? col_data : row.col_data;
  const newMemo = memo !== undefined ? memo : row.memo;

  db.prepare(`
    UPDATE contents SET status = ?, col_data = ?, memo = ?, updated_at = datetime('now','localtime')
    WHERE id = ?
  `).run(newStatus, newData, newMemo, req.params.id);

  res.json(db.prepare('SELECT * FROM contents WHERE id = ?').get(req.params.id));
});

// PATCH bulk status update
app.patch('/api/bulk-status', (req, res) => {
  const { ids, status } = req.body;
  if (!ids || !status) return res.status(400).json({ error: 'ids and status required' });
  const stmt = db.prepare(`UPDATE contents SET status = ?, updated_at = datetime('now','localtime') WHERE id = ?`);
  const tx = db.transaction(() => { ids.forEach(id => stmt.run(status, id)); });
  tx();
  res.json({ updated: ids.length });
});

// GET stats
app.get('/api/stats', (req, res) => {
  const stats = db.prepare(`
    SELECT status, COUNT(*) as cnt FROM contents GROUP BY status
  `).all();
  const total = db.prepare('SELECT COUNT(*) as cnt FROM contents').get();
  res.json({ total: total.cnt, byStatus: stats });
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`sora-content-checker running on http://0.0.0.0:${PORT}`);
});