import type { Pool } from 'pg';
import { AppError } from '../errors.ts';
import { withTransaction } from '../db/transaction.ts';
import { writeAuditEvent } from './audit.ts';
import type { AuthContext } from './loginService.ts';
import { isRole, type Role } from './permissions.ts';
import type { MembershipContext } from './types.ts';

export interface UpdateMembershipInput {
  actor: MembershipContext;
  actorUserId: string;
  targetUserId: string;
  role?: Role;
  status?: 'ACTIVE' | 'SUSPENDED' | 'REMOVED';
}

export async function updateMembership(pool: Pool, input: UpdateMembershipInput, context: AuthContext): Promise<void> {
  if (input.targetUserId === input.actorUserId) {
    throw new AppError(403, 'CANNOT_CHANGE_OWN_ROLE', 'You cannot change your own role or membership.');
  }

  await withTransaction(pool, async (client) => {
    // Lock every membership in the organisation. This serialises the last-owner check across
    // concurrent demotions/removals.
    const memberships = await client.query<{
      id: string;
      user_id: string;
      role: string;
      status: string;
    }>(
      `SELECT id, user_id, role, status
         FROM memberships
        WHERE organisation_id = $1
        FOR UPDATE`,
      [input.actor.organisationId],
    );
    const target = memberships.rows.find((row) => row.user_id === input.targetUserId);
    if (!target || !isRole(target.role)) {
      throw new AppError(404, 'MEMBER_NOT_FOUND', 'Member not found.');
    }

    const nextRole = input.role ?? target.role;
    const nextStatus = input.status ?? target.status;
    if (!isRole(nextRole)) {
      throw new AppError(400, 'INVALID_ROLE', 'Invalid role.');
    }
    if (nextRole === 'OWNER' && input.actor.role !== 'OWNER') {
      throw new AppError(403, 'FORBIDDEN', 'Only an owner can grant the owner role.');
    }

    const activeOwners = memberships.rows.filter((row) => row.role === 'OWNER' && row.status === 'ACTIVE');
    const removesActiveOwner =
      target.role === 'OWNER' && target.status === 'ACTIVE' && (nextRole !== 'OWNER' || nextStatus !== 'ACTIVE');
    if (removesActiveOwner && activeOwners.length <= 1) {
      throw new AppError(409, 'LAST_OWNER_PROTECTED', 'The last owner cannot be demoted or removed.');
    }

    if (nextRole === target.role && nextStatus === target.status) {
      return;
    }

    await client.query(
      `UPDATE memberships
          SET role = $2, status = $3
        WHERE id = $1`,
      [target.id, nextRole, nextStatus],
    );
    const revoked = await client.query(
      `UPDATE sessions
          SET revoked_at = now(), revoked_reason = 'ROLE_CHANGED'
        WHERE user_id = $1 AND revoked_at IS NULL`,
      [input.targetUserId],
    );
    await writeAuditEvent(client, {
      organisationId: input.actor.organisationId,
      actorUserId: input.actorUserId,
      sessionId: context.sessionId ?? null,
      action: 'membership.updated',
      entityType: 'membership',
      entityId: target.id,
      before: { role: target.role, status: target.status },
      after: {
        role: nextRole,
        status: nextStatus,
        sessionsRevoked: revoked.rowCount ?? 0,
      },
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
      requestId: context.requestId ?? null,
    });
  });
}
