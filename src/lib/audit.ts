import type { Prisma, PrismaClient } from "@/generated/prisma/client";

// Works with the normal client and inside a transaction, so the log entry commits or rolls
// back together with the change it describes.
type AuditDb = { auditLog: PrismaClient["auditLog"] };

export type AuditEntry = {
  actorId: string | null;
  /** Dotted verb, for example "builder.approved" or "document.viewed". */
  action: string;
  entity: string;
  entityId: string;
  meta?: Prisma.InputJsonValue;
};

export async function recordAudit(db: AuditDb, entry: AuditEntry): Promise<void> {
  await db.auditLog.create({
    data: {
      actorId: entry.actorId,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId,
      meta: entry.meta,
    },
  });
}
