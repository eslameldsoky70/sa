const nodemailer = require('nodemailer');

const money = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
const CUR = process.env.CURRENCY || 'ج.م';

function buildText(order, items) {
  return [
    `طلب جديد رقم #${order.id}`,
    '',
    `اسم العميل: ${order.customer_name}`,
    `رقم الموبايل: ${order.phone}`,
    `المحافظة: ${order.governorate}`,
    `المدينة: ${order.city}`,
    `العنوان: ${order.address}`,
    '',
    'المنتجات:',
    ...items.map((i) => `* ${i.name} × ${i.quantity} — ${money(i.price)} ${CUR}`),
    '',
    `إجمالي الطلب: ${money(order.total)} ${CUR}`,
    '',
    `ملاحظات العميل: ${order.notes || '—'}`,
  ].join('\n');
}

function getTransport() {
  if (process.env.EMAIL_DRY_RUN === '1') return nodemailer.createTransport({ jsonTransport: true });
  const { EMAIL_USER, EMAIL_PASSWORD } = process.env;
  if (!EMAIL_USER || !EMAIL_PASSWORD) return null;
  const port = Number(process.env.EMAIL_PORT || 465);
  return nodemailer.createTransport({
    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    port,
    secure: port === 465,
    auth: { user: EMAIL_USER, pass: EMAIL_PASSWORD },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
}

// يرجع true عند نجاح الإرسال. لا يرمي خطأ حتى لا يفشل الطلب بسبب البريد.
async function sendOrderEmail(order, items) {
  const to = process.env.ADMIN_EMAIL;
  const transport = getTransport();
  if (!to || !transport) {
    console.warn(`[email] لم يتم الإرسال للطلب #${order.id}: ADMIN_EMAIL أو بيانات البريد غير مضبوطة.`);
    return false;
  }
  try {
    const info = await transport.sendMail({
      from: process.env.EMAIL_USER || to,
      to,
      subject: `طلب جديد #${order.id} - ${order.customer_name}`,
      text: buildText(order, items),
    });
    if (process.env.EMAIL_DRY_RUN === '1') console.log('[email:dry-run]\n' + info.message);
    return true;
  } catch (err) {
    console.error(`[email] فشل إرسال الطلب #${order.id}:`, err.message);
    return false;
  }
}

module.exports = { sendOrderEmail };
