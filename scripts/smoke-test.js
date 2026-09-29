// اختبار شامل للمسارات والـAPI ولوحة التحكم — بدون أي خدمات خارجية:
//  - قاعدة libSQL مؤقتة (file:) بدل Turso
//  - Vercel Blob مُحاكى في الذاكرة
//  - البريد بوضع EMAIL_DRY_RUN
// التشغيل: npm test
const os = require('os');
const path = require('path');
const fs = require('fs');
const assert = require('assert');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'watch-test-'));
Object.assign(process.env, {
  TURSO_DATABASE_URL: 'file:' + path.join(tmp, 'test.db'),
  SESSION_SECRET: 'test-secret-test-secret-test-secret-1234',
  EMAIL_DRY_RUN: '1', ADMIN_EMAIL: 'admin@example.com', BRAND_NAME: 'AURUM', CURRENCY: 'ج.م',
});
delete process.env.VERCEL;

// محاكاة @vercel/blob
const blobs = new Map(); let n = 0;
const blobPath = require.resolve('@vercel/blob');
require.cache[blobPath] = { id: blobPath, filename: blobPath, loaded: true, exports: {
  put: async (name, body, opts) => {
    assert.strictEqual(opts.access, 'public');
    const url = `https://test.public.blob.vercel-storage.com/${name.replace(/(\.\w+)$/, `-x${++n}$1`)}`;
    blobs.set(url, body.length); return { url };
  },
  del: async (url) => { blobs.delete(url); },
} };

const db = require('../src/db');
const { hashPassword } = require('../src/auth');
const app = require('../app');

let passed = 0;
const ok = (cond, name) => { assert.ok(cond, name); passed++; console.log('  ✓', name); };

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);

