import {
  Injectable,
  BadRequestException,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { LiquidityContractClient } from "../../blockchain/contracts/liquidity-contract.client";
import { LiquidityWithdrawRequestDto } from "./dto/liquidity-withdraw-request.dto";
import { LiquidityWithdrawResponseDto } from "./dto/liquidity-withdraw-response.dto";

const FIXED_PRECISION = 10_000_000;

@Injectable()
export class LiquidityService {
  constructor(
    private readonly liquidityContractClient: LiquidityContractClient,
  ) {}

  /**
   * Builds an unsigned Soroban withdrawal transaction after validating the
   * caller's share balance and the pool's currently available liquidity.
   */
  async withdrawLiquidity(
    wallet: string,
    dto: LiquidityWithdrawRequestDto,
  ): Promise<LiquidityWithdrawResponseDto> {
    const requestedShares = this.roundTo7(dto.shares);

    if (requestedShares <= 0) {
      throw new BadRequestException({
        code: "VALIDATION_INVALID_SHARES",
        message: "Withdrawal shares must be greater than zero.",
      });
    }

    const [ownedShares, snapshot] = await Promise.all([
      this.liquidityContractClient.getProviderShares(wallet),
      this.liquidityContractClient.getPoolSnapshot(),
    ]);

    const normalizedOwnedShares = this.roundTo7(ownedShares);

    if (normalizedOwnedShares <= 0 || requestedShares > normalizedOwnedShares) {
      throw new BadRequestException({
        code: "LIQUIDITY_INSUFFICIENT_SHARES",
        message:
          "You do not have enough pool shares to complete this withdrawal.",
      });
    }

    const expectedAmount = this.roundTo7(requestedShares * snapshot.sharePrice);
    if (expectedAmount > this.roundTo7(snapshot.availableLiquidity)) {
      throw new HttpException(
        {
          code: "LIQUIDITY_INSUFFICIENT_AVAILABLE_LIQUIDITY",
          message:
            "The pool does not currently have enough liquid funds to satisfy this withdrawal. Please try a smaller amount or wait for liquidity to free up.",
        },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }

    const fee = this.roundTo7(
      expectedAmount * (snapshot.withdrawalFeeBps / 10_000),
    );
    const netAmount = this.roundTo7(expectedAmount - fee);
    const remainingShares = this.roundTo7(
      normalizedOwnedShares - requestedShares,
    );

    const unsignedXdr = await this.liquidityContractClient.buildWithdrawTx(
      wallet,
      requestedShares,
    );

    return {
      unsignedXdr,
      description: `Withdraw ${this.formatDisplayNumber(requestedShares)} shares from liquidity pool`,
      preview: {
        shares: requestedShares,
        ownedShares: normalizedOwnedShares,
        remainingShares,
        currentSharePrice: this.roundTo7(snapshot.sharePrice),
        expectedAmount,
        feeBps: snapshot.withdrawalFeeBps,
        fee,
        netAmount,
        availableLiquidity: this.roundTo7(snapshot.availableLiquidity),
      },
    };
  }

  private roundTo7(value: number): number {
    return Math.round(value * FIXED_PRECISION) / FIXED_PRECISION;
  }

  private formatDisplayNumber(value: number): string {
    return Number.isInteger(value)
      ? String(value)
      : this.roundTo7(value).toString();
  }
}
