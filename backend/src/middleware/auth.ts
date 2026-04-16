import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const IS_PROD = process.env.NODE_ENV === 'production';

const _WEAK_SECRETS = new Set([
  'secret', 'password', 'jwt_secret', 'jwtsecret', 'changeme', 'change_me',
  '1234567890', '12345678901234567890', 'dev_fallback_secret_not_for_production',
  'mysecret', 'mysecretkey', 'supersecret',
]);

(function validateJwtSecret() {
  const raw = process.env.JWT_SECRET;
  if (!raw) {
    if (IS_PROD) {
      console.error('[FATAL] JWT_SECRET is not set. Refusing to start in production.');
      process.exit(1);
    }
    console.warn('[SECURITY] JWT_SECRET not set — using insecure dev fallback. Set JWT_SECRET before deploying to production.');
    return;
  }
  if (raw.length < 32) {
    const msg = `JWT_SECRET is too short (${raw.length} chars). Minimum 32 characters required.`;
    if (IS_PROD) { console.error(`[FATAL] ${msg}`); process.exit(1); }
    console.warn(`[SECURITY] ${msg}`);
  }
  if (_WEAK_SECRETS.has(raw.toLowerCase())) {
    const msg = 'JWT_SECRET is a well-known weak value. Use a strong random secret.';
    if (IS_PROD) { console.error(`[FATAL] ${msg}`); process.exit(1); }
    console.warn(`[SECURITY] ${msg}`);
  }
})();

const JWT_SECRET = process.env.JWT_SECRET || 'dev_fallback_secret_not_for_production';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    username: string;
    role: string;
    fullName?: string | null;
  };
}

export const authenticate = (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

export const authorize = (roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
};
