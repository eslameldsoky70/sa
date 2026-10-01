// تطبيق Express (بدون listen) — يُستخدم محليًا عبر server.js وعلى Vercel عبر api/index.js
const express = require('express');
const multer = require('multer');
const path = require('path');
const db = require('./src/db');
const auth = require('./src/auth');
const { sendOrderEmail, sendSubscriberEmail } = require('./src/mailer');
const { uploadImage, removeImage } = require('./src/blob');
const v = require('./src/views');

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin' });
  next();
});
app.use(express.urlencoded({ extended: false, limit: '100kb' }));
// محليًا فقط: على Vercel يقدّم CDN مجلد public/ مباشرة قبل الوصول للدالة
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1d' }));
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------- رفع الصور (في الذاكرة ثم Vercel Blob) ----------
// حد 4MB: دوال Vercel لا تقبل طلبًا أكبر من 4.5MB
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => cb(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)),
}).single('image');

// ---------- المتجر ----------
const listProducts = () => db.all('SELECT * FROM products ORDER BY id DESC');
const getProduct = (id) => db.get('SELECT * FROM products WHERE id = ?', [id]);

app.get('/', wrap(async (req, res) => {
  const all = await listProducts();
  // الأكثر طلبًا: حسب الكميات المباعة فعليًا، ثم الأحدث
  const best = await db.all(`SELECT p.* FROM products p
    LEFT JOIN (SELECT product_id, SUM(quantity) AS q FROM order_items GROUP BY product_id) s ON s.product_id = p.id
    WHERE p.available = 1 ORDER BY COALESCE(s.q, 0) DESC, p.id DESC LIMIT 4`);
  res.send(v.home(all.slice(0, 3), best, all.length));
}));
app.post('/newsletter', wrap(async (req, res) => {
  const email = String(req.body.email || '').trim().slice(0, 120);
  if (!req.body.website && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) await sendSubscriberEmail(email);
  res.redirect('/subscribed');
}));
app.get('/subscribed', (req, res) => res.send(v.subscribedPage()));
app.get('/products', wrap(async (req, res) => res.send(v.productsPage(await listProducts()))));
app.get('/product/:id', wrap(async (req, res) => {
  const p = await getProduct(Number(req.params.id));
  res.status(p ? 200 : 404).send(p ? v.productPage(p) : v.notFound());
}));
app.get('/cart', (req, res) => res.send(v.cartPage()));
app.get('/checkout', (req, res) => res.send(v.checkoutPage()));

// بيانات المنتجات للسلة (الأسعار دائمًا من قاعدة البيانات)
app.get('/api/products', wrap(async (req, res) => {
  const ids = String(req.query.ids || '').split(',').map(Number).filter(Number.isInteger).slice(0, 50);
  if (!ids.length) return res.json([]);
  const rows = await db.all(`SELECT id, name, price, image, available FROM products WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
  res.json(rows.map((r) => ({ ...r, image: /^https?:\/\//.test(r.image) ? r.image : '/img/placeholder.svg' })));
}));

const clean = (s, max) => String(s ?? '').trim().slice(0, max);

app.post('/checkout', wrap(async (req, res) => {
  const b = req.body;
  if (b.website) return res.redirect('/'); // honeypot للبوتات
  const values = { name: clean(b.name, 100), phone: clean(b.phone, 20), governorate: clean(b.governorate, 50), city: clean(b.city, 80), address: clean(b.address, 300), notes: clean(b.notes, 500) };
  const fail = (msg) => res.status(400).send(v.checkoutPage(values, msg));

  if (!values.name || !values.phone || !values.governorate || !values.city || !values.address) return fail('من فضلك أكمل جميع الحقول المطلوبة.');
  if (!/^[+\d][\d\s-]{6,18}$/.test(values.phone)) return fail('رقم الموبايل غير صحيح.');

  let cart;
  try { cart = JSON.parse(b.cart || '[]'); } catch { cart = []; }
  if (!Array.isArray(cart) || !cart.length || cart.length > 50) return fail('السلة فارغة.');

  const lines = [];
  for (const it of cart) {
    const id = Number(it.id), qty = Number(it.qty);
    if (!Number.isInteger(id) || !Number.isInteger(qty) || qty < 1 || qty > 99) return fail('بيانات السلة غير صحيحة.');
    const p = await getProduct(id);
    if (!p || !p.available) return fail('أحد المنتجات لم يعد متوفرًا. راجع السلة وحاول مرة أخرى.');
    lines.push({ product_id: p.id, name: p.name, price: p.price, quantity: qty });
  }
  const total = lines.reduce((s, l) => s + l.price * l.quantity, 0);

  const id = await db.transaction(async (tx) => {
    const { lastId } = await tx.run(
      `INSERT INTO orders (customer_name, phone, governorate, city, address, notes, total) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [values.name, values.phone, values.governorate, values.city, values.address, values.notes, total]);
    for (const l of lines) {
      await tx.run('INSERT INTO order_items (order_id, product_id, name, price, quantity) VALUES (?, ?, ?, ?, ?)',
        [lastId, l.product_id, l.name, l.price, l.quantity]);
    }
    return lastId;
  });

  // على Vercel يجب انتظار الإرسال قبل الرد (الدالة تتوقف بعد إرسال الرد)
  const order = await db.get('SELECT * FROM orders WHERE id = ?', [id]);
  const sent = await sendOrderEmail(order, lines);
  if (sent) await db.run('UPDATE orders SET email_sent = 1 WHERE id = ?', [id]);
  res.redirect(`/success?order=${id}`);
}));

