import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import bcrypt from 'bcryptjs';
import { db } from './db';
import { users, workOrders, columnCatalog, roleColumnPermissions, stages, kpiTemplates, kpiRules, regions, sectors, columnGroups, workOrderAttachments } from './db/schema';
import authRoutes from './routes/auth';
import workOrderRoutes from './routes/workOrders';
import adminRoutes from './routes/admin';
import kpiRoutes from './routes/kpis';
import reportRoutes from './routes/reports';
import importExportRoutes from './routes/importExport';
import periodicReportRoutes from './routes/periodicReport';
import executiveDashboardRoutes from './routes/executiveDashboard';
import integrationsRoutes from './routes/integrations';
import exportCenterRoutes from './routes/exportCenter';
import auditLogRoutes from './routes/auditLog';
import contractRoutes from './routes/contracts';
import { authenticate } from './middleware/auth';
import { eq, or, sql } from 'drizzle-orm';
import multer from 'multer';
import { randomUUID } from 'crypto';
import { existsSync } from 'fs';
import { unlink, mkdir } from 'fs/promises';

import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';

// ESM-compatible __dirname (package.json "type": "module")
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Startup security validation ───────────────────────────────────────────────
const _IS_PROD = process.env.NODE_ENV === 'production';

const WEAK_PASSWORDS = new Set([
  'admin123','admin','password','123456','1234567890',
  'pass','secret','changeme','change_me','test','test123',
  'welcome','welcome1','qwerty','abc123',
]);

