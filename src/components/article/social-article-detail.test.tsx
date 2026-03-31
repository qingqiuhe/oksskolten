import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { LocaleContext } from '../../lib/i18n'
import type { ArticleDetail } from '../../../shared/types'
import { SocialArticleDetail } from './social-article-detail'
import { TooltipProvider } from '../ui/tooltip'

const baseArticle: ArticleDetail = {
  id: 1,
  feed_id: 2,
  feed_name: 'Example Author',
  feed_icon_url: 'https://cdn.example.com/avatar.png',
  feed_view_type: 'social',
  title: 'Quoted tweet title',
  url: 'https://x.com/example/status/123',
  article_kind: 'quote',
  published_at: '2026-03-30T00:00:00.000Z',
  lang: 'en',
  summary: null,
  excerpt: 'Quoted tweet excerpt',
  og_image: null,
  has_video: false,
  seen_at: null,
  read_at: null,
  bookmarked_at: null,
  liked_at: null,
  full_text: 'Body',
  full_text_translated: null,
  translated_lang: null,
  images_archived_at: null,
  feed_type: 'rss',
  imageArchivingEnabled: false,
  similar_count: 0,
}

describe('SocialArticleDetail', () => {
  it('renders X-native header and quoted content block', () => {
    const { getAllByText, getByText, container } = render(
      <MemoryRouter>
        <LocaleContext.Provider value={{ locale: 'en', setLocale: () => {} }}>
          <TooltipProvider>
            <SocialArticleDetail
              articleRef={{ current: null }}
              article={baseArticle}
              locale="en"
              displayTitle="Quoted tweet title"
              displayContent="<p>Hello world</p><blockquote><p>Quoted context</p></blockquote>"
              viewMode="original"
              isUserLang={true}
              hasTranslation={false}
              translating={false}
              translatingText=""
              translatingHtml=""
              summary={null}
              summarizing={false}
              streamingText=""
              summaryHtml=""
              streamingHtml=""
              summarizeError={null}
              metricsText={null}
              translateError={null}
              chatPosition="inline"
              chatOpen={false}
              onChatToggle={vi.fn()}
              onTranslate={vi.fn()}
              onToggleViewMode={vi.fn()}
              onSummarize={vi.fn()}
              isBookmarked={false}
              isLiked={false}
              archivingImages={false}
              onToggleBookmark={vi.fn()}
              onToggleLike={vi.fn()}
              onArchiveImages={vi.fn()}
              onDelete={vi.fn()}
              onCloseChat={vi.fn()}
            />
          </TooltipProvider>
        </LocaleContext.Provider>
      </MemoryRouter>,
    )

    expect(getAllByText('Example Author').length).toBeGreaterThan(0)
    expect(getByText('@example')).toBeTruthy()
    expect(getByText('View on X')).toBeTruthy()
    expect(getByText('Quoted post')).toBeTruthy()
    expect(getByText('Quoted context')).toBeTruthy()
    expect(container.querySelector('.social-content')).not.toBeNull()
  })
})
