// قاعدة البيانات: Turso (libSQL) عبر @libsql/client — لا ملفات محلية.
const { createClient } = require('@libsql/client');

let client;
function getClient() {
  if (client) return client;
  let url = process.env.TURSO_DATABASE_URL;
  if (!url) throw new Error('TURSO_DATABASE_URL غير مضبوط.');
  // على Vercel نستخدم HTTPS بدل WebSocket (أنسب للـ serverless)
  url = url.replace(/^libsql:/, 'https:');
  if (url.startsWith('file:') && process.env.VERCEL) {
    throw new Error('قاعدة بيانات ملفية (file:) غير مسموحة على Vercel. استخدم رابط Turso.');
  }
  client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  return client;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    price REAL NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    image TEXT NOT NULL DEFAULT '',
    available INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    governorate TEXT NOT NULL,
    city TEXT NOT NULL,
    address TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    total REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'new',
    email_sent INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id INTEGER,
    name TEXT NOT NULL,
    price REAL NOT NULL,
    quantity INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL
  )`,
];

// إنشاء الجداول مرة واحدة لكل instance (IF NOT EXISTS آمن للتكرار)
let ready;
function init() {
  if (!ready) {
    ready = getClient().batch(SCHEMA, 'write').catch((err) => { ready = null; throw err; });
  }
  return ready;
}

const toObjects = (rs) => rs.rows.map((row) => Object.fromEntries(rs.columns.map((c, i) => [c, row[i]])));

// كل الصفوف
async function all(sql, args = []) {
  await init();
  return toObjects(await getClient().execute({ sql, args }));
}
// صف واحد أو undefined
async function get(sql, args = []) {
  return (await all(sql, args))[0];
}
// تنفيذ كتابة؛ يرجع { lastId, changes }
async function run(sql, args = []) {
  await init();
  const rs = await getClient().execute({ sql, args });
  return { lastId: rs.lastInsertRowid == null ? null : Number(rs.lastInsertRowid), changes: rs.rowsAffected };
}
// معاملة (transaction) — fn تستقبل { run }
async function transaction(fn) {
  await init();
  const tx = await getClient().transaction('write');
  try {
    const out = await fn({
      run: async (sql, args = []) => {
        const rs = await tx.execute({ sql, args });
        return { lastId: rs.lastInsertRowid == null ? null : Number(rs.lastInsertRowid), changes: rs.rowsAffected };
      },
    });
    await tx.commit();
    return out;
  } catch (err) {
    try { await tx.rollback(); } catch { /* ignore */ }
    throw err;
  } finally {
    tx.close();
  }
}

module.exports = { all, get, run, transaction, init };