app.get('/success', (req, res) => {
  const id = Number(req.query.order);
  if (!Number.isInteger(id) || id < 1) return res.redirect('/');
  res.send(v.successPage(id));
});

// ---------- لوحة التحكم ----------
app.get('/admin/login', (req, res) => res.send(v.adminLogin()));
app.post('/admin/login', wrap(async (req, res) => {
  if (!auth.loginAllowed(req.ip)) return res.status(429).send(v.adminLogin('محاولات كثيرة. حاول بعد 15 دقيقة.'));
  const admin = await db.get('SELECT * FROM admins WHERE username = ?', [clean(req.body.username, 60)]);
  if (!admin || !auth.verifyPassword(String(req.body.password || ''), admin.password_hash)) {
    auth.loginFailed(req.ip);
    return res.status(401).send(v.adminLogin('اسم المستخدم أو كلمة المرور غير صحيحة.'));
  }
  auth.setSession(res, admin.username);
  res.redirect('/admin/orders');
}));
app.post('/admin/logout', (req, res) => { res.clearCookie('admin'); res.redirect('/admin/login'); });

const admin = express.Router();
admin.use(auth.requireAdmin);
app.use('/admin', admin);

admin.get('/', (req, res) => res.redirect('/admin/orders'));
admin.get('/account', (req, res) => res.send(v.adminAccount(req.adminUser)));
admin.post('/account', wrap(async (req, res) => {
  const me = await db.get('SELECT * FROM admins WHERE username = ?', [req.adminUser]);
  const username = clean(req.body.username, 40);
  const pw = String(req.body.password || ''), confirm = String(req.body.confirm || '');
  const show = (msg, code = 400) => res.status(code).send(v.adminAccount(username || me.username, msg));
  if (!auth.loginAllowed(req.ip)) return show('محاولات كثيرة. حاول بعد 15 دقيقة.', 429);
  if (!auth.verifyPassword(String(req.body.current || ''), me.password_hash)) { auth.loginFailed(req.ip); return show('كلمة المرور الحالية غير صحيحة.'); }
  if (!/^[^\s|]{3,40}$/.test(username)) return show('اسم المستخدم من 3 إلى 40 حرفًا بدون مسافات.');
  if (pw && pw.length < 8) return show('كلمة المرور الجديدة 8 أحرف على الأقل.');
  if (pw !== confirm) return show('تأكيد كلمة المرور غير مطابق.');
  if (await db.get('SELECT 1 AS x FROM admins WHERE username = ? AND id != ?', [username, me.id])) return show('اسم المستخدم مستخدم بالفعل.');
  await db.run('UPDATE admins SET username = ?, password_hash = ? WHERE id = ?', [username, pw ? auth.hashPassword(pw) : me.password_hash, me.id]);
  auth.setSession(res, username); // الجلسة مرتبطة باسم المستخدم، فنجددها
  res.send(v.adminAccount(username, '', 'تم حفظ التغييرات بنجاح.'));
}));

admin.get('/products', wrap(async (req, res) => res.send(v.adminProducts(await listProducts()))));
admin.get('/products/new', (req, res) => res.send(v.adminProductForm()));
admin.get('/products/:id/edit', wrap(async (req, res) => {
  const p = await getProduct(Number(req.params.id));
  p ? res.send(v.adminProductForm(p)) : res.status(404).send(v.notFound());
}));

