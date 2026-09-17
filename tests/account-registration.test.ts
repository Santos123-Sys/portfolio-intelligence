import { describe, expect, it } from 'vitest';
import { MAX_SELF_SERVICE_MEMBER_ACCOUNTS, AccountRegistrationError } from '../src/lib/account-registration';

describe('client account registration policy', () => {
  it('keeps the launch cohort to exactly two non-admin accounts', () => {
    expect(MAX_SELF_SERVICE_MEMBER_ACCOUNTS).toBe(2);
  });

  it('keeps capacity and duplicate-email outcomes distinguishable to the route', () => {
    expect(new AccountRegistrationError('capacity_reached', 'full').code).toBe('capacity_reached');
    expect(new AccountRegistrationError('email_unavailable', 'taken').code).toBe('email_unavailable');
  });
});
