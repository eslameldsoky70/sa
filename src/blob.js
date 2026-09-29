// تخزين صور المنتجات على Vercel Blob (بدل القرص المحلي).
const crypto = require('crypto');
const { put, del } = require('@vercel/blob');

const TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

// فحص التوقيع الحقيقي للملف (لا نثق بـ mimetype القادم من المتصفح)
function sniff(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

// يرفع الصورة ويرجع الرابط العام
async function uploadImage(file) {
  const type = sniff(file.buffer);
  if (!type) throw Object.assign(new Error('نوع الصورة غير مدعوم'), { code: 'BAD_TYPE' });
  const name = `products/${crypto.randomBytes(8).toString('hex')}${TYPES[type]}`;
  const blob = await put(name, file.buffer, {
    access: 'public',
    contentType: type,
    addRandomSuffix: true,
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });
  return blob.url;
}

const isBlobUrl = (u) => /^https:\/\/[^/]+\.blob\.vercel-storage\.com\//.test(String(u || ''));

// حذف الصورة من Blob — محاولة "بأفضل جهد": لا نُفشل العملية إن تعذر الحذف
async function removeImage(url) {
  if (!isBlobUrl(url)) return;
  try {
    await del(url, { token: process.env.BLOB_READ_WRITE_TOKEN });
  } catch (err) {
    console.error('[blob] تعذر حذف الصورة:', err.message);
  }
}

module.exports = { uploadImage, removeImage, isBlobUrl };
