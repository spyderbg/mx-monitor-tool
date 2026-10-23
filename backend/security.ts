import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { SESSION_COOKIE } from '../shared/config.js';

export const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
export const HARDENED_HEADERS = Object.freeze({
  'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin', 'Cross-Origin-Resource-Policy': 'same-origin',
  'Content-Security-Policy': CSP,
});

export function allowedHost(host: string | undefined): boolean {
  return host !== undefined && /^(localhost|127\.0\.0\.1)(:\d{1,5})?$/.test(host);
}

export function installSecurity(app: FastifyInstance): (reply: FastifyReply) => void {
  const token = randomBytes(32).toString('hex');
  const setSession = (reply: FastifyReply): void => {
    reply.header('Set-Cookie', `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/api`);
  };
  const authenticated = (request: FastifyRequest): boolean => {
    const value = request.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
    return value !== undefined && /^[a-f0-9]{64}$/.test(value) && timingSafeEqual(Buffer.from(value), Buffer.from(token));
  };
  app.addHook('onRequest', async (request, reply) => {
    reply.headers(HARDENED_HEADERS);
    const host = request.headers.host;
    // Match the complete authority; URL parsing alone would normalize unsafe forms.
    if (!allowedHost(host)) {
      return reply.code(403).send({ error: 'Forbidden host.' });
    }
    const rawPath = request.url.split('?')[0]!;
    let path: string;
    try { path = decodeURIComponent(rawPath); }
    catch { return reply.code(400).send({ error: 'Invalid path.' }); }
    // Fastify can match percent-encoded static segments. Authorization must use
    // the matched route too, never only the client-supplied raw URL prefix.
    const matched = request.routeOptions.url;
    const isApi = (value: string | undefined) => value === '/api' || value?.startsWith('/api/') === true;
    if (isApi(matched) || isApi(path) || isApi(rawPath)) {
      const site = request.headers['sec-fetch-site'];
      const origin = request.headers.origin;
      if ((site !== undefined && site !== 'same-origin' && site !== 'none') ||
          (origin !== undefined && origin !== `http://${host}`)) {
        return reply.code(403).send({ error: 'Forbidden origin.' });
      }
      // Health is a minimal public identity probe. Session is a same-origin bootstrap.
      if (matched !== '/api/health' && matched !== '/api/session' && !authenticated(request)) {
        return reply.code(401).send({ error: 'Application session required.' });
      }
    }
  });
  return setSession;
}
