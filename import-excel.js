const XLSX = require('xlsx');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const excelPath = process.argv[2] || path.join(__dirname, 'sora_SNS投稿テンプレ集.xlsx');
if (!fs.existsSync(excelPath)) {
  console.error('Excel file not found:', excelPath);
  process.exit(1);
}

const db = new Database(path.join(__dirname, 'data.db'));
db.pragma('journal_mode = WAL');

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
    row_number INTEGER NOT NULL,    col_data TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    memo TEXT DEFAULT '',
    updated_at TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (sheet_id) REFERENCES sheets(id)
  );
`);

// Clear existing data
db.exec('DELETE FROM contents; DELETE FROM sheets;');

const wb = XLSX.readFile(excelPath);

const insertSheet = db.prepare('INSERT INTO sheets (name, sort_order) VALUES (?, ?)');
const insertContent = db.prepare('INSERT INTO contents (sheet_id, row_number, col_data, status) VALUES (?, ?, ?, ?)');

const tx = db.transaction(() => {
  wb.SheetNames.forEach((sheetName, idx) => {
    const ws = wb.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    if (data.length < 2) return; // skip empty sheets

    insertSheet.run(sheetName, idx);
    const sheetId = db.prepare('SELECT id FROM sheets WHERE name = ?').get(sheetName).id;

    const headers = data[0];    // Find the first header row (skip title/merged rows)
    let headerRowIdx = 0;
    for (let i = 0; i < Math.min(5, data.length); i++) {
      const row = data[i];
      const filled = row.filter(c => c !== '').length;
      if (filled >= 3) { headerRowIdx = i; break; }
    }
    const hdrs = data[headerRowIdx];

    for (let r = headerRowIdx + 1; r < data.length; r++) {
      const row = data[r];
      if (!row || row.every(c => c === '' || c === null || c === undefined)) continue;

      const obj = {};
      hdrs.forEach((h, ci) => {
        if (h && row[ci] !== undefined && row[ci] !== '') {
          obj[String(h).trim()] = String(row[ci]).trim();
        }
      });
      if (Object.keys(obj).length === 0) continue;

      insertContent.run(sheetId, r, JSON.stringify(obj), 'draft');
    }
  });
});

tx();

const sheetCount = db.prepare('SELECT COUNT(*) as c FROM sheets').get().c;
const contentCount = db.prepare('SELECT COUNT(*) as c FROM contents').get().c;
console.log(`Imported: ${sheetCount} sheets, ${contentCount} content items`);
db.close();