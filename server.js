// تشغيل محلي فقط (npm start / npm run dev). على Vercel يُستخدم api/index.js
try { process.loadEnvFile('.env.local'); } catch { /* اختياري */ }
try { process.loadEnvFile(); } catch { /* لا يوجد ملف .env: نستخدم متغيرات النظام */ }
const app = require('./app');

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`المتجر يعمل على http://localhost:${PORT}`));
