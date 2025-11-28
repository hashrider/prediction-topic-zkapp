/**
 * LMSR价格反推计算器
 * 计算需要多少token投注才能达到目标价格
 */

import {
    FP_SCALE,
    MAX_SHARES,
    lmsrBuyYesQuote,
    lmsrPriceYesFp
} from "./lmsr_math.js";

interface PriceCalculationResult {
    targetPrice: number;
    requiredBetAmount: bigint;
    netBetAmount: bigint;
    fee: bigint;
    newYesLiquidity: bigint;
    newNoLiquidity: bigint;
    actualPrice: number;
}

export class LMSRPriceCalculator {
    private static readonly INITIAL_YES_LIQUIDITY: bigint = 100000n;
    private static readonly INITIAL_NO_LIQUIDITY: bigint = 100000n;
    private static readonly DEFAULT_B: bigint = 1_000_000n;
    private static readonly PLATFORM_FEE_RATE: bigint = 100n; // 1%
    private static readonly FEE_BASIS_POINTS: bigint = 10000n;

    /**
     * 计算当前价格 (LMSR)
     */
    static calculateCurrentPrice(yesLiquidity: bigint, noLiquidity: bigint, b: bigint = this.DEFAULT_B): number {
        if (yesLiquidity === 0n && noLiquidity === 0n) {
            return 0.5;
        }
        const priceFp = lmsrPriceYesFp(yesLiquidity, noLiquidity, b);
        return Number(priceFp) / Number(FP_SCALE);
    }

    /**
     * 反推计算：需要多少YES投注才能达到目标价格 (LMSR)
     * 
     * 使用二分搜索找到需要购买的YES份额数，使得价格达到目标价格
     * Uses the same cost-based calculation as Rust backend's calculate_shares
     */
    static calculateRequiredYesBet(
        currentYesLiquidity: bigint,
        currentNoLiquidity: bigint,
        targetPrice: number,
        b: bigint = this.DEFAULT_B
    ): PriceCalculationResult {
        const currentYes = BigInt(currentYesLiquidity);
        const currentNo = BigInt(currentNoLiquidity);
        const bBig = BigInt(b);

        const targetPriceFp = BigInt(Math.round(targetPrice * Number(FP_SCALE)));
        const currentPriceFp = lmsrPriceYesFp(currentYes, currentNo, bBig);

        if (targetPriceFp <= currentPriceFp) {
            return {
                targetPrice,
                requiredBetAmount: 0n,
                netBetAmount: 0n,
                fee: 0n,
                newYesLiquidity: currentYes,
                newNoLiquidity: currentNo,
                actualPrice: Number(currentPriceFp) / Number(FP_SCALE)
            };
        }
        
        let lo = 0n;
        let hi = MAX_SHARES;
        
        while (lo < hi) {
            const mid = lo + (hi - lo) / 2n;
            const priceFp = lmsrPriceYesFp(currentYes + mid, currentNo, bBig);
            if (priceFp < targetPriceFp) {
                lo = mid + 1n;
            } else {
                hi = mid;
            }
        }
        
        const deltaYes = lo;
        const netQuote = lmsrBuyYesQuote(currentYes, currentNo, bBig, deltaYes);
        const netBetAmount = netQuote / FP_SCALE;
        const fee = (netBetAmount * this.PLATFORM_FEE_RATE + this.FEE_BASIS_POINTS - 1n) / this.FEE_BASIS_POINTS;
        const totalBetAmount = netBetAmount + fee;

        const actualNewYes = currentYes + deltaYes;
        const actualNewNo = currentNo;
        const actualPrice = this.calculateCurrentPrice(actualNewYes, actualNewNo, bBig);

        return {
            targetPrice,
            requiredBetAmount: totalBetAmount,
            netBetAmount,
            fee,
            newYesLiquidity: actualNewYes,
            newNoLiquidity: actualNewNo,
            actualPrice
        };
    }

