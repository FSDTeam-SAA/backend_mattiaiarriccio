import AuditLog from '../models/auditLog.model.js';

/**
 * Records an admin action against a user/resource. Never throws into the request
 * path: audit failures are logged but do not break the action.
 */
export const logAudit = async ({ adminId, action, targetUserId = null, meta = null }) => {
  try {
    return await AuditLog.create({ adminId, action, targetUserId, meta });
  } catch (error) {
    console.error('[audit.service] Failed to write audit log:', error?.message || error);
    return null;
  }
};

export const listAuditForUser = async (targetUserId, limit = 50) =>
  AuditLog.find({ targetUserId }).sort({ createdAt: -1 }).limit(limit).lean();
