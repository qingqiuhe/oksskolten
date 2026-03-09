/**
 * Renders pre-sanitized HTML via dangerouslySetInnerHTML.
 *
 * Use this instead of raw dangerouslySetInnerHTML to make sanitized HTML
 * rendering explicit and easy to audit. The caller is responsible for
 * sanitizing the HTML (e.g. via sanitizeHtml from lib/sanitize).
 */
interface SanitizedHTMLProps {
  html: string
  className?: string
  as?: 'div' | 'span'
}

export function SanitizedHTML({ html, className, as: Tag = 'div' }: SanitizedHTMLProps) {
  return <Tag className={className} dangerouslySetInnerHTML={{ __html: html }} />
}
