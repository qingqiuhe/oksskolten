import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockIsSearchReady, mockMeiliSearch } = vi.hoisted(() => ({
  mockIsSearchReady: vi.fn(() => true),
  mockMeiliSearch: vi.fn(),
}))

vi.mock('./search/sync.js', () => ({
  isSearchReady: mockIsSearchReady,
}))

vi.mock('./search/client.js', () => ({
  buildMeiliFilter: vi.fn(() => undefined),
  meiliSearch: mockMeiliSearch,
}))

import {
  _awaitSimilarityQueueIdle,
  _resetSimilarityQueueForTests,
  computeTitleSimilarity,
  enqueueSimilarityDetection,
} from './similarity.js'

beforeEach(() => {
  _resetSimilarityQueueForTests()
  mockIsSearchReady.mockReset()
  mockIsSearchReady.mockReturnValue(true)
  mockMeiliSearch.mockReset()
  mockMeiliSearch.mockResolvedValue({ hits: [], estimatedTotalHits: 0 })
})

afterEach(async () => {
  await _awaitSimilarityQueueIdle()
  _resetSimilarityQueueForTests()
})

describe('computeTitleSimilarity', () => {
  it('returns 1.0 for identical titles', () => {
    expect(computeTitleSimilarity('Hello World', 'Hello World')).toBe(1)
  })

  it('returns 1.0 for case-insensitive identical titles', () => {
    expect(computeTitleSimilarity('Hello World', 'hello world')).toBe(1)
  })

  it('returns high score for very similar titles', () => {
    const score = computeTitleSimilarity(
      'Apple announces iPhone 17',
      'Apple unveils new iPhone 17',
    )
    expect(score).toBeGreaterThan(0.5)
  })

  it('returns score above threshold for same-news titles', () => {
    const score = computeTitleSimilarity(
      'Google releases Gemini 3.0 with major improvements',
      'Google launches Gemini 3.0 AI model update',
    )
    expect(score).toBeGreaterThan(0.4)
  })

  it('returns low score for unrelated titles', () => {
    const score = computeTitleSimilarity(
      'Apple announces iPhone 17',
      'How to bake a chocolate cake',
    )
    expect(score).toBeLessThan(0.2)
  })

  it('returns 0 for empty strings', () => {
    expect(computeTitleSimilarity('', '')).toBe(0)
    expect(computeTitleSimilarity('Hello', '')).toBe(0)
    expect(computeTitleSimilarity('', 'World')).toBe(0)
  })

  it('ignores punctuation', () => {
    const score = computeTitleSimilarity(
      'Breaking: Apple announces iPhone!',
      'Breaking Apple announces iPhone',
    )
    expect(score).toBeGreaterThan(0.9)
  })

  it('handles single-character words gracefully', () => {
    // Single-char words produce no bigrams
    const score = computeTitleSimilarity('A B C', 'X Y Z')
    expect(score).toBe(0)
  })

  it('handles Japanese titles', () => {
    const score = computeTitleSimilarity(
      'Appleが新型iPhone 17を発表',
      'Apple、iPhone 17を正式発表',
    )
    expect(score).toBeGreaterThan(0.4)
  })
})

describe('enqueueSimilarityDetection', () => {
  it('caps background similarity detections', async () => {
    let inFlight = 0
    let maxInFlight = 0
    mockMeiliSearch.mockImplementation(async () => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise(resolve => setTimeout(resolve, 10))
      inFlight -= 1
      return { hits: [], estimatedTotalHits: 0 }
    })

    for (let i = 0; i < 6; i++) {
      enqueueSimilarityDetection({
        articleId: i + 1,
        title: `Queued article ${i + 1}`,
        feedId: 1,
        publishedAt: '2026-01-01T00:00:00.000Z',
      })
    }

    await _awaitSimilarityQueueIdle()

    expect(mockMeiliSearch).toHaveBeenCalledTimes(6)
    expect(maxInFlight).toBe(2)
  })
})
