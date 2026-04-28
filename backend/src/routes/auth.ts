import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { db } from '../db';
import { users, auditLogs, roleDefinitions } from '../db/schema';
import { eq } from 'drizzle-orm';
import { authenticate, AuthRequest, JWT_SECRET } from '../middleware/auth';

const router = express.Router();

// ── In-memory login rate limiter (brute-force protection) ───────────────────
// Tracks failed attempts per IP. After MAX_FAILURES failures within the window,
// the IP is blocked for BLOCK_DURATION_MS. Resets on successful login.
const MAX_FAILURES        = 10;
const WINDOW_MS           = 15 * 60 * 1000; // 15 minutes
const BLOCK_DURATION_MS   = 15 * 60 * 1000; // 15 minutes
interface Attempt { count: number; firstAt: number; blockedUntil?: number }
const loginAttempts = new Map<string, Attempt>();

function getClientIp(req: express.Request): string {
  return (
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
    req.socket.remoteAddress ||
    'unknown'
  );
}

function checkRateLimit(req: express.Request, res: express.Response): boolean {
  const ip  = getClientIp(req);
  const now = Date.now();
  const rec = loginAttempts.get(ip);

  if (rec?.blockedUntil && now < rec.blockedUntil) {
    const waitSec = Math.ceil((rec.blockedUntil - now) / 1000);
    res.status(429).json({ error: `تم تجاوز الحد المسموح من محاولات تسجيل الدخول. حاول بعد ${waitSec} ثانية.` });
    return false;
  }

  // Reset window if expired
  if (rec && now - rec.firstAt > WINDOW_MS) {
    loginAttempts.delete(ip);
  }
  return true;
}

function recordFailure(req: express.Request) {
  const ip  = getClientIp(req);
  const now = Date.now();
  const rec = loginAttempts.get(ip) ?? { count: 0, firstAt: now };
  rec.count += 1;
  if (rec.count >= MAX_FAILURES) rec.blockedUntil = now + BLOCK_DURATION_MS;
  loginAttempts.set(ip, rec);
}

function clearFailures(req: express.Request) {
  loginAttempts.delete(getClientIp(req));
}

// Periodically prune stale entries to prevent unbounded memory growth
setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of loginAttempts) {
    if (now - rec.firstAt > WINDOW_MS * 2) loginAttempts.delete(ip);
  }
}, 30 * 60 * 1000);

router.post('/login', async (req, res) => {
  if (!checkRateLimit(req, res)) return;

  const { username, password } = req.body;

  try {
    const userWithRole = await db.query.users.findFirst({
      where: eq(users.username, username),
    });

    if (!userWithRole || !userWithRole.active) {
      recordFailure(req);
      return res.status(401).json({ error: 'Invalid credentials or inactive account' });
    }

    const isValid = await bcrypt.compare(password, userWithRole.passwordHash);
    if (!isValid) {
      recordFailure(req);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    clearFailures(req);

    // Fetch role definition to get permissions
    const { roleDefinitions } = await import('../db/schema');
    const roleDef = await db.query.roleDefinitions.findFirst({
      where: eq(roleDefinitions.roleKey, userWithRole.role),
    });

    const isAdminToken = userWithRole.role === 'ADMIN';
    const token = jwt.sign(
      {
        id: userWithRole.id,
        username: userWithRole.username,
        role: userWithRole.role,
        canManageTargets: isAdminToken ? true : (roleDef?.canManageTargets ?? false),
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    await db.insert(auditLogs).values({
      actorUserId: userWithRole.id,
      entityType: 'USER',
      entityId: userWithRole.id,
      action: 'LOGIN',
    });

    const isAdmin = userWithRole.role === 'ADMIN';
    res.json({
      token,
      user: {
        id: userWithRole.id,
        username: userWithRole.username,
        fullName: (userWithRole as any).fullName ?? (userWithRole as any).full_name ?? null,
        role: userWithRole.role,
        sectorId: (userWithRole as any).sectorId ?? (userWithRole as any).sector_id ?? null,
        regionId: (userWithRole as any).regionId ?? (userWithRole as any).region_id ?? null,
        scopeType: roleDef?.scopeType ?? 'ALL',
        canCreateOrder: isAdmin ? true : (roleDef?.canCreateOrder ?? false),
        canDeleteOrder: isAdmin ? true : (roleDef?.canDeleteOrder ?? false),
        canEditExecution: isAdmin ? true : (roleDef?.canEditExecution !== false),
        canViewExecutiveDashboard: roleDef?.canViewExecutiveDashboard || false,
        canViewExecKpiCards: roleDef?.canViewExecKpiCards !== false,
        canViewFinKpiCards:  roleDef?.canViewFinKpiCards  !== false,
        canManageTargets:    isAdmin ? true : (roleDef?.canManageTargets    ?? false),
        canViewContracts:    isAdmin ? true : (roleDef?.canViewContracts    ?? false),
        canManageContracts:  isAdmin ? true : (roleDef?.canManageContracts  ?? false),
      },
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/auth/me — returns fresh user data with latest role permissions
// Used by the frontend to refresh localStorage after role changes
router.get('/me', authenticate, async (req: AuthRequest, res) => {
  try {
    const user = req.user!;
    const userRecord = await db.query.users.findFirst({ where: eq(users.id, user.id) });
    if (!userRecord || !userRecord.active) return res.status(401).json({ error: 'User not found' });
    const roleDef = await db.query.roleDefinitions.findFirst({
      where: eq(roleDefinitions.roleKey, userRecord.role),
    });
    const isAdminMe = userRecord.role === 'ADMIN';
    res.json({
      id: userRecord.id,
      username: userRecord.username,
      fullName: (userRecord as any).fullName ?? (userRecord as any).full_name ?? null,
      role: userRecord.role,
      sectorId: (userRecord as any).sectorId ?? (userRecord as any).sector_id ?? null,
      regionId: (userRecord as any).regionId ?? (userRecord as any).region_id ?? null,
      scopeType: roleDef?.scopeType ?? 'ALL',
      canCreateOrder: isAdminMe ? true : (roleDef?.canCreateOrder ?? false),
      canDeleteOrder: isAdminMe ? true : (roleDef?.canDeleteOrder ?? false),
      canEditExecution: isAdminMe ? true : (roleDef?.canEditExecution !== false),
      canViewExecutiveDashboard: roleDef?.canViewExecutiveDashboard || false,
      canViewExecKpiCards: roleDef?.canViewExecKpiCards !== false,
      canViewFinKpiCards:  roleDef?.canViewFinKpiCards  !== false,
      canManageTargets:    isAdminMe ? true : (roleDef?.canManageTargets   ?? false),
      canViewContracts:    isAdminMe ? true : (roleDef?.canViewContracts   ?? false),
      canManageContracts:  isAdminMe ? true : (roleDef?.canManageContracts ?? false),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch user data' });
  }
});

export default router;
