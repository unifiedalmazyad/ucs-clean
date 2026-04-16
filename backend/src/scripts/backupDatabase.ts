/**
 * backupDatabase.ts
 *
 * نسخ احتياطي يومي لقاعدة PostgreSQL مع رفع مضغوط إلى GCS.
 *
 * الاستخدام اليدوي:
 *   npx tsx backend/src/scripts/backupDatabase.ts
 *
 * الجدولة التلقائية (Replit Scheduled Deployments):
 *   يُشغَّل يومياً في وقت محدد عبر Replit Deployments → Scheduled.
 *
 * آلية العمل:
 *   1. pg_dump → ضغط gzip → ملف مؤقت في /tmp
 *   2. رفع الملف إلى GCS: {PRIVATE_OBJECT_DIR}/backups/backup_{timestamp}.sql.gz
 *   3. الاحتفاظ بآخر MAX_BACKUPS نسخة (الافتراضي: 14) وحذف الأقدم
 *   4. طباعة ملخص
 */

import 'dotenv/config';
import { execSync } from 'child_process';
import { existsSync, unlinkSync, statSync } from 'fs';
import { objectStorageClient } from '../replit_integrations/object_storage/objectStorage.js';

const MAX_BACKUPS = Number(process.env.BACKUP_KEEP_COUNT) || 14;
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('[BACKUP FATAL] DATABASE_URL is not set.');
  process.exit(1);
}

const PRIVATE_DIR = process.env.PRIVATE_OBJECT_DIR;
if (!PRIVATE_DIR) {
  console.error('[BACKUP FATAL] PRIVATE_OBJECT_DIR is not set.');
  process.exit(1);
}

function parseObjectPath(path: string): { bucketName: string; objectName: string } {
  const normalized = path.startsWith('/') ? path : '/' + path;
  const parts = normalized.split('/');
  return { bucketName: parts[1], objectName: parts.slice(2).join('/') };
}

async function main() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  const tmpFile   = `/tmp/backup_${timestamp}.sql.gz`;
  const backupName = `backup_${timestamp}.sql.gz`;

  // Parse bucket info from PRIVATE_OBJECT_DIR
  // PRIVATE_OBJECT_DIR = /bucket-name/.private
  const { bucketName, objectName: privatePrefix } = parseObjectPath(PRIVATE_DIR!);
  const backupPrefix = `${privatePrefix}/backups/`;
  const backupObjectName = `${backupPrefix}${backupName}`;

  const bucket = objectStorageClient.bucket(bucketName);

  console.log('='.repeat(60));
  console.log('بدء النسخ الاحتياطي لقاعدة البيانات');
  console.log(`الوقت:    ${new Date().toISOString()}`);
  console.log(`الملف:    ${backupName}`);
  console.log(`الـ Bucket: ${bucketName}`);
  console.log('='.repeat(60));

  // ── الخطوة 1: pg_dump مضغوط ──────────────────────────────────────────────
  console.log('\n[1/3] تنفيذ pg_dump وضغط الناتج...');
  try {
    execSync(`pg_dump "${DATABASE_URL}" | gzip -9 > "${tmpFile}"`, {
      shell: '/bin/sh',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const sizeMB = (statSync(tmpFile).size / 1024 / 1024).toFixed(2);
    console.log(`  ✅ تم — حجم الملف المضغوط: ${sizeMB} MB`);
  } catch (err) {
    console.error('  ❌ فشل pg_dump:', (err as Error).message);
    process.exit(1);
  }

  // ── الخطوة 2: رفع إلى GCS ─────────────────────────────────────────────────
  console.log('\n[2/3] رفع الملف إلى GCS...');
  try {
    await bucket.upload(tmpFile, {
      destination: backupObjectName,
      metadata: { contentType: 'application/gzip' },
    });
    console.log(`  ✅ تم — gs://${bucketName}/${backupObjectName}`);
  } catch (err) {
    console.error('  ❌ فشل رفع الملف إلى GCS:', (err as Error).message);
    // Clean up temp file and exit
    if (existsSync(tmpFile)) unlinkSync(tmpFile);
    process.exit(1);
  } finally {
    if (existsSync(tmpFile)) unlinkSync(tmpFile);
  }

  // ── الخطوة 3: الاحتفاظ بآخر MAX_BACKUPS نسخة ─────────────────────────────
  console.log(`\n[3/3] تنظيف النسخ القديمة (الاحتفاظ بآخر ${MAX_BACKUPS})...`);
  try {
    const [files] = await bucket.getFiles({ prefix: backupPrefix });
    // Sort descending (newest first) by name — works because name has ISO timestamp
    const sorted = files
      .filter(f => f.name.endsWith('.sql.gz'))
      .sort((a, b) => b.name.localeCompare(a.name));

    const toDelete = sorted.slice(MAX_BACKUPS);
    if (toDelete.length === 0) {
      console.log(`  ✅ لا توجد نسخ للحذف (الإجمالي: ${sorted.length})`);
    } else {
      for (const f of toDelete) {
        await f.delete();
        console.log(`  🗑  حُذف: ${f.name.split('/').pop()}`);
      }
      console.log(`  ✅ تم حذف ${toDelete.length} نسخة قديمة`);
    }

    console.log(`\n  النسخ المتاحة الآن (${Math.min(sorted.length, MAX_BACKUPS)}):`);
    sorted.slice(0, MAX_BACKUPS).forEach((f, i) => {
      console.log(`    ${i + 1}. ${f.name.split('/').pop()}`);
    });
  } catch (err) {
    console.error('  ⚠️  تحذير — فشل التنظيف:', (err as Error).message);
  }

  console.log('\n' + '='.repeat(60));
  console.log('✅ النسخ الاحتياطي اكتمل بنجاح');
  console.log('='.repeat(60));
}

main().catch((err) => {
  console.error('[BACKUP ERROR]', err);
  process.exit(1);
});
