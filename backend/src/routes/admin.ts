import express from 'express';
import multer from 'multer';
import path from 'path';
import { mkdir } from 'fs/promises';
import { randomUUID } from 'crypto';
import { db, pool } from '../db';
import { 
  columnCatalog, 
  roleColumnPermissions, 
  userColumnOverrides, 
  stages, 
  kpiTemplates, 
  kpiRules, 
  users, 
  regions, 
  sectors, 
  columnOptions,
  auditLogs,
  columnGroups,
  columnCategories,
  roleDefinitions,
  workOrders,
  periodicKpiExecutionRules,
  periodicKpiFinancialRule,
  periodicKpiReportSettings,
  periodicKpiMetrics,
  userReportColumnPrefs,
} from '../db/schema';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { eq, and, sql, ne, asc } from 'drizzle-orm';
import bcrypt from 'bcryptjs';

const router = express.Router();

/**
 * Strip fields that must not be passed to Drizzle update:
 * - id (PK, never update)
 * - createdAt / created_at (auto-managed)
 * - updatedAt / updated_at (auto-managed or handled explicitly)
 * Also converts any date strings to Date objects for timestamp columns.
 */
function sanitize(body: Record<string, any>): Record<string, any> {
  const SKIP = new Set(['id', 'createdAt', 'created_at', 'updatedAt', 'updated_at']);
  const result: Record<string, any> = {};
  for (const [k, v] of Object.entries(body)) {
    if (SKIP.has(k)) continue;
    result[k] = v;
  }
  return result;
}

// Sync Columns
router.post('/columns/sync', authenticate, authorize(['ADMIN']), async (req, res) => {
  const { table } = req.query;
  if (table !== 'work_orders') return res.status(400).json({ error: 'Only work_orders supported' });

  const isDemo = process.env.DEMO_MODE === 'true' || !process.env.DATABASE_URL;

  try {
    let dbColumns: any[] = [];
    
    if (isDemo) {
      const info = await db.execute(sql`PRAGMA table_info(work_orders)`);
      dbColumns = info.map((col: any) => ({
        column_name: col.name,
        data_type: col.type
      }));
    } else {
      const info = await db.execute(sql`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'work_orders'
      `);
      dbColumns = info.rows;
    }

    const existingCatalog = await db.select().from(columnCatalog).where(eq(columnCatalog.tableName, 'work_orders'));
    
    const businessColumnsMapping: Record<string, { label: string, group: string, category?: string }> = {
      work_type: { label: 'نوع العمل', group: 'BASIC', category: 'EXEC' },
      order_number: { label: 'امر العمل', group: 'BASIC', category: 'EXEC' },
      client: { label: 'العميل', group: 'BASIC', category: 'EXEC' },
      assignment_date: { label: 'تاريخ الاسناد', group: 'BASIC', category: 'EXEC' },
      location: { label: 'الموقع', group: 'BASIC', category: 'EXEC' },
      project_type: { label: 'نوعية المشروع', group: 'BASIC', category: 'EXEC' },
      station: { label: 'المحطة', group: 'BASIC', category: 'EXEC' },
      length: { label: 'الطول', group: 'BASIC', category: 'EXEC' },
      consultant: { label: 'الاستشاري', group: 'BASIC', category: 'EXEC' },
      survey_date: { label: 'تاريخ المسح', group: 'OPS', category: 'EXEC' },
      coordination_date: { label: 'تاريخ التنسيق', group: 'COORD', category: 'EXEC' },
      coordination_cert_number: { label: 'رقم شهادة التنسيق', group: 'COORD', category: 'EXEC' },
      notes: { label: 'ملاحظات', group: 'BASIC', category: 'EXEC' },
      drilling_team: { label: 'فريق الحفر', group: 'OPS', category: 'EXEC' },
      drilling_date: { label: 'تاريخ الحفر', group: 'OPS', category: 'EXEC' },
      shutdown_date: { label: 'تاريخ التطفئة', group: 'OPS', category: 'EXEC' },
      procedure: { label: 'الاجراء', group: 'BASIC', category: 'EXEC' },
      hold_reason: { label: 'سبب تعليق الإجراء', group: 'BASIC', category: 'EXEC' },
      material_sheet_date: { label: 'تاريخ استلام ورقة المواد', group: 'BASIC', category: 'EXEC' },
      check_sheets_date: { label: 'تاريخ استلام اوراق تشيك', group: 'BASIC', category: 'EXEC' },
      metering_sheet_date: { label: 'تاريخ تجهيز ورقة التمتير', group: 'GIS_155', category: 'FIN' },
      gis_completion_date: { label: 'تاريخ الانتهاء من GIS', group: 'GIS_155', category: 'FIN' },
      proc_155_close_date: { label: 'تاريخ اقفال اجراء 155', group: 'GIS_155', category: 'FIN' },
      completion_cert_confirm: { label: 'تأكيد شهادة إنجاز', group: 'BASIC', category: 'FIN' },
      estimated_value: { label: 'القيمة التقديرية', group: 'FINANCE', category: 'FIN' },
      invoice_number: { label: 'رقم المستخلص', group: 'FINANCE', category: 'FIN' },
      actual_invoice_value: { label: 'القيمة الفعلية للفاتورة', group: 'FINANCE', category: 'FIN' },
      invoice_type: { label: 'نوع المستخلص', group: 'FINANCE', category: 'FIN' },
      invoice_1: { label: 'مستخلص 1', group: 'FINANCE', category: 'FIN' },
      invoice_2: { label: 'مستخلص 2', group: 'FINANCE', category: 'FIN' },
      collected_amount: { label: 'القيمة المحصله', group: 'FINANCE', category: 'FIN' },
      remaining_amount:      { label: 'المتبقى', group: 'FINANCE', category: 'FIN' },
      exec_delay_justified:  { label: 'هل التأخير التنفيذي مسبب؟', group: 'OPS',     category: 'EXEC' },
      exec_delay_reason:            { label: 'سبب التأخير التنفيذي',       group: 'OPS',     category: 'EXEC' },
      work_status_classification:   { label: 'حالة التنفيذ',               group: 'OPS',     category: 'EXEC' },
      fin_delay_justified:   { label: 'هل التأخير المالي مسبب؟',   group: 'FINANCE', category: 'FIN'  },
      fin_delay_reason:      { label: 'سبب التأخير المالي',         group: 'FINANCE', category: 'FIN'  },
    };

    for (const row of dbColumns) {
      const colKey = row.column_name;
      if (['id', 'created_at', 'updated_at', 'created_by', 'updated_by', 'status', 'stage', 'stage_id', 'custom_fields'].includes(colKey)) continue;

      const exists = existingCatalog.find(c => c.columnKey === colKey);
      if (!exists) {
        const mapping = businessColumnsMapping[colKey] || { label: colKey, group: 'BASIC', category: 'EXEC' };
        await db.insert(columnCatalog).values({
          tableName: 'work_orders',
          columnKey: colKey,
          labelAr: mapping.label,
          groupKey: mapping.group,
          category: mapping.category || 'EXEC',
          dataType: row.data_type,
          isSensitive: mapping.group === 'FINANCE',
          isCustom: false,
        });

        await db.insert(roleColumnPermissions).values({
          role: 'ADMIN',
          tableName: 'work_orders',
          columnKey: colKey,
          canRead: true,
          canWrite: true,
        });
      }
    }

    res.json({ message: 'Sync completed' });
  } catch (err) {
    console.error('Sync error:', err);
    res.status(500).json({ error: 'Sync failed' });
  }
});

