# دليل بيئة التطوير المحلي — UCS

## البيئات

| البيئة | قاعدة البيانات | الرابط | الملف |
|--------|---------------|--------|-------|
| **محلي** | PostgreSQL Docker (`unified_db`) | `localhost:3000` | `.env.local` |
| **إنتاج** | PostgreSQL على السيرفر | `contract.maz-safety.com` | `.env` (على السيرفر فقط) |

---

## متطلبات التشغيل المحلي

- Docker Desktop شغّال
- Node.js مثبّت
- Container `unified_db` يعمل

---

## تشغيل السيرفر محلياً (Windows)

```bash
cd "final-merge-complete/backend"

set DATABASE_URL=postgresql://unified_user:local_dev_pass@localhost:5432/unified_db
set JWT_SECRET=dev_secret_local_32chars_minimum_xyz
set NODE_ENV=development
npm run dev
```

أو من PowerShell:

```powershell
cd "final-merge-complete/backend"

$env:DATABASE_URL="postgresql://unified_user:local_dev_pass@localhost:5432/unified_db"
$env:JWT_SECRET="dev_secret_local_32chars_minimum_xyz"
$env:NODE_ENV="development"
npm run dev
```

---

## تشغيل الـ Frontend

```bash
cd "final-merge-complete"
npm run dev
```

الفرونت يعمل على `localhost:5173` ويتصل بالبيكند على `localhost:3000`.

---

## قاعدة البيانات المحلية

- **Container:** `unified_db`
- **Host:** `localhost:5432`
- **Database:** `unified_db`
- **User:** `unified_user`
- **Password:** `local_dev_pass`
- **البيانات:** ~850 أمر عمل (مستوردة من الإنتاج)

### التحقق من أن الـ container شغّال
```bash
docker ps
# يجب أن يظهر unified_db بحالة healthy
```

### الدخول المباشر لقاعدة البيانات
```bash
docker exec -it unified_db psql -U unified_user -d unified_db
```

---

## المستخدمون المحليون

| المستخدم | الدور | ملاحظة |
|----------|-------|--------|
| `admin` | ADMIN | موجود في DB |
| `Ibrahim_mo` | ADMIN | موجود في DB |
| `aalmazyad` | MANAGER | موجود في DB |
| `ibrahim` | GIS | موجود في DB |

### إعادة تعيين كلمة مرور admin
```bash
cd "final-merge-complete"
node -e "
const Database = require('better-sqlite3');
// للـ PostgreSQL عبر Docker:
// docker exec unified_db psql -U unified_user -d unified_db -c
// \"UPDATE users SET password_hash = crypt('NewPassword123', gen_salt('bf')) WHERE username = 'admin';\"
"
```

أو عبر Node مباشرة (bcrypt):
```bash
node -e "
const { Client } = require('pg');
const bcrypt = require('bcryptjs');
const hash = bcrypt.hashSync('NewPassword123', 10);
const client = new Client({ connectionString: 'postgresql://unified_user:local_dev_pass@localhost:5432/unified_db' });
client.connect().then(() =>
  client.query('UPDATE users SET password_hash = \$1 WHERE username = \$2', [hash, 'admin'])
).then(() => { console.log('done'); client.end(); });
"
```

---

## الرفع للإنتاج

```bash
# 1. رفع الكود
git add .
git commit -m "description"
git push

# 2. على السيرفر
docker compose up -d --build
```

> ⚠️ ملف `.env.local` **لا يُرفع** للسيرفر — مستثنى في `.gitignore`
> ⚠️ ملف `.env` الخاص بالإنتاج موجود على السيرفر فقط ولا يُلمس محلياً
