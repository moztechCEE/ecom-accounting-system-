import {
  BadGatewayException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  labelCustomer,
  labelOrigin,
  labelQrLink,
  type LabelItem,
} from './mailroom-label.contract';

const item: LabelItem = {
  id: '8c9bba2e-6fe7-4602-bf29-7df4a932ee6c',
  entityId: 'company',
  label: 'MR-1',
  productName: '產品',
  version: 1,
  receiptId: 'receipt',
  receipt: {
    entityId: 'company',
    category: 'REPAIR',
    sourceCaseId: 'source',
    sourceNumber: 'CASE-1',
  },
};
describe('mailroom label contract', () => {
  it('uses only configured trusted origin and has no production fallback', () => {
    expect(() => labelOrigin({})).toThrow(ServiceUnavailableException);
    expect(
      labelOrigin({ ERP_PUBLIC_FRONTEND_URL: 'https://dev.example.test/' }),
    ).toBe('https://dev.example.test');
    expect(
      labelOrigin({ FRONTEND_PUBLIC_URL: 'https://dev.example.test' }),
    ).toBe('https://dev.example.test');
    expect(labelOrigin({ FRONTEND_URL: 'https://dev.example.test' })).toBe(
      'https://dev.example.test',
    );
  });
  it.each([
    'https://dev.example.test/path',
    'https://user:pass@dev.example.test',
    'https://dev.example.test/?origin=other',
    'https://dev.example.test/#x',
    '//dev.example.test',
    'http://dev.example.test',
    'javascript:alert(1)',
    ' https://dev.example.test',
  ])('rejects unsafe configured origin %s', (configured) => {
    expect(() => labelOrigin({ ERP_PUBLIC_FRONTEND_URL: configured })).toThrow(
      ServiceUnavailableException,
    );
  });
  it('permits local HTTP only with explicit existing local-development policy', () => {
    expect(() =>
      labelOrigin({ ERP_PUBLIC_FRONTEND_URL: 'http://localhost:1234' }),
    ).toThrow();
    expect(
      labelOrigin({
        ERP_PUBLIC_FRONTEND_URL: 'http://localhost:1234',
        MAILROOM_ALLOW_LOCAL: 'true',
      }),
    ).toBe('http://localhost:1234');
  });
  it('keeps QR identities separate for two same-case physical items and excludes PII', () => {
    const first = labelQrLink('https://dev.example.test', item);
    const second = labelQrLink('https://dev.example.test', {
      ...item,
      id: '7eb7d3e2-034f-438d-9194-e7c0d03ec508',
    });
    expect(first).not.toBe(second);
    const url = new URL(first);
    expect([...url.searchParams.keys()]).toEqual([
      'entityId',
      'itemId',
      'queue',
    ]);
    expect(url.searchParams.get('itemId')).toBe(item.id);
  });
  it.each([
    ['array response', []],
    ['object name', { customerLabel: {} }],
    ['array phone', { customerPhone: [] }],
    ['oversized issue', { customerIssue: '問'.repeat(1024 * 1024 + 1) }],
  ])(
    'rejects malformed or oversized Source contact/issue: %s',
    (_name, invalid) => {
      const source = Array.isArray(invalid)
        ? invalid
        : { id: 'source', type: 'REPAIR', ...invalid };
      expect(() => labelCustomer(source, item)).toThrow(BadGatewayException);
    },
  );
  it('preserves long original customer text including Unicode, whitespace and newlines', () => {
    const issue =
      '  顧客原文\r\n第二行 <不是HTML> & 😀\t' +
      '多行文字😀\n'.repeat(4000) +
      '  ';
    expect(
      labelCustomer(
        { id: 'source', type: 'REPAIR', customerIssue: issue },
        item,
      ).customerIssue,
    ).toBe(issue);
    expect(
      labelCustomer(
        {
          id: 'source',
          type: 'REPAIR',
          customerLabel: '合成\n顧客',
          customerIssue: null,
        },
        item,
      ),
    ).toMatchObject({
      customerName: '合成 顧客',
      customerPhone: null,
      customerIssue: null,
    });
    expect(
      labelCustomer(
        { id: 'source', type: 'REPAIR', customerIssue: '第一行\n第二行' },
        item,
      ).customerIssue,
    ).toBe('第一行\n第二行');
  });
});
