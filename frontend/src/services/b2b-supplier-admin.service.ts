import api from './api'

export interface SupplierAccount {
  id: string
  vendorId: string | null
  vendorName: string
  email: string
  name: string
  isActive: boolean
  createdAt: string
}

export interface SupplierAccountSetup {
  accounts: SupplierAccount[]
  vendors: Array<{ id: string; name: string }>
}

const path = '/b2b/purchasing/supplier-accounts'

export const b2bSupplierAdminService = {
  async list(entityId: string): Promise<SupplierAccountSetup> {
    const { data } = await api.get<SupplierAccountSetup>(path, { params: { entityId } })
    return data
  },
  async create(input: { entityId: string; vendorId: string; email: string; name: string; password: string }): Promise<void> {
    await api.post(path, input)
  },
  async update(id: string, input: { entityId: string; isActive: boolean; password?: string }): Promise<void> {
    await api.patch(`${path}/${encodeURIComponent(id)}`, input)
  },
}