    /**
     * 计算达到多个目标价格所需的投注
     */
    static calculateMultipleTargets(
        currentYesLiquidity: bigint = this.INITIAL_YES_LIQUIDITY,
        currentNoLiquidity: bigint = this.INITIAL_NO_LIQUIDITY,
        targetPrices: number[] = [0.6, 0.7, 0.8, 0.9],
        b: bigint = this.DEFAULT_B
    ): PriceCalculationResult[] {
        return targetPrices.map(price => 
            this.calculateRequiredYesBet(currentYesLiquidity, currentNoLiquidity, price, b)
        );
    }

    /**
     * 格式化显示结果
     */
    static formatResults(results: PriceCalculationResult[]): string {
        let output = "\n=== LMSR Price Movement Calculation Results ===\n";
        output += "Initial State: YES=100,000, NO=100,000, Current Price=50%\n\n";
        
        results.forEach((result, index) => {
            const targetPercent = (result.targetPrice * 100).toFixed(0);
            const actualPercent = (result.actualPrice * 100).toFixed(1);
            
            output += `Target ${targetPercent}%:\n`;
            output += `   Required Bet: ${result.requiredBetAmount.toLocaleString()} tokens\n`;
            output += `   Net Bet Amount: ${result.netBetAmount.toLocaleString()} tokens\n`;
            output += `   Fee: ${result.fee.toLocaleString()} tokens\n`;
            output += `   New Liquidity: YES=${result.newYesLiquidity.toLocaleString()}, NO=${result.newNoLiquidity.toLocaleString()}\n`;
            output += `   Actual Price: ${actualPercent}%\n\n`;
        });

        return output;
    }

    /**
     * 计算累积投注效果（连续投注）
     */
    static calculateCumulativeEffect(
        targetPrices: number[],
        b: bigint = this.DEFAULT_B
    ): {
        individual: PriceCalculationResult[],
        cumulative: PriceCalculationResult[]
    } {
        // 单独投注效果（从初始状态）
        const individual = this.calculateMultipleTargets(
            this.INITIAL_YES_LIQUIDITY,
            this.INITIAL_NO_LIQUIDITY,
            targetPrices,
            b
        );

        // 累积投注效果（连续投注）
        const cumulative: PriceCalculationResult[] = [];
        let currentYes = this.INITIAL_YES_LIQUIDITY;
        let currentNo = this.INITIAL_NO_LIQUIDITY;

        for (const targetPrice of targetPrices) {
            const result = this.calculateRequiredYesBet(currentYes, currentNo, targetPrice, b);
            cumulative.push(result);
            
            // 更新流动性状态
            currentYes = result.newYesLiquidity;
            currentNo = result.newNoLiquidity;
        }

        return { individual, cumulative };
    }
}

// 执行计算并输出结果
export function calculatePriceTargets() {
    console.log("=== Individual Bet Effects (starting from 50%) ===");
    const individualResults = LMSRPriceCalculator.calculateMultipleTargets();
    console.log(LMSRPriceCalculator.formatResults(individualResults));

    console.log("=== Cumulative Bet Effects (consecutive price movements) ===");
    const { cumulative } = LMSRPriceCalculator.calculateCumulativeEffect([0.6, 0.7, 0.8, 0.9]);
    
    let totalInvestment = 0n;
    let currentPrice = 50;
    
    cumulative.forEach((result, index) => {
        const targetPercent = (result.targetPrice * 100).toFixed(0);
        const fromPercent = currentPrice.toFixed(0);
        
        totalInvestment += result.requiredBetAmount;
        
        console.log(`Moving from ${fromPercent}% to ${targetPercent}%:`);
        console.log(`   This bet: ${result.requiredBetAmount.toLocaleString()} tokens`);
        console.log(`   Total invested: ${totalInvestment.toLocaleString()} tokens`);
        console.log(`   New liquidity: YES=${result.newYesLiquidity.toLocaleString()}, NO=${result.newNoLiquidity.toLocaleString()}\n`);
        
        currentPrice = result.actualPrice * 100;
    });

    return { individual: individualResults, cumulative };
}

// 如果直接运行这个文件
if (typeof require !== 'undefined' && require.main === module) {
    calculatePriceTargets();
} 