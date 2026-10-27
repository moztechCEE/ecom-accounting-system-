import api from './api';
import type { PrecheckBinding, PrecheckRead, PrecheckValues, PrecheckHandoff, PrecheckHandoffResult, PrecheckSupplementInput } from '../pages/mailroom/initial-inspection-model';
export type PrecheckStart = { entityId: string; requestId: string; items: { itemId: string; requestId: string; expectedVersion: number }[] };
export type PrecheckSave = Omit<PrecheckValues, 'warrantyReview' | 'mailroomIssue'> & PrecheckSupplementInput & { entityId: string; requestId: string; expectedVersion: number; expectedRevision: number; status: 'DRAFT' | 'READY'; templateBinding: PrecheckBinding | null };
export const mailroomReceiving = {
  async item(entityId: string, itemId: string) { return (await api.get<PrecheckRead>('/mailroom/prechecks/items/' + encodeURIComponent(itemId), { params: { entityId } })).data; },
  async start(body: PrecheckStart) { return (await api.post('/mailroom/prechecks/start', body)).data; },
  async handoff(body: PrecheckHandoff) { return (await api.post<PrecheckHandoffResult>('/mailroom/prechecks/handoff', body)).data; },
  async save(itemId: string, body: PrecheckSave) { return (await api.post<PrecheckRead>('/mailroom/prechecks/items/' + encodeURIComponent(itemId) + '/save', body)).data; },
};
