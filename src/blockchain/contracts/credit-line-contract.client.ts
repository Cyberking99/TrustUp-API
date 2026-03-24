import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as StellarSdk from 'stellar-sdk';
import { SorobanService } from '../soroban/soroban.service';

/**
 * TypeScript client for the on-chain CreditLine smart contract.
 * Encapsulates transaction-building for loan repayment operations.
 *
 * Follows the unsigned XDR pattern:
 *  1. API builds unsigned XDR via buildRepayLoanTx()
 *  2. Mobile app signs the transaction
 *  3. Mobile app submits the signed XDR back to the API
 */
@Injectable()
export class CreditLineContractClient {
  private readonly logger = new Logger(CreditLineContractClient.name);
  private readonly contractId: string;

  constructor(
    private readonly sorobanService: SorobanService,
    private readonly configService: ConfigService,
  ) {
    this.contractId = this.configService.get<string>('CREDIT_LINE_CONTRACT_ID') || '';

    if (this.contractId) {
      this.logger.log(`CreditLine contract loaded: ${this.contractId.slice(0, 8)}...`);
    } else {
      this.logger.warn('CREDIT_LINE_CONTRACT_ID is not set — contract calls will fail');
    }
  }

  /**
   * Builds an unsigned XDR transaction that calls repay_loan() on-chain.
   *
   * The transaction is NOT submitted — it is returned to the mobile app
   * for signing. The mobile app signs with the user's private key and
   * submits the signed XDR back via the submit endpoint.
   *
   * @param userWallet  - Borrower's Stellar public key (G... format)
   * @param loanId      - On-chain loan identifier
   * @param amount      - Payment amount in stroops (1 XLM = 10_000_000 stroops)
   * @returns Base64-encoded unsigned XDR transaction envelope
   */
  async buildRepayLoanTx(
    userWallet: string,
    loanId: string,
    amount: number,
  ): Promise<string> {
    if (!this.contractId) {
      throw new ServiceUnavailableException({
        code: 'BLOCKCHAIN_CONTRACT_NOT_CONFIGURED',
        message: 'Credit line contract is not configured. Please contact support.',
      });
    }

    try {
      const contract = new StellarSdk.Contract(this.contractId);
      const server = this.sorobanService.getServer();
      const networkPassphrase = this.sorobanService.getNetworkPassphrase();

      // Build args: repay_loan(user: Address, loan_id: String, amount: i128)
      const userArg = StellarSdk.nativeToScVal(
        StellarSdk.Address.fromString(userWallet),
        { type: 'address' },
      );
      const loanIdArg = StellarSdk.nativeToScVal(loanId, { type: 'string' });
      // Convert USD amount to stroops (7 decimal places, DECIMAL(20,7) in DB)
      const amountInStroops = BigInt(Math.round(amount * 10_000_000));
      const amountArg = StellarSdk.nativeToScVal(amountInStroops, { type: 'i128' });

      // Use a throwaway account to build the transaction; the real user wallet
      // is passed as the `user` argument inside the contract call
      const sourceKeypair = StellarSdk.Keypair.random();
      const sourceAccount = new StellarSdk.Account(sourceKeypair.publicKey(), '0');

      const tx = new StellarSdk.TransactionBuilder(sourceAccount, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase,
      })
        .addOperation(contract.call('repay_loan', userArg, loanIdArg, amountArg))
        .setTimeout(300)
        .build();

      // Simulate to get the resource fee and footprint, then assemble
      const simulation = await server.simulateTransaction(tx);

      if (StellarSdk.SorobanRpc.Api.isSimulationError(simulation)) {
        const errorMsg =
          (simulation as StellarSdk.SorobanRpc.Api.SimulateTransactionErrorResponse).error ||
          'Unknown simulation error';
        this.logger.error(`repay_loan simulation failed: ${errorMsg}`);
        throw new ServiceUnavailableException({
          code: 'BLOCKCHAIN_SIMULATION_FAILED',
          message: 'Failed to simulate repay_loan transaction. Please try again later.',
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
      this.logger.error(`Failed to build repay_loan transaction: ${error.message}`);
      throw new ServiceUnavailableException({
        code: 'BLOCKCHAIN_TX_BUILD_FAILED',
        message: 'Failed to construct repayment transaction. Please try again later.',
      });
    }
  }
}
