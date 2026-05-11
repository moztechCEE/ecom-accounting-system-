import api from './api'

export type Entity = {
  id: string
  loginCode: string
  name: string
  country?: string
  baseCurrency?: string
  isActive?: boolean
  taxId?: string
  address?: string
  contactEmail?: string
  contactPhone?: string
}

export type EntityPayload = {
  loginCode: string
  name: string
  country: string
  baseCurrency: string
  taxId?: string
  address?: string
  contactEmail?: string
  contactPhone?: string
  isActive?: boolean
  adminName?: string
  adminEmail?: string
  adminEmployeeNo?: string
  adminPassword?: string
}

export async function listEntities(params?: { isActive?: boolean }): Promise<Entity[]> {
  const query = new URLSearchParams()
  if (params?.isActive !== undefined) {
    query.append('isActive', String(params.isActive))
  }

  const url = query.toString() ? `/entities?${query.toString()}` : '/entities'
  const response = await api.get<Entity[]>(url)
  return response.data
}

export async function createEntity(data: EntityPayload): Promise<Entity> {
  const response = await api.post<Entity>('/entities', data)
  return response.data
}

export async function updateEntity(id: string, data: Partial<EntityPayload>): Promise<Entity> {
  const response = await api.put<Entity>(`/entities/${id}`, data)
  return response.data
}

export async function deactivateEntity(id: string): Promise<Entity> {
  const response = await api.delete<Entity>(`/entities/${id}`)
  return response.data
}

let cachedDefaultEntityId: string | null = null
let inFlightDefault: Promise<string> | null = null

/**
 * Resolves an entityId using the following precedence:
 * 1) explicit argument
 * 2) localStorage('entityId')
 * 3) runtime/default env entity id
 * 4) first active entity from GET /entities
 */
export async function resolveEntityId(explicitEntityId?: string): Promise<string> {
  const explicit = explicitEntityId?.trim()
  if (explicit) return explicit

  const stored = localStorage.getItem('entityId')?.trim()
  if (stored) return stored

  const env =
    window.__APP_CONFIG__?.defaultEntityId?.trim() ||
    import.meta.env.VITE_DEFAULT_ENTITY_ID?.trim()
  if (env) return env

  if (cachedDefaultEntityId) return cachedDefaultEntityId

  if (!inFlightDefault) {
    inFlightDefault = (async () => {
      const entities = await listEntities({ isActive: true })
      const first = entities?.[0]?.id?.trim()
      if (!first) {
        throw new Error('找不到可用的公司實體（entities）。請先在後端建立/seed Entity，再重試。')
      }
      cachedDefaultEntityId = first
      localStorage.setItem('entityId', first)
      return first
    })().finally(() => {
      inFlightDefault = null
    })
  }

  return inFlightDefault
}
