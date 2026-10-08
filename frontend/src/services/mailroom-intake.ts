import api from './api';
import type { Item } from '../pages/mailroom/model';
export type IntakePage = { items: Item[]; total: number; page: number; limit: number; scope: 'company' | 'mine' };
export const mailroomIntake = {
  async queue(entityId: string, page: number, search: string) {
    return (await api.get<IntakePage>('/mailroom/intake-queue', { params: { entityId, page, search } })).data;
  },
  async item(entityId: string, itemId: string) {
    return (await api.get<Item>('/mailroom/items/' + encodeURIComponent(itemId), { params: { entityId } })).data;
  },
  async command(itemId: string, data: Record<string, unknown>) {
    await api.post('/mailroom/items/' + encodeURIComponent(itemId) + '/actions', data);
  },
};
