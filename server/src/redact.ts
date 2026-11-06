/**
 * Request paths can carry one-time invitation tokens. Logs and audit denial records must never
 * retain those secrets, so the token segment is replaced before the path leaves the server.
 */
export function safeRequestPath(url: string): string {
  const path = url.split('?')[0] ?? '';
  return path.replace(/(\/api\/v1\/auth\/invitations\/)[^/]+/i, '$1[redacted]');
}
