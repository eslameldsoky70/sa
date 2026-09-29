const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const BRAND = process.env.BRAND_NAME || 'AURUM';
const CUR = process.env.CURRENCY || 'ج.م';
const money = (n) => `${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${CUR}`;
// الصورة الآن رابط كامل على Vercel Blob
const imgUrl = (p) => (/^https?:\/\//.test(p.image || '') ? esc(p.image) : '/img/placeholder.svg');

const STATUS = { new: 'جديد', contacted: 'تم التواصل', shipped: 'تم الشحن', delivered: 'تم التسليم', cancelled: 'ملغي' };
const GOVS = ['القاهرة','الجيزة','الإسكندرية','الدقهلية','الشرقية','القليوبية','الغربية','المنوفية','البحيرة','كفر الشيخ','دمياط','بورسعيد','الإسماعيلية','السويس','الفيوم','بني سويف','المنيا','أسيوط','سوهاج','قنا','الأقصر','أسوان','البحر الأحمر','الوادي الجديد','مطروح','شمال سيناء','جنوب سيناء'];

const head = (title) => `<!doctype html><html lang="ar" dir="rtl" data-cur="${esc(CUR)}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/css/style.css"></head>`;

function layout(title, body) {
  return `${head(`${title} | ${BRAND}`)}<body>
<header class="site-header"><div class="wrap bar">
  <a class="logo" href="/">${esc(BRAND)}</a>
  <nav><a href="/">الرئيسية</a><a href="/products">الساعات</a>
  <a href="/cart" class="cart-link">السلة <span class="badge" data-cart-count hidden>0</span></a></nav>
</div></header>
<main>${body}</main>
<footer class="site-footer"><div class="wrap"><span class="logo sm">${esc(BRAND)}</span><span>الدفع عند الاستلام · © ${new Date().getFullYear()}</span></div></footer>
<script src="/js/cart.js"></script></body></html>`;
}

function adminLayout(title, body) {
  return `${head(`${title} | لوحة التحكم`)}<body class="admin">
<header class="site-header"><div class="wrap bar">
  <a class="logo" href="/admin/orders">لوحة التحكم</a>
  <nav><a href="/admin/orders">الطلبات</a><a href="/admin/products">المنتجات</a><a href="/" target="_blank">المتجر</a>
  <form method="post" action="/admin/logout" class="inline"><button class="link">خروج</button></form></nav>
</div></header><main class="wrap page">${body}</main></body></html>`;
}

const card = (p) => `<article class="card">
  <a href="/product/${p.id}" class="card-img"><img src="${imgUrl(p)}" alt="${esc(p.name)}" loading="lazy"></a>
  <div class="card-body"><h3>${esc(p.name)}</h3><p class="price">${money(p.price)}</p>
  <div class="card-actions"><a class="btn ghost" href="/product/${p.id}">عرض التفاصيل</a>
  ${p.available ? `<button class="btn" data-add="${p.id}">أضف إلى السلة</button>` : `<span class="btn disabled">غير متوفر</span>`}</div></div></article>`;

const empty = (msg) => `<p class="empty">${msg}</p>`;

const home = (products) => layout('الرئيسية', `
<section class="hero"><div class="wrap hero-grid">
  <div><h1>الوقت يليق<br>بمن يقدّره</h1><p>ساعات مختارة بعناية، بتصميم هادئ وتفاصيل متقنة.</p>
  <a class="btn gold" href="/products">تسوق الآن</a></div>
  <img src="/img/hero-watch.svg" alt="ساعة ${esc(BRAND)}" class="hero-img">
</div></section>
<section class="wrap section"><h2>الساعات</h2>
${products.length ? `<div class="grid">${products.map(card).join('')}</div>` : empty('لا توجد منتجات حاليًا.')}
</section>`);

const productsPage = (products) => layout('الساعات', `<section class="wrap section"><h2>جميع الساعات</h2>
${products.length ? `<div class="grid">${products.map(card).join('')}</div>` : empty('لا توجد منتجات حاليًا.')}</section>`);

const productPage = (p) => layout(p.name, `<section class="wrap section detail">
  <img src="${imgUrl(p)}" alt="${esc(p.name)}" class="detail-img">
  <div><h1>${esc(p.name)}</h1><p class="price big">${money(p.price)}</p>
  <p class="desc">${esc(p.description).replace(/\n/g, '<br>')}</p>
  ${p.available ? `<label class="qty">الكمية <input id="qty" type="number" min="1" max="99" value="1"></label>
  <button class="btn gold" data-add="${p.id}">Add to Cart</button>` : `<span class="btn disabled">غير متوفر حاليًا</span>`}
  </div></section>`);

const cartPage = () => layout('السلة', `<section class="wrap section"><h2>سلة المشتريات</h2>
<div id="cart-root"><p class="empty">جاري التحميل...</p></div></section>`);

const checkoutPage = (v = {}, error = '') => layout('إتمام الطلب', `<section class="wrap section narrow"><h2>إتمام الطلب</h2>
${error ? `<p class="alert">${esc(error)}</p>` : ''}
<div id="summary-root" class="summary"></div>
<form method="post" action="/checkout" class="form" id="checkout-form">
  <input type="hidden" name="cart" id="cart-field">
  <input type="text" name="website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">
  <label>الاسم بالكامل<input name="name" required maxlength="100" value="${esc(v.name)}"></label>
  <label>رقم الموبايل<input name="phone" type="tel" required inputmode="tel" maxlength="20" value="${esc(v.phone)}"></label>
  <div class="row2">
    <label>المحافظة<input name="governorate" list="govs" required maxlength="50" value="${esc(v.governorate)}"></label>
    <label>المدينة<input name="city" required maxlength="80" value="${esc(v.city)}"></label>
  </div>
  <datalist id="govs">${GOVS.map((g) => `<option value="${g}">`).join('')}</datalist>
  <label>العنوان بالتفصيل<textarea name="address" required maxlength="300" rows="3">${esc(v.address)}</textarea></label>
  <label>ملاحظات (اختياري)<textarea name="notes" maxlength="500" rows="2">${esc(v.notes)}</textarea></label>
  <p class="hint">الدفع عند الاستلام.</p>
  <button class="btn gold block" id="submit-btn">تأكيد الطلب</button>
</form></section>`);

const successPage = (id) => layout('تم الطلب', `<section class="wrap section narrow center">
<h1>تم استلام طلبك بنجاح</h1><p class="order-no">رقم الطلب: <strong>#${esc(id)}</strong></p>
<p>سنتواصل معك قريبًا لتأكيد الشحن.</p><a class="btn" href="/products">متابعة التسوق</a></section>
<script>try{localStorage.removeItem('cart')}catch(e){}</script>`);

const notFound = () => layout('غير موجود', `<section class="wrap section center"><h1>الصفحة غير موجودة</h1><a class="btn" href="/">العودة للرئيسية</a></section>`);

// ---------- Admin ----------
const adminLogin = (error = '') => `${head('دخول الأدمن')}<body class="admin"><main class="login">
<form method="post" action="/admin/login" class="form box"><h1>دخول الأدمن</h1>
${error ? `<p class="alert">${esc(error)}</p>` : ''}
<label>اسم المستخدم<input name="username" required autocomplete="username"></label>
<label>كلمة المرور<input name="password" type="password" required autocomplete="current-password"></label>
<button class="btn gold block">دخول</button></form></main></body></html>`;

const adminProducts = (list) => adminLayout('المنتجات', `<div class="toolbar"><h2>المنتجات</h2><a class="btn gold" href="/admin/products/new">إضافة منتج</a></div>
${list.length ? `<div class="table-wrap"><table><thead><tr><th></th><th>الاسم</th><th>السعر</th><th>الحالة</th><th></th></tr></thead><tbody>
${list.map((p) => `<tr><td><img class="thumb" src="${imgUrl(p)}" alt=""></td><td>${esc(p.name)}</td><td>${money(p.price)}</td>
<td>${p.available ? 'متوفر' : 'غير متوفر'}</td><td class="actions"><a class="btn ghost sm" href="/admin/products/${p.id}/edit">تعديل</a>
<form method="post" action="/admin/products/${p.id}/delete" class="inline" onsubmit="return confirm('حذف المنتج نهائيًا؟')"><button class="btn danger sm">حذف</button></form></td></tr>`).join('')}
</tbody></table></div>` : empty('لا توجد منتجات. ابدأ بإضافة أول ساعة.')}`);

const adminProductForm = (p = {}, error = '') => adminLayout(p.id ? 'تعديل منتج' : 'إضافة منتج', `<h2>${p.id ? 'تعديل منتج' : 'إضافة منتج'}</h2>
${error ? `<p class="alert">${esc(error)}</p>` : ''}
<form method="post" enctype="multipart/form-data" action="${p.id ? `/admin/products/${p.id}` : '/admin/products'}" class="form narrow">
<label>اسم المنتج<input name="name" required maxlength="120" value="${esc(p.name)}"></label>
<label>السعر (${esc(CUR)})<input name="price" type="number" step="0.01" min="0.01" required value="${esc(p.price)}"></label>
<label>الوصف<textarea name="description" rows="4" maxlength="2000">${esc(p.description)}</textarea></label>
<label>صورة المنتج (JPG / PNG / WebP، حتى 4MB)<input name="image" type="file" accept="image/jpeg,image/png,image/webp">
${p.image ? `<img class="thumb lg" src="${imgUrl(p)}" alt="">` : ''}</label>
<label class="check"><input type="checkbox" name="available" value="1" ${p.id && !p.available ? '' : 'checked'}> متوفر</label>
<button class="btn gold">حفظ</button> <a class="btn ghost" href="/admin/products">إلغاء</a></form>`);

const adminOrders = (orders) => adminLayout('الطلبات', `<h2>الطلبات</h2>
${orders.length ? orders.map((o) => `<article class="order">
<header><strong>#${o.id}</strong><span>${esc(o.created_at)} UTC</span><span class="tag s-${o.status}">${STATUS[o.status]}</span>
${o.email_sent ? '' : '<span class="tag warn">لم يُرسل البريد</span>'}</header>
<div class="order-grid"><div><p><b>${esc(o.customer_name)}</b></p><p dir="ltr" class="ltr-right">${esc(o.phone)}</p>
<p>${esc(o.governorate)} - ${esc(o.city)}</p><p>${esc(o.address)}</p>${o.notes ? `<p class="note">ملاحظات: ${esc(o.notes)}</p>` : ''}</div>
<div><ul>${o.items.map((i) => `<li>${esc(i.name)} × ${i.quantity} — ${money(i.price)}</li>`).join('')}</ul><p><b>الإجمالي: ${money(o.total)}</b></p></div></div>
<form method="post" action="/admin/orders/${o.id}/status" class="status-form"><select name="status">
${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${k === o.status ? 'selected' : ''}>${v}</option>`).join('')}</select>
<button class="btn sm">تحديث الحالة</button></form></article>`).join('') : empty('لا توجد طلبات بعد.')}`);

module.exports = { STATUS, home, productsPage, productPage, cartPage, checkoutPage, successPage, notFound, adminLogin, adminProducts, adminProductForm, adminOrders };
