import { PurchaseB2bQueueService } from './purchase-b2b-queue.service';

describe('purchasing B2B shortage queue', () => {
  it('scopes the projection to one company and excludes customer prices and credentials', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 'request-a',
        requestNumber: 'B2B-001',
        createdAt: new Date('2026-09-24T00:00:00Z'),
        items: [
          { id: 'line-a', sku: 'SKU-A', name: 'Item A', quantity: 5, confirmedQuantity: 2, unitPrice: '999' },
          { id: 'line-b', sku: 'SKU-B', name: 'Item B', quantity: 1, confirmedQuantity: 1 },
        ],
      },
      {
        id: 'request-b',
        requestNumber: 'B2B-002',
        createdAt: new Date('2026-09-24T00:00:00Z'),
        items: [{ id: 'line-c', sku: 'SKU-C', name: 'Item C', quantity: 1, confirmedQuantity: null }],
      },
    ]);
    const service = new PurchaseB2bQueueService({ b2bPurchaseRequest: { findMany } } as any);

    const result = await service.shortages('entity-a');

    expect(findMany).toHaveBeenCalledWith({
      where: { entityId: 'entity-a', status: 'needs_adjustment' },
      select: {
        id: true,
        requestNumber: true,
        createdAt: true,
        items: {
          select: { id: true, sku: true, name: true, quantity: true, confirmedQuantity: true },
          orderBy: { sortOrder: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(result.items).toEqual([{
      id: 'request-a',
      requestNumber: 'B2B-001',
      createdAt: new Date('2026-09-24T00:00:00Z'),
      items: [{ requestItemId: 'line-a', sku: 'SKU-A', name: 'Item A', requested: 5, confirmed: 2, shortage: 3 }],
    }]);
    expect(JSON.stringify(result)).not.toContain('999');
  });
});
