import {
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ExpenseReceiptService } from './expense-receipt.service';
import { parseReceiptFile, parseReceiptFiles } from './receipt-files';

const file = {
  name: 'test-receipt.pdf',
  mimeType: 'application/pdf',
  url: `data:application/pdf;base64,${Buffer.from('%PDF-1.4 synthetic test document').toString('base64')}`,
};
describe('Receipt recognition boundaries', () => {
  const prisma = {
    user: { findUnique: jest.fn() },
    expenseRequest: { count: jest.fn() },
  };
  const config = { get: jest.fn() };
  const ai = {
    getStatus: jest.fn((): { available: boolean; reason?: string } => ({
      available: true,
    })),
    resolveModelId: () => 'gemini-2.5-flash',
    parseJsonOutput: JSON.parse,
  };
  const expenses = {
    getReimbursementItems: jest.fn(),
    assertEntityAccess: jest.fn(),
  };
  let service: ExpenseReceiptService;
  const fetchOriginal = global.fetch;
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.user.findUnique.mockResolvedValue({
      isActive: true,
      employee: { entityId: 'company-a', departmentId: 'dept' },
      entityMemberships: [],
      roles: [{ role: { code: 'EMPLOYEE' } }],
    });
    prisma.expenseRequest.count.mockResolvedValue(0);
    config.get.mockReturnValue('test-key');
    expenses.getReimbursementItems.mockResolvedValue([
      { id: 'allowed-item', name: '文具', description: '' },
    ]);
    expenses.assertEntityAccess.mockImplementation(
      async (_userId, entityId) => {
        const user = await prisma.user.findUnique();
        if (!user?.isActive || entityId !== 'company-a')
          throw new ForbiddenException();
        return {
          user,
          roles: ['EMPLOYEE'],
          admin: false,
          permissions: ['expense_self:read', 'expense_self:create'],
        };
      },
    );
    service = new ExpenseReceiptService(
      prisma as never,
      config as never,
      ai as never,
      expenses as never,
    );
    global.fetch = jest.fn();
  });
  afterAll(() => {
    global.fetch = fetchOriginal;
  });
  const recognize = () =>
    service.recognize('employee', { entityId: 'company-a', files: [file] });
  const provider = (value: unknown) =>
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] } }],
      }),
    });

  it('rejects remote URLs and falsified MIME signatures without fetching', () => {
    expect(() =>
      parseReceiptFile({ ...file, url: 'https://internal/secret' }),
    ).toThrow(BadRequestException);
    expect(() => parseReceiptFile({ ...file, mimeType: 'image/png' })).toThrow(
      BadRequestException,
    );
    expect(() =>
      parseReceiptFile({
        ...file,
        url: 'data:application/pdf;base64,YWJjZA==',
      }),
    ).toThrow(BadRequestException);
    expect(global.fetch).not.toHaveBeenCalled();
  });
  it('enforces the same total size limit when submitting manually without recognition', () => {
    const bytes = Buffer.alloc(4 * 1024 * 1024);
    bytes.write('%PDF-');
    const large = {
      ...file,
      url: `data:application/pdf;base64,${bytes.toString('base64')}`,
    };
    expect(() => parseReceiptFiles([large, large, large])).toThrow(
      '憑證總大小上限 10 MB',
    );
    expect(() => parseReceiptFiles(Array(6).fill(file))).toThrow('每次最多 5');
  });
  it('does not send attachments from a sandbox even when an AI key exists', async () => {
    ai.getStatus.mockReturnValueOnce({
      available: false,
      reason: 'sandbox_disabled',
    });
    await expect(recognize()).rejects.toThrow('此測試環境尚未開放 AI 連線');
    expect(global.fetch).not.toHaveBeenCalled();
  });
  it('denies cross-company and inactive users before model access', async () => {
    await expect(
      service.recognize('employee', { entityId: 'company-b', files: [file] }),
    ).rejects.toThrow(ForbiddenException);
    prisma.user.findUnique.mockResolvedValue({ isActive: false, roles: [] });
    await expect(recognize()).rejects.toThrow(ForbiddenException);
    expect(global.fetch).not.toHaveBeenCalled();
  });
  it('reuses expense feature authorization before sending any attachment to AI', async () => {
    expenses.assertEntityAccess.mockRejectedValueOnce(
      new ForbiddenException('No expense permission'),
    );
    await expect(recognize()).rejects.toThrow(ForbiddenException);
    expect(global.fetch).not.toHaveBeenCalled();
  });
  it('reports unavailable configuration or provider failure without returning fake recognition', async () => {
    config.get.mockReturnValueOnce('');
    await expect(recognize()).rejects.toThrow(ServiceUnavailableException);
    (global.fetch as jest.Mock).mockRejectedValue(
      new Error('secret upstream detail'),
    );
    await expect(recognize()).rejects.toThrow('AI 憑證辨識暫時無法使用');
  });
  it('returns typed suggestions and only an existing eligible expense item', async () => {
    provider({
      transactionCount: 1,
      amountOriginal: 123.5,
      currency: 'TWD',
      expenseDate: '2026-02-30',
      suggestedItemId: 'foreign-item',
      confidence: 0.9,
      invoiceNo: 'AB12345678',
    });
    const result = await recognize();
    expect(result.status).toBe('needs_confirmation');
    expect(result.fields).toMatchObject({
      amountOriginal: 123.5,
      suggestedItemId: null,
      expenseDate: null,
    });
    expect(result.fingerprints[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(expenses.getReimbursementItems).toHaveBeenCalledWith('company-a', {
      roles: ['EMPLOYEE'],
      departmentId: 'dept',
    });
    expect(
      JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body).contents[0]
        .parts[1].inlineData.mimeType,
    ).toBe('application/pdf');
  });
  it('does not combine distinct transactions or invent missing amounts', async () => {
    provider({
      transactionCount: 2,
      amountOriginal: 999,
      currency: 'USD',
      taxAmount: 3,
      confidence: 0.2,
    });
    const result = await recognize();
    expect(result.fields.amountOriginal).toBeNull();
    expect(result.fields.taxAmount).toBeNull();
    expect(result.warnings.join(' ')).toContain('分開申請');
    expect(result.warnings.join(' ')).toContain('外幣');
  });
  it('warns of duplicate files without exposing other applicants or approving anything', async () => {
    provider({
      transactionCount: 1,
      amountOriginal: 500,
      currency: 'TWD',
      suggestedItemId: 'allowed-item',
      confidence: 0.95,
    });
    prisma.expenseRequest.count.mockResolvedValue(1);
    const result = await service.recognize('employee', {
      entityId: 'company-a',
      files: [file, file],
    });
    expect(result.fingerprints).toHaveLength(1);
    expect(result.possibleDuplicate).toBe(true);
    expect(result.warnings.join()).toContain('重複請款');
    expect(result).not.toHaveProperty('requestId');
  });
});
