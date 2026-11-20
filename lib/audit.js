const crypto = require('crypto')

function auditPayload(event, correlationId) {
  return {
    correlation_id: correlationId,
    event_type: String(event.type || 'event'),
    actor_uid: event.actorUid || null,
    target_uid: event.targetUid || null,
    entity_type: event.entityType || null,
    entity_id: event.entityId ? String(event.entityId) : null,
    status: event.status || 'info',
    detail: event.detail || {}
  }
}

function errorMessage(error) {
  return String(error?.message || error || 'unknown_audit_error').slice(0, 2000)
}

async function auditEvent(supabase, event) {
  if (!supabase || !event) return { ok: false, skipped: true }

  const correlationId = String(event.correlationId || crypto.randomUUID())
  const payload = auditPayload(event, correlationId)
  try {
    const result = await supabase.from('audit_logs').insert(payload)
    const error = result?.error || null
    if (error && String(error.code || '') !== '23505') throw error
    return { ok: true, duplicate: Boolean(error), correlationId }
  } catch (error) {
    const message = errorMessage(error)
    console.error(JSON.stringify({ level: 'error', source: 'audit', correlationId, eventType: payload.event_type, message }))
    try {
      const { error: outboxError } = await supabase.from('audit_failure_outbox').upsert({
        correlation_id: correlationId,
        event_payload: payload,
        original_error: message,
        status: 'pending',
        updated_at: new Date().toISOString()
      }, { onConflict: 'correlation_id', ignoreDuplicates: true })
      if (outboxError) throw outboxError
      return { ok: false, queued: true, correlationId, error: message }
    } catch (outboxError) {
      console.error(JSON.stringify({ level: 'critical', source: 'audit_outbox', correlationId, eventType: payload.event_type, message: errorMessage(outboxError) }))
      return { ok: false, queued: false, correlationId, error: message }
    }
  }
}

async function retryAuditFailure(supabase, outboxId, recoveredBy) {
  const { data: record, error: readError } = await supabase.from('audit_failure_outbox').select('*').eq('id', outboxId).maybeSingle()
  if (readError) throw readError
  if (!record) throw new Error('AUDIT_FAILURE_NOT_FOUND')
  if (record.status === 'recovered') return { recovered: true, duplicate: true, correlationId: record.correlation_id }

  const payload = { ...(record.event_payload || {}), correlation_id: record.correlation_id }
  const { error: auditError } = await supabase.from('audit_logs').upsert(payload, { onConflict: 'correlation_id', ignoreDuplicates: true })
  if (auditError) {
    const message = errorMessage(auditError)
    await supabase.from('audit_failure_outbox').update({
      status: 'pending', attempts: Number(record.attempts || 0) + 1, last_error: message, updated_at: new Date().toISOString()
    }).eq('id', outboxId)
    throw auditError
  }

  const { error: updateError } = await supabase.from('audit_failure_outbox').update({
    status: 'recovered', attempts: Number(record.attempts || 0) + 1, last_error: null,
    recovered_at: new Date().toISOString(), recovered_by: recoveredBy || null, updated_at: new Date().toISOString()
  }).eq('id', outboxId)
  if (updateError) throw updateError
  return { recovered: true, duplicate: false, correlationId: record.correlation_id }
}

module.exports = { auditEvent, retryAuditFailure }
