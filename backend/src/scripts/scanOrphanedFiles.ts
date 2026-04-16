/**
 * scanOrphanedFiles.ts
 *
 * فحص الملفات في GCS التي لا يوجد لها سجل في قاعدة البيانات.
 *
 * الاستخدام:
 *   npx tsx backend/src/scripts/scanOrphanedFiles.ts
 *
 * المخرجات:
 *   - قائمة بالملفات الأيتام (موجودة في GCS لكن غير مرتبطة بـ DB)
 *   - قائمة بمسارات المرفقات في DB التي لا يوجد لها ملف في GCS
 *   - ملخص إجمالي
 *
 * لا يتم حذف أي ملف تلقائياً — تقرير فقط.
 */

import 'dotenv/config';
import { db } from '../db/index.js';
import { workOrderAttachments } from '../db/schema.js';
import { ObjectStorageService } from '../replit_integrations/object_storage/index.js';
import { like } from 'drizzle-orm';

async function main() {
  console.log('='.repeat(60));
  console.log('فحص الملفات الأيتام في GCS');
  console.log('='.repeat(60));
  console.log();

  const objStorage = new ObjectStorageService();

  // 1. جلب جميع الملفات من GCS تحت مسار uploads
  console.log('جاري جلب قائمة الملفات من GCS...');
  let gcsFiles: string[];
  try {
    gcsFiles = await objStorage.listUploadedFiles();
  } catch (err) {
    console.error('فشل في الاتصال بـ GCS:', (err as Error).message);
    process.exit(1);
  }
  console.log(`  عدد الملفات في GCS: ${gcsFiles.length}`);
  console.log();

  // 2. جلب جميع مسارات المرفقات من DB التي تبدأ بـ /objects/
  console.log('جاري جلب سجلات المرفقات من قاعدة البيانات...');
  const dbAttachments = await db
    .select({ url: workOrderAttachments.url, name: workOrderAttachments.name, workOrderId: workOrderAttachments.workOrderId })
    .from(workOrderAttachments)
    .where(like(workOrderAttachments.url, '/objects/%'));

  console.log(`  عدد المرفقات المسجلة في DB (GCS فقط): ${dbAttachments.length}`);
  console.log();

  const dbUrlSet  = new Set(dbAttachments.map(a => a.url));
  const gcsUrlSet = new Set(gcsFiles);

  // 3. ملفات في GCS لكن غير مسجلة في DB (orphaned)
  const orphanedInGCS = gcsFiles.filter(path => !dbUrlSet.has(path));

  // 4. سجلات في DB لكن الملف غير موجود في GCS (broken links)
  const brokenInDB = dbAttachments.filter(a => !gcsUrlSet.has(a.url));

  // ── تقرير الملفات الأيتام ──────────────────────────────────────────────────
  console.log('─'.repeat(60));
  console.log(`ملفات موجودة في GCS لكن غير مسجلة في DB (أيتام): ${orphanedInGCS.length}`);
  console.log('─'.repeat(60));
  if (orphanedInGCS.length === 0) {
    console.log('  لا توجد ملفات أيتام.');
  } else {
    orphanedInGCS.forEach((path, i) => {
      console.log(`  ${i + 1}. ${path}`);
    });
  }
  console.log();

  // ── تقرير الروابط المكسورة ────────────────────────────────────────────────
  console.log('─'.repeat(60));
  console.log(`سجلات في DB لكن الملف غير موجود في GCS (روابط مكسورة): ${brokenInDB.length}`);
  console.log('─'.repeat(60));
  if (brokenInDB.length === 0) {
    console.log('  لا توجد روابط مكسورة.');
  } else {
    brokenInDB.forEach((a, i) => {
      console.log(`  ${i + 1}. ${a.url} | الاسم: ${a.name} | أمر عمل: ${a.workOrderId}`);
    });
  }
  console.log();

  // ── ملخص ──────────────────────────────────────────────────────────────────
  console.log('='.repeat(60));
  console.log('الملخص:');
  console.log(`  إجمالي ملفات GCS:          ${gcsFiles.length}`);
  console.log(`  إجمالي سجلات DB (GCS):     ${dbAttachments.length}`);
  console.log(`  ملفات أيتام في GCS:         ${orphanedInGCS.length}`);
  console.log(`  روابط مكسورة في DB:         ${brokenInDB.length}`);
  console.log('='.repeat(60));
  console.log();
  console.log('ملاحظة: لا يتم حذف أي ملف تلقائياً. هذا تقرير فحص فقط.');
  console.log('لحذف الملفات الأيتام يدوياً، استخدم أداة "Object Storage" في Replit.');
}

main().catch((err) => {
  console.error('خطأ غير متوقع:', err);
  process.exit(1);
});
