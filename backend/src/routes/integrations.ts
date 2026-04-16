import express from 'express';
import { db } from '../db';
import { integrations } from '../db/schema';
import { authenticate, AuthRequest } from '../middleware/auth';
import { eq } from 'drizzle-orm';
import { connectors } from '../connectors';

const router = express.Router();

const SECRET_FIELDS = ['apiKey', 'password', 'clientSecret', 'accessToken', 'refreshToken', 'webhookSecret'];
const MASK = '••••••';

function maskSecrets(row: any) {
  const masked = { ...row };
  for (const field of SECRET_FIELDS) {
    if (masked[field]) masked[field] = MASK;
  }
  return masked;
}

function requireAdmin(req: AuthRequest, res: any, next: any) {
  if (!req.user || req.user.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Admin only' });
  }
  next();
}

// GET /api/integrations
router.get('/', authenticate, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const rows = await db.select().from(integrations);
    res.json(rows.map(maskSecrets));
  } catch (err) {
    console.error('[INTEGRATIONS GET ALL]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/integrations/:id
router.get('/:id', authenticate, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const [row] = await db.select().from(integrations).where(eq(integrations.id, req.params.id));
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(maskSecrets(row));
  } catch (err) {
    console.error('[INTEGRATIONS GET ONE]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/integrations/:id
router.put('/:id', authenticate, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const [existing] = await db.select().from(integrations).where(eq(integrations.id, req.params.id));
    if (!existing) return res.status(404).json({ error: 'Not found' });

    const body = req.body;
    const updates: Record<string, any> = {};

    // Non-secret fields — always update if provided
    const plainFields = ['name', 'enabled', 'baseUrl', 'authType', 'syncMode', 'username', 'clientId'];
    for (const f of plainFields) {
      if (body[f] !== undefined) updates[f] = body[f];
    }

    // Secret fields — only update if not masked placeholder
    for (const f of SECRET_FIELDS) {
      if (body[f] !== undefined && body[f] !== MASK) {
        updates[f] = body[f] || null;
      }
    }

    updates.updatedAt = new Date();

    await db.update(integrations).set(updates).where(eq(integrations.id, req.params.id));
    const [updated] = await db.select().from(integrations).where(eq(integrations.id, req.params.id));
    res.json(maskSecrets(updated));
  } catch (err) {
    console.error('[INTEGRATIONS PUT]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/integrations/:id/test
router.post('/:id/test', authenticate, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const [row] = await db.select().from(integrations).where(eq(integrations.id, req.params.id));
    if (!row) return res.status(404).json({ error: 'Not found' });

    const connector = connectors[(row as any).code];
    if (!connector) {
      return res.status(400).json({ success: false, message: `No connector found for code: ${(row as any).code}` });
    }

    const config = {
      baseUrl: (row as any).baseUrl,
      apiKey: (row as any).apiKey,
      username: (row as any).username,
      password: (row as any).password,
      clientId: (row as any).clientId,
      clientSecret: (row as any).clientSecret,
      accessToken: (row as any).accessToken,
      refreshToken: (row as any).refreshToken,
      webhookSecret: (row as any).webhookSecret,
    };

    const result = await connector.test(config);

    await db.update(integrations).set({
      lastStatus: result.success ? 'success' : 'failed',
      lastError: result.success ? null : result.message,
      lastSyncAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(integrations.id, req.params.id));

    res.json(result);
  } catch (err) {
    console.error('[INTEGRATIONS TEST]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/integrations/:id/sync
router.post('/:id/sync', authenticate, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const [row] = await db.select().from(integrations).where(eq(integrations.id, req.params.id));
    if (!row) return res.status(404).json({ error: 'Not found' });

    const connector = connectors[(row as any).code];
    if (!connector) {
      return res.status(400).json({ success: false, message: `No connector for: ${(row as any).code}` });
    }

    const config = {
      baseUrl: (row as any).baseUrl,
      apiKey: (row as any).apiKey,
      username: (row as any).username,
      password: (row as any).password,
      clientId: (row as any).clientId,
      clientSecret: (row as any).clientSecret,
      accessToken: (row as any).accessToken,
    };

    const result = connector.pull
      ? await connector.pull(config)
      : { success: false, message: 'Pull not implemented for this connector' };

    await db.update(integrations).set({
      lastStatus: result.success ? 'success' : 'failed',
      lastError: result.success ? null : result.message,
      lastSyncAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(integrations.id, req.params.id));

    res.json(result);
  } catch (err) {
    console.error('[INTEGRATIONS SYNC]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
