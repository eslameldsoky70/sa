# متجر ساعات — نسخة Vercel

Express + Turso (libSQL) + Vercel Blob + Nodemailer، يعمل بالكامل على Vercel Functions بدون أي ملفات محلية دائمة.
الدفع عند الاستلام، وإشعار بالبريد لكل طلب. التصميم والوظائف كما هي.

```
app.js               تطبيق Express (المسارات) — بدون listen
api/index.js         نقطة دخول Vercel Function
server.js            تشغيل محلي فقط (npm start)
vercel.json          rewrite كل المسارات إلى الدالة
src/db.js            Turso: الاتصال + إنشاء الجداول تلقائيًا
src/blob.js          رفع/حذف صور المنتجات على Vercel Blob
src/auth.js          دخول الأدمن (كوكي موقّع، بدون ملفات)
src/mailer.js        Nodemailer
src/views.js         صفحات HTML
scripts/create-admin.js   إنشاء/تغيير أدمن
scripts/smoke-test.js     اختبار شامل (npm test)
public/              CSS و JS والصور الثابتة (تُقدَّم من CDN)
```

## Environment Variables
| المتغير | الوصف |
|---|---|
| `TURSO_DATABASE_URL` | رابط قاعدة Turso (`libsql://...`) |
| `TURSO_AUTH_TOKEN` | توكن قاعدة Turso |
| `BLOB_READ_WRITE_TOKEN` | يُضاف تلقائيًا عند ربط Vercel Blob بالمشروع |
| `SESSION_SECRET` | **مطلوب.** نص عشوائي 32+ حرف: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `ADMIN_EMAIL` | البريد الذي تصله الطلبات |
| `EMAIL_USER` / `EMAIL_PASSWORD` | حساب SMTP المُرسِل (Gmail App Password) |
| `EMAIL_HOST` / `EMAIL_PORT` | `smtp.gmail.com` / `465` |
| `BRAND_NAME` / `CURRENCY` | اسم البراند والعملة (`AURUM` / `ج.م`) |

## 1) إنشاء قاعدة Turso
1. أنشئ حسابًا على https://turso.tech ثم ثبّت الـCLI:
   `curl -sSfL https://get.tur.so/install.sh | bash` (أو `brew install tursodatabase/tap/turso`).
2. `turso auth login`
3. `turso db create watch-store`
4. `turso db show watch-store --url` ← هذا هو `TURSO_DATABASE_URL`
5. `turso db tokens create watch-store` ← هذا هو `TURSO_AUTH_TOKEN`

الجداول (products, orders, order_items, admins) تُنشأ تلقائيًا عند أول طلب، ولا حاجة لتنفيذ SQL يدويًا.

## 2) إنشاء Vercel Blob Store
1. من لوحة Vercel افتح مشروعك ← **Storage** ← **Create Database** ← **Blob**.
2. سمّه (مثلًا `watch-store-images`) واختر المنطقة الأقرب لقاعدتك.
3. إن سُئلت عن نوع الوصول اختر **Public** (صور المنتجات تُعرض للزوار).
4. اربطه بالمشروع (Connect Project) ليُضاف `BLOB_READ_WRITE_TOKEN` تلقائيًا لكل البيئات.

## 3) ربط GitHub بـ Vercel
```bash
git init && git add . && git commit -m "Vercel + Turso + Blob"
git branch -M main
git remote add origin https://github.com/USERNAME/watch-store.git
git push -u origin main
```
ثم في Vercel: **Add New… ← Project ← Import** المستودع. اترك Framework Preset على **Other** ولا تغيّر Build Command.

## 4) التشغيل على Vercel
1. قبل أول Deploy: **Settings ← Environment Variables** وأضف كل المتغيرات أعلاه (Production + Preview).
2. اضغط **Deploy** (أو أعد Deploy بعد إضافة المتغيرات).
3. أنشئ الأدمن (القسم التالي) ثم ادخل من `https://<موقعك>/admin/login`.

## 5) إنشاء الأدمن لأول مرة
من جهازك (يتصل بنفس قاعدة Turso):
```bash
npm install
npm i -g vercel && vercel link && vercel env pull .env.local   # يجلب المتغيرات
npm run create-admin -- admin كلمة_مرور_قوية                 # 8 أحرف على الأقل
```
بدون Vercel CLI: أنشئ ملف `.env` فيه `TURSO_DATABASE_URL` و`TURSO_AUTH_TOKEN` فقط ثم نفّذ نفس الأمر.
نفس الأمر يغيّر كلمة المرور لأدمن موجود.

## تشغيل محلي
يلزم Node 22. املأ `.env` (انسخ `.env.example`) ثم `npm start`.
للتجربة بدون Turso يمكنك مؤقتًا وضع `TURSO_DATABASE_URL=file:./local.db` (محليًا فقط؛ مرفوض على Vercel).
`npm test` يشغّل الاختبار الشامل بقاعدة مؤقتة وBlob مُحاكى.

## ملاحظات
- **حد حجم الصورة 4MB** (كان 5MB): دوال Vercel لا تقبل طلبًا أكبر من 4.5MB.
- حذف صورة Blob عند حذف المنتج/تغيير الصورة "بأفضل جهد": لو فشل الحذف لا يفشل الطلب (يُسجَّل خطأ في Logs).
- حد محاولات دخول الأدمن يُطبَّق في ذاكرة كل instance، فهو حماية أساسية وليس حدًا عامًا صارمًا.
