import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as StellarSdk from "stellar-sdk";
import { SorobanService } from "../soroban/soroban.service";

export interface LiquidityPoolSnapshot {
  totalLiquidity: number;
  availableLiquidity: number;
  sharePrice: number;
  withdrawalFeeBps: number;
}

const STROOPS_SCALE = 10_000_000;

/**
 * Contract client for TrustUp's liquidity pool contract.
 *
 * This client keeps blockchain I/O and XDR construction isolated from the
 * LiquidityService, following the architecture docs in `docs/architecture/blockchain-layer.md`.
 */
@Injectable()
export class LiquidityContractClient {
  private readonly logger = new Logger(LiquidityContractClient.name);
  private readonly contractId: string;

  constructor(
    private readonly sorobanService: SorobanService,
    private readonly configService: ConfigService,
  ) {
    this.contractId =
      this.configService.get<string>("LIQUIDITY_POOL_CONTRACT_ID") || "";

    if (this.contractId) {
      this.logger.log(
        `Liquidity pool contract loaded: ${this.contractId.slice(0, 8)}...`,
      );
    } else {
      this.logger.warn(
        "LIQUIDITY_POOL_CONTRACT_ID is not set - liquidity contract calls will fail",
      );
    }
  }

  async getProviderShares(wallet: string): Promise<number> {
    const addressArg = StellarSdk.nativeToScVal(
      StellarSdk.Address.fromString(wallet),
      {
        type: "address",
      },
    );

    return this.readScaledContractNumber(
      ["get_provider_shares", "provider_shares", "get_shares", "shares_of"],
      [addressArg],
      "provider shares",
    );
  }

  async getPoolSnapshot(): Promise<LiquidityPoolSnapshot> {
    const [totalLiquidity, availableLiquidity, sharePrice, withdrawalFeeBps] =
      await Promise.all([
        this.readScaledContractNumber(
          ["get_total_liquidity", "total_liquidity"],
          [],
          "total liquidity",
        ),
        this.readScaledContractNumber(
          ["get_available_liquidity", "available_liquidity", "liquid_assets"],
          [],
          "available liquidity",
        ),
        this.readSharePrice(),
        this.readOptionalBasisPoints([
          "get_withdrawal_fee_bps",
          "withdrawal_fee_bps",
          "get_withdraw_fee_bps",
        ]),
      ]);

    return {
      totalLiquidity,
      availableLiquidity,
      sharePrice,
      withdrawalFeeBps,
    };
  }

  async buildWithdrawTx(userWallet: string, shares: number): Promise<string> {
    this.ensureConfigured();

    try {
      const contract = new StellarSdk.Contract(this.contractId);
      const server = this.sorobanService.getServer();
      const networkPassphrase = this.sorobanService.getNetworkPassphrase();

      const userArg = StellarSdk.nativeToScVal(
        StellarSdk.Address.fromString(userWallet),
        {
          type: "address",
        },
      );
      const sharesArg = StellarSdk.nativeToScVal(this.toScaledBigInt(shares), {
        type: "i128",
      });

      const sourceKeypair = StellarSdk.Keypair.random();
      const sourceAccount = new StellarSdk.Account(
        sourceKeypair.publicKey(),
        "0",
      );

      const tx = new StellarSdk.TransactionBuilder(sourceAccount, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase,
      })
        .addOperation(contract.call("withdraw", userArg, sharesArg))
        .setTimeout(300)
        .build();

      const simulation = await server.simulateTransaction(tx);

      if (StellarSdk.SorobanRpc.Api.isSimulationError(simulation)) {
        const errorMsg =
          (
            simulation as StellarSdk.SorobanRpc.Api.SimulateTransactionErrorResponse
          ).error || "Unknown simulation error";
        this.logger.error(`withdraw simulation failed: ${errorMsg}`);
        throw new ServiceUnavailableException({
          code: "BLOCKCHAIN_SIMULATION_FAILED",
          message:
            "Failed to simulate liquidity withdrawal transaction. Please try again later.",
        });
      }

      const assembledTx = StellarSdk.SorobanRpc.assembleTransaction(
        tx,
        simulation as StellarSdk.SorobanRpc.Api.SimulateTransactionSuccessResponse,
      ).build();

      return assembledTx.toXDR();
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        throw error;
      }

