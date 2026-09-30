import api from './api'

export type PerformanceCycle = {
  id: string
  entityId: string
  title: string
  periodStart: string
  periodEnd: string
  createdAt: string
  _count?: { reviews: number }
}

export type PerformanceEmployee = {
  id: string
  employeeNo: string
  name: string
  department?: { id: string; name: string } | null
  supervisorEmployeeId?: string | null
}

export type PerformanceReview = {
  id: string
  cycleId: string
  subjectEmployeeId: string
  reviewerEmployeeId: string
  status: 'DRAFT' | 'SUBMITTED'
  score: number | null
  goals: string | null
  comment: string | null
  submittedAt: string | null
  createdAt: string
  updatedAt: string
  cycle: PerformanceCycle
  subject: PerformanceEmployee
  reviewer: PerformanceEmployee
}

export const performanceService = {
  async cycles(entityId?: string): Promise<PerformanceCycle[]> {
    const { data } = await api.get('/performance/cycles', { params: entityId ? { entityId } : undefined })
    return data
  },
  async createCycle(payload: { entityId: string; title: string; periodStart: string; periodEnd: string }): Promise<PerformanceCycle> {
    const { data } = await api.post('/performance/cycles', payload)
    return data
  },
  async roster(entityId: string): Promise<PerformanceEmployee[]> {
    const { data } = await api.get('/performance/roster', { params: { entityId } })
    return data
  },
  async assignReview(cycleId: string, subjectEmployeeId: string, reviewerEmployeeId?: string): Promise<PerformanceReview> {
    const { data } = await api.post(`/performance/cycles/${cycleId}/reviews`, { subjectEmployeeId, reviewerEmployeeId })
    return data
  },
  async reviews(cycleId?: string, entityId?: string): Promise<PerformanceReview[]> {
    const { data } = await api.get('/performance/reviews', { params: { cycleId, entityId } })
    return data
  },
  async updateReview(id: string, payload: { score: number | null; goals: string | null; comment: string | null }): Promise<PerformanceReview> {
    const { data } = await api.patch(`/performance/reviews/${id}`, payload)
    return data
  },
  async submitReview(id: string): Promise<PerformanceReview> {
    const { data } = await api.post(`/performance/reviews/${id}/submit`)
    return data
  },
}
