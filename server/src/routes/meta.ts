import type { FastifyPluginAsync } from 'fastify';

export const metaRoutes: FastifyPluginAsync = async (app) => {
  /**
   * Minimal authenticated-independent route used to prove routing, request ids and the error
   * envelope before identity and tenant middleware arrive in Phase 3.
   */
  app.get('/ping', { config: { auth: { mode: 'public' } } }, async (request) => {
    return {
      pong: true,
      requestId: request.id,
      timestamp: new Date().toISOString(),
    };
  });
};
