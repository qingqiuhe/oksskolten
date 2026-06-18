import { getDb, getNamed } from './connection.js'
import type { Category } from './types.js'
import { syncArticleFiltersToSearch } from '../search/sync.js'
import { getCurrentUserId } from '../identity.js'

function resolveUserId(userId?: number | null): number | null {
  return userId ?? getCurrentUserId()
}

export function getCategories(userId?: number | null): Category[] {
  const scopedUserId = resolveUserId(userId)
  if (scopedUserId == null) {
    return getDb().prepare('SELECT * FROM categories ORDER BY sort_order ASC, name COLLATE NOCASE ASC').all() as Category[]
  }
  return getDb().prepare(`
    SELECT *
    FROM categories
    WHERE user_id = ?
    ORDER BY sort_order ASC, name COLLATE NOCASE ASC
  `).all(scopedUserId) as Category[]
}

export function getCategoryById(id: number, userId?: number | null): Category | undefined {
  const scopedUserId = resolveUserId(userId)
  if (scopedUserId == null) {
    return getDb().prepare('SELECT * FROM categories WHERE id = ?').get(id) as Category | undefined
  }
  return getDb().prepare('SELECT * FROM categories WHERE id = ? AND user_id = ?').get(id, scopedUserId) as Category | undefined
}

export function createCategory(name: string, userId?: number | null): Category {
  const scopedUserId = resolveUserId(userId)
  const maxOrder = scopedUserId == null
    ? getDb().prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM categories').get() as { next: number }
    : getDb().prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM categories WHERE user_id = ?').get(scopedUserId) as { next: number }
  return getDb().prepare('INSERT INTO categories (user_id, name, sort_order) VALUES (?, ?, ?) RETURNING *').get(scopedUserId, name, maxOrder.next) as Category
}

export function updateCategory(
  id: number,
  data: { name?: string; sort_order?: number; collapsed?: number },
  userId?: number | null,
): Category | undefined {
  const fields: string[] = []
  const params: Record<string, unknown> = { id }

  if (data.name !== undefined) {
    fields.push('name = @name')
    params.name = data.name
  }
  if (data.sort_order !== undefined) {
    fields.push('sort_order = @sort_order')
    params.sort_order = data.sort_order
  }
  if (data.collapsed !== undefined) {
    fields.push('collapsed = @collapsed')
    params.collapsed = data.collapsed
  }

  if (fields.length === 0) return getCategoryById(id, userId)

  const scopedUserId = resolveUserId(userId)
  if (scopedUserId != null) {
    params.user_id = scopedUserId
    return getNamed<Category>(`UPDATE categories SET ${fields.join(', ')} WHERE id = @id AND user_id = @user_id RETURNING *`, params)
  }
  return getNamed<Category>(`UPDATE categories SET ${fields.join(', ')} WHERE id = @id RETURNING *`, params)
}

export function deleteCategory(id: number, userId?: number | null): boolean {
  const scopedUserId = resolveUserId(userId)
  const result = scopedUserId == null
    ? getDb().prepare('DELETE FROM categories WHERE id = ?').run(id)
    : getDb().prepare('DELETE FROM categories WHERE id = ? AND user_id = ?').run(id, scopedUserId)
  return result.changes > 0
}

export function markAllSeenByCategory(categoryId: number, userId?: number | null): { updated: number } {
  const scopedUserId = resolveUserId(userId)
  const updatedRows = (scopedUserId == null
    ? getDb().prepare(`
      UPDATE articles
      SET seen_at = datetime('now')
      WHERE seen_at IS NULL
        AND purged_at IS NULL
        AND category_id = ?
      RETURNING id
    `).all(categoryId)
    : getDb().prepare(`
      UPDATE articles
      SET seen_at = datetime('now')
      WHERE seen_at IS NULL
        AND purged_at IS NULL
        AND category_id = ?
        AND user_id = ?
      RETURNING id
    `).all(categoryId, scopedUserId)
  ) as { id: number }[]
  if (updatedRows.length > 0) {
    syncArticleFiltersToSearch(updatedRows.map(row => ({ id: row.id, is_unread: false })))
  }
  return { updated: updatedRows.length }
}
