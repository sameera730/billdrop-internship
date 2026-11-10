import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(ROOT, 'public');
const PRIVATE_DIR = join(ROOT, 'private-uploads');
const DATA_DIR = resolve(ROOT, process.env.DATA_DIR || './data');
const DB_PATH = join(DATA_DIR, 'billdrop.sqlite');
const PORT = Number(process.env.PORT || 3000);
const MAX_BYTES = 4 * 1024 * 1024;
const sessions = new Map();
const MIME = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'], ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'], ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'],
  ['.pdf', 'application/pdf'], ['.ico', 'image/x-icon']
]);

await loadEnv();
await mkdir(DATA_DIR, { recursive: true });
await mkdir(PRIVATE_DIR, { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS people (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('accountant','manager')), login_id TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS suppliers (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS batches (
    id TEXT PRIMARY KEY, uploaded_by TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS bills (
    id TEXT PRIMARY KEY, batch_id TEXT, supplier_id INTEGER, bill_number TEXT,
    bill_date TEXT, total REAL, lines_total REAL, file_path TEXT, ocr_text TEXT,
    status TEXT NOT NULL, problem TEXT, saved_at TEXT, created_at TEXT NOT NULL,
    FOREIGN KEY(batch_id) REFERENCES batches(id), FOREIGN KEY(supplier_id) REFERENCES suppliers(id)
  );
  CREATE TABLE IF NOT EXISTS bill_lines (
    id TEXT PRIMARY KEY, bill_id TEXT NOT NULL, description TEXT NOT NULL, amount REAL NOT NULL,
    FOREIGN KEY(bill_id) REFERENCES bills(id) ON DELETE CASCADE
  );
`);

const DEMO_USERS = [
  { id: 'demo-accountant', name: 'Demo Accountant', email: 'accountant@billdrop.demo', role: 'accountant', password: 'billdrop-demo-1' },
  { id: 'demo-manager', name: 'Demo Manager', email: 'manager@billdrop.demo', role: 'manager', password: 'billdrop-demo-2' }
];
const DEMO_INVOICE = {
  supplier: 'Salem Fasteners Demo',
  bill_number: 'SFD-1109',
  bill_date: '2026-11-09',
  lines: [
    { description: 'Hex bolts, 20 pieces', amount: 850 },
    { description: 'Steel hinges, 12 pieces', amount: 720 },
    { description: 'Wall plugs, 8 boxes', amount: 480 }
  ],
  total: 2050
};
const DEMO_OCR_TEXT = `SALEM FASTENERS DEMO\nInvoice No: SFD-1109\nDate: 2026-11-09\nHex bolts, 20 pieces 850\nSteel hinges, 12 pieces 720\nWall plugs, 8 boxes 480\nTotal 2050`;
seedDatabase();

async function loadEnv() {
  try {
    const text = await readFile(join(ROOT, '.env'), 'utf8');
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const index = line.indexOf('=');
      if (index < 1) continue;
      const key = line.slice(0, index).trim();
      if (process.env[key] === undefined) process.env[key] = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
    }
  } catch { /* .env is optional */ }
}

function seedDatabase() {
  const addPerson = db.prepare('INSERT OR IGNORE INTO people(id,name,email,role,login_id) VALUES(?,?,?,?,?)');
  for (const user of DEMO_USERS) addPerson.run(user.id, user.name, user.email, user.role, user.id);
  const addSupplier = db.prepare('INSERT OR IGNORE INTO suppliers(name,created_at) VALUES(?,?)');
  const suppliers = ['Salem Fasteners Demo', 'Irumbu Parts Demo', 'Kongu Tools Demo', 'Mettur Hardware Demo', 'Demo Electricals', 'Steel City Supply Demo', 'Blue River Traders Demo', 'Salem Pipe House Demo', 'Daily Fixings Demo', 'North Gate Wholesale Demo'];
  for (const name of suppliers) addSupplier.run(name, '2026-11-01T00:00:00.000Z');
  const old = db.prepare("SELECT id FROM bills WHERE bill_number='SFD-OCT-1001' LIMIT 1").get();
  if (!old) {
    const supplier = db.prepare('SELECT id FROM suppliers WHERE name=?').get('Salem Fasteners Demo');
    db.prepare('INSERT OR IGNORE INTO batches(id,uploaded_by,created_at) VALUES(?,?,?)').run('seed-october', 'demo-accountant', '2026-10-12T10:00:00.000Z');
    db.prepare(`INSERT INTO bills(id,batch_id,supplier_id,bill_number,bill_date,total,lines_total,file_path,ocr_text,status,problem,saved_at,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('seed-old-bill','seed-october',supplier.id,'SFD-OCT-1001','2026-10-12',3700,3700,null,'Made-up October bill record','saved',null,'2026-10-12T10:15:00.000Z','2026-10-12T10:00:00.000Z');
    db.prepare('INSERT INTO bill_lines(id,bill_id,description,amount) VALUES(?,?,?,?)').run('seed-old-line-1','seed-old-bill','Sample shelf brackets',2500);
    db.prepare('INSERT INTO bill_lines(id,bill_id,description,amount) VALUES(?,?,?,?)').run('seed-old-line-2','seed-old-bill','Sample screws',1200);
  }
}

function json(res, status, value, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(value));
}

async function bodyJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BYTES * 2) throw new Error('Request is too large.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('Request body must be valid JSON.'); }
}

function cookieValue(req, name) {
  const raw = req.headers.cookie || '';
  const entry = raw.split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : '';
}

function currentUser(req) {
  const token = cookieValue(req, 'billdrop_session');
  return token ? sessions.get(token) || null : null;
}

function requireUser(req, res, roles = ['accountant', 'manager']) {
  const user = currentUser(req);
  if (!user) { json(res, 401, { error: 'Please log in to continue.' }); return null; }
  if (!roles.includes(user.role)) { json(res, 403, { error: 'This action is not allowed for your role.' }); return null; }
  return user;
}

function publicBill(id) {
  const bill = db.prepare(`SELECT b.*, s.name AS supplier FROM bills b LEFT JOIN suppliers s ON s.id=b.supplier_id WHERE b.id=?`).get(id);
  if (!bill) return null;
  const lines = db.prepare('SELECT description,amount FROM bill_lines WHERE bill_id=? ORDER BY rowid').all(id);
  return { id: bill.id, batch_id: bill.batch_id, supplier: bill.supplier || '', bill_number: bill.bill_number || '', bill_date: bill.bill_date || '', total: bill.total ?? '', lines_total: bill.lines_total ?? '', ocr_text: bill.ocr_text || '', status: bill.status, problem: bill.problem || '', saved_at: bill.saved_at || '', created_at: bill.created_at, lines };
}

function emptyInvoice() { return { supplier: '', bill_number: '', bill_date: '', lines: [{ description: '', amount: '' }], total: '' }; }

function normalizeInvoice(value) {
  if (!value || typeof value !== 'object') return emptyInvoice();
  const lines = Array.isArray(value.lines) ? value.lines.slice(0, 50).map(line => ({
    description: String(line?.description || '').slice(0, 160),
    amount: Number.isFinite(Number(line?.amount)) ? Number(line.amount) : ''
  })) : [];
  return {
    supplier: String(value.supplier || '').slice(0, 120),
    bill_number: String(value.bill_number || '').slice(0, 80),
    bill_date: /^\d{4}-\d{2}-\d{2}$/.test(String(value.bill_date || '')) ? value.bill_date : '',
    lines: lines.length ? lines : [{ description: '', amount: '' }],
    total: Number.isFinite(Number(value.total)) ? Number(value.total) : ''
  };
}

function parseInvoiceText(text) {
  const invoice = emptyInvoice();
  const supplier = text.match(/(?:supplier|vendor|from)\s*[:#-]\s*(.+)/i);
  const number = text.match(/(?:invoice|bill)\s*(?:no\.?|number|#)\s*[:#-]?\s*([A-Z0-9/-]+)/i);
  const date = text.match(/(?:date)\s*[:#-]\s*(\d{4}-\d{2}-\d{2})/i);
  const total = text.match(/(?:grand\s+)?total\s*[:₹$-]*\s*([\d,]+(?:\.\d{1,2})?)/i);
  invoice.supplier = supplier?.[1]?.trim().slice(0, 120) || '';
  invoice.bill_number = number?.[1]?.trim() || '';
  invoice.bill_date = date?.[1] || '';
  invoice.total = total ? Number(total[1].replaceAll(',', '')) : '';
  const linePattern = /^(.+?)\s+(?:₹\s*)?([\d,]+(?:\.\d{1,2})?)\s*$/gm;
  for (const match of text.matchAll(linePattern)) {
    const description = match[1].trim();
    if (/^(?:total|grand total|subtotal)/i.test(description)) continue;
    if (/^(?:invoice|bill|date|supplier|vendor)/i.test(description)) continue;
    if (description.length > 2) invoice.lines.push({ description, amount: Number(match[2].replaceAll(',', '')) });
  }
  if (!invoice.lines.length) invoice.lines = [{ description: '', amount: '' }];
  return invoice;
}

async function readWithOcr(fileBuffer, filename, mimeType) {
  const key = process.env.OCR_SPACE_API_KEY;
  if (!key) throw new Error('OCR.Space is not configured yet. The demo sample is available while the OCR key is being set up.');
  const form = new FormData();
  form.append('apikey', key);
  form.append('language', 'eng');
  form.append('isTable', 'true');
  form.append('OCREngine', '2');
  form.append('scale', 'true');
  form.append('file', new Blob([fileBuffer], { type: mimeType }), filename);
  const response = await fetch('https://api.ocr.space/parse/image', { method: 'POST', body: form });
  if (!response.ok) throw new Error(`OCR service returned HTTP ${response.status}.`);
  const payload = await response.json();
  const text = payload?.ParsedResults?.map(row => row.ParsedText || '').join('\n').trim();
  if (payload?.IsErroredOnProcessing || !text) throw new Error('OCR could not read this file. Try a clearer, smaller bill.');
  return text;
}

async function readWithAi(text) {
  if (!process.env.OPENROUTER_API_KEY || !process.env.OPENROUTER_MODEL) return parseInvoiceText(text);
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.OPENROUTER_MODEL,
      temperature: 0,
      messages: [
        { role: 'system', content: 'Extract invoice fields from the supplied OCR text. Return only a JSON object with supplier (string), bill_number (string), bill_date (YYYY-MM-DD or empty), lines (array of {description, amount}), and total (number or null). Use amounts in rupees. Never invent missing values.' },
        { role: 'user', content: text }
      ]
    })
  });
  if (!response.ok) throw new Error(`AI service returned HTTP ${response.status}. The bill is still editable.`);
  const payload = await response.json();
  const answer = payload?.choices?.[0]?.message?.content || '';
  const cleaned = answer.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try { return normalizeInvoice(JSON.parse(cleaned)); }
  catch { return emptyInvoice(); }
}

function saveFile(buffer, filename) {
  const suffix = extname(filename).toLowerCase();
  const allowed = new Set(['.pdf', '.png', '.jpg', '.jpeg']);
  if (!allowed.has(suffix)) throw new Error('Upload a PDF, JPG, or PNG bill.');
  if (!buffer.length || buffer.length > MAX_BYTES) throw new Error('The file must be smaller than 4 MB.');
  const name = `${randomUUID()}${suffix}`;
  return { name, path: join(PRIVATE_DIR, name) };
}

async function processNewBill({ user, buffer, filename, mimeType, demo = false }) {
  const file = saveFile(buffer, filename);
  await writeFile(file.path, buffer, { flag: 'wx' });
  const batchId = randomUUID();
  const billId = randomUUID();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO batches(id,uploaded_by,created_at) VALUES(?,?,?)').run(batchId, user.id, now);
  db.prepare(`INSERT INTO bills(id,batch_id,file_path,ocr_text,status,created_at) VALUES(?,?,?,?,?,?)`).run(billId,batchId,file.name,'','reading',now);
  try {
    const text = demo ? DEMO_OCR_TEXT : await readWithOcr(buffer, filename, mimeType);
    const fields = demo ? DEMO_INVOICE : await readWithAi(text);
    const invoice = normalizeInvoice(fields);
    db.prepare('UPDATE bills SET ocr_text=?,status=?,problem=? WHERE id=?').run(text,'ready',(!demo && (!process.env.OPENROUTER_API_KEY || !process.env.OPENROUTER_MODEL)) ? 'AI service is not configured; editable fields were filled from a local text parser.' : null,billId);
    const addLine = db.prepare('INSERT INTO bill_lines(id,bill_id,description,amount) VALUES(?,?,?,?)');
    for (const line of invoice.lines) if (line.description) addLine.run(randomUUID(),billId,line.description,Number(line.amount) || 0);
    db.prepare('UPDATE bills SET supplier_id=(SELECT id FROM suppliers WHERE name=?),bill_number=?,bill_date=?,total=? WHERE id=?').run(invoice.supplier,invoice.bill_number,invoice.bill_date,invoice.total === '' ? null : invoice.total,billId);
  } catch (error) {
    db.prepare('UPDATE bills SET status=?,problem=? WHERE id=?').run('failed',String(error.message || 'Bill reading failed.').slice(0,240),billId);
  }
  return publicBill(billId);
}

async function handleApi(req, res, url) {
  const path = url.pathname;
  if (req.method === 'GET' && path === '/api/health') return json(res, 200, { ok: true, app: 'BillDrop' });
  if (req.method === 'GET' && path === '/api/session') return json(res, 200, { user: currentUser(req) });
  if (req.method === 'POST' && path === '/api/login') {
    const body = await bodyJson(req);
    const email = String(body.email || '').toLowerCase().trim();
    const user = DEMO_USERS.find(item => item.email === email);
    if (!user || !safeEqual(String(body.password || ''), user.password)) return json(res, 401, { error: 'Email or password did not match the demo logins.' });
    const token = randomBytes(32).toString('hex');
    sessions.set(token, { id: user.id, name: user.name, email: user.email, role: user.role });
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    return json(res, 200, { user: sessions.get(token) }, { 'Set-Cookie': `billdrop_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=28800${secure}` });
  }
  if (req.method === 'POST' && path === '/api/logout') {
    const token = cookieValue(req, 'billdrop_session');
    sessions.delete(token);
    return json(res, 200, { ok: true }, { 'Set-Cookie': 'billdrop_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' });
  }
  if (req.method === 'GET' && path === '/api/bills') {
    const user = requireUser(req, res); if (!user) return;
    const rows = user.role === 'accountant'
      ? db.prepare('SELECT id,status,created_at,bill_number,total,problem FROM bills ORDER BY created_at DESC').all()
      : db.prepare("SELECT id,status,created_at,bill_number,total,problem FROM bills WHERE status='saved' ORDER BY created_at DESC").all();
    return json(res, 200, { bills: rows });
  }
  const billMatch = path.match(/^\/api\/bills\/([\w-]+)$/);
  if (req.method === 'GET' && billMatch) {
    const user = requireUser(req, res); if (!user) return;
    const bill = publicBill(billMatch[1]);
    if (!bill || (user.role === 'manager' && bill.status !== 'saved')) return json(res, 404, { error: 'Bill not found.' });
    return json(res, 200, { bill });
  }
  if (req.method === 'GET' && path === '/api/supplier-totals') {
    const user = requireUser(req, res); if (!user) return;
    const month = new Date().toISOString().slice(0,7);
    const totals = db.prepare(`SELECT s.name AS supplier, ROUND(SUM(b.total),2) AS total, COUNT(*) AS bills
      FROM bills b JOIN suppliers s ON s.id=b.supplier_id WHERE b.status='saved' AND substr(b.bill_date,1,7)=?
      GROUP BY s.id ORDER BY s.name`).all(month);
    return json(res, 200, { totals, month });
  }
  if (req.method === 'POST' && path === '/api/sample') {
    const user = requireUser(req, res, ['accountant']); if (!user) return;
    const samplePath = join(ROOT,'docs','sample-bill.pdf');
    const buffer = await readFile(samplePath);
    const bill = await processNewBill({ user, buffer, filename: 'sample-bill.pdf', mimeType: 'application/pdf', demo: true });
    return json(res, 201, { bill });
  }
  if (req.method === 'POST' && path === '/api/upload') {
    const user = requireUser(req, res, ['accountant']); if (!user) return;
    const body = await bodyJson(req);
    const filename = String(body.filename || 'bill.pdf').split(/[\\/]/).pop().slice(0,160);
    const mimeType = String(body.mimeType || '').toLowerCase();
    if (!['application/pdf','image/png','image/jpeg'].includes(mimeType)) return json(res, 400, { error: 'Only PDF, JPG, and PNG bills are accepted.' });
    const buffer = Buffer.from(String(body.data || ''), 'base64');
    if (!buffer.length || buffer.length > MAX_BYTES) return json(res, 400, { error: 'Choose a file smaller than 4 MB.' });
    const bill = await processNewBill({ user, buffer, filename, mimeType });
    return json(res, 201, { bill });
  }
  const fileMatch = path.match(/^\/api\/bills\/([\w-]+)\/file$/);
  if (req.method === 'GET' && fileMatch) {
    const user = requireUser(req, res); if (!user) return;
    const bill = db.prepare('SELECT id,status,file_path FROM bills WHERE id=?').get(fileMatch[1]);
    if (!bill || !bill.file_path) return json(res, 404, { error: 'Bill file not found.' });
    if (user.role === 'manager' && bill.status !== 'saved') return json(res, 403, { error: 'Managers can view saved bills only.' });
    const filePath = resolve(PRIVATE_DIR, bill.file_path);
    if (!filePath.startsWith(resolve(PRIVATE_DIR) + sep)) return json(res, 400, { error: 'Invalid file path.' });
    const contentType = MIME.get(extname(filePath).toLowerCase()) || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType, 'Content-Disposition': 'inline', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
    return createReadStream(filePath).pipe(res);
  }
  const saveMatch = path.match(/^\/api\/bills\/([\w-]+)\/save$/);
  if (req.method === 'POST' && saveMatch) {
    const user = requireUser(req, res, ['accountant']); if (!user) return;
    const body = await bodyJson(req);
    const bill = db.prepare('SELECT id,status FROM bills WHERE id=?').get(saveMatch[1]);
    if (!bill) return json(res, 404, { error: 'Bill not found.' });
    if (!['ready','saved'].includes(bill.status)) return json(res, 409, { error: 'This bill is not ready to save yet.' });
    const fields = normalizeInvoice(body);
    if (!fields.supplier || !fields.bill_number || !fields.bill_date || !fields.lines.some(line => line.description)) return json(res, 400, { error: 'Add the supplier, bill number, date, and at least one line before saving.' });
    const linesTotal = fields.lines.reduce((sum,line) => sum + (Number(line.amount) || 0),0);
    const difference = Math.round((linesTotal - Number(fields.total || 0)) * 100) / 100;
    const problem = Math.abs(difference) > 1 ? `Total is off by ₹${Math.abs(difference).toLocaleString('en-IN')}.` : null;
    const now = new Date().toISOString();
    db.exec('BEGIN');
    try {
      db.prepare('INSERT OR IGNORE INTO suppliers(name,created_at) VALUES(?,?)').run(fields.supplier,now);
      const supplier = db.prepare('SELECT id FROM suppliers WHERE name=?').get(fields.supplier);
      db.prepare('UPDATE bills SET supplier_id=?,bill_number=?,bill_date=?,total=?,lines_total=?,status=?,problem=?,saved_at=? WHERE id=?')
        .run(supplier.id,fields.bill_number,fields.bill_date,Number(fields.total || 0),linesTotal,'saved',problem,now,bill.id);
      db.prepare('DELETE FROM bill_lines WHERE bill_id=?').run(bill.id);
      const add = db.prepare('INSERT INTO bill_lines(id,bill_id,description,amount) VALUES(?,?,?,?)');
      for (const line of fields.lines) if (line.description) add.run(randomUUID(),bill.id,line.description,Number(line.amount)||0);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return json(res, 200, { bill: publicBill(bill.id) });
  }
  return json(res, 404, { error: 'Route not found.' });
}

function safeEqual(a, b) {
  const left = Buffer.from(a); const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left,right);
}

async function staticFile(req, res, pathname) {
  let relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
  relative = normalize(relative);
  const target = resolve(PUBLIC_DIR, relative);
  if (!target.startsWith(resolve(PUBLIC_DIR) + sep) && target !== resolve(PUBLIC_DIR,'index.html')) {
    res.writeHead(403); return res.end('Forbidden');
  }
  try {
    const stat = await import('node:fs/promises').then(fs => fs.stat(target));
    if (!stat.isFile()) throw new Error('Not a file');
    res.writeHead(200, { 'Content-Type': MIME.get(extname(target).toLowerCase()) || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
    return createReadStream(target).pipe(res);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Not found');
  }
}

const server = createServer(async (req,res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) await handleApi(req,res,url);
    else await staticFile(req,res,url.pathname);
  } catch (error) {
    if (!res.headersSent) json(res, 500, { error: error.message || 'Something went wrong.' });
    else res.destroy();
  }
});

server.listen(PORT, '0.0.0.0', () => console.log(`BillDrop running on http://localhost:${PORT}`));
