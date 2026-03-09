import { useEscapeKey } from '../../hooks/use-escape-key'

interface ImageLightboxProps {
  src: string | null
  onClose: () => void
}

export function ImageLightbox({ src, onClose }: ImageLightboxProps) {
  useEscapeKey(onClose)

  if (!src) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 cursor-zoom-out animate-[fade-in_150ms_ease] overscroll-contain touch-none"
      onClick={onClose}
    >
      <img
        src={src}
        className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        alt=""
      />
    </div>
  )
}
