const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { selectSmartSafetyQuestion, stableQuestionScore } = require('../lib/safety-question-rotation')

const questions = [
  { id: 'q1' },
  { id: 'q2' },
  { id: 'q3' },
  { id: 'q4' }
]

test('selects an unseen question before any previously answered question', () => {
  const history = [
    { safety_question_id: 'q1', checkin_date: '2026-10-29' },
    { safety_question_id: 'q2', checkin_date: '2026-10-30' }
  ]
  const result = selectSmartSafetyQuestion(questions, history, 'user-a', '2026-10-31')
  assert.equal(result.mode, 'unseen')
  assert.ok(['q3', 'q4'].includes(result.question.id))
  assert.equal(result.unseenCount, 2)
})

test('selects the least recently answered question after all questions were seen', () => {
  const history = [
    { safety_question_id: 'q1', checkin_date: '2026-10-30' },
    { safety_question_id: 'q2', checkin_date: '2026-10-28' },
    { safety_question_id: 'q3', checkin_date: '2026-10-29' },
    { safety_question_id: 'q4', checkin_date: '2026-10-27' }
  ]
  const result = selectSmartSafetyQuestion(questions, history, 'user-a', '2026-10-31')
  assert.equal(result.mode, 'least_recently_seen')
  assert.equal(result.question.id, 'q4')
})

test('selection is stable for the same user and date but varies across users', () => {
  const first = selectSmartSafetyQuestion(questions, [], 'user-a', '2026-10-31')
  const repeated = selectSmartSafetyQuestion(questions, [], 'user-a', '2026-10-31')
  assert.equal(first.question.id, repeated.question.id)

  const selectedIds = new Set(['user-a', 'user-b', 'user-c', 'user-d'].map(uid => (
    selectSmartSafetyQuestion(questions, [], uid, '2026-10-31').question.id
  )))
  assert.ok(selectedIds.size > 1)
})

test('ignores history for questions that are no longer active', () => {
  const result = selectSmartSafetyQuestion(
    questions,
    [{ safety_question_id: 'archived-question', checkin_date: '2026-10-30' }],
    'user-a',
    '2026-10-31'
  )
  assert.equal(result.mode, 'unseen')
  assert.equal(result.unseenCount, 4)
})

test('keeps the previous selection and hashes each candidate only once', (t) => {
  const uid = 'member-test'
  const day = '2026-11-28'
  const candidates = Array.from({ length: 120 }, (_, index) => ({ id: `q-${index}` }))
  const expected = [...candidates].sort((left, right) => (
    stableQuestionScore(uid, day, left.id).localeCompare(stableQuestionScore(uid, day, right.id)) ||
    left.id.localeCompare(right.id)
  ))[0]
  const hash = t.mock.method(crypto, 'createHash')
  assert.equal(selectSmartSafetyQuestion(candidates, [], uid, day).question, expected)
  assert.equal(hash.mock.callCount(), candidates.length)
})
