(function () {
  const KEY = 'cart';
  const CUR = document.documentElement.dataset.cur || 'ج.م';
  const fmt = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 }) + ' ' + CUR;
  const read = () => { try { const c = JSON.parse(localStorage.getItem(KEY)); return Array.isArray(c) ? c : []; } catch { return []; } };
  const write = (c) => { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch {} badge(); };
  function badge() {
    const n = read().reduce((s, i) => s + i.qty, 0);
    document.querySelectorAll('[data-cart-count]').forEach((e) => { e.textContent = n; e.hidden = !n; });
  }
  function add(id, qty) {
    const c = read(), it = c.find((x) => x.id === id);
    if (it) it.qty = Math.min(99, it.qty + qty); else c.push({ id, qty: Math.min(99, qty) });
    write(c);
  }
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => (k in el && k !== 'list' ? (el[k] = v) : el.setAttribute(k, v)));
    kids.forEach((k) => el.append(k));
    return el;
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-add]');
    if (!b) return;
    const q = document.getElementById('qty');
    add(Number(b.dataset.add), q ? Math.max(1, parseInt(q.value, 10) || 1) : 1);
    const old = b.textContent; b.textContent = 'تمت الإضافة'; setTimeout(() => (b.textContent = old), 1200);
  });

  // يجلب بيانات المنتجات من السيرفر وينظف السلة من المنتجات المحذوفة/غير المتوفرة
  async function load() {
    const cart = read();
    if (!cart.length) return { lines: [], total: 0 };
    const res = await fetch('/api/products?ids=' + cart.map((i) => i.id).join(','));
    const prods = await res.json();
    const lines = cart.map((i) => ({ ...i, p: prods.find((p) => p.id === i.id) })).filter((l) => l.p && l.p.available);
    if (lines.length !== cart.length) write(lines.map(({ id, qty }) => ({ id, qty })));
    return { lines, total: lines.reduce((s, l) => s + l.p.price * l.qty, 0) };
  }

  async function renderCart(root) {
    const { lines, total } = await load();
    root.replaceChildren();
    if (!lines.length) {
      root.append(h('p', { className: 'empty' }, 'السلة فارغة. '), h('a', { className: 'btn', href: '/products' }, 'تصفح الساعات'));
      return;
    }
    lines.forEach((l) => {
      const qty = h('input', { type: 'number', min: 1, max: 99, value: l.qty, className: 'qty-in', ariaLabel: 'الكمية' });
      qty.addEventListener('change', () => {
        const c = read(); const it = c.find((x) => x.id === l.id);
        it.qty = Math.min(99, Math.max(1, parseInt(qty.value, 10) || 1)); write(c); renderCart(root);
      });
      const del = h('button', { className: 'btn ghost sm', type: 'button' }, 'حذف');
      del.addEventListener('click', () => { write(read().filter((x) => x.id !== l.id)); renderCart(root); });
      root.append(h('div', { className: 'cart-row' },
        h('img', { src: l.p.image, alt: l.p.name }),
        h('div', null, h('div', null, l.p.name), h('div', { className: 'price' }, fmt(l.p.price))),
        h('strong', null, fmt(l.p.price * l.qty)),
        h('div', { className: 'cart-meta', style: 'grid-column:2 / -1' }, h('label', null, 'الكمية ', qty), del)));
    });
    root.append(
      h('div', { className: 'cart-total' }, h('span', null, 'إجمالي الطلب'), h('span', null, fmt(total))),
      h('a', { className: 'btn gold block', href: '/checkout' }, 'إتمام الطلب'));
  }

  async function renderCheckout(root) {
    const { lines, total } = await load();
    if (!lines.length) { location.replace('/cart'); return; }
    const ul = h('ul', null);
    lines.forEach((l) => ul.append(h('li', null, h('span', null, `${l.p.name} × ${l.qty}`), h('span', null, fmt(l.p.price * l.qty)))));
    ul.append(h('li', { className: 'tot' }, h('span', null, 'الإجمالي'), h('span', null, fmt(total))));
    root.replaceChildren(ul);
    document.getElementById('checkout-form').addEventListener('submit', (e) => {
      document.getElementById('cart-field').value = JSON.stringify(read().map(({ id, qty }) => ({ id, qty })));
      const btn = document.getElementById('submit-btn'); btn.disabled = true; btn.textContent = 'جاري إرسال الطلب...';
    });
  }

  badge();
  const cartRoot = document.getElementById('cart-root'), sumRoot = document.getElementById('summary-root');
  if (cartRoot) renderCart(cartRoot).catch(() => (cartRoot.textContent = 'تعذر تحميل السلة.'));
  if (sumRoot) renderCheckout(sumRoot).catch(() => (sumRoot.textContent = 'تعذر تحميل الطلب.'));
})();
