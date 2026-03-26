import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { LiquidityService } from "./liquidity.service";
import { LiquidityWithdrawRequestDto } from "./dto/liquidity-withdraw-request.dto";
import { LiquidityWithdrawResponseDto } from "./dto/liquidity-withdraw-response.dto";

@ApiTags("liquidity")
@Controller("liquidity")
export class LiquidityController {
  constructor(private readonly liquidityService: LiquidityService) {}

  @Post("withdraw")
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Construct a liquidity withdrawal transaction",
    description:
      "Validates the authenticated user share balance, checks pool available liquidity, calculates the expected payout and fees, and returns an unsigned Soroban withdraw() XDR for the client to sign.",
  })
  @ApiResponse({
    status: 200,
    description:
      "Unsigned XDR transaction and withdrawal preview returned successfully",
    type: LiquidityWithdrawResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: "Invalid share amount or insufficient shares",
  })
  @ApiResponse({
    status: 401,
    description: "Unauthorized - missing or invalid JWT",
  })
  @ApiResponse({
    status: 402,
    description: "Pool has insufficient available liquidity",
  })
  @ApiResponse({
    status: 503,
    description: "Liquidity contract unavailable or network issue",
  })
  async withdrawLiquidity(
    @CurrentUser() user: { wallet: string },
    @Body() dto: LiquidityWithdrawRequestDto,
  ) {
    const data = await this.liquidityService.withdrawLiquidity(
      user.wallet,
      dto,
    );
    return {
      success: true,
      data,
      message: "Withdrawal transaction constructed successfully",
    };
  }
}
