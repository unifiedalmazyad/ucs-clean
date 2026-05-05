# نظام العقود الموحد — UCS

نظام لإدارة أوامر العمل الميدانية. يدعم متابعة المراحل، تتبع مؤشرات الأداء (KPI)، إدارة العقود وتصاريح الحفر، مع نظام صلاحيات مفصّل حسب القطاع والمنطقة.

---

## المتطلبات

| | |
|---|---|
| Node.js | 20+ |
| Docker + Docker Compose | للتشغيل مع PostgreSQL |
| PostgreSQL 15 | يُدار عبر Docker |

---

## النشر على الإنتاج

```bash
# 1. نسخ وتعبئة متغيرات البيئة
cp .env.example .env

# 2. بناء وتشغيل
docker compose -f docker-compose.server-working.yml up -d --build

# 3. التحقق من الصحة
curl http://localhost:3010/api/health
# المتوقع: {"status":"ok","db":"connected"}
```

---

## التشغيل المحلي للتطوير

```bash
# تثبيت التبعيات
npm install

# تشغيل (backend + Vite في نفس العملية)
npm run dev
```

للتفاصيل الكاملة (متغيرات البيئة المحلية، إعداد Docker، المستخدمين) راجع [DEV_SETUP.md](DEV_SETUP.md).

> **ملاحظة:** في وضع التطوير — إذا لم يُضبط `DATABASE_URL` — يعمل النظام على SQLite محلي.
> هذا fallback مؤقت سيُزال في مرحلة Cleanup القادمة.

---

## المتغيرات المطلوبة

| المتغير | الوصف | مطلوب في Production |
|---|---|---|
| `DATABASE_URL` | رابط اتصال PostgreSQL | ✅ |
| `JWT_SECRET` | مفتاح JWT (64 حرف+) | ✅ |
| `ADMIN_DEFAULT_PASSWORD` | كلمة مرور admin (12 حرف+) | ✅ |
| `POSTGRES_PASSWORD` | كلمة مرور قاعدة البيانات | ✅ |

انظر [`.env.example`](.env.example) للقائمة الكاملة.

---

## هيكل المشروع

```
backend/src/
  server.ts            # نقطة دخول Express
  db/index.ts          # إعداد قاعدة البيانات
  db/schema_pg.ts      # تعريف الجداول (Drizzle ORM)
  routes/              # API endpoints
  middleware/auth.ts   # JWT authentication

src/
  pages/               # صفحات React (Vite SPA)
  components/          # مكونات مشتركة

backend/src/db/migrations/   # ملفات SQL migrations
```

---

## أوامر مفيدة

```bash
npm run dev     # تشغيل محلي
npm run build   # بناء frontend (Vite)
npm run lint    # فحص TypeScript (tsc --noEmit)
```
