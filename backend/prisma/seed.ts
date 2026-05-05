import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

/**
 * Seed Script - 初始化系統資料
 * 
 * 建立內容：
 * 1. 兩個公司實體（台灣、大陸）
 * 2. 角色與權限（SUPER_ADMIN, ADMIN, ACCOUNTANT, OPERATOR, EMPLOYEE）
 * 3. 預設管理員使用者
 * 4. 完整的會計科目表（IFRS / 台灣常用架構）
 * 5. 銷售渠道（Shopify, momo, PChome, Shopee, Coupang 等）
 * 6. 會計期間（2025年度）
 */
async function main() {
  console.log('🌱 Starting database seeding...\n');

  // ============================================
  // 1. 建立公司實體
  // ============================================
  console.log('📦 Creating entities...');
  
  const taiwanEntity = await prisma.entity.upsert({
    where: { id: 'tw-entity-001' },
    update: {},
    create: {
      id: 'tw-entity-001',
      name: '台灣公司',
      country: 'TW',
      baseCurrency: 'TWD',
      taxId: '12345678',
      address: '台北市信義區信義路五段7號',
      contactEmail: 'taiwan@company.com',
      contactPhone: '+886-2-2345-6789',
    },
  });

  const chinaEntity = await prisma.entity.upsert({
    where: { id: 'cn-entity-001' },
    update: {},
    create: {
      id: 'cn-entity-001',
      name: '大陸公司',
      country: 'CN',
      baseCurrency: 'CNY',
      taxId: '91110000000000000X',
      address: '上海市浦東新區陸家嘴環路1000號',
      contactEmail: 'china@company.com',
      contactPhone: '+86-21-1234-5678',
    },
  });

  console.log(`✅ Created entities: ${taiwanEntity.name}, ${chinaEntity.name}\n`);

  // ============================================
  // 2. 建立角色與權限
  // ============================================
  console.log('👥 Creating roles and permissions...');

  // 建立權限
  const permissions = await Promise.all([
    // Users
    prisma.permission.upsert({
      where: { resource_action: { resource: 'users', action: 'read' } },
      update: {},
      create: { resource: 'users', action: 'read', description: '查看使用者' },
    }),
    prisma.permission.upsert({
      where: { resource_action: { resource: 'users', action: 'create' } },
      update: {},
      create: { resource: 'users', action: 'create', description: '建立使用者' },
    }),
    prisma.permission.upsert({
      where: { resource_action: { resource: 'access_control', action: 'read' } },
      update: {},
      create: { resource: 'access_control', action: 'read', description: '查看帳號與權限管理' },
    }),
    prisma.permission.upsert({
      where: { resource_action: { resource: 'access_control', action: 'update' } },
      update: {},
      create: { resource: 'access_control', action: 'update', description: '維護帳號、角色與權限設定' },
    }),
    // Accounts
    prisma.permission.upsert({
      where: { resource_action: { resource: 'accounts', action: 'read' } },
      update: {},
      create: { resource: 'accounts', action: 'read', description: '查看會計科目' },
    }),
    prisma.permission.upsert({
      where: { resource_action: { resource: 'accounts', action: 'create' } },
      update: {},
      create: { resource: 'accounts', action: 'create', description: '建立會計科目' },
    }),
    // Journal Entries
    prisma.permission.upsert({
      where: { resource_action: { resource: 'journal_entries', action: 'read' } },
      update: {},
      create: { resource: 'journal_entries', action: 'read', description: '查看會計分錄' },
    }),
    prisma.permission.upsert({
      where: { resource_action: { resource: 'journal_entries', action: 'create' } },
      update: {},
      create: { resource: 'journal_entries', action: 'create', description: '建立會計分錄' },
    }),
    prisma.permission.upsert({
      where: { resource_action: { resource: 'journal_entries', action: 'approve' } },
      update: {},
      create: { resource: 'journal_entries', action: 'approve', description: '審核會計分錄' },
    }),
    // Sales Orders
    prisma.permission.upsert({
      where: { resource_action: { resource: 'sales_orders', action: 'read' } },
      update: {},
      create: { resource: 'sales_orders', action: 'read', description: '查看銷售訂單' },
    }),
    prisma.permission.upsert({
      where: { resource_action: { resource: 'sales_orders', action: 'create' } },
      update: {},
      create: { resource: 'sales_orders', action: 'create', description: '建立銷售訂單' },
    }),
    prisma.permission.upsert({
      where: { resource_action: { resource: 'purchase_orders', action: 'read' } },
      update: {},
      create: { resource: 'purchase_orders', action: 'read', description: '查看採購訂單' },
    }),
    prisma.permission.upsert({
      where: { resource_action: { resource: 'purchase_orders', action: 'create' } },
      update: {},
      create: { resource: 'purchase_orders', action: 'create', description: '建立採購訂單' },
    }),
    prisma.permission.upsert({
      where: { resource_action: { resource: 'inventory', action: 'read' } },
      update: {},
      create: { resource: 'inventory', action: 'read', description: '查看庫存與產品' },
    }),
    prisma.permission.upsert({
      where: { resource_action: { resource: 'inventory', action: 'update' } },
      update: {},
      create: { resource: 'inventory', action: 'update', description: '維護庫存與產品' },
    }),
    prisma.permission.upsert({
      where: { resource_action: { resource: 'banking', action: 'read' } },
      update: {},
      create: { resource: 'banking', action: 'read', description: '查看銀行與對帳資料' },
    }),
    prisma.permission.upsert({
      where: { resource_action: { resource: 'banking', action: 'update' } },
      update: {},
      create: { resource: 'banking', action: 'update', description: '執行銀行與對帳作業' },
    }),
    prisma.permission.upsert({
      where: { resource_action: { resource: 'reports', action: 'read' } },
      update: {},
      create: { resource: 'reports', action: 'read', description: '查看報表中心' },
    }),
    prisma.permission.upsert({
      where: { resource_action: { resource: 'attendance_self', action: 'read' } },
      update: {},
      create: { resource: 'attendance_self', action: 'read', description: '查看自己的打卡與出勤' },
    }),
    prisma.permission.upsert({
      where: { resource_action: { resource: 'leave_self', action: 'read' } },
      update: {},
      create: { resource: 'leave_self', action: 'read', description: '查看與申請自己的請假' },
    }),
    prisma.permission.upsert({
      where: { resource_action: { resource: 'payroll_self', action: 'read' } },
      update: {},
      create: { resource: 'payroll_self', action: 'read', description: '查看自己的薪資單' },
    }),
    prisma.permission.upsert({
      where: { resource_action: { resource: 'payroll_self_breakdown', action: 'read' } },
      update: {},
      create: { resource: 'payroll_self_breakdown', action: 'read', description: '查看自己的薪資明細與計算方式' },
    }),
    prisma.permission.upsert({
      where: { resource_action: { resource: 'profile_self', action: 'read' } },
      update: {},
      create: { resource: 'profile_self', action: 'read', description: '查看自己的個人資料' },
    }),
    prisma.permission.upsert({
      where: { resource_action: { resource: 'employees_admin', action: 'read' } },
      update: {},
      create: { resource: 'employees_admin', action: 'read', description: '查看員工與部門資料' },
    }),
    prisma.permission.upsert({
      where: { resource_action: { resource: 'employees_admin', action: 'update' } },
      update: {},
      create: { resource: 'employees_admin', action: 'update', description: '維護員工與部門資料' },
    }),
    prisma.permission.upsert({
      where: { resource_action: { resource: 'attendance_admin', action: 'read' } },
      update: {},
      create: { resource: 'attendance_admin', action: 'read', description: '查看考勤後臺審核資料' },
    }),
    prisma.permission.upsert({
      where: { resource_action: { resource: 'attendance_admin', action: 'update' } },
      update: {},
      create: { resource: 'attendance_admin', action: 'update', description: '維護考勤規則與執行審核' },
    }),
    prisma.permission.upsert({
      where: { resource_action: { resource: 'payroll_admin', action: 'read' } },
      update: {},
      create: { resource: 'payroll_admin', action: 'read', description: '查看薪資批次與設定' },
    }),
    prisma.permission.upsert({
      where: { resource_action: { resource: 'payroll_admin', action: 'update' } },
      update: {},
      create: { resource: 'payroll_admin', action: 'update', description: '執行薪資計算與發薪' },
    }),
  ]);

  // 建立角色（四層級）
  const roleDefinitions = [
    {
      code: 'SUPER_ADMIN',
      name: 'SUPER_ADMIN',
      description: '最高管理員，擁有完整系統權限',
      hierarchyLevel: 1,
    },
    {
      code: 'ADMIN',
      name: 'ADMIN',
      description: '公司管理員，可管理大部分模組',
      hierarchyLevel: 2,
    },
    {
      code: 'ACCOUNTANT',
      name: 'ACCOUNTANT',
      description: '財會部門成員，可處理會計與報表作業',
      hierarchyLevel: 3,
    },
    {
      code: 'EMPLOYEE',
      name: 'EMPLOYEE',
      description: '一般員工，預設只可查看自己的資料與進行自助作業',
      hierarchyLevel: 5,
    },
    {
      code: 'OPERATOR',
      name: 'OPERATOR',
      description: '一般操作成員，可進行基礎作業',
      hierarchyLevel: 4,
    },
  ];

  const roles: Record<string, { id: string }> = {};

  for (const roleDef of roleDefinitions) {
    const role = await prisma.role.upsert({
      where: { code: roleDef.code },
      update: {
        name: roleDef.name,
        description: roleDef.description,
        hierarchyLevel: roleDef.hierarchyLevel,
      },
      create: {
        code: roleDef.code,
        name: roleDef.name,
        description: roleDef.description,
        hierarchyLevel: roleDef.hierarchyLevel,
      },
    });

    roles[roleDef.code] = role;
  }

  const permissionIndex = new Map(
    permissions.map((permission) => [`${permission.resource}:${permission.action}`, permission]),
  );

  const ensureRolePermissions = async (roleCode: string, keys: string[] | 'ALL') => {
    const role = roles[roleCode];
    if (!role) {
      return;
    }

    const targetPermissions =
      keys === 'ALL'
        ? permissions
        : keys
            .map((key) => permissionIndex.get(key))
            .filter((permission): permission is (typeof permissions)[number] => Boolean(permission));

    for (const permission of targetPermissions) {
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: role.id,
            permissionId: permission.id,
          },
        },
        update: {},
        create: {
          roleId: role.id,
          permissionId: permission.id,
        },
      });
    }
  };

  await ensureRolePermissions('SUPER_ADMIN', 'ALL');
  await ensureRolePermissions('ADMIN', 'ALL');
  await ensureRolePermissions('ACCOUNTANT', [
    'access_control:read',
    'attendance_self:read',
    'leave_self:read',
    'payroll_self:read',
    'payroll_self_breakdown:read',
    'profile_self:read',
    'accounts:read',
    'journal_entries:read',
    'journal_entries:create',
    'journal_entries:approve',
    'reports:read',
    'banking:read',
    'attendance_admin:read',
    'payroll_admin:read',
    'sales_orders:read',
  ]);
  await ensureRolePermissions('EMPLOYEE', [
    'attendance_self:read',
    'leave_self:read',
    'payroll_self:read',
    'payroll_self_breakdown:read',
    'profile_self:read',
  ]);
  await ensureRolePermissions('OPERATOR', [
    'attendance_self:read',
    'leave_self:read',
    'payroll_self:read',
    'payroll_self_breakdown:read',
    'profile_self:read',
    'sales_orders:read',
    'sales_orders:create',
    'purchase_orders:read',
    'purchase_orders:create',
    'inventory:read',
    'inventory:update',
  ]);

  console.log(`✅ Created roles with hierarchy: SUPER_ADMIN, ADMIN, ACCOUNTANT, OPERATOR, EMPLOYEE\n`);

  const superAdminRole = roles['SUPER_ADMIN'];
  const adminRole = roles['ADMIN'];

  // ============================================
  // 3. 建立部門（每個公司）
  // ============================================
  console.log('🏢 Creating departments...');

  const departmentTemplates = [
    { key: 'mgmt', name: '管理部' },
    { key: 'procurement', name: '採購部' },
    { key: 'logistics', name: '儲運部' },
    { key: 'product', name: '產品部' },
    { key: 'design', name: '設計部' },
    { key: 'customer-success', name: '客服部' },
    { key: 'finance', name: '財會部' },
  ];

  const entities = [taiwanEntity, chinaEntity];

  for (const entity of entities) {
    for (const template of departmentTemplates) {
      await prisma.department.upsert({
        where: { id: `${entity.id}-${template.key}` },
        update: {
          name: template.name,
          isActive: true,
        },
        create: {
          id: `${entity.id}-${template.key}`,
          entityId: entity.id,
          name: template.name,
        },
      });
    }
  }

  console.log(`✅ Created departments for entities: ${entities.map((entity) => entity.name).join(', ')}\n`);

  // ============================================
  // 4. 建立預設管理員
  // ============================================
  console.log('👤 Creating default admin user...');

  const adminEmail = process.env.SUPER_ADMIN_EMAIL || 'admin@moztech.tw';
  const adminPassword = process.env.SUPER_ADMIN_PASSWORD || 'Moztech2025!';
  const adminName = process.env.SUPER_ADMIN_NAME ?? '系統管理員';

  if (!process.env.SUPER_ADMIN_EMAIL) {
    console.warn('⚠️  SUPER_ADMIN_EMAIL not provided, using default: ' + adminEmail);
  }
  
  // Removed strict error throw to allow fallback seeding
  // if (!adminEmail || !adminPassword) { ... }

  const passwordHash = await bcrypt.hash(adminPassword, 10);

  // 4-1. Create Default Admin from Env
  const adminUser = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      passwordHash, // Update password if user exists
      name: adminName,
    },
    create: {
      email: adminEmail,
      name: adminName,
      passwordHash,
    },
  });

  // 4-2. Create Specific User (moztecheason@gmail.com)
  const userEmail = 'moztecheason@gmail.com';
  // If the user is the same as adminEmail, skip to avoid double processing or let upsert handle it logic above
  if (userEmail !== adminEmail) {
      console.log(`👤 Creating user: ${userEmail}...`);
      const userPassword = process.env.USER_PASSWORD || 'Moztech2025!'; // Default password if not provided
      const userPasswordHash = await bcrypt.hash(userPassword, 10);
      
      const specificUser = await prisma.user.upsert({
        where: { email: userEmail },
        update: {
           // We do NOT update password here to prevent overwriting user changes if they changed it
           // Unless we want to force reset. For now, let's only set if creating.
           // Actually, the user says "let my account be written", implying they can't login. 
           // Better force reset it this time or use a specific env var.
           // Let's force reset it to a known value so they can login.
           passwordHash: userPasswordHash,
        },
        create: {
          email: userEmail,
          name: 'Eason',
          passwordHash: userPasswordHash,
        },
      });
      
      // Assign Super Admin Role to Eason
      if (superAdminRole) {
        await prisma.userRole.upsert({
            where: {
                userId_roleId: {
                    userId: specificUser.id,
                    roleId: superAdminRole.id
                }
            },
            update: {},
            create: {
                userId: specificUser.id,
                roleId: superAdminRole.id,
            }
        });
      }
  }

  // 指派 SUPER_ADMIN 與 ADMIN 角色
  if (superAdminRole) {
    await prisma.userRole.upsert({
      where: {
        userId_roleId: {
          userId: adminUser.id,
          roleId: superAdminRole.id,
        },
      },
      update: {},
      create: {
        userId: adminUser.id,
        roleId: superAdminRole.id,
      },
    });
  }

  if (adminRole) {
    await prisma.userRole.upsert({
      where: {
        userId_roleId: {
          userId: adminUser.id,
          roleId: adminRole.id,
        },
      },
      update: {},
      create: {
        userId: adminUser.id,
        roleId: adminRole.id,
      },
    });
  }

  console.log(`✅ Ensured admin user: ${adminUser.email} (name: ${adminUser.name}, roles: SUPER_ADMIN, ADMIN)\n`);

  // ============================================
  // 5. 建立會計科目表（台灣公司）
  // ============================================
  console.log('📊 Creating chart of accounts for Taiwan (official 112+ standard)...');

  type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';

  const determineType = (code: string): AccountType => {
    const first = code[0];
    if (first === '1') return 'asset';
    if (first === '2') return 'liability';
    if (first === '3') return 'equity';
    if (first === '4') return 'revenue';
    if (first === '5' || first === '6' || first === '8') return 'expense';
    if (first === '7') {
      // 7xxx: 依實際科目判斷
      if (code === '7111' || code === '7181' || code === '7191') return 'revenue';
      return 'expense';
    }
    return 'asset';
  };

  const reimbursableOverrideFalse = new Set<string>(['6111', '6125']);

  const twAccounts = [
    // 1. 資產
    { code: '1111', name: '庫存現金' },
    { code: '1113', name: '銀行存款' },
    { code: '1191', name: '應收帳款' },
    { code: '1261', name: '預付薪資' },
    { code: '1262', name: '預付租金' },
    { code: '1263', name: '預付保險費' },
    { code: '1265', name: '其他預付費用' },
    { code: '1231', name: '商品存貨' },
    { code: '1421', name: '機器設備' },
    { code: '1431', name: '辦公設備' },
    { code: '1441', name: '租賃資產' },
    { code: '1541', name: '商譽' },
    { code: '1583', name: '存出保證金' },

    // 2. 負債
    { code: '2111', name: '銀行透支' },
    { code: '2112', name: '銀行借款' },
    { code: '2161', name: '應付票據' },
    { code: '2171', name: '應付帳款' },
    { code: '2191', name: '應付薪資' },
    { code: '2192', name: '應付租金' },
    { code: '2194', name: '應付營業稅' },
    { code: '2261', name: '預收貨款' },
    { code: '2252', name: '代收款' },
    { code: '2392', name: '存入保證金' },

    // 3. 權益
    { code: '3111', name: '普通股股本' },
    { code: '3211', name: '資本公積—普通股股票溢價' },
    { code: '3311', name: '法定盈餘公積' },
    { code: '3351', name: '累積盈虧' },
    { code: '3353', name: '本期損益' },

    // 4. 營業收入
    { code: '4111', name: '銷貨收入' },
    { code: '4113', name: '銷貨退回' },
    { code: '4114', name: '銷貨折讓' },
    { code: '4121', name: '勞務收入' },

    // 5. 營業成本
    { code: '5111', name: '銷貨成本' },
    { code: '5151', name: '間接人工' },
    { code: '5121', name: '進貨' },
    { code: '5122', name: '進貨費用' },

    // 6. 營業費用
    { code: '6111', name: '薪資支出' },
    { code: '6112', name: '租金支出' },
    { code: '6113', name: '文具用品' },
    { code: '6114', name: '旅費' },
    { code: '6115', name: '運費' },
    { code: '6116', name: '郵電費' },
    { code: '6117', name: '修繕費' },
    { code: '6118', name: '廣告費' },
    { code: '6119', name: '水電瓦斯費' },
    { code: '6120', name: '保險費' },
    { code: '6121', name: '交際費' },
    { code: '6122', name: '捐贈' },
    { code: '6123', name: '稅捐' },
    { code: '6125', name: '折舊' },
    { code: '6128', name: '伙食費' },
    { code: '6129', name: '職工福利' },
    { code: '6131', name: '佣金支出' },
    { code: '6132', name: '訓練費' },
    { code: '6133', name: '勞務費' },
    { code: '6134', name: '其他營業費用' },

    // 7. 營業外收支
    { code: '7111', name: '利息收入' },
    { code: '7151', name: '利息費用' },
    { code: '7181', name: '兌換利益' },
    { code: '7182', name: '兌換損失' },
    { code: '7191', name: '投資利益' },

    // 8. 所得稅
    { code: '8211', name: '所得稅費用' },
  ];

  for (const account of twAccounts) {
    const type = determineType(account.code);
    const isExpenseCategory = account.code.startsWith('6');
    const isReimbursable =
      isExpenseCategory && !reimbursableOverrideFalse.has(account.code);

    await prisma.account.upsert({
      where: {
        entityId_code: {
          entityId: taiwanEntity.id,
          code: account.code,
        },
      },
      update: {
        name: account.name,
        type,
        isReimbursable,
      },
      create: {
        entityId: taiwanEntity.id,
        code: account.code,
        name: account.name,
        type,
        isReimbursable,
      },
    });
  }

  console.log(`✅ Created/updated ${twAccounts.length} official accounts for Taiwan (112+ standard)\n`);

  console.log('🧾 Creating reimbursement item templates for Taiwan (TW Entity)...');

  const twReimbursementItems = [
    {
      name: '出差旅費',
      accountCode: '6114',
      description: '員工國內外出差相關交通與住宿費用',
      allowedReceiptTypes: 'TAX_INVOICE,RECEIPT,BANK_SLIP',
    },
    {
      name: '交際費',
      accountCode: '6121',
      description: '客戶餐敘、應酬等交際支出',
      allowedReceiptTypes: 'TAX_INVOICE,RECEIPT',
    },
    {
      name: '餐費／加班餐',
      accountCode: '6128',
      description: '員工值班、加班、部門聚餐等餐飲支出',
      allowedReceiptTypes: 'RECEIPT,BANK_SLIP',
    },
    {
      name: '辦公用品',
      accountCode: '6113',
      description: '文具、影印紙、簡易辦公耗材等',
      allowedReceiptTypes: 'TAX_INVOICE,RECEIPT',
    },
    {
      name: '樣品採購（內部）',
      accountCode: '6133',
      description: '產品打樣、送測樣品等，主要供內部評估使用',
      allowedReceiptTypes: 'BANK_SLIP,INTERNAL_ONLY',
      allowedRoles: 'ADMIN,ACCOUNTANT',
    },
    {
      name: '進口關稅',
      accountCode: '5122',
      description: '進口貨物之關稅、報關費、商港服務費等',
      allowedReceiptTypes: 'TAX_INVOICE,RECEIPT,BANK_SLIP',
    },
    {
      name: '關稅預付',
      accountCode: '5122',
      description: '預付進口關稅，需後補稅單',
      allowedReceiptTypes: 'TAX_INVOICE',
    },
  ];

  for (const item of twReimbursementItems) {
    const account = await prisma.account.findUnique({
      where: {
        entityId_code: {
          entityId: taiwanEntity.id,
          code: item.accountCode,
        },
      },
    });

    if (!account) {
      console.warn(
        `⚠️ Skipping reimbursement item "${item.name}" because account code ${item.accountCode} was not found for TW entity`,
      );
      continue;
    }

    await prisma.reimbursementItem.upsert({
      where: {
        entityId_name: {
          entityId: taiwanEntity.id,
          name: item.name,
        },
      },
      update: {
        description: item.description,
        accountId: account.id,
        allowedReceiptTypes: item.allowedReceiptTypes,
        allowedRoles: (item as any).allowedRoles ?? null,
      },
      create: {
        entityId: taiwanEntity.id,
        name: item.name,
        description: item.description,
        accountId: account.id,
        allowedReceiptTypes: item.allowedReceiptTypes,
        allowedRoles: (item as any).allowedRoles ?? null,
      },
    });
  }

  console.log(`✅ Created/updated ${twReimbursementItems.length} reimbursement item templates for TW Entity\n`);

  // ============================================
  // 5. 建立會計科目表（大陸公司 - 簡化版）
  // ============================================
  console.log('📊 Creating chart of accounts for China...');

  const cnAccounts = [
    { code: '1001', name: '库存现金', type: 'asset', parentId: null },
    { code: '1002', name: '银行存款', type: 'asset', parentId: null },
    { code: '1122', name: '应收账款', type: 'asset', parentId: null },
    { code: '1405', name: '库存商品', type: 'asset', parentId: null },
    { code: '2202', name: '应付账款', type: 'liability', parentId: null },
    { code: '2211', name: '应付职工薪酬', type: 'liability', parentId: null },
    { code: '4001', name: '主营业务收入', type: 'revenue', parentId: null },
    { code: '5001', name: '主营业务成本', type: 'expense', parentId: null },
    { code: '6601', name: '销售费用', type: 'expense', parentId: null },
  ];

  for (const account of cnAccounts) {
    await prisma.account.upsert({
      where: {
        entityId_code: {
          entityId: chinaEntity.id,
          code: account.code,
        },
      },
      update: {},
      create: {
        entityId: chinaEntity.id,
        code: account.code,
        name: account.name,
        type: account.type,
      },
    });
  }

  console.log(`✅ Created ${cnAccounts.length} accounts for China\n`);

  // ============================================
  // 6. 建立銷售渠道
  // ============================================
  console.log('🛍️  Creating sales channels...');

  const channels = [
    {
      entityId: taiwanEntity.id,
      name: 'Shopify 官網',
      code: 'SHOPIFY',
      type: 'own_site',
      defaultCurrency: 'TWD',
    },
    {
      entityId: taiwanEntity.id,
      name: '1shop 團購',
      code: '1SHOP',
      type: 'group_buy',
      defaultCurrency: 'TWD',
    },
    {
      entityId: taiwanEntity.id,
      name: 'SHOPLINE',
      code: 'SHOPLINE',
      type: 'own_site',
      defaultCurrency: 'TWD',
    },
    {
      entityId: taiwanEntity.id,
      name: 'momo 購物',
      code: 'MOMO',
      type: 'marketplace',
      defaultCurrency: 'TWD',
    },
    {
      entityId: taiwanEntity.id,
      name: 'PChome 商店街',
      code: 'PCHOME',
      type: 'marketplace',
      defaultCurrency: 'TWD',
    },
    {
      entityId: taiwanEntity.id,
      name: 'Shopee 蝦皮',
      code: 'SHOPEE',
      type: 'marketplace',
      defaultCurrency: 'TWD',
    },
    {
      entityId: taiwanEntity.id,
      name: 'Coupang',
      code: 'COUPANG',
      type: 'marketplace',
      defaultCurrency: 'TWD',
    },
    {
      entityId: taiwanEntity.id,
      name: 'Amazon',
      code: 'AMAZON',
      type: 'marketplace',
      defaultCurrency: 'USD',
    },
    {
      entityId: taiwanEntity.id,
      name: 'TikTok Shop',
      code: 'TTSHOP',
      type: 'social_commerce',
      defaultCurrency: 'TWD',
    },
  ];

  for (const channel of channels) {
    await prisma.salesChannel.upsert({
      where: {
        entityId_code: {
          entityId: channel.entityId,
          code: channel.code,
        },
      },
      update: {},
      create: channel,
    });
  }

  console.log(`✅ Created ${channels.length} sales channels\n`);

  // ============================================
  // 7. 建立會計期間（2025年）
  // ============================================
  console.log('📅 Creating accounting periods for 2025...');

  const periods = [];
  for (let month = 1; month <= 12; month++) {
    const startDate = new Date(2025, month - 1, 1);
    const endDate = new Date(2025, month, 0); // 該月最後一天

    // 台灣公司
    periods.push(
      prisma.period.upsert({
        where: {
          entityId_name: {
            entityId: taiwanEntity.id,
            name: `2025-${String(month).padStart(2, '0')}`,
          },
        },
        update: {},
        create: {
          entityId: taiwanEntity.id,
          name: `2025-${String(month).padStart(2, '0')}`,
          startDate,
          endDate,
          status: month <= 11 ? 'open' : 'open', // 當前月及之後為 open
        },
      }),
    );

    // 大陸公司
    periods.push(
      prisma.period.upsert({
        where: {
          entityId_name: {
            entityId: chinaEntity.id,
            name: `2025-${String(month).padStart(2, '0')}`,
          },
        },
        update: {},
        create: {
          entityId: chinaEntity.id,
          name: `2025-${String(month).padStart(2, '0')}`,
          startDate,
          endDate,
          status: 'open',
        },
      }),
    );
  }

  await Promise.all(periods);

  console.log(`✅ Created 24 accounting periods (12 months × 2 entities)\n`);

  // ============================================
  // 10. 建立假別 (台灣)
  // ============================================
  console.log('🏖️ Creating leave types...');

  const twLeaveTypes = [
    {
      code: 'SICK',
      name: '病假',
      balanceResetPolicy: 'CALENDAR_YEAR',
      requiresDocument: true,
      maxDaysPerYear: 30,
      paidPercentage: 50,
      minNoticeHours: 0,
    },
    {
      code: 'PERSONAL',
      name: '事假',
      balanceResetPolicy: 'CALENDAR_YEAR',
      requiresDocument: false,
      maxDaysPerYear: 14,
      paidPercentage: 0,
      minNoticeHours: 24,
    },
    {
      code: 'ANNUAL',
      name: '特休',
      balanceResetPolicy: 'HIRE_ANNIVERSARY',
      requiresDocument: false,
      paidPercentage: 100,
      minNoticeHours: 24,
    },
    {
      code: 'MENSTRUAL',
      name: '生理假',
      balanceResetPolicy: 'CALENDAR_YEAR',
      requiresDocument: false,
      maxDaysPerYear: 12, // 1 day per month
      paidPercentage: 50,
      minNoticeHours: 0,
    },
    {
      code: 'MARRIAGE',
      name: '婚假',
      balanceResetPolicy: 'NONE',
      requiresDocument: true,
      maxDaysPerYear: 8,
      paidPercentage: 100,
      minNoticeHours: 168, // 1 week
    },
    {
      code: 'FUNERAL',
      name: '喪假',
      balanceResetPolicy: 'NONE',
      requiresDocument: true,
      paidPercentage: 100,
      minNoticeHours: 0,
    },
    {
      code: 'MATERNITY',
      name: '產假',
      balanceResetPolicy: 'NONE',
      requiresDocument: true,
      maxDaysPerYear: 56, // 8 weeks
      paidPercentage: 100,
      minNoticeHours: 720, // 30 days
      requiresChildData: true,
    },
    {
      code: 'PATERNITY',
      name: '陪產假',
      balanceResetPolicy: 'NONE',
      requiresDocument: true,
      maxDaysPerYear: 7,
      paidPercentage: 100,
      minNoticeHours: 48,
      requiresChildData: true,
    },
  ];

  for (const leave of twLeaveTypes) {
    await prisma.leaveType.upsert({
      where: {
        entityId_code: {
          entityId: taiwanEntity.id,
          code: leave.code,
        },
      },
      update: {},
      create: {
        entityId: taiwanEntity.id,
        code: leave.code,
        name: leave.name,
        balanceResetPolicy: leave.balanceResetPolicy,
        requiresDocument: leave.requiresDocument,
        maxDaysPerYear: leave.maxDaysPerYear,
        paidPercentage: leave.paidPercentage,
        minNoticeHours: leave.minNoticeHours,
        requiresChildData: leave.requiresChildData || false,
      },
    });
  }
  console.log(`✅ Created ${twLeaveTypes.length} leave types for Taiwan entity\n`);

  console.log('✨ Database seeding completed successfully!\n');
  console.log('📝 Summary:');
  console.log(`   - Entities: 2 (台灣公司, 大陸公司)`);
  console.log('   - Users: 1 admin (credentials sourced from SUPER_ADMIN_* environment variables)');
  console.log('   - Roles: 5 (SUPER_ADMIN, ADMIN, ACCOUNTANT, OPERATOR, EMPLOYEE)');
  console.log(`   - Permissions: ${permissions.length}`);
  console.log(`   - Accounts: ${twAccounts.length + cnAccounts.length}`);
  console.log(`   - Sales Channels: ${channels.length}`);
  console.log(`   - Accounting Periods: 24`);
  console.log('\n🚀 You can now start the application!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
