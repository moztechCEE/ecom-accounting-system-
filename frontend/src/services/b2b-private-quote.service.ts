import axios from 'axios'
import { API_URL } from './api'
import type { B2BFormalQuote } from './b2b.service'

// This client intentionally has no employee or customer-session interceptor.
// The one-time credential is sent in the POST body, never in a URL.
const publicApi = axios.create({
  baseURL: API_URL,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
})

function verifiedQuote(data: B2BFormalQuote): B2BFormalQuote {
  if (!data || !Array.isArray(data.items) || typeof data.quotationNo !== 'string' ||
      !['sent', 'accepted'].includes(data.status)) throw new Error('私密報價資料格式不正確')
  return data
}

export const b2bPrivateQuoteService = {
  async preview(token: string): Promise<B2BFormalQuote> {
    const { data } = await publicApi.post<B2BFormalQuote>('/b2b/public/quote-access/preview', { token })
    return verifiedQuote(data)
  },
  async accept(token: string): Promise<B2BFormalQuote> {
    const { data } = await publicApi.post<B2BFormalQuote>('/b2b/public/quote-access/accept', { token })
    return verifiedQuote(data)
  },
}
