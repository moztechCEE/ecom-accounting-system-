import {
  minLength,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

export const DEV_CLERK_USER_ID = 'doa-dev-clerk-20261002';
const DEV_CLERK_ENTITY_ID = 'doa-dev-qa-20261002';
const DEV_CLERK_EMPLOYEE_NO = 'DEV123';

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

export function isValidLoginPassword(input: LoginInput): boolean {
  return (
    typeof input.password === 'string' &&
    (minLength(input.password, 8) || isDevClerkShortPasswordLogin(input))
  );
}

// Only validation of one synthetic fixture changes; stored-password verification
// and the exact existing user ID remain AuthService responsibilities.
@ValidatorConstraint({ name: 'loginPassword', async: false })
export class LoginPasswordValidator implements ValidatorConstraintInterface {
  validate(password: unknown, args: ValidationArguments): boolean {
    return isValidLoginPassword({ ...args.object, password });
  }

  defaultMessage(): string {
    return 'password must be longer than or equal to 8 characters';
  }
}
