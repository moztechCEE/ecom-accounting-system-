import {
  minLength,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

export const DEV_CLERK_USER_ID = 'doa-dev-clerk-20261002';
const DEV_CLERK_ENTITY_ID = 'doa-dev-qa-20261002';
const DEV_CLERK_EMPLOYEE_NO = 'DEV123';
const DEV_TECHNICIAN_LOGIN = {
  userId: 'doa-dev-tech-20261002',
  employeeId: 'c7585674-980b-4fb2-afb9-7f2adcca413e',
  entityId: 'doa-dev-qa-20261002',
  employeeNo: 'DEV121',
} as const;

export type DevFixtureEmployeeIdentity = {
  readonly userId: string;
  readonly employeeId?: string;
  readonly entityId: string;
  readonly employeeNo: string;
};

type LoginInput = {
  entityId?: unknown;
  employeeNo?: unknown;
  email?: unknown;
  platformLoginId?: unknown;
  password?: unknown;
};

function isDevClerkEmployeeLogin(input: LoginInput): boolean {
  return (
    process.env.ERP_DEV_SANDBOX === 'true' &&
    typeof input.entityId === 'string' &&
    input.entityId.trim() === DEV_CLERK_ENTITY_ID &&
    typeof input.employeeNo === 'string' &&
    input.employeeNo.trim().toUpperCase() === DEV_CLERK_EMPLOYEE_NO &&
    input.email === undefined &&
    input.platformLoginId === undefined
  );
}

export function normalizeDevClerkEmployeeNo(input: LoginInput): string {
  return isDevClerkEmployeeLogin(input)
    ? DEV_CLERK_EMPLOYEE_NO
    : typeof input.employeeNo === 'string'
      ? input.employeeNo.trim()
      : '';
}

export function isDevClerkShortPasswordLogin(input: LoginInput): boolean {
  return isDevClerkEmployeeLogin(input) && input.password === 'dev';
}

function devFixtureEmployeeLogin(
  input: LoginInput,
): DevFixtureEmployeeIdentity | undefined {
  if (isDevClerkEmployeeLogin(input)) {
    return {
      userId: DEV_CLERK_USER_ID,
      entityId: DEV_CLERK_ENTITY_ID,
      employeeNo: DEV_CLERK_EMPLOYEE_NO,
    };
  }
  if (
    process.env.ERP_DEV_SANDBOX === 'true' &&
    typeof input.entityId === 'string' &&
    input.entityId.trim() === DEV_TECHNICIAN_LOGIN.entityId &&
    typeof input.employeeNo === 'string' &&
    input.employeeNo.trim().toUpperCase() === DEV_TECHNICIAN_LOGIN.employeeNo &&
    input.email === undefined &&
    input.platformLoginId === undefined
  ) {
    return DEV_TECHNICIAN_LOGIN;
  }
  return undefined;
}

export function normalizeDevFixtureEmployeeNo(input: LoginInput): string {
  return (
    devFixtureEmployeeLogin(input)?.employeeNo ??
    (typeof input.employeeNo === 'string' ? input.employeeNo.trim() : '')
  );
}

export function devFixtureShortPasswordIdentity(
  input: LoginInput,
): DevFixtureEmployeeIdentity | undefined {
  const identity = devFixtureEmployeeLogin(input);
  return input.password === 'dev' ||
    (input.password === '123' && identity === DEV_TECHNICIAN_LOGIN)
    ? identity
    : undefined;
}

export function isValidLoginPassword(input: LoginInput): boolean {
  return (
    typeof input.password === 'string' &&
    (minLength(input.password, 8) ||
      devFixtureShortPasswordIdentity(input) !== undefined)
  );
}

// Only exact synthetic fixture validation changes; stored-password verification
// and the matching existing identity remain AuthService responsibilities.
@ValidatorConstraint({ name: 'loginPassword', async: false })
export class LoginPasswordValidator implements ValidatorConstraintInterface {
  validate(password: unknown, args: ValidationArguments): boolean {
    return isValidLoginPassword({ ...args.object, password });
  }

  defaultMessage(): string {
    return 'password must be longer than or equal to 8 characters';
  }
}
