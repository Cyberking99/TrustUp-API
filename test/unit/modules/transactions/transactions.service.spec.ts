import { CACHE_MANAGER } from '@nestjs/cache-manager';
import {
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import * as StellarSdk from 'stellar-sdk';
import { SupabaseService } from '../../../../src/database/supabase.client';
import { TransactionsService } from '../../../../src/modules/transactions/transactions.service';

const mockTransactionCall = jest.fn();
const mockIncludeFailed = jest.fn();
const mockTransactionsBuilder = jest.fn();
const mockSubmitTransaction = jest.fn();

jest.mock('stellar-sdk', () => {
  const actual = jest.requireActual('stellar-sdk');

  return {
    ...actual,
    Horizon: {
      ...actual.Horizon,
      Server: jest.fn().mockImplementation(() => ({
        submitTransaction: mockSubmitTransaction,
        transactions: mockTransactionsBuilder,
      })),
    },
  };
});

describe('TransactionsService', () => {
  let service: TransactionsService;

  const validWallet = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW';
  const validHash = 'a'.repeat(64);
  const now = '2026-03-23T05:16:00.000Z';

  const mockCacheManager = {
    get: jest.fn(),
    set: jest.fn(),
  };

  const mockSupabaseTable = {
    select: jest.fn(),
    insert: jest.fn(),
    update: jest.fn(),
    eq: jest.fn(),
    maybeSingle: jest.fn(),
  };

  const mockSupabaseClient = {
    from: jest.fn().mockReturnValue(mockSupabaseTable),
  };

  const mockSupabaseService = {
    getServiceRoleClient: jest.fn().mockReturnValue(mockSupabaseClient),
  };

  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'STELLAR_HORIZON_URL') return 'https://horizon-testnet.stellar.org';
      if (key === 'STELLAR_NETWORK_PASSPHRASE') return StellarSdk.Networks.TESTNET;
      return undefined;
    }),
  };

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(new Date(now));
    mockTransactionsBuilder.mockReturnValue({
      includeFailed: mockIncludeFailed,
      transaction: mockTransactionCall,
    });
    mockIncludeFailed.mockReturnValue({
      transaction: mockTransactionCall,
    });
    mockTransactionCall.mockReturnValue({
      call: jest.fn(),
    });
    mockSupabaseTable.insert.mockResolvedValue({ error: null });
    mockSupabaseTable.update.mockReturnValue({
      eq: jest.fn().mockResolvedValue({ error: null }),
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransactionsService,
        { provide: CACHE_MANAGER, useValue: mockCacheManager },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: SupabaseService, useValue: mockSupabaseService },
      ],
    }).compile();

    service = module.get<TransactionsService>(TransactionsService);
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  function mockDbLookup(record: Record<string, unknown> | null) {
    mockSupabaseTable.select.mockReturnThis();
    mockSupabaseTable.eq.mockReturnThis();
    mockSupabaseTable.maybeSingle.mockResolvedValue({ data: record, error: null });
  }

  function mockTxCallResult(result: unknown) {
    const call = jest.fn().mockResolvedValue(result);
    mockTransactionCall.mockReturnValue({ call });
    return call;
  }

  it('should return finalized cached responses without calling Horizon', async () => {
    mockCacheManager.get.mockResolvedValue({
      hash: validHash,
      status: 'success',
      type: 'deposit',
      result: {
        ledger: 123,
        operationCount: 1,
        sourceAccount: validWallet,
        feeCharged: '100',
        memoType: 'none',
        memo: null,
        createdAt: '2026-03-23T05:15:30Z',
      },
      error: null,
      submittedAt: '2026-03-23T05:15:00.000Z',
      confirmedAt: '2026-03-23T05:15:30Z',
      lastCheckedAt: now,
    });

    const result = await service.getTransactionStatus(validHash);

    expect(result.status).toBe('success');
    expect(mockTransactionsBuilder).not.toHaveBeenCalled();
  });

  it('should return and cache a successful finalized transaction', async () => {
    mockCacheManager.get.mockResolvedValue(undefined);
    mockDbLookup({
      hash: validHash,
      type: 'loan_repay',
      status: 'pending',
      submitted_at: '2026-03-23T05:15:00.000Z',
      completed_at: null,
      updated_at: '2026-03-23T05:15:10.000Z',
    });
    mockTxCallResult({
      hash: validHash,
      successful: true,
      ledger_attr: 123456,
      operation_count: 2,
      source_account: validWallet,
      fee_charged: '100',
      memo_type: 'text',
      memo: 'Loan repayment',
      created_at: '2026-03-23T05:15:30Z',
    });

    const result = await service.getTransactionStatus(validHash);

    expect(result).toMatchObject({
      hash: validHash,
      status: 'success',
      type: 'loan_repay',
      submittedAt: '2026-03-23T05:15:00.000Z',
      confirmedAt: '2026-03-23T05:15:30Z',
      result: {
        ledger: 123456,
        operationCount: 2,
        sourceAccount: validWallet,
      },
      error: null,
    });
    expect(mockCacheManager.set).toHaveBeenCalledWith(
      `transactions:status:${validHash}`,
      expect.objectContaining({ status: 'success' }),
      0,
    );
  });

  it('should return pending when Horizon cannot find a locally tracked transaction yet', async () => {
    mockCacheManager.get.mockResolvedValue(undefined);
    mockDbLookup({
      hash: validHash,
      type: 'deposit',
      status: 'pending',
      submitted_at: '2026-03-23T05:15:00.000Z',
      completed_at: null,
      updated_at: '2026-03-23T05:15:10.000Z',
    });
    mockTxCallResult(
      Promise.reject({
        response: { status: 404 },
      }),
    );

    const result = await service.getTransactionStatus(validHash);

    expect(result).toEqual({
      hash: validHash,
      status: 'pending',
      type: 'deposit',
      result: null,
      error: null,
      submittedAt: '2026-03-23T05:15:00.000Z',
      confirmedAt: null,
      lastCheckedAt: now,
    });
  });

  it('should return 404 when Horizon cannot find an unknown hash', async () => {
    mockCacheManager.get.mockResolvedValue(undefined);
    mockDbLookup(null);
    mockTxCallResult(
      Promise.reject({
        response: { status: 404 },
      }),
    );

    await expect(service.getTransactionStatus(validHash)).rejects.toThrow(NotFoundException);
  });

  it('should return 503 when Horizon is temporarily unavailable', async () => {
    mockCacheManager.get.mockResolvedValue(undefined);
    mockDbLookup({
      hash: validHash,
      type: 'deposit',
      status: 'pending',
      submitted_at: '2026-03-23T05:15:00.000Z',
    });
    mockTxCallResult(Promise.reject(new Error('network timeout')));

    await expect(service.getTransactionStatus(validHash)).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('should return failure details and cache finalized failed transactions', async () => {
    mockCacheManager.get.mockResolvedValue(undefined);
    mockDbLookup({
      hash: validHash,
      type: 'withdraw',
      status: 'pending',
      submitted_at: '2026-03-23T05:15:00.000Z',
      completed_at: null,
      updated_at: '2026-03-23T05:15:10.000Z',
    });
    mockTxCallResult({
      hash: validHash,
      successful: false,
      result_xdr: 'AAAA',
      ledger_attr: 123456,
      operation_count: 1,
      source_account: validWallet,
      fee_charged: '100',
      memo_type: 'none',
      memo: undefined,
      created_at: '2026-03-23T05:15:30Z',
    });
    jest.spyOn(StellarSdk.xdr.TransactionResult, 'fromXDR').mockReturnValue({
      result: () => ({
        switch: () => ({ name: 'txFailed' }),
        value: () => [{ switch: () => ({ name: 'opUnderfunded' }) }],
      }),
    } as any);

    const result = await service.getTransactionStatus(validHash);

    expect(result).toMatchObject({
      hash: validHash,
      status: 'failed',
      type: 'withdraw',
      result: null,
      error: {
        code: 'tx_failed',
        message:
          'Insufficient balance to complete one or more operations in this transaction.',
        operationCodes: ['op_underfunded'],
      },
      submittedAt: '2026-03-23T05:15:00.000Z',
      confirmedAt: '2026-03-23T05:15:30Z',
    });
    expect(mockCacheManager.set).toHaveBeenCalledWith(
      `transactions:status:${validHash}`,
      expect.objectContaining({ status: 'failed' }),
      0,
    );
  });
});
