import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException, HttpException } from "@nestjs/common";
import { LiquidityService } from "../../../../src/modules/liquidity/liquidity.service";
import { LiquidityContractClient } from "../../../../src/blockchain/contracts/liquidity-contract.client";

describe("LiquidityService", () => {
  let service: LiquidityService;

  const validWallet =
    "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW";

  const mockLiquidityContractClient = {
    getProviderShares: jest.fn(),
    getPoolSnapshot: jest.fn(),
    buildWithdrawTx: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LiquidityService,
        {
          provide: LiquidityContractClient,
          useValue: mockLiquidityContractClient,
        },
      ],
    }).compile();

    service = module.get<LiquidityService>(LiquidityService);
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("withdrawLiquidity", () => {
    it("should construct an unsigned XDR and preview for a valid partial withdrawal", async () => {
      mockLiquidityContractClient.getProviderShares.mockResolvedValue(925);
      mockLiquidityContractClient.getPoolSnapshot.mockResolvedValue({
        totalLiquidity: 100000,
        availableLiquidity: 1500,
        sharePrice: 1.08,
        withdrawalFeeBps: 50,
      });
      mockLiquidityContractClient.buildWithdrawTx.mockResolvedValue(
        "AAAAAgAAAAA...",
      );

      const result = await service.withdrawLiquidity(validWallet, {
        shares: 500,
      });

      expect(result).toEqual({
        unsignedXdr: "AAAAAgAAAAA...",
        description: "Withdraw 500 shares from liquidity pool",
        preview: {
          shares: 500,
          ownedShares: 925,
          remainingShares: 425,
          currentSharePrice: 1.08,
          expectedAmount: 540,
          feeBps: 50,
          fee: 2.7,
          netAmount: 537.3,
          availableLiquidity: 1500,
        },
      });
      expect(mockLiquidityContractClient.buildWithdrawTx).toHaveBeenCalledWith(
        validWallet,
        500,
      );
    });

    it("should reject zero or negative shares before hitting the blockchain client", async () => {
      await expect(
        service.withdrawLiquidity(validWallet, { shares: 0 }),
      ).rejects.toThrow(BadRequestException);

      expect(
        mockLiquidityContractClient.getProviderShares,
      ).not.toHaveBeenCalled();
      expect(
        mockLiquidityContractClient.getPoolSnapshot,
      ).not.toHaveBeenCalled();
    });

    it("should reject withdrawals above the user share balance", async () => {
      mockLiquidityContractClient.getProviderShares.mockResolvedValue(
        499.9999999,
      );
      mockLiquidityContractClient.getPoolSnapshot.mockResolvedValue({
        totalLiquidity: 100000,
        availableLiquidity: 10000,
        sharePrice: 1.08,
        withdrawalFeeBps: 0,
      });

      await expect(
        service.withdrawLiquidity(validWallet, { shares: 500 }),
      ).rejects.toMatchObject({
        response: { code: "LIQUIDITY_INSUFFICIENT_SHARES" },
      });
    });

    it("should fail gracefully when pool available liquidity is insufficient", async () => {
      mockLiquidityContractClient.getProviderShares.mockResolvedValue(1000);
      mockLiquidityContractClient.getPoolSnapshot.mockResolvedValue({
        totalLiquidity: 100000,
        availableLiquidity: 400,
        sharePrice: 1.08,
        withdrawalFeeBps: 0,
      });

      await expect(
        service.withdrawLiquidity(validWallet, { shares: 500 }),
      ).rejects.toThrow(HttpException);

      try {
        await service.withdrawLiquidity(validWallet, { shares: 500 });
        fail("Expected insufficient liquidity error");
      } catch (error) {
        expect((error as HttpException).getStatus()).toBe(402);
        expect((error as HttpException).getResponse()).toEqual(
          expect.objectContaining({
            code: "LIQUIDITY_INSUFFICIENT_AVAILABLE_LIQUIDITY",
          }),
        );
      }
    });

    it("should support zero configured withdrawal fees", async () => {
      mockLiquidityContractClient.getProviderShares.mockResolvedValue(1000);
      mockLiquidityContractClient.getPoolSnapshot.mockResolvedValue({
        totalLiquidity: 100000,
        availableLiquidity: 10000,
        sharePrice: 1,
        withdrawalFeeBps: 0,
      });
      mockLiquidityContractClient.buildWithdrawTx.mockResolvedValue(
        "AAAAAgAAAAA...",
      );

      const result = await service.withdrawLiquidity(validWallet, {
        shares: 250.5,
      });

      expect(result.preview.expectedAmount).toBe(250.5);
      expect(result.preview.fee).toBe(0);
      expect(result.preview.netAmount).toBe(250.5);
      expect(result.preview.remainingShares).toBe(749.5);
    });
  });
});
