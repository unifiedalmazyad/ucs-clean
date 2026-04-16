import { db } from '../db';
import { roleColumnPermissions, userColumnOverrides, columnCatalog } from '../db/schema';
import { eq, and } from 'drizzle-orm';

export interface ColumnPermission {
  columnKey: string;
  physicalKey: string | null;
  canRead: boolean;
  canWrite: boolean;
}

/** Convert snake_case to camelCase */
function toCamel(s: string): string {
  return s.replace(/_(\d+)/g, (_, n) => n).replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

export async function getEffectivePermissions(userId: string, role: string, tableName: string): Promise<ColumnPermission[]> {
  const columns = await db.select().from(columnCatalog).where(eq(columnCatalog.tableName, tableName));

  const rolePerms = await db.select().from(roleColumnPermissions).where(
    and(
      eq(roleColumnPermissions.role, role),
      eq(roleColumnPermissions.tableName, tableName)
    )
  );

  const userOverrides = await db.select().from(userColumnOverrides).where(
    and(
      eq(userColumnOverrides.userId, userId),
      eq(userColumnOverrides.tableName, tableName)
    )
  );

  return columns.map(col => {
    const rolePerm = rolePerms.find(p => p.columnKey === col.columnKey);
    const userOverride = userOverrides.find(o => o.columnKey === col.columnKey);

    let canRead = rolePerm?.canRead ?? false;
    let canWrite = rolePerm?.canWrite ?? false;

    if (role === 'ADMIN') {
      canRead = true;
      canWrite = true;
    }

    if (userOverride) {
      if (userOverride.canRead !== null) canRead = userOverride.canRead;
      if (userOverride.canWrite !== null) canWrite = userOverride.canWrite;
    }

    return { columnKey: col.columnKey, physicalKey: (col as any).physicalKey ?? null, canRead, canWrite };
  });
}

// Metadata fields always included regardless of permissions
const ALWAYS_ALLOW_SNAKE = new Set([
  'id', 'created_at', 'updated_at', 'status', 'stage', 'stage_id',
  'created_by', 'updated_by', 'region_id', 'sector_id',
  'kpiSummary', 'orderNumber', 'order_number', 'workType', 'work_type',
  'district', 'client',
]);
const ALWAYS_ALLOW_CAMEL = new Set([...ALWAYS_ALLOW_SNAKE].map(toCamel));

// Fields always allowed through filterInput (system/workflow fields not in catalog)
const ALWAYS_WRITABLE_CAMEL = new Set(['stageId', 'procedure']);

// camelCase names of ALL physical columns Drizzle knows about in work_orders.
// Any catalog column whose physKey (camelCased) is NOT in this set is a
// dynamically-added physical column and must be written via raw SQL.
export const DRIZZLE_WO_COLS = new Set([
  'id', 'workType', 'orderNumber', 'client', 'assignmentDate', 'district',
  'projectType', 'station', 'length', 'consultant', 'surveyDate',
  'coordinationDate', 'coordinationCertNumber', 'notes', 'drillingTeam',
  'drillingDate', 'shutdownDate', 'procedure', 'holdReason',
  'materialSheetDate', 'checkSheetsDate', 'meteringSheetDate',
  'gisCompletionDate', 'proc155CloseDate', 'completionCertConfirm',
  'estimatedValue', 'invoiceNumber', 'actualInvoiceValue', 'invoiceType',
  'invoice1', 'invoice2', 'collectedAmount', 'remainingAmount',
  'execDelayJustified', 'execDelayReason', 'finDelayJustified', 'finDelayReason',
  'workStatusClassification',
  'customFields', 'regionId', 'sectorId', 'status', 'stage', 'stageId',
  'createdBy', 'updatedBy', 'createdAt', 'updatedAt',
]);

export async function filterOutput(data: any[], userId: string, role: string, tableName: string) {
  const perms = await getEffectivePermissions(userId, role, tableName);
  const readablePerms = perms.filter(p => p.canRead);
  const readableColumns = readablePerms.map(p => p.columnKey);

  // Build lookup for snake_case and camelCase readable columns
  // Also include physicalKey variants so renamed columns still pass through
  const allowedSnake = new Set([...readableColumns, ...ALWAYS_ALLOW_SNAKE]);
  const allowedCamel = new Set([...readableColumns.map(toCamel), ...ALWAYS_ALLOW_CAMEL]);

  // Add physical keys for readable columns that have been renamed
  for (const perm of readablePerms) {
    if (perm.physicalKey && perm.physicalKey !== perm.columnKey) {
      allowedSnake.add(perm.physicalKey);
      allowedCamel.add(toCamel(perm.physicalKey));
    }
  }

  const isAllowed = (key: string) => allowedSnake.has(key) || allowedCamel.has(key);

  return data.map(item => {
    const merged = { ...item };

    // Merge customFields into top level
    const cf = merged.customFields ?? merged.custom_fields;
    if (cf) {
      const parsed = typeof cf === 'string' ? JSON.parse(cf) : cf;
      if (parsed && typeof parsed === 'object') Object.assign(merged, parsed);
    }
    delete merged.customFields;
    delete merged.custom_fields;

    const filtered: any = {};
    Object.keys(merged).forEach(key => {
      if (isAllowed(key)) filtered[key] = merged[key];
    });
    return filtered;
  });
}

export async function filterInput(input: any, userId: string, role: string, tableName: string) {
  const perms = await getEffectivePermissions(userId, role, tableName);
  const writablePerms = perms.filter(p => p.canWrite);
  const writableColumns = writablePerms.map(p => p.columnKey);
  const catalog = await db.select().from(columnCatalog).where(eq(columnCatalog.tableName, tableName));

  // Accept both snake_case and camelCase input keys
  const writableSnake = new Set(writableColumns);
  const writableCamel = new Set(writableColumns.map(toCamel));

  // Also allow physical keys as input (for backward compat & edit form PUTs)
  const physicalToLogical = new Map<string, string>(); // physicalKey → columnKey
  for (const perm of writablePerms) {
    if (perm.physicalKey && perm.physicalKey !== perm.columnKey) {
      physicalToLogical.set(perm.physicalKey, perm.columnKey);
      physicalToLogical.set(toCamel(perm.physicalKey), perm.columnKey);
    }
  }

  const coreFiltered: any = {};
  // dynamicFiltered: catalog columns that are physical but not in Drizzle schema
  // (added via ALTER TABLE). Keys are snake_case for raw SQL. Values are also
  // kept in customFiltered so that the Drizzle customFields JSONB stays in sync
  // for backward-compatible reads via filterOutput.
  const dynamicFiltered: any = {};

  Object.keys(input).forEach(inputKey => {
    // Always allow system/workflow fields not in catalog
    if (ALWAYS_WRITABLE_CAMEL.has(inputKey)) {
      coreFiltered[inputKey] = input[inputKey];
      return;
    }

    // Resolve to the snake_case column key
    let snakeKey: string | null | undefined = writableSnake.has(inputKey)
      ? inputKey
      : writableCamel.has(inputKey)
        ? writableColumns.find(c => toCamel(c) === inputKey)
        : null;

    // If not found by columnKey, try physicalKey alias lookup
    if (!snakeKey && physicalToLogical.has(inputKey)) {
      snakeKey = physicalToLogical.get(inputKey)!;
    }

    if (snakeKey) {
      const colDef = catalog.find(c => c.columnKey === snakeKey);
      // Use physicalKey (actual DB column) — handles renamed columns
      const physKey = (colDef as any)?.physicalKey || snakeKey;
      const camelPhys = toCamel(physKey);

      if (DRIZZLE_WO_COLS.has(camelPhys)) {
        // Known Drizzle schema column → write via ORM
        coreFiltered[camelPhys] = input[inputKey];
      } else {
        // Dynamically-added physical column → write via raw SQL
        // Use snake_case key (physKey) for the raw SQL UPDATE
        dynamicFiltered[physKey] = input[inputKey];
      }
    }
  });

  return { coreFiltered, dynamicFiltered };
}
