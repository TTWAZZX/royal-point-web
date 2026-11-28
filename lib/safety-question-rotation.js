const crypto = require('crypto')

function stableQuestionScore(uid, date, questionId) {
  return crypto
    .createHash('sha256')
    .update(`${String(uid || '')}:${String(date || '')}:${String(questionId || '')}`)
    .digest('hex')
}

function selectSmartSafetyQuestion(questions, history, uid, today) {
  const available = (Array.isArray(questions) ? questions : [])
    .filter(question => question?.id)

  if (!available.length) {
    return { question: null, mode: 'fallback', unseenCount: 0 }
  }

  const availableIds = new Set(available.map(question => String(question.id)))
  const lastSeenByQuestion = new Map()

  for (const row of Array.isArray(history) ? history : []) {
    const questionId = String(row?.safety_question_id || '').trim()
    if (!questionId || !availableIds.has(questionId)) continue
    const seenAt = String(row?.checkin_date || row?.created_at || '')
    const previous = lastSeenByQuestion.get(questionId)
    if (!previous || seenAt > previous) lastSeenByQuestion.set(questionId, seenAt)
  }

  const unseen = available.filter(question => !lastSeenByQuestion.has(String(question.id)))
  let pool = unseen
  let mode = 'unseen'

  if (!pool.length) {
    mode = 'least_recently_seen'
    let oldestSeenAt = null
    for (const seenAt of lastSeenByQuestion.values()) {
      if (oldestSeenAt === null || seenAt < oldestSeenAt) oldestSeenAt = seenAt
    }
    pool = available.filter(question => lastSeenByQuestion.get(String(question.id)) === oldestSeenAt)
  }

  let question = pool[0] || available[0]
  if (pool.length > 1) {
    let bestScore = stableQuestionScore(uid, today, question.id)
    for (let index = 1; index < pool.length; index++) {
      const candidate = pool[index]
      const score = stableQuestionScore(uid, today, candidate.id)
      const order = score.localeCompare(bestScore) || String(candidate.id).localeCompare(String(question.id))
      if (order < 0) {
        question = candidate
        bestScore = score
      }
    }
  }

  return {
    question,
    mode,
    unseenCount: unseen.length
  }
}

module.exports = {
  stableQuestionScore,
  selectSmartSafetyQuestion
}
