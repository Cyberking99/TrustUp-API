import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { LoansController } from '../../../../src/modules/loans/loans.controller';
import { LoansService } from '../../../../src/modules/loans/loans.service';
import { CreateLoanResponseDto } from '../../../../src/modules/loans/dto/create-loan-response.dto';

describe('LoansController', () => {
  let controller: LoansController;
  let loansService: LoansService;

  const validWallet = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW';

  const mockQuoteResponse = {
    amount: 500,
    guarantee: 100,
    loanAmount: 400,
    interestRate: 8,
    totalRepayment: 410.67,
    term: 4,
    schedule: [
      { paymentNumber: 1, amount: 102.66, dueDate: '2026-03-13T00:00:00.000Z' },
      { paymentNumber: 2, amount: 102.66, dueDate: '2026-04-13T00:00:00.000Z' },
      { paymentNumber: 3, amount: 102.66, dueDate: '2026-05-13T00:00:00.000Z' },
      { paymentNumber: 4, amount: 102.69, dueDate: '2026-06-13T00:00:00.000Z' },
    ],
  };

  const mockLoansService = {
    calculateLoanQuote: jest.fn(),
    createLoan: jest.fn(),
  };

  const mockCreateLoanResponse: CreateLoanResponseDto = {
    loanId: 'pending-1711180800000-ab12cd34',
    xdr: 'AAAAAgAAAAC...',
    description: 'Create BNPL loan for $500 at TechStore',
    terms: mockQuoteResponse,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [LoansController],
      providers: [
        { provide: LoansService, useValue: mockLoansService },
      ],
    }).compile();

    controller = module.get<LoansController>(LoansController);
    loansService = module.get<LoansService>(LoansService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // POST /loans/quote
  // ---------------------------------------------------------------------------
  describe('getLoanQuote', () => {
    const validDto = {
      amount: 500,
      merchant: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      term: 4,
    };

    it('should return a loan quote wrapped in response envelope', async () => {
      mockLoansService.calculateLoanQuote.mockResolvedValue(mockQuoteResponse);

      const result = await controller.getLoanQuote(validWallet, validDto);

      expect(result).toEqual({
        success: true,
        data: mockQuoteResponse,
        message: 'Loan quote calculated successfully',
      });
      expect(loansService.calculateLoanQuote).toHaveBeenCalledWith(
        validWallet,
        validDto,
      );
      expect(loansService.calculateLoanQuote).toHaveBeenCalledTimes(1);
    });

    it('should throw BadRequestException for missing wallet header', async () => {
      await expect(
        controller.getLoanQuote(undefined as any, validDto),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for empty wallet header', async () => {
      await expect(
        controller.getLoanQuote('', validDto),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for invalid wallet format', async () => {
      await expect(
        controller.getLoanQuote('INVALID_WALLET', validDto),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException with VALIDATION_INVALID_WALLET code', async () => {
      await expect(
        controller.getLoanQuote('short', validDto),
      ).rejects.toMatchObject({
        response: { code: 'VALIDATION_INVALID_WALLET' },
      });
    });

    it('should throw BadRequestException for wallet not starting with G', async () => {
      const badWallet = 'XABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW';

      await expect(
        controller.getLoanQuote(badWallet, validDto),
      ).rejects.toThrow(BadRequestException);
    });

    it('should propagate service errors to the caller', async () => {
      mockLoansService.calculateLoanQuote.mockRejectedValue(
        new Error('Reputation fetch failed'),
      );

      await expect(
        controller.getLoanQuote(validWallet, validDto),
      ).rejects.toThrow('Reputation fetch failed');
    });
  });

  describe('createLoan', () => {
    const validDto = {
      amount: 500,
      merchant: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      term: 4,
    };

    it('should return a created loan response wrapped in response envelope', async () => {
      mockLoansService.createLoan.mockResolvedValue(mockCreateLoanResponse);

      const result = await controller.createLoan(validWallet, validDto);

      expect(result).toEqual({
        success: true,
        data: mockCreateLoanResponse,
        message: 'Pending loan created successfully',
      });
      expect(loansService.createLoan).toHaveBeenCalledWith(validWallet, validDto);
      expect(loansService.createLoan).toHaveBeenCalledTimes(1);
    });

    it('should throw BadRequestException for invalid wallet format', async () => {
      await expect(controller.createLoan('INVALID_WALLET', validDto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should propagate service errors to the caller', async () => {
      mockLoansService.createLoan.mockRejectedValue(new Error('XDR construction failed'));

      await expect(controller.createLoan(validWallet, validDto)).rejects.toThrow(
        'XDR construction failed',
      );
    });
  });
});