// Get Catalog
router.get('/columns', authenticate, authorize(['ADMIN']), async (req, res) => {
  try {
    const catalog = await db.select().from(columnCatalog).orderBy(asc(columnCatalog.sortOrder));
    res.json(catalog);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch columns' });
  }
});

// Public (authenticated) endpoint — returns columns marked showInCreate with their options
// Hides / filters sector & region fields based on the calling user's scope
router.get('/columns/create-fields', authenticate, async (req: AuthRequest, res) => {
  try {
    const user = req.user!;

    // ── Resolve user scope ──────────────────────────────────────────────────
    const [dbUser, roleDef] = await Promise.all([
      db.query.users.findFirst({ where: eq(users.id, user.id) }),
      db.query.roleDefinitions.findFirst({ where: eq(roleDefinitions.roleKey, user.role) }),
    ]);
    const userSectorId  = (dbUser as any)?.sectorId  ?? (dbUser as any)?.sector_id  ?? null;
    const userRegionId  = (dbUser as any)?.regionId  ?? (dbUser as any)?.region_id  ?? null;
    const scopeType     = roleDef?.scopeType ?? 'ALL';

    const catalog = await db.select().from(columnCatalog)
      .where(and(eq(columnCatalog.showInCreate, true), eq(columnCatalog.isEnabled, true)))
      .orderBy(asc(columnCatalog.sortOrder));

    const fieldsWithOptions = await Promise.all(catalog.map(async col => {
      let options: any[] = [];
      let hidden  = false;
      let prefill: any = undefined;

      if (col.columnKey === 'sector_id') {
        // OWN_REGION / OWN_SECTOR → sector is always fixed from user profile, hide the dropdown
        if (scopeType === 'OWN_REGION' || scopeType === 'OWN_SECTOR') {
          hidden  = true;
          prefill = userSectorId;
        } else {
          // ALL → show all active sectors
          const allSectors = await db.select().from(sectors).where(eq(sectors.active, true));
          options = allSectors.map(s => ({ value: s.id, labelAr: s.nameAr, labelEn: s.nameEn }));
        }

      } else if (col.columnKey === 'region_id') {
        if (scopeType === 'OWN_REGION') {
          // Region is also fixed, hide it
          hidden  = true;
          prefill = userRegionId;
        } else if (scopeType === 'OWN_SECTOR' && userSectorId) {
          // Show region dropdown filtered to the user's sector only
          const sectorRegions = await db.select().from(regions)
            .where(and(eq(regions.sectorId, userSectorId), eq(regions.active, true)));
          options = sectorRegions.map(r => ({ value: r.id, labelAr: r.nameAr, labelEn: r.nameEn }));
        } else {
          // ALL → show all active regions
          const allRegions = await db.select().from(regions).where(eq(regions.active, true));
          options = allRegions.map(r => ({ value: r.id, labelAr: r.nameAr, labelEn: r.nameEn }));
        }

      } else if (col.dataType === 'select') {
        options = await db.select().from(columnOptions)
          .where(and(eq(columnOptions.columnKey, col.columnKey), eq(columnOptions.active, true)));
        options.sort((a: any, b: any) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
      }

      return { ...col, options, hidden, prefill };
    }));

    res.json({
      fields:    fieldsWithOptions,
      userScope: { scopeType, sectorId: userSectorId, regionId: userRegionId },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch create fields' });
  }
});

// Get Role Permissions
router.get('/permissions/roles', authenticate, authorize(['ADMIN']), async (req, res) => {
  try {
    const perms = await db.select().from(roleColumnPermissions);
    res.json(perms);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch permissions' });
  }
});

// Update Role Permission
router.put('/permissions/roles', authenticate, authorize(['ADMIN']), async (req, res) => {
  try {
    const { role, columnKey, canRead, canWrite } = req.body;
    
    await db.insert(roleColumnPermissions).values({
      role,
      tableName: 'work_orders',
      columnKey,
      canRead,
      canWrite,
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: [roleColumnPermissions.role, roleColumnPermissions.tableName, roleColumnPermissions.columnKey],
      set: { canRead, canWrite, updatedAt: new Date() }
    });

    res.json({ message: 'Updated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update permission' });
  }
});

// --- Users ---
router.get('/users', authenticate, authorize(['ADMIN']), async (req, res) => {
  try {
    const allUsers = await db.select().from(users);
    res.json(allUsers.map((u: any) => {
      const { passwordHash, ...rest } = u;
      return rest;
    }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

router.post('/users', authenticate, authorize(['ADMIN']), async (req, res) => {
  try {
    const { username, password, fullName, role, regionId, sectorId, employeeId, phoneNumber, email } = req.body;
    const hash = await bcrypt.hash(password, 10);
    const [newUser] = await db.insert(users).values({
      username,
      passwordHash: hash,
      fullName,
      role,
      regionId: regionId || null,
      sectorId: sectorId || null,
      employeeId: employeeId || null,
      phoneNumber: phoneNumber || null,
      email: email || null,
    }).returning();
    
    const { passwordHash, ...rest } = newUser;
    res.json(rest);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

router.put('/users/:id', authenticate, authorize(['ADMIN']), async (req, res) => {
  try {
    const { password, ...rest } = req.body;
    const updateData: any = sanitize(rest);
    // Convert empty strings to null for nullable UUID foreign keys
    if ('regionId' in updateData) updateData.regionId = updateData.regionId || null;
    if ('sectorId' in updateData) updateData.sectorId = updateData.sectorId || null;
    if (password) {
      updateData.passwordHash = await bcrypt.hash(password, 10);
    }
    await db.update(users).set(updateData).where(eq(users.id, req.params.id));
    res.json({ message: 'Updated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

router.post('/users/:id/reset-password', authenticate, authorize(['ADMIN']), async (req, res) => {
  try {
    const { password } = req.body;
    const hash = await bcrypt.hash(password, 10);
    await db.update(users).set({ passwordHash: hash }).where(eq(users.id, req.params.id));
    res.json({ message: 'Password reset' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

router.post('/users/:id/toggle-active', authenticate, authorize(['ADMIN']), async (req, res) => {
  try {
    const [user] = await db.select().from(users).where(eq(users.id, req.params.id));
    if (!user) return res.status(404).json({ error: 'User not found' });
    await db.update(users).set({ active: !user.active }).where(eq(users.id, req.params.id));
    res.json({ message: 'Status toggled' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to toggle user status' });
  }
});

// --- Regions ---
router.get('/regions', authenticate, authorize(['ADMIN']), async (req, res) => {
  try {
    const { sectorId } = req.query;
    let q = db.select().from(regions);
    if (sectorId) {
      q = q.where(eq(regions.sectorId, sectorId as string));
    }
    const data = await q;
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch regions' });
  }
});

router.post('/regions', authenticate, authorize(['ADMIN']), async (req, res) => {
  try {
    const [data] = await db.insert(regions).values(req.body).returning();
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create region' });
  }
});

router.put('/regions/:id', authenticate, authorize(['ADMIN']), async (req, res) => {
  try {
    await db.update(regions).set(sanitize(req.body)).where(eq(regions.id, req.params.id));
    res.json({ message: 'Updated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update region' });
  }
});

// --- Sectors ---
router.get('/sectors', authenticate, authorize(['ADMIN']), async (req, res) => {
  try {
    const data = await db.select().from(sectors);
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch sectors' });
  }
});

router.post('/sectors', authenticate, authorize(['ADMIN']), async (req, res) => {
  try {
    const [data] = await db.insert(sectors).values(req.body).returning();
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create sector' });
  }
});

router.put('/sectors/:id', authenticate, authorize(['ADMIN']), async (req, res) => {
  try {
    await db.update(sectors).set(sanitize(req.body)).where(eq(sectors.id, req.params.id));
    res.json({ message: 'Updated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update sector' });
  }
});

// --- Column Groups ---
router.get('/column-groups', authenticate, authorize(['ADMIN']), async (req, res) => {
  try {
    const data = await db.select().from(columnGroups).orderBy(columnGroups.sortOrder);
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch column groups' });
  }
});

router.post('/column-groups', authenticate, authorize(['ADMIN']), async (req, res) => {
  try {
    const [data] = await db.insert(columnGroups).values(req.body).returning();
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create column group' });
  }
});

router.put('/column-groups/:id', authenticate, authorize(['ADMIN']), async (req, res) => {
  try {
    await db.update(columnGroups).set(sanitize(req.body)).where(eq(columnGroups.id, req.params.id));
    res.json({ message: 'Updated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update column group' });
  }
});

// PATCH rename a group key — cascades to column_catalog.group_key
router.patch('/column-groups/:id/rename-key', authenticate, authorize(['ADMIN']), async (req, res) => {
  try {
    const { newKey } = req.body as { newKey: string };

    if (!newKey || !/^[A-Z][A-Z0-9_]*$/.test(newKey)) {
      return res.status(400).json({ error: 'الكود يجب أن يكون بالإنجليزية الكبيرة وأرقام وشرطة سفلية فقط (مثل: BASIC, OPS_2)' });
    }

    const [grp] = await db.select().from(columnGroups).where(eq(columnGroups.id, req.params.id));
    if (!grp) return res.status(404).json({ error: 'المجموعة غير موجودة' });

    const oldKey = grp.key;
    if (oldKey === newKey) return res.json({ message: 'لا يوجد تغيير' });

    const [conflict] = await db.select().from(columnGroups).where(eq(columnGroups.key, newKey));
    if (conflict) return res.status(409).json({ error: `الكود "${newKey}" مستخدم بالفعل` });

    // Find the FK constraint name (if any) from the DB catalog
    const fkResult = await db.execute(sql`
      SELECT tc.constraint_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
      WHERE tc.table_name = 'column_catalog'
        AND tc.constraint_type = 'FOREIGN KEY'
        AND kcu.column_name = 'group_key'
      LIMIT 1
    `);
    const rawFkName: string | null = fkResult.rows.length > 0
      ? (fkResult.rows[0] as any).constraint_name
      : null;
    const FK_NAME_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
    const fkName = rawFkName && FK_NAME_REGEX.test(rawFkName) ? rawFkName : null;

    await db.transaction(async (tx) => {
      // Drop FK if it exists so we can update the parent key freely
      if (fkName) {
        await tx.execute(sql.raw(`ALTER TABLE column_catalog DROP CONSTRAINT IF EXISTS "${fkName}"`));
      }
      // 1. Update the group key itself
      await tx.execute(sql`UPDATE column_groups SET key = ${newKey} WHERE id = ${req.params.id}`);
      // 2. Update all referencing columns in catalog
      await tx.execute(sql`UPDATE column_catalog SET group_key = ${newKey} WHERE group_key = ${oldKey}`);
      // Re-add FK constraint
      if (fkName) {
        await tx.execute(sql.raw(`ALTER TABLE column_catalog ADD CONSTRAINT "${fkName}" FOREIGN KEY (group_key) REFERENCES column_groups(key)`));
      }
    });

    res.json({ message: 'تم تغيير الكود بنجاح', oldKey, newKey });
  } catch (err) {
    console.error('[RENAME GROUP KEY]', err);
    res.status(500).json({ error: 'فشل تغيير الكود' });
  }
});

// --- Column Categories ---
router.get('/column-categories', authenticate, async (_req, res) => {
  try {
    const cats = await db.select().from(columnCategories).orderBy(asc(columnCategories.sortOrder));
    res.json(cats);
  } catch (err) { res.status(500).json({ error: 'Failed to fetch categories' }); }
});

router.post('/column-categories', authenticate, authorize(['ADMIN']), async (req, res) => {
  try {
    const { key, nameAr, sortOrder } = req.body;
    if (!key || !/^[A-Z][A-Z0-9_]*$/.test(key)) return res.status(400).json({ error: 'الكود يجب أن يكون بالإنجليزية الكبيرة (مثل: EXEC, FIN)' });
    if (!nameAr) return res.status(400).json({ error: 'الاسم بالعربي مطلوب' });
    const [cat] = await db.insert(columnCategories).values({ key, nameAr, sortOrder: sortOrder ?? 0 }).returning();
    res.json(cat);
  } catch (err: any) {
    if (err?.code === '23505') return res.status(409).json({ error: `الكود "${req.body.key}" مستخدم بالفعل` });
    res.status(500).json({ error: 'فشل إنشاء الفئة' });
  }
});

router.put('/column-categories/:id', authenticate, authorize(['ADMIN']), async (req, res) => {
  try {
    const { key, ...rest } = req.body;
    await db.update(columnCategories).set(rest).where(eq(columnCategories.id, req.params.id));
    res.json({ message: 'Updated' });
  } catch (err) { res.status(500).json({ error: 'فشل تحديث الفئة' }); }
});

router.patch('/column-categories/reorder', authenticate, authorize(['ADMIN']), async (req, res) => {
  try {
    const { ids } = req.body as { ids: string[] };
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids required' });
    await db.transaction(async (tx) => {
      for (let i = 0; i < ids.length; i++) {
        await tx.update(columnCategories).set({ sortOrder: i + 1 }).where(eq(columnCategories.id, ids[i]));
      }
    });
    res.json({ message: 'تم حفظ الترتيب' });
  } catch (err) { res.status(500).json({ error: 'فشل حفظ الترتيب' }); }
});

// PATCH rename a category key — cascades to column_catalog, stages, kpi_templates, kpi_rules
router.patch('/column-categories/:id/rename-key', authenticate, authorize(['ADMIN']), async (req, res) => {
  try {
    const { newKey } = req.body as { newKey: string };
    if (!newKey || !/^[A-Z][A-Z0-9_]*$/.test(newKey)) {
      return res.status(400).json({ error: 'الكود يجب أن يكون بالإنجليزية الكبيرة وأرقام وشرطة سفلية فقط' });
    }
    const [cat] = await db.select().from(columnCategories).where(eq(columnCategories.id, req.params.id));
    if (!cat) return res.status(404).json({ error: 'الفئة غير موجودة' });
    const oldKey = cat.key;
    if (oldKey === newKey) return res.json({ message: 'لا يوجد تغيير' });
    const [conflict] = await db.select().from(columnCategories).where(eq(columnCategories.key, newKey));
    if (conflict) return res.status(409).json({ error: `الكود "${newKey}" مستخدم بالفعل` });

    await db.transaction(async (tx) => {
      await tx.execute(sql`UPDATE column_categories SET key = ${newKey} WHERE id = ${req.params.id}`);
      await tx.execute(sql`UPDATE column_catalog SET category = ${newKey} WHERE category = ${oldKey}`);
      await tx.execute(sql`UPDATE stages SET category = ${newKey} WHERE category = ${oldKey}`);
      await tx.execute(sql`UPDATE kpi_templates SET category = ${newKey} WHERE category = ${oldKey}`);
      await tx.execute(sql`UPDATE kpi_rules SET category = ${newKey} WHERE category = ${oldKey}`);
    });

    res.json({ message: 'تم تغيير الكود بنجاح', oldKey, newKey });
  } catch (err) {
    console.error('[RENAME CATEGORY KEY]', err);
    res.status(500).json({ error: 'فشل تغيير الكود' });
  }
});

// --- Columns (Dynamic) ---
router.post('/columns', authenticate, authorize(['ADMIN']), async (req, res) => {
  try {
    const { options, ...colData } = req.body;
    
    if (!colData.groupKey) {
      return res.status(400).json({ error: 'groupKey is required' });
    }
    if (!colData.labelAr) {
      return res.status(400).json({ error: 'labelAr is required' });
    }
    if (!colData.columnKey) {
      return res.status(400).json({ error: 'columnKey is required' });
    }

    const COL_KEY_REGEX = /^[a-z][a-z0-9_]*$/;
    if (!COL_KEY_REGEX.test(colData.columnKey)) {
      return res.status(400).json({ error: 'columnKey: أحرف إنجليزية صغيرة وأرقام وشرطة سفلية فقط' });
    }

    const coreCols = ['id', 'work_type', 'order_number', 'client', 'assignment_date', 'location', 'project_type', 'station', 'length', 'consultant', 'survey_date', 'coordination_date', 'coordination_cert_number', 'notes', 'drilling_team', 'drilling_date', 'shutdown_date', 'procedure', 'hold_reason', 'material_sheet_date', 'check_sheets_date', 'metering_sheet_date', 'gis_completion_date', 'proc_155_close_date', 'completion_cert_confirm', 'estimated_value', 'invoice_number', 'actual_invoice_value', 'invoice_type', 'invoice_1', 'invoice_2', 'collected_amount', 'remaining_amount'];
    if (coreCols.includes(colData.columnKey)) {
      return res.status(400).json({ error: 'Column key conflicts with core database column' });
    }

    const maxRes = await db.select({ m: sql<number>`MAX(sort_order)` }).from(columnCatalog);
    const nextOrder = (maxRes[0]?.m ?? 0) + 1;

    // Map UI dataType → PostgreSQL column type
    const DATA_TYPE_SQL: Record<string, string> = {
      text: 'TEXT', number: 'NUMERIC', date: 'TIMESTAMPTZ',
      boolean: 'BOOLEAN', select: 'TEXT',
    };
    const sqlType = DATA_TYPE_SQL[colData.dataType] || 'TEXT';

    // Create the actual physical column in work_orders before inserting catalog row
    if (pool) {
      await pool.query(
        `ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS "${colData.columnKey}" ${sqlType};`
      );
    }

    const [newCol] = await db.insert(columnCatalog).values({
      ...colData,
      tableName: 'work_orders',
      isCustom: false,           // physical column → not custom
      sortOrder: nextOrder,
      physicalKey: colData.columnKey, // lock physical key at creation — never changed on rename
    }).returning();

    if (options && Array.isArray(options)) {
      for (const opt of options) {
        await db.insert(columnOptions).values({
          columnKey: colData.columnKey,
          ...opt
        });
      }
    }

    await db.insert(roleColumnPermissions).values({
      role: 'ADMIN',
      tableName: 'work_orders',
      columnKey: colData.columnKey,
      canRead: true,
      canWrite: true,
    });

    res.json(newCol);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create column' });
  }
});

router.put('/columns/:id', authenticate, authorize(['ADMIN']), async (req, res) => {
  try {
    const { options, ...rawData } = req.body;
    const colData = sanitize(rawData);
    await db.update(columnCatalog).set(colData).where(eq(columnCatalog.id, req.params.id));
    
    if (options && Array.isArray(options)) {
      await db.delete(columnOptions).where(eq(columnOptions.columnKey, colData.columnKey));
      for (const opt of options) {
        await db.insert(columnOptions).values({
          columnKey: colData.columnKey,
          ...opt
        });
      }
    }
    res.json({ message: 'Updated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update column' });
  }
});

// PATCH reorder columns — receives ordered array of IDs, assigns sortOrder 1..n
router.patch('/columns/reorder', authenticate, authorize(['ADMIN']), async (req, res) => {
  try {
    const { ids } = req.body as { ids: string[] };
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids array required' });
    }
    await db.transaction(async (tx) => {
      for (let i = 0; i < ids.length; i++) {
        await tx.update(columnCatalog)
          .set({ sortOrder: i + 1 })
          .where(eq(columnCatalog.id, ids[i]));
      }
    });
    res.json({ message: 'تم حفظ الترتيب' });
  } catch (err) {
    console.error('[REORDER COLUMNS]', err);
    res.status(500).json({ error: 'فشل حفظ الترتيب' });
  }
});

// PATCH rename a column key — updates ALL references in a single transaction
router.patch('/columns/:id/rename-key', authenticate, authorize(['ADMIN']), async (req, res) => {
  try {
    const { newKey } = req.body as { newKey: string };

    // Validate format: snake_case only
    if (!newKey || !/^[a-z][a-z0-9_]*$/.test(newKey)) {
      return res.status(400).json({ error: 'الكود يجب أن يكون بالإنجليزية صغيرة وأرقام وشرطة سفلية فقط (snake_case)' });
    }

    // Get the current column
    const [col] = await db.select().from(columnCatalog).where(eq(columnCatalog.id, req.params.id));
    if (!col) return res.status(404).json({ error: 'العمود غير موجود' });

    const oldKey = col.columnKey;
    if (oldKey === newKey) return res.json({ message: 'لا يوجد تغيير' });

    // Ensure newKey is not already in use
    const [conflict] = await db.select().from(columnCatalog).where(eq(columnCatalog.columnKey, newKey));
    if (conflict) return res.status(409).json({ error: `الكود "${newKey}" مستخدم بالفعل` });

    // Run all updates inside a transaction
    await db.transaction(async (tx) => {
      // 0. Lock physicalKey to oldKey if not already set (first rename — locks original DB column name)
      const currentPhysical = (col as any).physicalKey;
      await tx.update(columnCatalog)
        .set({ columnKey: newKey, ...(!currentPhysical ? { physicalKey: oldKey } : {}) })
        .where(eq(columnCatalog.id, req.params.id));
      // 2. role_column_permissions
      await tx.update(roleColumnPermissions).set({ columnKey: newKey }).where(eq(roleColumnPermissions.columnKey, oldKey));
      // 3. user_column_overrides
      await tx.update(userColumnOverrides).set({ columnKey: newKey }).where(eq(userColumnOverrides.columnKey, oldKey));
      // 4. column_options
      await tx.update(columnOptions).set({ columnKey: newKey }).where(eq(columnOptions.columnKey, oldKey));
      // 5. kpi_rules — start_column_key
      await tx.update(kpiRules).set({ startColumnKey: newKey }).where(eq(kpiRules.startColumnKey, oldKey));
      // 6. kpi_rules — end_column_key
      await tx.update(kpiRules).set({ endColumnKey: newKey }).where(eq(kpiRules.endColumnKey, oldKey));
      // 7. periodic_kpi_execution_rules
      await tx.update(periodicKpiExecutionRules).set({ startColumnKey: newKey }).where(eq(periodicKpiExecutionRules.startColumnKey, oldKey));
      await tx.update(periodicKpiExecutionRules).set({ endColumnKey: newKey }).where(eq(periodicKpiExecutionRules.endColumnKey, oldKey));
      // 8. periodic_kpi_financial_rule
      await tx.update(periodicKpiFinancialRule).set({ startColumnKey: newKey }).where(eq(periodicKpiFinancialRule.startColumnKey, oldKey));
      await tx.update(periodicKpiFinancialRule).set({ endColumnKey: newKey }).where(eq(periodicKpiFinancialRule.endColumnKey, oldKey));
      // 9. periodic_kpi_metrics — all three column key fields
      await tx.update(periodicKpiMetrics).set({ startColumnKey: newKey }).where(eq(periodicKpiMetrics.startColumnKey, oldKey));
      await tx.update(periodicKpiMetrics).set({ endColumnKey: newKey }).where(eq(periodicKpiMetrics.endColumnKey, oldKey));
      await tx.update(periodicKpiMetrics).set({ valueColumnKey: newKey }).where(eq(periodicKpiMetrics.valueColumnKey, oldKey));
      // 10. user_report_column_prefs — selectedColumnKeys is a JSON array; replace the old key inside the array
      await tx.execute(sql`
        UPDATE user_report_column_prefs
        SET selected_column_keys = (
          SELECT jsonb_agg(
            CASE WHEN elem::text = ${JSON.stringify(oldKey)}
              THEN ${JSON.stringify(newKey)}::jsonb
              ELSE elem
            END
          )
          FROM jsonb_array_elements(selected_column_keys) AS elem
        )
        WHERE selected_column_keys @> ${JSON.stringify(oldKey)}::jsonb
      `);
    });

    res.json({ message: 'تم تغيير الكود بنجاح', oldKey, newKey });
  } catch (err) {
    console.error('[RENAME KEY]', err);
    res.status(500).json({ error: 'فشل تغيير الكود' });
  }
});

router.get('/column-options/:columnKey', authenticate, async (req, res) => {
  try {
    const opts = await db.select().from(columnOptions).where(eq(columnOptions.columnKey, req.params.columnKey));
    res.json(opts);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch column options' });
  }
});

// --- Stages ---
router.get('/stages', authenticate, authorize(['ADMIN']), async (req, res) => {
  try {
    const data = await db.select().from(stages).orderBy(stages.seq);
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch stages' });
  }
});

router.post('/stages', authenticate, authorize(['ADMIN']), async (req, res) => {
  try {
    const [data] = await db.insert(stages).values(req.body).returning();
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create stage' });
  }
});

router.put('/stages/:id', authenticate, authorize(['ADMIN']), async (req, res) => {
  try {
    await db.update(stages).set(sanitize(req.body)).where(eq(stages.id, req.params.id));
    res.json({ message: 'Updated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update stage' });
  }
});

router.delete('/stages/:id', authenticate, authorize(['ADMIN']), async (req, res) => {
  const { id } = req.params;
  try {
    const [usedByOrder] = await db.select({ id: workOrders.id }).from(workOrders)
      .where(eq(workOrders.stageId, id)).limit(1);
    if (usedByOrder) {
      return res.status(400).json({ error: 'الإجراء مرتبط بأوامر عمل ولا يمكن حذفه' });
    }
    const [usedByKpi] = await db.select({ id: kpiRules.id }).from(kpiRules)
      .where(sql`${kpiRules.startStageId} = ${id} OR ${kpiRules.endStageId} = ${id}`).limit(1);
    if (usedByKpi) {
      return res.status(400).json({ error: 'الإجراء مرتبط بقواعد KPI ولا يمكن حذفه' });
    }
    await db.delete(stages).where(eq(stages.id, id));
    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete stage' });
  }
});

router.patch('/stages/reorder', authenticate, authorize(['ADMIN']), async (req, res) => {
  const { order }: { order: { id: string; seq: number }[] } = req.body;
  try {
    await db.transaction(async (tx) => {
      for (const item of order) {
        await tx.update(stages).set({ seq: item.seq }).where(eq(stages.id, item.id));
      }
    });
    res.json({ message: 'Reordered' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to reorder' });
  }
});

// --- KPI Templates ---
router.get('/kpi-templates', authenticate, authorize(['ADMIN']), async (req, res) => {
  try {
    const data = await db.select().from(kpiTemplates).orderBy(kpiTemplates.seq);
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch KPI templates' });
  }
});

router.post('/kpi-templates', authenticate, authorize(['ADMIN']), async (req, res) => {
  try {
    const [data] = await db.insert(kpiTemplates).values(req.body).returning();
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create KPI template' });
  }
});

router.put('/kpi-templates/:id', authenticate, authorize(['ADMIN']), async (req, res) => {
  try {
    await db.update(kpiTemplates).set(sanitize(req.body)).where(eq(kpiTemplates.id, req.params.id));
    res.json({ message: 'Updated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update KPI template' });
  }
});

router.delete('/kpi-templates/:id', authenticate, authorize(['ADMIN']), async (req, res) => {
  try {
    await db.delete(kpiRules).where(eq(kpiRules.templateId, req.params.id));
    await db.delete(kpiTemplates).where(eq(kpiTemplates.id, req.params.id));
    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete KPI template' });
  }
});

// --- KPI Rules ---
router.get('/kpi-rules', authenticate, authorize(['ADMIN']), async (req, res) => {
  try {
    const data = await db.select().from(kpiRules);
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch KPI rules' });
  }
});

router.post('/kpi-rules', authenticate, authorize(['ADMIN']), async (req, res) => {
  try {
    const [data] = await db.insert(kpiRules).values(req.body).returning();
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create KPI rule' });
  }
});

router.put('/kpi-rules/:id', authenticate, authorize(['ADMIN']), async (req, res) => {
  try {
    await db.update(kpiRules).set(sanitize(req.body)).where(eq(kpiRules.id, req.params.id));
    res.json({ message: 'Updated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update KPI rule' });
  }
});

router.delete('/kpi-rules/:id', authenticate, authorize(['ADMIN']), async (req, res) => {
  try {
    await db.delete(kpiRules).where(eq(kpiRules.id, req.params.id));
    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete KPI rule' });
  }
});

// ─── ROLE DEFINITIONS ───────────────────────────────────────────────────────

// GET all roles with user count
router.get('/roles', authenticate, authorize(['ADMIN']), async (_req, res) => {
  try {
    const roles = await db.select().from(roleDefinitions).orderBy(asc(roleDefinitions.sortOrder));
    const userCounts = await db.select({
      role: users.role,
      count: sql<number>`count(*)`.as('count')
    }).from(users).groupBy(users.role);
    const countMap: Record<string, number> = {};
    userCounts.forEach(r => { countMap[r.role] = Number(r.count); });
    res.json(roles.map(r => ({ ...r, userCount: countMap[r.roleKey] ?? 0 })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch roles' });
  }
});

// GET single role
router.get('/roles/:key', authenticate, authorize(['ADMIN']), async (req, res) => {
  try {
    const [role] = await db.select().from(roleDefinitions).where(eq(roleDefinitions.roleKey, req.params.key));
    if (!role) return res.status(404).json({ error: 'Not found' });
    res.json(role);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch role' });
  }
});

// POST create role
router.post('/roles', authenticate, authorize(['ADMIN']), async (req, res) => {
  try {
    const { nameAr, nameEn, roleKey, scopeType, canCreateOrder, canDeleteOrder, canEditExecution,
            canViewExcavationPermits, canEditExcavationPermits, canDeleteExcavationPermits,
            canViewExecutiveDashboard, canViewExecKpiCards, canViewFinKpiCards,
            canViewPeriodicReport, canManageTargets,
            canViewContracts, canManageContracts } = req.body;
    if (!nameAr || !roleKey) return res.status(400).json({ error: 'nameAr and roleKey required' });
    const maxOrder = await db.select({ max: sql<number>`COALESCE(MAX(sort_order),0)` }).from(roleDefinitions);
    const [role] = await db.insert(roleDefinitions).values({
      roleKey: roleKey.toUpperCase().replace(/\s+/g, '_'),
      nameAr, nameEn,
      scopeType: scopeType ?? 'OWN_REGION',
      canCreateOrder: canCreateOrder ?? false,
      canDeleteOrder: canDeleteOrder ?? false,
      canEditExecution: canEditExecution ?? true,
      canViewExcavationPermits:   canViewExcavationPermits   ?? true,
      canEditExcavationPermits:   canEditExcavationPermits   ?? false,
      canDeleteExcavationPermits: canDeleteExcavationPermits ?? false,
      canViewExecutiveDashboard:  canViewExecutiveDashboard  ?? false,
      canViewExecKpiCards: canViewExecKpiCards !== false,
      canViewFinKpiCards:  canViewFinKpiCards  !== false,
      canViewPeriodicReport: canViewPeriodicReport ?? false,
      canManageTargets: canManageTargets ?? false,
      canViewContracts: canViewContracts ?? false,
      canManageContracts: canManageContracts ?? false,
      isSystem: false,
      active: true,
      sortOrder: (Number(maxOrder[0]?.max) ?? 0) + 1,
    }).returning();
    res.json(role);
  } catch (err: any) {
    if (err.code === '23505') return res.status(400).json({ error: 'Role key already exists' });
    console.error(err);
    res.status(500).json({ error: 'Failed to create role' });
  }
});

// PUT update role
router.put('/roles/:key', authenticate, authorize(['ADMIN']), async (req, res) => {
  try {
    const { nameAr, nameEn, scopeType, canCreateOrder, canDeleteOrder, canEditExecution, active,
            canViewExcavationPermits, canEditExcavationPermits, canDeleteExcavationPermits,
            canViewExecutiveDashboard, canViewExecKpiCards, canViewFinKpiCards,
            canViewPeriodicReport, canManageTargets,
            canViewContracts, canManageContracts } = req.body;
    await db.update(roleDefinitions).set({
      ...(nameAr !== undefined && { nameAr }),
      ...(nameEn !== undefined && { nameEn }),
      ...(scopeType !== undefined && { scopeType }),
      ...(canCreateOrder !== undefined && { canCreateOrder }),
      ...(canDeleteOrder !== undefined && { canDeleteOrder }),
      ...(canEditExecution !== undefined && { canEditExecution }),
      ...(canViewExcavationPermits   !== undefined && { canViewExcavationPermits }),
      ...(canEditExcavationPermits   !== undefined && { canEditExcavationPermits }),
      ...(canDeleteExcavationPermits !== undefined && { canDeleteExcavationPermits }),
      ...(canViewExecutiveDashboard  !== undefined && { canViewExecutiveDashboard }),
      ...(canViewExecKpiCards !== undefined && { canViewExecKpiCards }),
      ...(canViewFinKpiCards  !== undefined && { canViewFinKpiCards }),
      ...(canViewPeriodicReport !== undefined && { canViewPeriodicReport }),
      ...(canManageTargets !== undefined && { canManageTargets }),
      ...(canViewContracts !== undefined && { canViewContracts }),
      ...(canManageContracts !== undefined && { canManageContracts }),
      ...(active !== undefined && { active }),
    }).where(eq(roleDefinitions.roleKey, req.params.key));
    res.json({ message: 'Updated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update role' });
  }
});

// DELETE role
router.delete('/roles/:key', authenticate, authorize(['ADMIN']), async (req, res) => {
  try {
    const [role] = await db.select().from(roleDefinitions).where(eq(roleDefinitions.roleKey, req.params.key));
    if (!role) return res.status(404).json({ error: 'Not found' });
    if (role.isSystem) return res.status(400).json({ error: 'Cannot delete system role' });
    const [countRow] = await db.select({ count: sql<number>`count(*)` }).from(users).where(eq(users.role, req.params.key));
    if (Number(countRow.count) > 0) return res.status(400).json({ error: 'Role has assigned users' });
    await db.delete(roleDefinitions).where(eq(roleDefinitions.roleKey, req.params.key));
    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete role' });
  }
});

// GET users with this role
router.get('/roles/:key/users', authenticate, authorize(['ADMIN']), async (req, res) => {
  try {
    const roleUsers = await db.select({
      id: users.id, username: users.username, fullName: users.fullName,
      role: users.role, active: users.active,
      regionId: users.regionId, sectorId: users.sectorId,
    }).from(users).where(eq(users.role, req.params.key));
    res.json(roleUsers);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// PUT assign user to role
router.put('/roles/:key/users/:userId', authenticate, authorize(['ADMIN']), async (req, res) => {
  try {
    await db.update(users).set({ role: req.params.key }).where(eq(users.id, req.params.userId));
    res.json({ message: 'User assigned to role' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to assign user' });
  }
});

// DELETE remove user from role (reset to VIEWER)
router.delete('/roles/:key/users/:userId', authenticate, authorize(['ADMIN']), async (req, res) => {
  try {
    await db.update(users).set({ role: 'VIEWER' }).where(and(eq(users.id, req.params.userId), eq(users.role, req.params.key)));
    res.json({ message: 'User removed from role' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove user' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PERIODIC KPI — Options (dateColumns + stages + projectTypes)
// ─────────────────────────────────────────────────────────────────────────────

router.get('/periodic-kpi/options', authenticate, authorize(['ADMIN']), async (_req, res) => {
  try {
    const [dateColsRaw, stagesRaw, projectTypesRaw] = await Promise.all([
      db.execute(sql`
        SELECT column_key as "columnKey", label_ar as "labelAr", data_type as "dataType"
        FROM column_catalog
        WHERE is_enabled = true AND data_type IN ('date', 'timestamp', 'timestamp with time zone')
        ORDER BY sort_order
      `),
      db.select().from(stages).orderBy(asc(stages.seq)),
      db.execute(sql`
        SELECT value, label_ar as "labelAr", sort_order as "sortOrder"
        FROM column_options
        WHERE column_key = 'project_type' AND active = true
        ORDER BY sort_order
      `),
    ]);
    const toRows = (r: any) => r.rows ?? r;
    res.json({
      dateColumns:  toRows(dateColsRaw),
      stages:       stagesRaw,
      projectTypes: toRows(projectTypesRaw),
    });
  } catch (err) {
    console.error('[PERIODIC OPTIONS ERROR]', err);
    res.status(500).json({ error: 'Failed to fetch options' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PERIODIC KPI — Execution Rules (dynamic — driven by column_options)
// ─────────────────────────────────────────────────────────────────────────────

router.get('/periodic-kpi/execution-rules', authenticate, authorize(['ADMIN']), async (_req, res) => {
  try {
    // Fetch all project types from column_options (source of truth)
    const ptRaw = await db.execute(sql`
      SELECT value, label_ar as "labelAr", sort_order as "sortOrder"
      FROM column_options
      WHERE column_key = 'project_type' AND active = true
      ORDER BY sort_order
    `);
    const projectTypes: { value: string; labelAr: string; sortOrder: number }[] = (ptRaw as any).rows ?? ptRaw;

    // Fetch all existing rules
    const rules = await db.select().from(periodicKpiExecutionRules);
    const ruleMap = new Map(rules.map(r => [r.projectTypeValue, r]));

    // Merge: every project type gets an entry
    const merged = projectTypes.map(pt => {
      const existing = ruleMap.get(pt.value);
      if (existing) {
        return { ...(existing as any), projectTypeLabelAr: pt.labelAr, __configured: true };
      }
      return {
        id: null,
        projectTypeValue: pt.value,
        projectTypeLabelAr: pt.labelAr,
        isEnabled: false,
        slaDays: 30,
        warningDays: 5,
        startMode: 'COLUMN_DATE',
        startColumnKey: null,
        startStageId: null,
        endMode: 'COLUMN_DATE',
        endColumnKey: null,
        endStageId: null,
        updatedAt: null,
        __configured: false,
      };
    });

    res.json(merged);
  } catch (err) {
    console.error('[PERIODIC EXEC RULES ERROR]', err);
    res.status(500).json({ error: 'Failed to fetch execution rules' });
  }
});

// POST — initialize a new rule for an unconfigured project type
router.post('/periodic-kpi/execution-rules', authenticate, authorize(['ADMIN']), async (req, res) => {
  try {
    const { projectTypeValue, projectTypeLabelAr, slaDays = 30, warningDays = 5 } = req.body;
    if (!projectTypeValue) return res.status(400).json({ error: 'projectTypeValue required' });
    const [created] = await db.insert(periodicKpiExecutionRules).values({
      projectTypeValue,
      projectTypeLabelAr: projectTypeLabelAr || projectTypeValue,
      isEnabled: false,
      slaDays: Number(slaDays),
      warningDays: Number(warningDays),
      updatedAt: new Date(),
    }).returning();
    res.json(created);
  } catch (err: any) {
    if (err?.code === '23505' || String(err?.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'Rule already exists for this project type' });
    }
    res.status(500).json({ error: 'Failed to create execution rule' });
  }
});

router.put('/periodic-kpi/execution-rules/:id', authenticate, authorize(['ADMIN']), async (req, res) => {
  try {
    const { id } = req.params;
    const {
      isEnabled, slaDays, warningDays,
      startMode, startColumnKey, startStageId,
      endMode, endColumnKey, endStageId,
    } = req.body;
    await db.update(periodicKpiExecutionRules).set({
      isEnabled, slaDays: Number(slaDays), warningDays: Number(warningDays),
      startMode, startColumnKey: startColumnKey || null, startStageId: startStageId || null,
      endMode, endColumnKey: endColumnKey || null, endStageId: endStageId || null,
      updatedAt: new Date(),
    }).where(eq(periodicKpiExecutionRules.id, id));
    const [updated] = await db.select().from(periodicKpiExecutionRules).where(eq(periodicKpiExecutionRules.id, id));
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update execution rule' });
  }
});

// ─── Periodic KPI — Financial Rule (single row) ───────────────────────────────

router.get('/periodic-kpi/financial-rule', authenticate, authorize(['ADMIN']), async (_req, res) => {
  try {
    let rows = await db.select().from(periodicKpiFinancialRule);
    if (rows.length === 0) {
      await db.insert(periodicKpiFinancialRule).values({ updatedAt: new Date() });
      rows = await db.select().from(periodicKpiFinancialRule);
    }
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch financial rule' });
  }
});

router.put('/periodic-kpi/financial-rule/:id', authenticate, authorize(['ADMIN']), async (req, res) => {
  try {
    const { id } = req.params;
    const {
      isEnabled, slaDays, warningDays,
      startMode, startColumnKey, startStageId,
      endMode, endColumnKey, endStageId,
    } = req.body;
    await db.update(periodicKpiFinancialRule).set({
      isEnabled, slaDays: Number(slaDays), warningDays: Number(warningDays),
      startMode, startColumnKey: startColumnKey || null, startStageId: startStageId || null,
      endMode, endColumnKey: endColumnKey || null, endStageId: endStageId || null,
      updatedAt: new Date(),
    }).where(eq(periodicKpiFinancialRule.id, id));
    const [updated] = await db.select().from(periodicKpiFinancialRule).where(eq(periodicKpiFinancialRule.id, id));
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update financial rule' });
  }
});

// ─── Periodic KPI — Report Settings (single row) ─────────────────────────────

router.get('/periodic-kpi/report-settings', authenticate, authorize(['ADMIN']), async (_req, res) => {
  try {
    let rows = await db.select().from(periodicKpiReportSettings);
    if (rows.length === 0) {
      await db.insert(periodicKpiReportSettings).values({ updatedAt: new Date() });
      rows = await db.select().from(periodicKpiReportSettings);
    }
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch report settings' });
  }
});

router.put('/periodic-kpi/report-settings/:id', authenticate, authorize(['ADMIN']), async (req, res) => {
  try {
    const { id } = req.params;
    const {
      defaultDateRangeMode, avgModeDefault,
      includeCancelled, includeCompleted, enableFocusMode,
      regionCardsPerRow, projectCardsPerRow,
    } = req.body;
    await db.update(periodicKpiReportSettings).set({
      defaultDateRangeMode, avgModeDefault,
      includeCancelled, includeCompleted, enableFocusMode,
      regionCardsPerRow: Number(regionCardsPerRow),
      projectCardsPerRow: Number(projectCardsPerRow),
      updatedAt: new Date(),
    }).where(eq(periodicKpiReportSettings.id, id));
    const [updated] = await db.select().from(periodicKpiReportSettings).where(eq(periodicKpiReportSettings.id, id));
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update report settings' });
  }
});

// ── Logo Upload ──────────────────────────────────────────────────────────────
const LOGO_DIR = process.env.UPLOAD_DIR
  ? path.join(process.env.UPLOAD_DIR, 'logos')
  : path.join(process.cwd(), 'uploads', 'logos');

const logoStorage = multer.diskStorage({
  destination: async (_req, _file, cb) => {
    try { await mkdir(LOGO_DIR, { recursive: true }); } catch {}
    cb(null, LOGO_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${randomUUID()}${ext}`);
  },
});

const logoUpload = multer({
  storage: logoStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
    if (!['png','jpg','jpeg','svg','webp'].includes(ext)) {
      return cb(new Error('نوع الملف غير مسموح. يُقبل: PNG, JPG, SVG, WEBP'));
    }
    cb(null, true);
  },
});

router.post('/upload-logo', authenticate, authorize(['ADMIN']), logoUpload.single('logo'), async (req: any, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'لم يتم إرسال أي صورة' });
    const side = req.query.side === 'left' ? 'left' : req.query.side === 'sidebar' ? 'sidebar' : 'right';
    // sidebar uses its own key to avoid collisions with report logo keys
    const settingKey = side === 'sidebar' ? 'sidebar_logo_url' : `logo_${side}_url`;
    const publicUrl = `/public/logos/${req.file.filename}`;
    await db.execute(sql`
      INSERT INTO system_settings (key, value, updated_at) VALUES (${settingKey}, ${publicUrl}, NOW())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    `);
    res.json({ url: publicUrl, key: settingKey });
  } catch (err) {
    console.error('[LOGO UPLOAD ERROR]', err);
    res.status(500).json({ error: 'فشل رفع الشعار' });
  }
});

router.use('/upload-logo', (err: any, _req: any, res: any, _next: any) => {
  res.status(400).json({ error: err?.message || 'خطأ في رفع الشعار' });
});

// ── Report Header (accessible to all authenticated users) ────────────────────
router.get('/report-header', authenticate, async (_req, res) => {
  try {
    const rows = await db.execute(sql`
      SELECT key, value FROM system_settings
      WHERE key IN (
        'logo_right_url','logo_left_url','company_name_ar','company_name_en',
        'logo_right_width_excel','logo_left_width_excel',
        'logo_right_width_pdf','logo_left_width_pdf',
        'sidebar_logo_url'
      )
    `);
    const obj: Record<string, string> = {};
    for (const r of (rows as any).rows ?? rows) obj[r.key] = r.value;
    res.json({
      logoRightUrl:        obj['logo_right_url']          ?? null,
      logoLeftUrl:         obj['logo_left_url']           ?? null,
      companyNameAr:       obj['company_name_ar']         ?? null,
      companyNameEn:       obj['company_name_en']         ?? null,
      logoRightWidthExcel: obj['logo_right_width_excel']  ? Number(obj['logo_right_width_excel']) : 150,
      logoLeftWidthExcel:  obj['logo_left_width_excel']   ? Number(obj['logo_left_width_excel'])  : 150,
      logoRightWidthPdf:   obj['logo_right_width_pdf']    ? Number(obj['logo_right_width_pdf'])   : 150,
      logoLeftWidthPdf:    obj['logo_left_width_pdf']     ? Number(obj['logo_left_width_pdf'])    : 150,
      sidebarLogoUrl:      obj['sidebar_logo_url']        ?? null,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch report header' });
  }
});

// ── System Settings ──────────────────────────────────────────────────────────
router.get('/system-settings', authenticate, authorize(['ADMIN']), async (_req, res) => {
  try {
    const rows = await db.execute(sql`SELECT key, value FROM system_settings`);
    const obj: Record<string, string> = {};
    for (const r of (rows as any).rows ?? rows) obj[r.key] = r.value;
    res.json(obj);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch system settings' });
  }
});

router.put('/system-settings/:key', authenticate, authorize(['ADMIN']), async (req, res) => {
  const { key } = req.params;
  const { value } = req.body;
  try {
    await db.execute(sql`
      INSERT INTO system_settings (key, value, updated_at) VALUES (${key}, ${value}, NOW())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    `);
    res.json({ key, value });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update system setting' });
  }
});

export default router;
