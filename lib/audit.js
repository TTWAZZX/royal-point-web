async function auditEvent(supabase, event) {
  if (!supabase || !event) return

  try {
    await supabase.from('audit_logs').insert({
      event_type: String(event.type || 'event'),
      actor_uid: event.actorUid || null,
      target_uid: event.targetUid || null,
      entity_type: event.entityType || null,
      entity_id: event.entityId ? String(event.entityId) : null,
      status: event.status || 'info',
      detail: event.detail || {}
    })
  } catch (_) {
    // audit_logs is optional; never break user/admin flows if the table is absent.
  }
}

module.exports = { auditEvent }
