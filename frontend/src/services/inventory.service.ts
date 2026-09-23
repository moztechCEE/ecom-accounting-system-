import api from './api'

export const inventoryService = {
  async getWarehouses(entityId: string) {
    const response = await api.get('/inventory/warehouses', { params: { entityId } })
    return response.data
  },

  async importErpInventory(file: File, options: { entityId: string; sheet?: string; dryRun?: boolean; force?: boolean }) {
    const formData = new FormData()
    formData.append('file', file)

    const response = await api.post('/inventory/import/erp', formData, {
      params: {
        entityId: options.entityId,
        sheet: options?.sheet,
        dryRun: options?.dryRun ? 'true' : undefined,
        force: options?.force ? 'true' : undefined,
      },
      headers: { 'Content-Type': 'multipart/form-data' }
    })
    return response.data
  }
}
