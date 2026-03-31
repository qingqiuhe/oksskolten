import { Skeleton } from '../ui/skeleton'
import { SanitizedHTML } from '../ui/sanitized-html'

interface ArticleContentBodyProps {
  translating: boolean
  translatingText: string
  translatingHtml: string
  displayContent: string
  className?: string
}

export function ArticleContentBody({
  translating,
  translatingText,
  translatingHtml,
  displayContent,
  className = 'prose article-rendered-content transition-opacity duration-150',
}: ArticleContentBodyProps) {
  if (translating && translatingText) {
    return <SanitizedHTML html={translatingHtml} className={className} />
  }

  if (translating) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-4" />
        <Skeleton className="h-4" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    )
  }

  return <SanitizedHTML html={displayContent} className={className} />
}
