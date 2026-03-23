import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as StellarSdk from 'stellar-sdk';
import { SorobanService } from '../soroban/soroban.service';

interface CreateLoanParams {
  loanId: string;
  merchantId: string;
  amount: number;
  loanAmount: number;
  guarantee: number;
  interestRate: number;
  term: number;
}

@Injectable()
export class CreditLineContractClient {
  private readonly logger = new Logger(CreditLineContractClient.name);
  private readonly contractId: string;

  constructor(
    private readonly sorobanService: SorobanService,
    private readonly configService: ConfigService,
  ) {
    this.contractId = this.configService.get<string>('CREDITLINE_CONTRACT_ID') || '';

    if (this.contractId) {
      this.logger.log(`Credit line contract loaded: ${this.contractId.slice(0, 8)}...`);
    } else {
      this.logger.warn('CREDITLINE_CONTRACT_ID is not set - create_loan() calls will fail');
    }
  }

  async buildCreateLoanTransaction(
    borrowerWallet: string,
    params: CreateLoanParams,
  ): Promise<string> {
    if (!this.contractId) {
      throw new Error('CREDITLINE_CONTRACT_ID is not configured');
    }

    const contract = new StellarSdk.Contract(this.contractId);
    const server = this.sorobanService.getServer();
    const networkPassphrase = this.sorobanService.getNetworkPassphrase();
    const sourceAccount = await server.getAccount(borrowerWallet);
    const amount = this.toContractAmount(params.amount);
    const loanAmount = this.toContractAmount(params.loanAmount);
    const guarantee = this.toContractAmount(params.guarantee);

    const tx = new StellarSdk.TransactionBuilder(sourceAccount, {
      fee: '100',
      networkPassphrase,
    })
      .addOperation(
        contract.call(
          'create_loan',
          StellarSdk.nativeToScVal(params.loanId, { type: 'string' }),
          StellarSdk.nativeToScVal(params.merchantId, { type: 'string' }),
          StellarSdk.nativeToScVal(amount, { type: 'i128' }),
          StellarSdk.nativeToScVal(loanAmount, { type: 'i128' }),
          StellarSdk.nativeToScVal(guarantee, { type: 'i128' }),
          StellarSdk.nativeToScVal(params.interestRate, { type: 'u32' }),
          StellarSdk.nativeToScVal(params.term, { type: 'u32' }),
        ),
      )
      .setTimeout(30)
      .build();

    const prepared = await server.prepareTransaction(tx);
    return prepared.toXDR();
  }

  private toContractAmount(value: number): bigint {
    return BigInt(Math.round(value * 100));
  }
}