      this.logger.error(
        `Failed to build withdraw transaction: ${error.message}`,
      );
      throw new ServiceUnavailableException({
        code: "BLOCKCHAIN_TX_BUILD_FAILED",
        message:
          "Failed to construct liquidity withdrawal transaction. Please try again later.",
      });
    }
  }

  private async readSharePrice(): Promise<number> {
    try {
      return await this.readScaledContractNumber(
        ["get_share_price", "share_price", "current_share_price"],
        [],
        "share price",
      );
    } catch {
      const [totalLiquidity, totalShares] = await Promise.all([
        this.readScaledContractNumber(
          ["get_total_liquidity", "total_liquidity"],
          [],
          "total liquidity",
        ),
        this.readScaledContractNumber(
          ["get_total_shares", "total_shares"],
          [],
          "total shares",
        ),
      ]);

      if (totalShares <= 0) {
        return 0;
      }

      return this.roundTo7(totalLiquidity / totalShares);
    }
  }

  private async readOptionalBasisPoints(methods: string[]): Promise<number> {
    try {
      for (const method of methods) {
        try {
          const result = await this.sorobanService.simulateContractCall(
            this.contractId,
            method,
            [],
          );
          const native = StellarSdk.scValToNative(result);
          return this.toSafeNumber(native, false);
        } catch {
          // try next method name
        }
      }
    } catch {
      // fall through to default zero
    }

    this.logger.warn(
      "Withdrawal fee method not available on contract; defaulting fee to 0 bps",
    );
    return 0;
  }

  private async readScaledContractNumber(
    methods: string[],
    args: StellarSdk.xdr.ScVal[],
    label: string,
  ): Promise<number> {
    this.ensureConfigured();

    let lastError: unknown;

    for (const method of methods) {
      try {
        const result = await this.sorobanService.simulateContractCall(
          this.contractId,
          method,
          args,
        );
        return this.toSafeNumber(StellarSdk.scValToNative(result), true);
      } catch (error) {
        lastError = error;
      }
    }

    this.logger.error(
      `Failed to read ${label} from liquidity contract`,
      lastError as Error,
    );
    throw new ServiceUnavailableException({
      code: "BLOCKCHAIN_CONTRACT_READ_FAILED",
      message: `Failed to read ${label} from the liquidity pool contract. Please try again later.`,
    });
  }

  private ensureConfigured(): void {
    if (!this.contractId) {
      throw new ServiceUnavailableException({
        code: "BLOCKCHAIN_CONTRACT_NOT_CONFIGURED",
        message:
          "Liquidity pool contract is not configured. Please contact support.",
      });
    }
  }

  private toScaledBigInt(value: number): bigint {
    return BigInt(Math.round(value * STROOPS_SCALE));
  }

  private toSafeNumber(value: unknown, scaled: boolean): number {
    if (typeof value === "bigint") {
      return scaled
        ? this.roundTo7(Number(value) / STROOPS_SCALE)
        : Number(value);
    }

    if (typeof value === "number") {
      return scaled ? this.roundTo7(value / STROOPS_SCALE) : value;
    }

    if (typeof value === "string") {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) {
        throw new Error(`Unable to parse contract numeric string: ${value}`);
      }
      return scaled ? this.roundTo7(parsed / STROOPS_SCALE) : parsed;
    }

    if (value && typeof value === "object" && "toString" in (value as object)) {
      const parsed = Number(String(value));
      if (Number.isFinite(parsed)) {
        return scaled ? this.roundTo7(parsed / STROOPS_SCALE) : parsed;
      }
    }

    throw new Error(`Unsupported contract numeric value: ${String(value)}`);
  }

  private roundTo7(value: number): number {
    return Math.round(value * STROOPS_SCALE) / STROOPS_SCALE;
  }
}
