import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { ArticleDetail } from './article-detail'

interface ArticleOverlayProps {
  articleUrl: string | null
  onClose: () => void
}

export function ArticleOverlay({ articleUrl, onClose }: ArticleOverlayProps) {
  return (
    <DialogPrimitive.Root open={!!articleUrl} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[70] bg-overlay data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 duration-300" />
        <DialogPrimitive.Content
          className="fixed inset-y-0 right-0 z-[70] w-full md:w-2/3 bg-bg shadow-2xl overflow-y-auto overscroll-contain data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right duration-300"
          aria-describedby={undefined}
        >
          <DialogPrimitive.Title className="sr-only">Article</DialogPrimitive.Title>
          {/* Close button */}
          <div className="sticky top-0 z-10 flex items-center h-12 px-4 bg-bg/80 backdrop-blur-sm border-b border-border">
            <button
              onClick={onClose}
              className="flex items-center justify-center w-8 h-8 rounded-full hover:bg-hover transition-colors"
              aria-label="Close"
            >
              <X className="w-5 h-5 text-muted" />
            </button>
          </div>
          {articleUrl && <ArticleDetail articleUrl={articleUrl} />}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
