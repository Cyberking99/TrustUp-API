/**
 * Test fixtures and factories
 *
 * Use this file to export reusable test data factories
 * Example:
 *
 * export const createMockUser = (overrides?: Partial<User>): User => ({
 *   id: '123',
 *   email: 'test@example.com',
 *   ...overrides,
 * });
 */

import { createTestKeypair, signMessage } from '../helpers';
import { TransactionType } from '../../src/modules/transactions/dto/submit-transaction-request.dto';

/**
 * Creates a mock nonce response
 */
export const createMockNonceResponse = (overrides?: any) => ({
  nonce: 'a1b2c3d4e5f67890abcdef1234567890a1b2c3d4e5f67890abcdef1234567890',
  expiresAt: new Date(Date.now() + 300000).toISOString(), // 5 minutes from now
  ...overrides,
});

/**
 * Creates a mock verify request with valid signature
 */
export const createMockVerifyRequest = (overrides?: any) => {
  const keypair = createTestKeypair();
  const nonce = 'a1b2c3d4e5f67890abcdef1234567890a1b2c3d4e5f67890abcdef1234567890';
  const signature = signMessage(keypair, nonce);

  return {
    wallet: keypair.publicKey(),
    nonce,
    signature,
    ...overrides,
  };
};

/**
 * Creates a mock auth response
 */
export const createMockAuthResponse = (overrides?: any) => ({
  accessToken: 'mock.access.token',
  refreshToken: 'mock.refresh.token',
  expiresIn: 900,
  tokenType: 'Bearer',
  ...overrides,
  user: {
    wallet: createTestKeypair().publicKey(),
    ...overrides?.user,
  },
});

/**
 * Creates a mock register request
 */
export const createMockRegisterRequest = (overrides?: any) => {
  const keypair = createTestKeypair();

  return {
    walletAddress: keypair.publicKey(),
    username: `testuser_${Date.now()}`,
    displayName: 'Test User',
    termsAccepted: 'true',
    ...overrides,
  };
};

/**
 * Creates a mock submit transaction request
 */
export const createMockSubmitTransactionRequest = (overrides?: any) => ({
  xdr: 'AAAAAgAAAAA...', // Dummy XDR
  type: TransactionType.DEPOSIT,
  ...overrides,
});

/**
 * Creates a mock Horizon transaction record
 */
export const createMockHorizonTransaction = (overrides?: any) => ({
  hash: 'a1b2c3d4e5f67890abcdef1234567890a1b2c3d4e5f67890abcdef1234567890',
  successful: true,
  ledger_attr: 123456,
  operation_count: 1,
  source_account: 'GC3X3S5VX6V...',
  fee_charged: '100',
  memo_type: 'none',
  created_at: new Date().toISOString(),
  result_xdr: 'AAAAAAAAAGQAAAAAAAAAAQAAAAAAAAAAAAAAAQAAAAAAAAAA',
  ...overrides,
});

/**
 * Creates a mock transaction status response
 */
export const createMockTransactionStatusResponse = (overrides?: any) => ({
  hash: 'a1b2c3d4e5f67890abcdef1234567890a1b2c3d4e5f67890abcdef1234567890',
  status: 'success',
  type: TransactionType.DEPOSIT,
  result: {
    ledger: 123456,
    operationCount: 1,
    sourceAccount: 'GC3X3S5VX6V...',
    feeCharged: '100',
    memoType: 'none',
    memo: null,
    createdAt: new Date().toISOString(),
  },
  error: null,
  submittedAt: new Date().toISOString(),
  confirmedAt: new Date().toISOString(),
  lastCheckedAt: new Date().toISOString(),
  ...overrides,
});

