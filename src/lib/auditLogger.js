/**
 * Audit Logger — records all admin actions to the audit_logs table.
 * Every admin action (role change, approve/reject, delete, add, etc.)
 * must call logAudit() so there is a full audit trail.
 */
import { supabase } from './supabase';

/**
 * @param {object} params
 * @param {string} params.action       - e.g. 'UPDATE_USER_ROLE', 'APPROVE_VEHICLE'
 * @param {string} params.entityType   - 'user' | 'vehicle' | 'booking' | 'brand' | 'model'
 * @param {string} params.entityId     - UUID or ID of the affected record
 * @param {string} params.description  - Human-readable description
 * @param {object} [params.oldValue]   - Previous state (optional)
 * @param {object} [params.newValue]   - New state (optional)
 * @param {string} [params.performedBy]       - UUID of admin who performed the action
 * @param {string} [params.performerName]     - Full name of admin
 * @param {string} [params.performerEmail]    - Email of admin
 */
export const logAudit = async ({
    action,
    entityType,
    entityId,
    description,
    oldValue = null,
    newValue = null,
    performedBy = null,
    performerName = null,
    performerEmail = null,
}) => {
    try {
        const { error } = await supabase.from('audit_logs').insert({
            performed_by: performedBy,
            performer_name: performerName,
            performer_email: performerEmail,
            action,
            entity_type: entityType,
            entity_id: String(entityId || ''),
            description,
            old_value: oldValue,
            new_value: newValue,
            user_agent: navigator?.userAgent?.slice(0, 200) || null,
        });

        if (error) {
            console.warn('[Audit] Failed to log audit event:', error.message);
        }
    } catch (err) {
        // Audit logging must NEVER throw — it should never block the main action
        console.warn('[Audit] Exception in logAudit:', err);
    }
};

export default logAudit;
