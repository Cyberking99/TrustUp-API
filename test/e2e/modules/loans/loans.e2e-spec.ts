import { Test, TestingModule } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { LoansModule } from '../../../../src/modules/loans/loans.module';
import { ReputationService } from '../../../../src/modules/reputation/reputation.service';
import { SorobanService } from '../../../../src/blockchain/soroban/soroban.service';
import { SupabaseService } from '../../../../src/database/supabase.client';
import { CreditLineContractClient } from '../../../../src/blockchain/contracts/credit-line-contract.client';

describe('LoansController (e2e)', () => {
  let app: NestFastifyApplication;

  const validWallet = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW';
  const merchantId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

  const mockCreditLineContract = {
    buildCreateLoanTransaction: jest.fn().mockResolvedValue('AAAAAgAAAAC...'),
  };

  const mockSorobanService = {
    simulateContractCall: jest.fn(),
    getServer: jest.fn(),
    getNetworkPassphrase: jest.fn().mockReturnValue('Test SDF Network ; September 2015'),
  };

  const mockSupabaseFrom = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({
      data: { id: merchantId, name: 'TechStore', is_active: true },
      error: null,
    }),
    insert: jest.fn().mockResolvedValue({ error: null }),
  };

  const mockSupabaseClient = {
    from: jest.fn().mockReturnValue(mockSupabaseFrom),
  };

  const mockSupabaseService = {
    getServiceRoleClient: jest.fn().mockReturnValue(mockSupabaseClient),
    getClient: jest.fn().mockReturnValue(mockSupabaseClient),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), LoansModule],
    })
      .overrideProvider(SorobanService)
      .useValue(mockSorobanService)
      .overrideProvider(CreditLineContractClient)
      .useValue(mockCreditLineContract)
      .overrideProvider(SupabaseService)
      .useValue(mockSupabaseService)
      .compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter());

    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockSupabaseClient.from.mockReturnValue(mockSupabaseFrom);
    mockSupabaseFrom.select.mockReturnThis();
    mockSupabaseFrom.eq.mockReturnThis();
    mockSupabaseFrom.single.mockResolvedValue({
      data: { id: merchantId, name: 'TechStore', is_active: true },
      error: null,
    });
    mockSupabaseFrom.insert.mockResolvedValue({ error: null });
    mockSupabaseService.getServiceRoleClient.mockReturnValue(mockSupabaseClient);
    mockCreditLineContract.buildCreateLoanTransaction.mockResolvedValue('AAAAAgAAAAC...');

    jest.spyOn(app.get(ReputationService), 'getReputationData').mockResolvedValue({
      wallet: validWallet,
      score: 75,
      tier: 'silver',
      interestRate: 8,
      maxCredit: 3000,
      lastUpdated: '2026-03-23T00:00:00.000Z',
    });
  });

  describe('POST /loans/quote', () => {
    const validBody = { amount: 500, merchant: merchantId, term: 4 };

    it('should return 200 with a valid loan quote in response envelope', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/loans/quote',
        headers: { 'x-wallet-address': validWallet },
        payload: validBody,
      });

      expect(res.statusCode).toBe(200);

      const body = JSON.parse(res.payload);
      expect(body).toHaveProperty('success', true);
      expect(body).toHaveProperty('message', 'Loan quote calculated successfully');
      expect(body).toHaveProperty('data');
      expect(body.data).toHaveProperty('amount', 500);
      expect(body.data).toHaveProperty('guarantee', 100);
      expect(body.data).toHaveProperty('loanAmount', 400);
      expect(body.data).toHaveProperty('term', 4);
      expect(body.data.schedule).toHaveLength(4);
    }, 10000);

    it('should return schedule with correct structure', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/loans/quote',
        headers: { 'x-wallet-address': validWallet },
        payload: validBody,
      });

      const body = JSON.parse(res.payload);
      const payment = body.data.schedule[0];

      expect(payment).toHaveProperty('paymentNumber', 1);
      expect(payment).toHaveProperty('amount');
      expect(payment).toHaveProperty('dueDate');
      expect(typeof payment.amount).toBe('number');
    }, 10000);

    it('should return 400 for missing wallet header', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/loans/quote',
        payload: validBody,
      });

      expect(res.statusCode).toBe(400);
    });

    it('should return 400 for invalid wallet format', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/loans/quote',
        headers: { 'x-wallet-address': 'INVALID' },
        payload: validBody,
      });

      expect(res.statusCode).toBe(400);
    });

    it('should return 400 for amount below minimum', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/loans/quote',
        headers: { 'x-wallet-address': validWallet },
        payload: { ...validBody, amount: 0 },
      });

      expect(res.statusCode).toBe(400);
    });

    it('should return 400 for amount above maximum', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/loans/quote',
        headers: { 'x-wallet-address': validWallet },
        payload: { ...validBody, amount: 20000 },
      });

      expect(res.statusCode).toBe(400);
    });

    it('should return 400 for non-integer term', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/loans/quote',
        headers: { 'x-wallet-address': validWallet },
        payload: { ...validBody, term: 2.5 },
      });

      expect(res.statusCode).toBe(400);
    });

    it('should return 400 for term exceeding 12 months', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/loans/quote',
        headers: { 'x-wallet-address': validWallet },
        payload: { ...validBody, term: 24 },
      });

      expect(res.statusCode).toBe(400);
    });

    it('should return 400 for invalid merchant UUID', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/loans/quote',
        headers: { 'x-wallet-address': validWallet },
        payload: { ...validBody, merchant: 'not-a-uuid' },
      });

      expect(res.statusCode).toBe(400);
    });

    it('should return 404 when merchant does not exist', async () => {
      mockSupabaseFrom.single.mockResolvedValue({
        data: null,
        error: { message: 'not found' },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/loans/quote',
        headers: { 'x-wallet-address': validWallet },
        payload: validBody,
      });

      expect(res.statusCode).toBe(404);
    }, 10000);

    it('should return 400 for forbidden extra fields', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/loans/quote',
        headers: { 'x-wallet-address': validWallet },
        payload: { ...validBody, extraField: 'hack' },
      });

      expect(res.statusCode).toBe(400);
    });

    it('should return 400 when amount exceeds user credit limit', async () => {
      jest.spyOn(app.get(ReputationService), 'getReputationData').mockResolvedValue({
        wallet: validWallet,
        score: 40,
        tier: 'poor',
        interestRate: 12,
        maxCredit: 500,
        lastUpdated: '2026-03-23T00:00:00.000Z',
      });

      const res = await app.inject({
        method: 'POST',
        url: '/loans/quote',
        headers: { 'x-wallet-address': validWallet },
        payload: { ...validBody, amount: 5000 },
      });

      expect(res.statusCode).toBe(400);
    }, 10000);
  });

  describe('POST /loans/create', () => {
    const validBody = { amount: 500, merchant: merchantId, term: 4 };

    it('should return 200 with loanId, xdr, and terms', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/loans/create',
        headers: { 'x-wallet-address': validWallet },
        payload: validBody,
      });

      expect(res.statusCode).toBe(200);

      const body = JSON.parse(res.payload);
      expect(body).toHaveProperty('success', true);
      expect(body).toHaveProperty('message', 'Pending loan created successfully');
      expect(body.data).toHaveProperty('loanId');
      expect(body.data).toHaveProperty('xdr', 'AAAAAgAAAAC...');
      expect(body.data).toHaveProperty('terms');
      expect(body.data.terms).toHaveProperty('guarantee', 100);
    }, 10000);

    it('should return 400 for invalid request body', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/loans/create',
        headers: { 'x-wallet-address': validWallet },
        payload: { amount: 500, merchant: merchantId },
      });

      expect(res.statusCode).toBe(400);
    });

    it('should return 400 for insufficient reputation', async () => {
      jest.spyOn(app.get(ReputationService), 'getReputationData').mockResolvedValue({
        wallet: validWallet,
        score: 40,
        tier: 'poor',
        interestRate: 12,
        maxCredit: 500,
        lastUpdated: '2026-03-23T00:00:00.000Z',
      });

      const res = await app.inject({
        method: 'POST',
        url: '/loans/create',
        headers: { 'x-wallet-address': validWallet },
        payload: { ...validBody, amount: 200 },
      });

      expect(res.statusCode).toBe(400);
    });

    it('should return 400 when amount exceeds credit', async () => {
      jest.spyOn(app.get(ReputationService), 'getReputationData').mockResolvedValue({
        wallet: validWallet,
        score: 75,
        tier: 'silver',
        interestRate: 8,
        maxCredit: 300,
        lastUpdated: '2026-03-23T00:00:00.000Z',
      });

      const res = await app.inject({
        method: 'POST',
        url: '/loans/create',
        headers: { 'x-wallet-address': validWallet },
        payload: validBody,
      });

      expect(res.statusCode).toBe(400);
    });

    it('should return 404 when merchant does not exist', async () => {
      mockSupabaseFrom.single.mockResolvedValue({
        data: null,
        error: { message: 'not found' },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/loans/create',
        headers: { 'x-wallet-address': validWallet },
        payload: validBody,
      });

      expect(res.statusCode).toBe(404);
    }, 10000);
  });
});
