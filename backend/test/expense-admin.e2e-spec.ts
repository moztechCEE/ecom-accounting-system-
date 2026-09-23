import { Test, TestingModule } from '@nestjs/testing';
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  INestApplication,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import request from 'supertest';
import { ExpenseController } from '../src/modules/expense/expense.controller';
import { ExpenseService } from '../src/modules/expense/expense.service';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard';
import { RolesGuard } from '../src/common/guards/roles.guard';
import { ROLES_KEY } from '../src/common/decorators/roles.decorator';

class TestingRolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles?.length) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();
    if (!user?.roles?.length) {
      throw new ForbiddenException('User not authenticated');
    }

    const hasRole = user.roles.some((role: string) => requiredRoles.includes(role));
    if (!hasRole) {
      throw new ForbiddenException('User does not have required roles');
    }

    return true;
  }
}

describe('Expense Admin Routes (e2e)', () => {
  let app: INestApplication;
  let currentUser: any;
  const expenseService = {
    listReimbursementItemsAdmin: jest.fn(),
    createReimbursementItemAdmin: jest.fn(),
    updateReimbursementItemAdmin: jest.fn(),
    archiveReimbursementItemAdmin: jest.fn(),
    listApprovalPolicies: jest.fn(),
    getReimbursementItemAdmin: jest.fn(),
    getReimbursementItems: jest.fn(),
    getExpenseRequests: jest.fn(),
    previewLegacyApprovalRoute: jest.fn(),
    assignLegacyApprovalRoute: jest.fn(),
  } as unknown as ExpenseService;

  beforeAll(async () => {
    const jwtGuardStub: CanActivate = {
      canActivate: (context: ExecutionContext) => {
        const request = context.switchToHttp().getRequest();
        request.user = currentUser;
        return true;
      },
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [ExpenseController],
      providers: [
        {
          provide: ExpenseService,
          useValue: expenseService,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(jwtGuardStub)
      .overrideGuard(RolesGuard)
      .useValue(new TestingRolesGuard(new Reflector()))
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    currentUser = { id: 'admin-1', roles: ['SUPER_ADMIN'] };
    jest.clearAllMocks();
  });

  it('allows SUPER_ADMIN to list reimbursement items', async () => {
    const mockItems = [
      {
        id: 'item-1',
        entityId: 'tw-entity-001',
        name: '交通補貼',
        accountId: 'acct-1',
        isActive: true,
      },
    ];
    (expenseService.listReimbursementItemsAdmin as jest.Mock).mockResolvedValue(
      mockItems,
    );

    await request(app.getHttpServer())
      .get('/expense/admin/reimbursement-items')
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual(mockItems);
      });

    expect(expenseService.listReimbursementItemsAdmin).toHaveBeenCalledWith(
      undefined,
      false,
    );
  });

  it('rejects non-admin users when accessing admin routes', async () => {
    currentUser = { id: 'staff-1', roles: ['ACCOUNTANT'] };

    await request(app.getHttpServer())
      .get('/expense/admin/reimbursement-items')
      .expect(403);
  });

  it('blocks accountants from previewing or assigning legacy approval routes', async () => {
    currentUser = { id: 'accountant-1', roles: ['ACCOUNTANT'] };
    await request(app.getHttpServer()).get('/expense/requests/legacy-1/legacy-approval-route').expect(403);
    await request(app.getHttpServer()).put('/expense/requests/legacy-1/legacy-approval-route').send({}).expect(403);
    expect(expenseService.previewLegacyApprovalRoute).not.toHaveBeenCalled();
    expect(expenseService.assignLegacyApprovalRoute).not.toHaveBeenCalled();
  });

  it('passes the authenticated administrator and confirmed preview to legacy assignment', async () => {
    currentUser = { id: 'admin-1', roles: ['ADMIN'] };
    const confirmation = { expectedUpdatedAt: '2026-09-23T00:00:00.000Z', routeToken: 'a'.repeat(64) };
    (expenseService.previewLegacyApprovalRoute as jest.Mock).mockResolvedValue({ requestId: 'legacy-1', ...confirmation });
    (expenseService.assignLegacyApprovalRoute as jest.Mock).mockResolvedValue({ id: 'legacy-1', status: 'pending' });
    await request(app.getHttpServer()).get('/expense/requests/legacy-1/legacy-approval-route').expect(200);
    await request(app.getHttpServer()).put('/expense/requests/legacy-1/legacy-approval-route').send(confirmation).expect(200);
    expect(expenseService.previewLegacyApprovalRoute).toHaveBeenCalledWith('legacy-1', 'admin-1');
    expect(expenseService.assignLegacyApprovalRoute).toHaveBeenCalledWith('legacy-1', 'admin-1', confirmation);
  });

  it('creates reimbursement items via admin endpoint', async () => {
    const payload = {
      entityId: 'tw-entity-001',
      name: '差旅補助',
      accountId: 'acct-2',
      keywords: ['travel'],
    };
    const created = { ...payload, id: 'item-2', isActive: true };
    (expenseService.createReimbursementItemAdmin as jest.Mock).mockResolvedValue(
      created,
    );

    await request(app.getHttpServer())
      .post('/expense/admin/reimbursement-items')
      .send(payload)
      .expect(201)
      .expect(({ body }) => {
        expect(body).toEqual(created);
      });

    expect(expenseService.createReimbursementItemAdmin).toHaveBeenCalledWith(
      payload,
    );
  });

  it('updates reimbursement items via admin endpoint', async () => {
    const payload = {
      name: '差旅補助-更新',
      accountId: 'acct-2',
    };
    const updated = { id: 'item-2', ...payload };
    (expenseService.updateReimbursementItemAdmin as jest.Mock).mockResolvedValue(
      updated,
    );

    await request(app.getHttpServer())
      .put('/expense/admin/reimbursement-items/item-2')
      .send(payload)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual(updated);
      });

    expect(expenseService.updateReimbursementItemAdmin).toHaveBeenCalledWith(
      'item-2',
      payload,
    );
  });

  it('archives reimbursement items', async () => {
    const archived = { id: 'item-3', isActive: false };
    (expenseService.archiveReimbursementItemAdmin as jest.Mock).mockResolvedValue(
      archived,
    );

    await request(app.getHttpServer())
      .put('/expense/admin/reimbursement-items/item-3/archive')
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual(archived);
      });

    expect(expenseService.archiveReimbursementItemAdmin).toHaveBeenCalledWith(
      'item-3',
    );
  });

  it('returns approval policies list for admins', async () => {
    const policies = [
      { id: 'policy-1', name: '小額審批', isActive: true },
      { id: 'policy-2', name: '大型採購', isActive: true },
    ];
    (expenseService.listApprovalPolicies as jest.Mock).mockResolvedValue(
      policies,
    );

    await request(app.getHttpServer())
      .get('/expense/admin/approval-policies')
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual(policies);
      });

    expect(expenseService.listApprovalPolicies).toHaveBeenCalledWith(undefined);
  });
});
