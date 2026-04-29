/**
 * Test helpers and utilities
 *
 * Use this file to export test utilities
 * Example:
 *
 * export const createTestModule = async (providers: any[]) => {
 *   return Test.createTestingModule({ providers }).compile();
 * };
 */

import { Keypair, TransactionBuilder, Asset, Operation, Networks, Account } from 'stellar-sdk';

/**
 * Creates a random Stellar keypair for testing
 */
export const createTestKeypair = () => {
  return Keypair.random();
};

/**
 * Signs a message with a Stellar keypair
 */
export const signMessage = (keypair: Keypair, message: string): string => {
  return keypair.sign(Buffer.from(message)).toString('base64');
};

/**
 * Creates test user data
 */
export const createTestUserData = (overrides?: any) => ({
  walletAddress: createTestKeypair().publicKey(),
  username: `testuser_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
  displayName: 'Test User',
  termsAccepted: 'true',
  ...overrides,
});

/**
 * Creates test wallet data
 */
export const createTestWallet = () => {
  return createTestKeypair().publicKey();
};

/**
 * Creates a valid signed Stellar XDR for testing
 */
export const createValidTestXdr = (sourceKeypair: Keypair = createTestKeypair()) => {
  const publicKey = sourceKeypair.publicKey();
  const account = new Account(publicKey, '1');
  // We need to mock the sequence number for the builder
  const transaction = new TransactionBuilder(account, {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.payment({
        destination: createTestKeypair().publicKey(),
        asset: Asset.native(),
        amount: '10',
      }),
    )
    .setTimeout(0)
    .build();

  transaction.sign(sourceKeypair);
  return transaction.toXDR();
};

