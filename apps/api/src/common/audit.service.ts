import { Inject, Injectable } from '@nestjs/common';
import { DB } from '../config';
import type { Db, DbOrTx } from '../db/client';
import { auditLogs } from '../db/schema';
import type { Actor } from '../auth/actor';

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId: string;
  metadata?: Record<string, unknown>;
}

/** Audit log for sensitive operations. Pass the transaction so the log commits with the change. */
@Injectable()
export class AuditService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async record(actor: Actor | null, entry: AuditEntry, tx: DbOrTx = this.db) {
    await tx.insert(auditLogs).values({
      actorId: actor?.userId ?? null,
      actorRole: actor?.role ?? 'SYSTEM',
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      metadata: entry.metadata ?? {},
      ip: actor?.ip ?? null,
    });
  }
}
