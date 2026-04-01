import { describe, it, expect, vi } from 'vitest'
import type { FastifyRequest, FastifyReply } from 'fastify'
import { requireAuth, getAuthUser, requireJson } from './auth.js'

vi.mock('./db.js', () => ({
  getDb: vi.fn(() => ({
    prepare: vi.fn(() => ({
      get: vi.fn(() => ({ id: 1, email: 'user@example.com', role: 'owner', status: 'active', token_version: 0 })),
    })),
  })),
}))

// Helper to create a minimal request-like object
function fakeRequest(overrides: Record<string, unknown> = {}): FastifyRequest {
  return {
    headers: {},
    ...overrides,
  } as unknown as FastifyRequest
}

// Helper to create a minimal reply-like object
function fakeReply() {
  const reply = {
    statusCode: 200,
    body: null as unknown,
    status(code: number) {
      reply.statusCode = code
      return reply
    },
    send(body: unknown) {
      reply.body = body
      return reply
    },
  }
  return reply as unknown as FastifyReply & { statusCode: number; body: unknown }
}

describe('auth', () => {
  // Note: vitest.config sets AUTH_DISABLED=1 for server tests

  describe('requireAuth', () => {
    it('sets authUser to "local" when AUTH_DISABLED=1', async () => {
      const request = fakeRequest()
      const reply = fakeReply()
      await requireAuth(request, reply)
      expect(request.authUser).toBe('local')
    })

    it('returns 401 when no JWT and AUTH_DISABLED is off', async () => {
      const saved = process.env.AUTH_DISABLED
      delete process.env.AUTH_DISABLED

      try {
        const request = fakeRequest({
          jwtVerify: vi.fn().mockRejectedValue(new Error('no token')),
        })
        const reply = fakeReply()
        await requireAuth(request, reply)
        expect(reply.statusCode).toBe(401)
        expect(reply.body).toEqual({ error: 'Unauthorized' })
      } finally {
        process.env.AUTH_DISABLED = saved
      }
    })

    it('sets authUser from JWT payload when valid', async () => {
      const saved = process.env.AUTH_DISABLED
      delete process.env.AUTH_DISABLED

      try {
        const request = fakeRequest({
          jwtVerify: vi.fn().mockResolvedValue(undefined),
          user: { email: 'user@example.com', token_version: 0 },
        })
        const reply = fakeReply()
        await requireAuth(request, reply)
        expect(request.authUser).toBe('user@example.com')
      } finally {
        process.env.AUTH_DISABLED = saved
      }
    })

    it('returns 401 when token_version does not match DB', async () => {
      const saved = process.env.AUTH_DISABLED
      delete process.env.AUTH_DISABLED

      const { getDb } = await import('./db.js')
      vi.mocked(getDb).mockReturnValue({
        prepare: vi.fn(() => ({
          get: vi.fn(() => ({ id: 1, email: 'user@example.com', role: 'owner', status: 'active', token_version: 1 })),
        })),
      } as any)

      try {
        const request = fakeRequest({
          jwtVerify: vi.fn().mockResolvedValue(undefined),
          user: { email: 'user@example.com', token_version: 0 },
        })
        const reply = fakeReply()
        await requireAuth(request, reply)
        expect(reply.statusCode).toBe(401)
      } finally {
        process.env.AUTH_DISABLED = saved
        // Reset mock to default
        vi.mocked(getDb).mockReturnValue({
          prepare: vi.fn(() => ({
            get: vi.fn(() => ({ id: 1, email: 'user@example.com', role: 'owner', status: 'active', token_version: 0 })),
          })),
        } as any)
      }
    })
  })

  describe('getAuthUser', () => {
    it('returns authUser from request', () => {
      const request = fakeRequest()
      request.authUser = 'test@example.com'
      expect(getAuthUser(request)).toBe('test@example.com')
    })

    it('returns null when authUser is not set', () => {
      const request = fakeRequest()
      expect(getAuthUser(request)).toBeNull()
    })
  })

  describe('requireJson', () => {
    it('calls done() for application/json', () => {
      const done = vi.fn()
      const reply = fakeReply()
      requireJson(fakeRequest({ headers: { 'content-type': 'application/json' } }), reply, done)
      expect(done).toHaveBeenCalled()
    })

    it('calls done() for application/json with charset', () => {
      const done = vi.fn()
      const reply = fakeReply()
      requireJson(fakeRequest({ headers: { 'content-type': 'application/json; charset=utf-8' } }), reply, done)
      expect(done).toHaveBeenCalled()
    })

    it('returns 415 for non-json content type', () => {
      const done = vi.fn()
      const reply = fakeReply()
      requireJson(fakeRequest({ headers: { 'content-type': 'text/plain' } }), reply, done)
      expect(done).not.toHaveBeenCalled()
      expect(reply.statusCode).toBe(415)
      expect(reply.body).toEqual({ error: 'Unsupported Media Type' })
    })

    it('returns 415 when content-type is missing', () => {
      const done = vi.fn()
      const reply = fakeReply()
      requireJson(fakeRequest(), reply, done)
      expect(done).not.toHaveBeenCalled()
      expect(reply.statusCode).toBe(415)
    })
  })
})
