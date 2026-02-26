import type { Request, Response, NextFunction } from 'express';

const API_KEY = process.env.API_KEY;

/**
 * Bearer-token auth middleware. When API_KEY env var is set, all requests
 * must include `Authorization: Bearer <key>`. When unset, auth is skipped
 * so the app works zero-config for local development.
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!API_KEY) {
    next();
    return;
  }

  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ') || header.slice(7) !== API_KEY) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  next();
}

/** Check whether a raw token string matches the configured API_KEY. */
export function isValidToken(token: string | undefined): boolean {
  if (!API_KEY) return true;
  return token === API_KEY;
}