function parseProduct(req) {
  const price = Number(req.body.price);
  const data = { name: clean(req.body.name, 120), price, description: clean(req.body.description, 2000), available: req.body.available ? 1 : 0 };
  const error = !data.name ? 'اسم المنتج مطلوب.' : !(price > 0) ? 'السعر غير صحيح.' : '';
  return { data, error };
}
// رسالة خطأ الرفع (تظهر للأدمن فقط) + تسجيل السبب الحقيقي في Vercel Logs
function uploadErrorMessage(e) {
  if (e.code === 'BAD_TYPE') return 'الملف ليس صورة JPG أو PNG أو WebP صالحة.';
  console.error('[blob] فشل رفع الصورة:', e.name, '-', e.message);
  return `تعذر رفع الصورة. السبب: ${String(e.message || e.name).slice(0, 200)}`;
}
const withUpload = (req, res, next) => upload(req, res, (err) => {
  if (err) {
    if (err.code !== 'LIMIT_FILE_SIZE') console.error('[upload] multer:', err.code, err.message);
    req.uploadError = err.code === 'LIMIT_FILE_SIZE' ? 'حجم الصورة أكبر من 4MB.' : 'تعذر رفع الصورة.';
  }
  next();
});

admin.post('/products', withUpload, wrap(async (req, res) => {
  const { data, error } = parseProduct(req);
  const err = req.uploadError || error;
  if (err) return res.status(400).send(v.adminProductForm(data, err));

  let image = '';
  if (req.file) {
    try { image = await uploadImage(req.file); }
    catch (e) { return res.status(400).send(v.adminProductForm(data, uploadErrorMessage(e))); }
  }
  try {
    await db.run('INSERT INTO products (name, price, description, image, available) VALUES (?, ?, ?, ?, ?)',
      [data.name, data.price, data.description, image, data.available]);
  } catch (e) { await removeImage(image); throw e; }
  res.redirect('/admin/products');
}));

admin.post('/products/:id', withUpload, wrap(async (req, res) => {
  const id = Number(req.params.id);
  const old = await getProduct(id);
  if (!old) return res.status(404).send(v.notFound());
  const { data, error } = parseProduct(req);
  const err = req.uploadError || error;
  if (err) return res.status(400).send(v.adminProductForm({ ...old, ...data }, err));

  let image = old.image;
  if (req.file) {
    try { image = await uploadImage(req.file); }
    catch (e) { return res.status(400).send(v.adminProductForm({ ...old, ...data }, uploadErrorMessage(e))); }
  }
  try {
    await db.run('UPDATE products SET name=?, price=?, description=?, available=?, image=? WHERE id=?',
      [data.name, data.price, data.description, data.available, image, id]);
  } catch (e) { if (req.file) await removeImage(image); throw e; }
  if (req.file && old.image) await removeImage(old.image); // حذف الصورة القديمة بعد نجاح التحديث
  res.redirect('/admin/products');
}));

admin.post('/products/:id/delete', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const p = await db.get('SELECT image FROM products WHERE id = ?', [id]);
  if (p) { await db.run('DELETE FROM products WHERE id = ?', [id]); await removeImage(p.image); }
  res.redirect('/admin/products');
}));

admin.get('/orders', wrap(async (req, res) => {
  const orders = await db.all('SELECT * FROM orders ORDER BY id DESC LIMIT 300');
  if (orders.length) {
    // استعلام واحد لكل البنود بدل استعلام لكل طلب
    const items = await db.all(`SELECT * FROM order_items WHERE order_id IN (${orders.map(() => '?').join(',')}) ORDER BY id`, orders.map((o) => o.id));
    orders.forEach((o) => { o.items = items.filter((i) => i.order_id === o.id); });
  }
  res.send(v.adminOrders(orders));
}));
admin.post('/orders/:id/status', wrap(async (req, res) => {
  if (Object.hasOwn(v.STATUS, req.body.status)) await db.run('UPDATE orders SET status = ? WHERE id = ?', [req.body.status, Number(req.params.id)]);
  res.redirect('/admin/orders');
}));

// ---------- أخطاء ----------
app.use((req, res) => res.status(404).send(v.notFound()));
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error(err);
  res.status(500).send('حدث خطأ غير متوقع. حاول مرة أخرى.');
});

module.exports = app;
