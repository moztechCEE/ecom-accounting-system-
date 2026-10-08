/* eslint-disable @typescript-eslint/require-await */
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Actor } from './mailroom.contract';
import { MailroomService } from './mailroom.service';
import { MailroomSyncService } from './mailroom-sync.service';
import { MailroomSourceMediaService } from './mailroom-source-media.service';
import { MailroomSourceMediaController } from './mailroom-source-media.controller';
import type { Response } from 'express';

describe('scoped Source case photos and summary reads', () => {
  const company = 'fixture-company';
  let current: Actor;
  let mailroom: {
    enabled: jest.Mock;
    actor: jest.Mock;
    intakeCustomerService: jest.Mock;
  };
  let sync: {
    cases: jest.Mock;
    caseAttachments: jest.Mock;
    caseAttachmentMedia: jest.Mock;
    sourceSummary: jest.Mock;
  };
  let service: MailroomSourceMediaService;
  const actor = (permissions: string[]): Actor => ({
    id: 'staff',
    name: 'SYNTHETIC staff',
    permissions: new Set(permissions),
    entityIds: [company],
  });
  const csr = [
    'mailroom:review',
    'after_sales_cases:read',
    'after_sales_cases:update',
  ];
  beforeEach(() => {
    current = actor(['mailroom:read']);
    mailroom = {
      enabled: jest.fn(),
      actor: jest.fn(async () => current),
      intakeCustomerService: jest.fn(async () => ({})),
    };
    sync = {
      cases: jest.fn(async () => ({ items: [{ id: 'case', type: 'REPAIR' }] })),
      caseAttachments: jest.fn(async () => ({
        caseId: 'case',
        scope: 'CASE',
        items: [],
      })),
      caseAttachmentMedia: jest.fn(async () => ({
        contents: Buffer.from('synthetic'),
        contentType: 'image/webp',
      })),
      sourceSummary: jest.fn(async () => ({
        complete: true,
        counts: { awaitingCases: 3, awaitingItems: 4, inTransitCases: 1 },
      })),
    };
    service = new MailroomSourceMediaService(
      mailroom as unknown as MailroomService,
      sync as unknown as MailroomSyncService,
    );
  });
  it('mailroom readers need no artificial Employee gate and use selected case IDs only', async () => {
    await expect(
      service.attachments('staff', company, 'case'),
    ).resolves.toEqual({ caseId: 'case', scope: 'CASE', items: [] });
    expect(mailroom.intakeCustomerService).not.toHaveBeenCalled();
    expect(sync.cases).toHaveBeenCalledWith(company, '', 'case');
    expect(sync.caseAttachments).toHaveBeenCalledWith(company, 'case');
    expect(mailroom.actor).toHaveBeenCalledTimes(3);
  });
  it('foreign companies and absent permissions fail before any upstream request', async () => {
    await expect(
      service.media('staff', 'other-company', 'case', 'photo'),
    ).rejects.toThrow(ForbiddenException);
    current = actor([]);
    await expect(service.attachments('staff', company, 'case')).rejects.toThrow(
      ForbiddenException,
    );
    expect(sync.cases).not.toHaveBeenCalled();
    expect(sync.caseAttachmentMedia).not.toHaveBeenCalled();
  });
  it('technician readers cannot fetch return photos or all-company counts', async () => {
    current = actor(['repair_workbench:read']);
    sync.cases.mockResolvedValue({ items: [{ id: 'case', type: 'RETURN' }] });
    await expect(service.attachments('staff', company, 'case')).rejects.toThrow(
      NotFoundException,
    );
    expect(sync.caseAttachments).not.toHaveBeenCalled();
    await expect(service.summary('staff', company)).rejects.toThrow(
      ForbiddenException,
    );
    expect(sync.sourceSummary).not.toHaveBeenCalled();
  });
  it('qualified CSR can read selected return photos after the existing authoritative Employee check', async () => {
    current = actor(csr);
    sync.cases.mockResolvedValue({ items: [{ id: 'case', type: 'RETURN' }] });
    await service.media('staff', company, 'case', 'photo');
    expect(mailroom.intakeCustomerService).toHaveBeenCalledWith(
      'staff',
      company,
    );
    expect(sync.caseAttachmentMedia).toHaveBeenCalledTimes(1);
  });
  it('CSR eligibility fallback catches only Forbidden and retains a freshly granted repair scope', async () => {
    current = actor([...csr, 'repair_workbench:read']);
    mailroom.intakeCustomerService.mockRejectedValue(
      new ForbiddenException('not CSR'),
    );
    await service.attachments('staff', company, 'case');
    expect(sync.caseAttachments).toHaveBeenCalledTimes(1);
    sync.cases.mockResolvedValue({ items: [{ id: 'case', type: 'RETURN' }] });
    await expect(service.attachments('staff', company, 'case')).rejects.toThrow(
      NotFoundException,
    );
    mailroom.intakeCustomerService.mockRejectedValue(
      new Error('database unavailable'),
    );
    await expect(service.attachments('staff', company, 'case')).rejects.toThrow(
      'database unavailable',
    );
    expect(sync.caseAttachments).toHaveBeenCalledTimes(1);
  });
  it('a grant revoked while the selected case request waits blocks photo fetching', async () => {
    sync.cases.mockImplementation(async () => {
      current = actor([]);
      return { items: [{ id: 'case', type: 'REPAIR' }] };
    });
    await expect(
      service.media('staff', company, 'case', 'photo'),
    ).rejects.toThrow(ForbiddenException);
    expect(sync.caseAttachmentMedia).not.toHaveBeenCalled();
  });
  it('a grant or company revoked during image fetch prevents returning buffered bytes', async () => {
    sync.caseAttachmentMedia.mockImplementation(async () => {
      current = { ...actor(['mailroom:read']), entityIds: ['other-company'] };
      return { contents: Buffer.from('synthetic'), contentType: 'image/webp' };
    });
    await expect(
      service.media('staff', company, 'case', 'photo'),
    ).rejects.toThrow(ForbiddenException);
  });
  it('CSR to technician downgrade during metadata read cannot reveal return case photos', async () => {
    current = actor(csr);
    sync.cases.mockResolvedValue({ items: [{ id: 'case', type: 'RETURN' }] });
    sync.caseAttachments.mockImplementation(async () => {
      current = actor(['repair_workbench:read']);
      return { caseId: 'case', items: [] };
    });
    await expect(service.attachments('staff', company, 'case')).rejects.toThrow(
      NotFoundException,
    );
  });
  it('summary rechecks current full scope after the upstream count request', async () => {
    await expect(service.summary('staff', company)).resolves.toHaveProperty(
      'complete',
      true,
    );
    sync.sourceSummary.mockImplementation(async () => {
      current = actor(['repair_workbench:read']);
      return { complete: false, counts: null };
    });
    await expect(service.summary('staff', company)).rejects.toThrow(
      ForbiddenException,
    );
  });
  it('unknown selected case never fetches attachment metadata', async () => {
    sync.cases.mockResolvedValue({
      items: [{ id: 'different', type: 'REPAIR' }],
    });
    await expect(service.attachments('staff', company, 'case')).rejects.toThrow(
      NotFoundException,
    );
    expect(sync.caseAttachments).not.toHaveBeenCalled();
  });
  it('controller marks every new read private before service responses and errors', async () => {
    const controller = new MailroomSourceMediaController(service);
    const responseMock = { setHeader: jest.fn(), send: jest.fn() };
    const response = responseMock as unknown as Response;
    await controller.summary(
      { user: { id: 'staff' } },
      { entityId: company },
      response,
    );
    expect(responseMock.setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'private, no-store',
    );
    await controller.media(
      { user: { id: 'staff' } },
      { entityId: company },
      'case',
      'photo',
      response,
    );
    expect(responseMock.setHeader).toHaveBeenCalledWith(
      'X-Content-Type-Options',
      'nosniff',
    );
    expect(responseMock.send).toHaveBeenCalledWith(Buffer.from('synthetic'));
    current = actor([]);
    await expect(
      controller.attachments(
        { user: { id: 'staff' } },
        { entityId: company },
        'case',
        response,
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(responseMock.setHeader).toHaveBeenCalledTimes(5);
  });
});
