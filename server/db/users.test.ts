import { describe, expect, it, beforeEach, vi } from 'vitest'
import { setupTestDb } from '../__tests__/helpers/testDb.js'
import {
  createInitialOwner,
  createUser,
  getDb,
  issueInvitation,
  updateUser,
  updateUserPassword,
} from '../db.js'

beforeEach(() => {
  setupTestDb()
})

function capturePreparedSql(): string[] {
  const db = getDb()
  const originalPrepare = db.prepare.bind(db)
  const preparedSql: string[] = []
  vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
    preparedSql.push(sql)
    return originalPrepare(sql)
  })
  return preparedSql
}

describe('user write paths', () => {
  it('creates users without a follow-up row query', () => {
    const preparedSql = capturePreparedSql()

    const user = createUser({
      email: 'member@example.com',
      passwordHash: 'hash',
      role: 'member',
      status: 'active',
    })

    expect(user.email).toBe('member@example.com')
    expect(preparedSql.some(sql => sql.includes('INSERT INTO users') && sql.includes('RETURNING *'))).toBe(true)
    expect(preparedSql.some(sql => sql.includes('SELECT * FROM users WHERE id = ?'))).toBe(false)
  })

  it('creates the initial owner with returning and returns null when one exists', () => {
    const preparedSql = capturePreparedSql()

    const owner = createInitialOwner('owner@example.com', 'hash')
    const duplicate = createInitialOwner('second@example.com', 'hash')

    expect(owner?.role).toBe('owner')
    expect(duplicate).toBeNull()
    expect(preparedSql.filter(sql => sql.includes('INSERT INTO users') && sql.includes('RETURNING *'))).toHaveLength(2)
    expect(preparedSql.some(sql => sql.includes('SELECT * FROM users WHERE id = ?'))).toBe(false)
  })

  it('updates users without a follow-up row query', () => {
    const user = createUser({
      email: 'old@example.com',
      passwordHash: 'hash',
      role: 'member',
      status: 'active',
    })
    const preparedSql = capturePreparedSql()

    const updated = updateUser(user.id, { email: 'new@example.com' })

    expect(updated?.email).toBe('new@example.com')
    expect(preparedSql.some(sql => sql.includes('UPDATE users SET') && sql.includes('RETURNING *'))).toBe(true)
    expect(preparedSql.some(sql => sql.includes('SELECT * FROM users WHERE id = ?'))).toBe(false)
  })

  it('updates user passwords without a follow-up row query', () => {
    const user = createUser({
      email: 'password@example.com',
      passwordHash: 'old-hash',
      role: 'member',
      status: 'invited',
    })
    const preparedSql = capturePreparedSql()

    const updated = updateUserPassword(user.id, 'new-hash', true)

    expect(updated?.password_hash).toBe('new-hash')
    expect(updated?.status).toBe('active')
    expect(updated?.token_version).toBe(user.token_version + 1)
    expect(preparedSql.some(sql => sql.includes('UPDATE users') && sql.includes('RETURNING *'))).toBe(true)
    expect(preparedSql.some(sql => sql.includes('SELECT * FROM users WHERE id = ?'))).toBe(false)
  })

  it('issues invitations without a follow-up token lookup', () => {
    const user = createUser({
      email: 'invitee@example.com',
      passwordHash: 'hash',
      role: 'member',
      status: 'invited',
    })
    const preparedSql = capturePreparedSql()

    const invitation = issueInvitation(user.id, null)

    expect(invitation.user_id).toBe(user.id)
    expect(invitation.token).toBeTruthy()
    expect(preparedSql.some(sql => sql.includes('INSERT INTO invitations') && sql.includes('RETURNING *'))).toBe(true)
    expect(preparedSql.some(sql => sql.includes('SELECT * FROM invitations WHERE token = ?'))).toBe(false)
  })
})
