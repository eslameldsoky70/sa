const crypto = require('crypto');
const db = require('./db');

const isProd = process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL);
let SECRET = process.env.SESSION_SECRET;
if (!SECRET) {
  // على Vercel كل طلب قد يمر على instance مختلف، فلا يصلح سر عشوائي
  if (isProd) throw new Error('SESSION_SECRET مطلوب في وضع production (Environment Variable).');
  SECRET = crypto.randomBytes(32).toString('hex');
  console.warn('تنبيه: SESSION_SECRET غير مضبوط، سيتم تسجيل خروج الأدمن عند كل إعادة تشغيل.');
}
const MAX_AGE = 1000 * 60 * 60 * 12; // 12 ساعة

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(pw, salt, 64).toString('hex')}`;
}
function verifyPassword(pw, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const a = Buffer.from(hash, 'hex');
  const b = crypto.scryptSync(pw, salt, 64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const sign = (v) => crypto.createHmac('sha256', SECRET).update(v).digest('hex');

function makeToken(username) {
  const payload = Buffer.from(`${username}|${Date.now() + MAX_AGE}`).toString('base64url');
  return `${payload}.${sign(payload)}`;
}
function readToken(token) {
  if (!token) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const good = sign(payload);
  if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  const [username, exp] = Buffer.from(payload, 'base64url').toString().split('|');
  return Date.now() < Number(exp) ? username : null;
}
function cookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function setSession(res, username) {
  res.cookie('admin', makeToken(username), { httpOnly: true, sameSite: 'lax', secure: isProd, maxAge: MAX_AGE });
}
async function requireAdmin(req, res, next) {
  try {
    const user = readToken(cookies(req).admin);
    if (user && (await db.get('SELECT 1 AS ok FROM admins WHERE username = ?', [user]))) { req.adminUser = user; return next(); }
    res.redirect('/admin/login');
  } catch (err) { next(err); }
}

// حد بسيط لمحاولات الدخول (في الذاكرة؛ على Vercel يُطبَّق لكل instance)
const attempts = new Map();
function loginAllowed(ip) {
  const now = Date.now();
  const list = (attempts.get(ip) || []).filter((t) => now - t < 15 * 60 * 1000);
  attempts.set(ip, list);
  return list.length < 8;
}
const loginFailed = (ip) => attempts.set(ip, [...(attempts.get(ip) || []), Date.now()]);

module.exports = { hashPassword, verifyPassword, setSession, requireAdmin, loginAllowed, loginFailed };
