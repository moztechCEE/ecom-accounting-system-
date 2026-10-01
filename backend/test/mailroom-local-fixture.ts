import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
export const fixturePassword = 'FixturePass2026!';
export const localDatabase =
  'postgresql://local:mailroom-local-fixture@127.0.0.1:57643/mailroom';
export function requireLocalFixture() {
  if (
    process.env.DATABASE_URL !== localDatabase ||
    process.env.MAILROOM_LOCAL_TEST !== 'true'
  )
    throw Error('Requires isolated local mailroom fixture');
}
export async function seedMailroom(prisma: PrismaClient) {
  requireLocalFixture();
  const passwordHash = await bcrypt.hash(fixturePassword,10);
  for (const id of ['fixture-company', 'fixture-other'])
    await prisma.entity.upsert({
      where: { id },
      update: {},
      create: {
        id,
        loginCode: id,
        name: id === 'fixture-company' ? 'MOZTECH 本機示範' : '其他公司測試',
        country: 'TW',
        baseCurrency: 'TWD',
      },
    });
  await prisma.role.upsert({
    where: { code: 'FIXTURE_REVIEWER' },
    update: {},
    create: {
      id: 'fixture-reviewer-role',
      code: 'FIXTURE_REVIEWER',
      name: '示範客服覆核',
      permissions: {
        create: (
          await prisma.permission.findMany({
            where: { resource: 'mailroom', action: { in: ['read', 'review'] } },
          })
        ).map((p) => ({ permissionId: p.id })),
      },
    },
  });
  for (const [id, name, code, department] of [
    ['fixture-mail', '行政收發（示範）', 'MAILROOM_OPERATOR', '行政部'],
    ['fixture-repair', '維修同仁（示範）', 'REPAIR_TECHNICIAN', '維修部'],
    ['fixture-review', '客服同仁（示範）', 'FIXTURE_REVIEWER', '客服部'],
    ['fixture-person', '營運同仁（示範）', null, '營運部'],
    ['fixture-outsider', '其他公司同仁', null, '外部'],
  ] as const) {
    const entityId =
      id === 'fixture-outsider' ? 'fixture-other' : 'fixture-company';
    const dept = await prisma.department.upsert({
      where: { id: 'dept-' + id },
      update: {},
      create: { id: 'dept-' + id, entityId, name: department },
    });
    await prisma.user.upsert({
      where: { id },
      update: {passwordHash},
      create: {
        id,
        name,
        email: id + '@example.invalid',
        passwordHash,
        entityMemberships: { create: { entityId, isPrimary: true } },
        ...(code ? { roles: { create: { role: { connect: { code } } } } } : {}),
        employee: {
          create: {
            entityId,
            departmentId: dept.id,
            employeeNo: id,
            name,
            country: 'TW',
            hireDate: new Date('2026-01-01'),
            salaryBaseOriginal: 0,
            salaryBaseBase: 0,
          },
        },
      },
    });
  }
}
