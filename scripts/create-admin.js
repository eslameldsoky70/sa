// الاستخدام: npm run create-admin -- اسم_المستخدم كلمة_المرور
// أو: ADMIN_USER=admin ADMIN_PASS=xxxx npm run create-admin
// يتصل بنفس قاعدة Turso (اقرأ المتغيرات من .env أو .env.local)
try { process.loadEnvFile('.env.local'); } catch {}
try { process.loadEnvFile(); } catch {}
const db = require('../src/db');
const { hashPassword } = require('../src/auth');

(async () => {
  const username = process.argv[2] || process.env.ADMIN_USER;
  const password = process.argv[3] || process.env.ADMIN_PASS;
  if (!username || !password || password.length < 8) {
    console.error('الاستخدام: npm run create-admin -- <username> <password>  (كلمة المرور 8 أحرف على الأقل)');
    process.exit(1);
  }
  await db.run(`INSERT INTO admins (username, password_hash) VALUES (?, ?)
                ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash`,
    [username, hashPassword(password)]);
  console.log(`تم حفظ الأدمن: ${username}`);
})().catch((err) => { console.error('فشل:', err.message); process.exit(1); });