(async () => {
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const req = async (method, url, { body, form, headers = {} } = {}) => {
    const r = await fetch(base + url, {
      method, redirect: 'manual',
      headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}), ...headers },
      body: body ? new URLSearchParams(body).toString() : form,
    });
    const sc = r.headers.get('set-cookie'); if (sc && sc.startsWith('admin=')) cookie = sc.split(';')[0];
    return { status: r.status, loc: r.headers.get('location'), text: await r.text(), r };
  };

  try {
    console.log('الجداول:');
    await db.init();
    const tables = (await db.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")).map((t) => t.name);
    for (const t of ['products', 'orders', 'order_items', 'admins']) ok(tables.includes(t), `جدول ${t}`);

    console.log('الحماية:');
    for (const u of ['/admin', '/admin/orders', '/admin/products', '/admin/products/new']) {
      const r = await req('GET', u); ok(r.status === 302 && r.loc === '/admin/login', `${u} يحوّل للدخول`);
    }
    ok((await req('POST', '/admin/products/1/delete')).loc === '/admin/login', 'حذف بدون دخول مرفوض');

    console.log('دخول الأدمن:');
    ok((await req('GET', '/admin/login')).status === 200, 'صفحة الدخول');
    await db.run('INSERT INTO admins (username, password_hash) VALUES (?, ?)', ['admin', hashPassword('secret-pass-1')]);
    ok((await req('POST', '/admin/login', { body: { username: 'admin', password: 'bad' } })).status === 401, 'كلمة مرور خاطئة → 401');
    const li = await req('POST', '/admin/login', { body: { username: 'admin', password: 'secret-pass-1' } });
    ok(li.status === 302 && li.loc === '/admin/orders' && cookie.startsWith('admin='), 'دخول ناجح + كوكي الجلسة');

    console.log('المنتجات (أدمن + Blob):');
    ok((await req('GET', '/admin/products')).text.includes('لا توجد منتجات'), 'قائمة فارغة');
    ok((await req('GET', '/admin/products/new')).status === 200, 'نموذج الإضافة');
    const mk = (fields, file) => { const f = new FormData(); Object.entries(fields).forEach(([k, x]) => f.append(k, x)); if (file) f.append('image', new Blob([file.buf], { type: file.type }), file.name); return f; };

    let r = await req('POST', '/admin/products', { form: mk({ name: 'Classic', price: '1500', description: 'وصف', available: '1' }, { buf: PNG, type: 'image/png', name: 'a.png' }) });
    ok(r.status === 302 && blobs.size === 1, 'إضافة منتج + رفع الصورة إلى Blob');
    const p1 = await db.get('SELECT * FROM products WHERE name = ?', ['Classic']);
    ok(p1.image.startsWith('https://test.public.blob.vercel-storage.com/products/'), 'رابط Blob محفوظ في القاعدة');
    ok(!fs.existsSync(path.join(__dirname, '..', 'data')), 'لا يوجد مجلد data');

    r = await req('POST', '/admin/products', { form: mk({ name: 'Fake', price: '10' }, { buf: Buffer.from('<html>not image</html>'), type: 'image/png', name: 'x.png' }) });
    ok(r.status === 400 && blobs.size === 1, 'ملف مزوّر (ليس صورة) مرفوض ولا يُرفع');
    r = await req('POST', '/admin/products', { form: mk({ name: '', price: '10' }) });
    ok(r.status === 400, 'اسم فارغ مرفوض');
    r = await req('POST', '/admin/products', { form: mk({ name: 'Bad', price: '-5' }) });
    ok(r.status === 400, 'سعر غير صحيح مرفوض');
    r = await req('POST', '/admin/products', { form: mk({ name: 'Big', price: '10' }, { buf: Buffer.concat([PNG, Buffer.alloc(4.5 * 1024 * 1024)]), type: 'image/png', name: 'b.png' }) });
    ok(r.status === 400 && r.text.includes('4MB'), 'صورة أكبر من 4MB مرفوضة');
    r = await req('POST', '/admin/products', { form: mk({ name: 'NoImg', price: '900' }) });
    ok(r.status === 302, 'منتج بدون صورة');
    const p2 = await db.get('SELECT * FROM products WHERE name = ?', ['NoImg']);
    ok(p2.image === '' && p2.available === 0, 'بدون صورة + غير متوفر عند عدم تحديد available');

    ok((await req('GET', `/admin/products/${p1.id}/edit`)).text.includes(p1.image), 'نموذج التعديل يعرض صورة Blob');
    const oldUrl = p1.image;
    r = await req('POST', `/admin/products/${p1.id}`, { form: mk({ name: 'Classic II', price: '1600', description: 'x', available: '1' }, { buf: JPG, type: 'image/jpeg', name: 'n.jpg' }) });
    const p1b = await db.get('SELECT * FROM products WHERE id = ?', [p1.id]);
    ok(r.status === 302 && p1b.name === 'Classic II' && p1b.price === 1600, 'تعديل الاسم والسعر');
    ok(p1b.image !== oldUrl && p1b.image.endsWith('.jpg'), 'تحديث الصورة برابط جديد');
    ok(!blobs.has(oldUrl) && blobs.has(p1b.image), 'حذف الصورة القديمة من Blob');
    await req('POST', `/admin/products/${p1.id}`, { form: mk({ name: 'Classic II', price: '1600', available: '1' }) });
    ok((await db.get('SELECT image FROM products WHERE id = ?', [p1.id])).image === p1b.image, 'تعديل بدون صورة يحافظ على الصورة');
    ok((await req('POST', '/admin/products/9999', { form: mk({ name: 'x', price: '1' }) })).status === 404, 'تعديل منتج غير موجود → 404');

    console.log('المتجر:');
    ok((await req('GET', '/')).text.includes('Classic II'), 'الرئيسية');
    ok((await req('GET', '/products')).text.includes(p1b.image), 'صفحة المنتجات تعرض صورة Blob');
    ok((await req('GET', `/product/${p1.id}`)).status === 200, 'صفحة منتج');
    ok((await req('GET', '/product/9999')).status === 404, 'منتج غير موجود → 404');
    ok((await req('GET', '/cart')).status === 200 && (await req('GET', '/checkout')).status === 200, 'السلة والـcheckout');
    ok((await req('GET', '/css/style.css')).status === 200 && (await req('GET', '/js/cart.js')).status === 200, 'ملفات ثابتة');
    ok((await req('GET', '/uploads/x.png')).status === 404, 'لا يوجد مسار /uploads');
    const api = JSON.parse((await req('GET', `/api/products?ids=${p1.id},${p2.id},abc`)).text);
    ok(api.length === 2 && api.find((x) => x.id === p1.id).image === p1b.image, 'GET /api/products');
    ok(api.find((x) => x.id === p2.id).image === '/img/placeholder.svg', 'placeholder لمنتج بلا صورة');
    ok(JSON.parse((await req('GET', '/api/products')).text).length === 0, 'API بدون ids');

    console.log('Checkout:');
    const good = { name: 'أحمد', phone: '01012345678', governorate: 'الدقهلية', city: 'المنصورة', address: 'شارع 1', notes: 'ملاحظة' };
    const cart = (c) => JSON.stringify(c);
    ok((await req('POST', '/checkout', { body: { ...good, name: '', cart: cart([{ id: p1.id, qty: 1 }]) } })).status === 400, 'حقول ناقصة');
    ok((await req('POST', '/checkout', { body: { ...good, phone: 'abc', cart: cart([{ id: p1.id, qty: 1 }]) } })).status === 400, 'موبايل خاطئ');
    ok((await req('POST', '/checkout', { body: { ...good, cart: '[]' } })).status === 400, 'سلة فارغة');
    ok((await req('POST', '/checkout', { body: { ...good, cart: cart([{ id: p1.id, qty: 0 }]) } })).status === 400, 'كمية غير صحيحة');
    ok((await req('POST', '/checkout', { body: { ...good, cart: cart([{ id: p2.id, qty: 1 }]) } })).status === 400, 'منتج غير متوفر مرفوض');
    ok((await req('POST', '/checkout', { body: { ...good, cart: cart([{ id: 9999, qty: 1 }]) } })).status === 400, 'منتج غير موجود مرفوض');
    ok((await req('POST', '/checkout', { body: { ...good, website: 'bot', cart: cart([{ id: p1.id, qty: 1 }]) } })).loc === '/', 'honeypot');
    ok((await db.get('SELECT COUNT(*) AS c FROM orders')).c === 0, 'لا طلبات من المحاولات الفاشلة');

    r = await req('POST', '/checkout', { body: { ...good, cart: cart([{ id: p1.id, qty: 2 }]) } });
    ok(r.status === 302 && /^\/success\?order=\d+$/.test(r.loc), 'إنشاء طلب ناجح');
    const oid = Number(r.loc.split('=')[1]);
    const order = await db.get('SELECT * FROM orders WHERE id = ?', [oid]);
    ok(order.total === 3200 && order.status === 'new' && order.email_sent === 1, 'إجمالي محسوب من القاعدة + تم "إرسال" البريد');
    const items = await db.all('SELECT * FROM order_items WHERE order_id = ?', [oid]);
    ok(items.length === 1 && items[0].quantity === 2 && items[0].price === 1600, 'order_items محفوظة بالسعر الحالي');
    ok((await req('GET', r.loc)).status === 200, 'صفحة النجاح');
    ok((await req('GET', '/success?order=abc')).loc === '/', 'success بمعرّف غير صحيح');

    console.log('الطلبات (أدمن):');
    const ot = (await req('GET', '/admin/orders')).text;
    ok(ot.includes(`#${oid}`) && ot.includes('أحمد') && ot.includes('Classic II'), 'قائمة الطلبات مع البنود');
    for (const s of ['contacted', 'shipped', 'delivered', 'cancelled', 'new']) {
      await req('POST', `/admin/orders/${oid}/status`, { body: { status: s } });
      ok((await db.get('SELECT status FROM orders WHERE id = ?', [oid])).status === s, `الحالة → ${s}`);
    }
    await req('POST', `/admin/orders/${oid}/status`, { body: { status: 'hacked' } });
    ok((await db.get('SELECT status FROM orders WHERE id = ?', [oid])).status === 'new', 'حالة غير صالحة مرفوضة');

    console.log('حذف منتج:');
    const before = blobs.size;
    await req('POST', `/admin/products/${p1.id}/delete`);
    ok(!(await db.get('SELECT 1 AS x FROM products WHERE id = ?', [p1.id])) && blobs.size === before - 1 && !blobs.has(p1b.image), 'حذف المنتج + صورته من Blob');
    ok((await db.all('SELECT * FROM order_items WHERE order_id = ?', [oid])).length === 1, 'بنود الطلب القديم تبقى بعد حذف المنتج');
    await req('POST', `/admin/products/${p2.id}/delete`);

    console.log('خروج + أخطاء:');
    await req('POST', '/admin/logout'); cookie = '';
    ok((await req('GET', '/admin/orders')).loc === '/admin/login', 'الخروج');
    cookie = 'admin=' + Buffer.from('admin|' + (Date.now() + 1e6)).toString('base64url') + '.deadbeef';
    ok((await req('GET', '/admin/orders')).loc === '/admin/login', 'كوكي مزوّر مرفوض');
    cookie = '';
    ok((await req('GET', '/nope')).status === 404, '404');
    for (let i = 0; i < 8; i++) await req('POST', '/admin/login', { body: { username: 'admin', password: 'bad' } });
    ok((await req('POST', '/admin/login', { body: { username: 'admin', password: 'secret-pass-1' } })).status === 429, 'حد محاولات الدخول');

    console.log(`\nنجح ${passed} اختبار ✔`);
  } finally {
    server.close(); fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch((e) => { console.error('\n✗ فشل:', e.message, '\n', e.stack); process.exit(1); });