// ADMIN_DEFAULT_PASSWORD: minimum 12 chars, no common weak values
const _adminPwd = process.env.ADMIN_DEFAULT_PASSWORD;
if (_adminPwd !== undefined) {
  if (_adminPwd.length < 12) {
    const msg = `[SECURITY] ADMIN_DEFAULT_PASSWORD is too short (${_adminPwd.length} chars). Use at least 12 characters.`;
    if (_IS_PROD) { console.error('[FATAL] ' + msg.replace('[SECURITY] ','')); process.exit(1); }
    else console.warn(msg);
  } else if (WEAK_PASSWORDS.has(_adminPwd.toLowerCase())) {
    const msg = `[SECURITY] ADMIN_DEFAULT_PASSWORD is a well-known weak value. Set a strong password.`;
    if (_IS_PROD) { console.error('[FATAL] ' + msg.replace('[SECURITY] ','')); process.exit(1); }
    else console.warn(msg);
  }
} else if (_IS_PROD) {
  console.warn('[SECURITY] ADMIN_DEFAULT_PASSWORD not set — admin user will keep its existing password.');
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(helmet({
    contentSecurityPolicy: false,
  }));

  // Trust the first hop (Nginx reverse proxy) — required so that:
  //   • req.ip returns the real client IP from X-Forwarded-For
  //   • Login rate limiter blocks by real IP, not the proxy IP
  //   • Secure cookies / HTTPS detection works correctly
  app.set('trust proxy', 1);

  // CORS: open only in development. In production the frontend is served by the same Express
  // server, so same-origin applies. ALLOWED_ORIGINS can override when behind a proxy.
  if (process.env.NODE_ENV !== 'production') {
    app.use(cors());
  } else if (process.env.ALLOWED_ORIGINS) {
    const origins = process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim());
    app.use(cors({ origin: origins, credentials: true }));
  }

  app.use(express.json({ limit: '10mb' }));

  // Routes
  app.use('/api/auth', authRoutes);
  app.use('/api/work-orders', workOrderRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/kpis', kpiRoutes);
  app.use('/api/reports', reportRoutes);
  app.use('/api/import', importExportRoutes);
  app.use('/api/reports/periodic-kpis', periodicReportRoutes);
  app.use('/api/dashboard/executive', executiveDashboardRoutes);
  app.use('/api/integrations', integrationsRoutes);
  app.use('/api/export-center', exportCenterRoutes);
  app.use('/api/audit-logs', auditLogRoutes);
  app.use('/api/contracts',  contractRoutes);

  // ── Local File Storage ───────────────────────────────────────────────────────
  // Files are stored at UPLOAD_DIR (default: <cwd>/uploads)
  // In Docker production this directory is mounted as a persistent volume.
  const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');
  await mkdir(UPLOAD_DIR, { recursive: true });

  // ── Public logos (no auth required — used in reports) ────────────────────
  const LOGOS_DIR = path.join(UPLOAD_DIR, 'logos');
  await mkdir(LOGOS_DIR, { recursive: true });
  app.use('/public/logos', express.static(LOGOS_DIR));

  const MAX_ATTACHMENT_MB    = Number(process.env.MAX_ATTACHMENT_SIZE_MB) || 100;
  const MAX_ATTACHMENT_BYTES = MAX_ATTACHMENT_MB * 1024 * 1024;

  const ALLOWED_EXTENSIONS = new Set([
    'pdf','doc','docx','xls','xlsx','png','jpg','jpeg','zip',
  ]);

  const multerStorage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${randomUUID()}${ext}`);
    },
  });

  const upload = multer({
    storage: multerStorage,
    limits: { fileSize: MAX_ATTACHMENT_BYTES },
    fileFilter: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
      if (!ALLOWED_EXTENSIONS.has(ext)) {
        return cb(new Error(`نوع الملف (.${ext}) غير مسموح. الأنواع المقبولة: PDF, Word, Excel, صور, ZIP`));
      }
      cb(null, true);
    },
  });

  // POST /api/uploads/file — multipart upload, stores file locally, returns objectPath
  app.post('/api/uploads/file', authenticate, upload.single('file'), async (req: any, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'لم يتم إرسال أي ملف' });
      const objectPath = `/objects/${req.file.filename}`;
      res.json({ objectPath });
    } catch (err) {
      console.error('[UPLOAD FILE ERROR]', (err as Error).message);
      res.status(500).json({ error: 'فشل في رفع الملف، يرجى المحاولة مجدداً' });
    }
  });

  // Multer error handler (file size, type rejections)
  app.use('/api/uploads/file', (err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err?.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: `حجم الملف يتجاوز الحد المسموح (${MAX_ATTACHMENT_MB} MB)`, code: 'FILE_TOO_LARGE' });
    }
    res.status(400).json({ error: err?.message || 'خطأ في رفع الملف' });
  });

  // GET /objects/:filename — serve local file with authentication + ownership scope check
  app.get('/objects/:filename', authenticate as any, async (req: any, res) => {
    try {
      // Prevent path traversal: only allow safe filenames (uuid + extension)
      const filename = path.basename(req.params.filename);
      if (!/^[\w\-]+\.[a-z0-9]+$/i.test(filename)) {
        return res.status(400).json({ error: 'اسم ملف غير صالح' });
      }

      const objectPath = `/objects/${filename}`;

      // Ownership / scope check — same logic as before
      const [att] = await db
        .select({ workOrderId: workOrderAttachments.workOrderId, regionId: workOrders.regionId, sectorId: workOrders.sectorId })
        .from(workOrderAttachments)
        .leftJoin(workOrders, eq(workOrderAttachments.workOrderId, workOrders.id))
        .where(eq(workOrderAttachments.url, objectPath));

      if (att) {
        const jwtUser = req.user;
        if (jwtUser.role !== 'ADMIN') {
          const [userRecord] = await db
            .select({ regionId: users.regionId, sectorId: users.sectorId })
            .from(users)
            .where(eq(users.id, jwtUser.id));

          // Scoped users may only access files within their region/sector
          if (userRecord?.regionId && att.regionId && userRecord.regionId !== att.regionId) {
            return res.status(403).json({ error: 'ليس لديك صلاحية الوصول إلى هذا الملف' });
          }
          if (userRecord?.sectorId && att.sectorId && userRecord.sectorId !== att.sectorId) {
            return res.status(403).json({ error: 'ليس لديك صلاحية الوصول إلى هذا الملف' });
          }
        }
      }

      const filePath = path.join(UPLOAD_DIR, filename);
      if (!existsSync(filePath)) {
        return res.status(404).json({ error: 'الملف غير موجود' });
      }

      res.sendFile(filePath);
    } catch (err) {
      console.error('[FILE DOWNLOAD ERROR]', (err as Error).message);
      res.status(500).json({ error: 'فشل في تحميل الملف' });
    }
  });

  // Global error handler — prevents server crash on unhandled route errors
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error('Unhandled route error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  });

  // Health check
  app.get('/api/health', async (req, res) => {
    try {
      await db.execute(sql`SELECT 1`);
      res.json({ status: 'ok', db: 'connected' });
    } catch {
      res.status(503).json({ status: 'error', db: 'disconnected' });
    }
  });

  // Catch any /api/* route that didn't match a registered handler.
  // In dev this prevents Vite's proxy from forwarding unknown API calls.
  // In production this prevents the SPA catch-all from returning HTML for missing API routes.
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API route not found' });
  });

  // Create the Node HTTP server explicitly so we can hand it to Vite's HMR
  // (otherwise Vite creates a *separate* WebSocket server on port 24678 which
  //  fights with the previous process on restarts and silently kills the app)
  const httpServer = http.createServer(app);

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
        // Disable HMR completely — prevents WebSocket port conflicts that crash the server
        hmr: false,
        watch: {
          // Ignore Replit internal files to stop constant page-reload spam
          ignored: (p: string) =>
            p.includes('/.local/') ||
            p.includes('/node_modules/') ||
            p.includes('/.git/'),
        },
      },
      appType: 'spa',
    });
    // Rewrite host header to bypass Vite's host check restriction for Replit domains
    app.use((req, _res, next) => {
      req.headers.host = 'localhost';
      next();
    });
    app.use(vite.middlewares);
  } else {
    // __dirname = backend/src — built frontend is at project_root/dist
    const distPath = path.join(__dirname, '../../dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Seed Admin User
  async function seedAdmin() {
    const adminExists = await db.query.users.findFirst({
      where: eq(users.username, 'admin'),
    });

    if (!adminExists) {
      const password = process.env.ADMIN_DEFAULT_PASSWORD;
      if (!password) {
        if (_IS_PROD) {
          console.error('[FATAL] Admin user does not exist and ADMIN_DEFAULT_PASSWORD is not set. Refusing to seed a weak password in production.');
          process.exit(1);
        }
        console.warn('[SECURITY] ADMIN_DEFAULT_PASSWORD not set — skipping admin seed in dev. Set it to create the admin user.');
        return;
      }
      const hash = await bcrypt.hash(password, 10);
      await db.insert(users).values({
        username: 'admin',
        passwordHash: hash,
        role: 'ADMIN',
      });
      console.log('Admin user seeded with username: admin');
    }
  }

  // Graceful shutdown on SIGTERM/SIGINT — frees port 5000 immediately
  // so the next process can bind without EADDRINUSE on restart
  const shutdown = () => {
    console.log('Shutting down gracefully...');
    httpServer.close(() => {
      console.log('Server closed, exiting.');
      process.exit(0);
    });
    // Hard-exit after 3 s if connections don't drain
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT',  shutdown);

  httpServer.on('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`[WARN] Port ${PORT} in use. Retrying in 2s...`);
      setTimeout(() => {
        httpServer.close();
        httpServer.listen(PORT, '0.0.0.0');
      }, 2000);
    } else {
      console.error('[SERVER ERROR]', err.message);
    }
  });

  httpServer.listen(PORT, '0.0.0.0', async () => {
    console.log(`Server running on port ${PORT}`);
    try {
      console.log("Starting seedAdmin...");
      await seedAdmin();
      console.log("seedAdmin done.");

    } catch (err) {
      console.error('Seeding failed:', err);
    }
  });
}

// Prevent crashes from unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

startServer();
