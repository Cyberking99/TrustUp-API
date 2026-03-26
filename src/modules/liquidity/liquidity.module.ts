import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AuthModule } from "../auth/auth.module";
import { LiquidityController } from "./liquidity.controller";
import { LiquidityService } from "./liquidity.service";
import { SorobanService } from "../../blockchain/soroban/soroban.service";
import { LiquidityContractClient } from "../../blockchain/contracts/liquidity-contract.client";

@Module({
  imports: [ConfigModule, AuthModule],
  controllers: [LiquidityController],
  providers: [LiquidityService, SorobanService, LiquidityContractClient],
  exports: [LiquidityService],
})
export class LiquidityModule {}
