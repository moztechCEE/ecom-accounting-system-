export const getAccessControlErrorMessage = (error: unknown): string => {
  if (error && typeof error === 'object') {
    const response = (error as {
      response?: { status?: number; data?: { message?: unknown } }
    }).response
    const message = response?.data?.message
    if (response?.status === 409) {
      if (typeof message === 'string' && /^Email .+ already exists$/.test(message)) {
        return '此電子郵件已有帳號，請至使用者清單查詢或編輯原帳號。'
      }
      return '資料與現有紀錄重複，請確認電子郵件及帳號資料後再試。'
    }
    if (Array.isArray(message)) {
      const details = message.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
      if (details.length) return details.join('；')
    }
    if (typeof message === 'string' && message.trim()) return message
    const fallback = (error as { message?: unknown }).message
    if (typeof fallback === 'string' && fallback.trim()) return fallback
  }
  return '操作失敗，請稍後再試'
}
