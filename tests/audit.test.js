const test = require('node:test')
const assert = require('node:assert/strict')
const { auditEvent, retryAuditFailure } = require('../lib/audit')

test('auditEvent reports Supabase response errors and queues the event with one correlation id', async () => {
  let queued = null
  const client = {
    from(table) {
      if (table === 'audit_logs') return { insert: async () => ({ error: new Error('audit insert failed') }) }
      if (table === 'audit_failure_outbox') return { upsert: async value => { queued = value; return { error: null } } }
      throw new Error(`unexpected table ${table}`)
    }
  }
  const originalError = console.error
  console.error = () => {}
  try {
    const result = await auditEvent(client, { type: 'test_event', actorUid: 'U1', detail: { safe: true } })
    assert.equal(result.ok, false)
    assert.equal(result.queued, true)
    assert.match(result.correlationId, /^[0-9a-f-]{36}$/)
    assert.equal(queued.correlation_id, result.correlationId)
    assert.equal(queued.event_payload.correlation_id, result.correlationId)
    assert.equal(queued.event_payload.event_type, 'test_event')
  } finally {
    console.error = originalError
  }
})

test('retryAuditFailure upserts the original audit before marking outbox recovered', async () => {
  const updates = []
  let restored = null
  const record = {
    id: 'outbox-1', correlation_id: '1e087388-2371-4a74-b651-65973a28ecae', status: 'pending', attempts: 1,
    event_payload: { event_type: 'test_event', detail: { safe: true } }
  }
  const client = {
    from(table) {
      if (table === 'audit_logs') return { upsert: async value => { restored = value; return { error: null } } }
      if (table === 'audit_failure_outbox') {
        return {
          select() { return this },
          eq() { return this },
          maybeSingle: async () => ({ data: record, error: null }),
          update(value) { updates.push(value); return { eq: async () => ({ error: null }) } }
        }
      }
      throw new Error(`unexpected table ${table}`)
    }
  }
  const result = await retryAuditFailure(client, record.id, 'ADMIN')
  assert.equal(result.recovered, true)
  assert.equal(restored.correlation_id, record.correlation_id)
  assert.equal(updates[0].status, 'recovered')
  assert.equal(updates[0].attempts, 2)
  assert.equal(updates[0].recovered_by, 'ADMIN')
})
