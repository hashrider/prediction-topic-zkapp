import fetch from 'node-fetch';
import { PlayerConvention, ZKWasmAppRpc, createCommand } from "zkwasm-minirollup-rpc";
import { get_server_admin_key } from "zkwasm-ts-server/src/config.js";
import { stringToU64Array, validateMarketTitleLength } from "./models.js";
import {
    FP_SCALE,
    MAX_SHARES,
    lmsrBuyNoQuote,
    lmsrBuyYesQuote,
    lmsrPriceNoFp,
    lmsrPriceYesFp,
    lmsrSellNoQuote,
    lmsrSellYesQuote
} from "./lmsr_math.js";

export const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:3000";

// Command constants - updated for multi-market
const TICK = 0;
const INSTALL_PLAYER = 1;
const WITHDRAW = 2;
const DEPOSIT = 3;
const BET = 4;
const SELL = 5;
const RESOLVE = 6;
const CLAIM = 7;
const WITHDRAW_FEES = 8;
const CREATE_MARKET = 9;

// Fee constants - centralized to avoid duplication
const PLATFORM_FEE_RATE = 100n; // 1%
const FEE_BASIS_POINTS = 10000n;

export class Player extends PlayerConvention {
    constructor(key: string, rpc: ZKWasmAppRpc) {
        super(key, rpc, BigInt(DEPOSIT), BigInt(WITHDRAW));
        this.processingKey = key;
        this.rpc = rpc;
    }

    async sendTransactionWithCommand(cmd: BigUint64Array) {
        try {
            let result = await this.rpc.sendTransaction(cmd, this.processingKey);
            return result;
        } catch (e) {
            if (e instanceof Error) {
                console.log(e.message);
            }
            throw e;
        }
    }

    async installPlayer() {
        try {
            let cmd = createCommand(0n, BigInt(INSTALL_PLAYER), []);
            return await this.sendTransactionWithCommand(cmd);
        } catch (e) {
            if (e instanceof Error && e.message === "PlayerAlreadyExists") {
                console.log("Player already exists, skipping installation");
                return null; // Not an error, just already exists
            }
            throw e; // Re-throw other errors
        }
    }

    // Updated to include market_id
    async placeBet(marketId: bigint, betType: number, amount: bigint) {
        let nonce = await this.getNonce();
        let cmd = createCommand(nonce, BigInt(BET), [marketId, BigInt(betType), amount]);
        return await this.sendTransactionWithCommand(cmd);
    }

    // Updated to include market_id
    async sellShares(marketId: bigint, sellType: number, shares: bigint) {
        let nonce = await this.getNonce();
        let cmd = createCommand(nonce, BigInt(SELL), [marketId, BigInt(sellType), shares]);
        return await this.sendTransactionWithCommand(cmd);
    }

    // Updated to include market_id
    async claimWinnings(marketId: bigint) {
        let nonce = await this.getNonce();
        let cmd = createCommand(nonce, BigInt(CLAIM), [marketId]);
        return await this.sendTransactionWithCommand(cmd);
    }

    // Updated to include market_id
    async resolveMarket(marketId: bigint, outcome: boolean) {
        let nonce = await this.getNonce();
        let cmd = createCommand(nonce, BigInt(RESOLVE), [marketId, outcome ? 1n : 0n]);
        return await this.sendTransactionWithCommand(cmd);
    }

    // Updated to include market_id
    async withdrawFees(marketId: bigint) {
        let nonce = await this.getNonce();
        let cmd = createCommand(nonce, BigInt(WITHDRAW_FEES), [marketId]);
        return await this.sendTransactionWithCommand(cmd);
    }

    // Create markets with relative time offsets (LMSR)
    async createMarket(
        title: string,
        startTimeOffset: bigint,    // Offset from current counter
        endTimeOffset: bigint,      // Offset from current counter
        resolutionTimeOffset: bigint, // Offset from current counter
        initialYesLiquidity: bigint, // Initial YES shares for LMSR
        initialNoLiquidity: bigint,  // Initial NO shares for LMSR
        b: bigint                    // LMSR liquidity parameter (market depth)
    ) {
        // Validate title length before creating market
        const titleValidation = validateMarketTitleLength(title);
        if (!titleValidation.valid) {
            throw new Error(titleValidation.message);
        }
        
        let nonce = await this.getNonce();
        const titleU64Array = stringToU64Array(title);
        
        // Build command: [cmd, ...title_u64s, start_time_offset, end_time_offset, resolution_time_offset, yes_liquidity, no_liquidity, b]
        const params = [
            ...titleU64Array,
            startTimeOffset,
            endTimeOffset,
            resolutionTimeOffset,
            initialYesLiquidity,
            initialNoLiquidity,
            b
        ];
        
        let cmd = createCommand(nonce, BigInt(CREATE_MARKET), params);
        return await this.sendTransactionWithCommand(cmd);
    }

    async withdrawFunds(amount: bigint, addressHigh: bigint, addressLow: bigint) {
        let nonce = await this.getNonce();
        let cmd = createCommand(nonce, BigInt(WITHDRAW), [0n, amount, addressHigh, addressLow]);
        return await this.sendTransactionWithCommand(cmd);
    }

    async depositFunds(amount: bigint, targetPid1: bigint, targetPid2: bigint) {
        let nonce = await this.getNonce();
        let cmd = createCommand(nonce, BigInt(DEPOSIT), [targetPid1, targetPid2, 0n, amount]);
        return await this.sendTransactionWithCommand(cmd);
    }
}

// Updated interfaces for multi-market support (LMSR)
export interface MarketData {
    marketId: string;
    title: string;
    titleString?: string; // Converted from u64 array to string
    startTime: string;
    endTime: string;
    resolutionTime: string;
    totalYesShares: string;
    totalNoShares: string;
    b: string;              // LMSR liquidity parameter
    poolBalance: string;    // Collateral in the LMSR market
    totalVolume: string;
    resolved: boolean;
    outcome: boolean | null;
    totalFeesCollected: string;
}

export interface TransactionData {
    index: string;
    pid: string[];
    marketId: string;
    betType: number;
    amount: string;
    shares: string;
    counter: string;
    transactionType: 'BET_YES' | 'BET_NO' | 'SELL_YES' | 'SELL_NO';
    originalBetType: number;
}

export interface LiquidityHistoryData {
    marketId: string;
    counter: string;
    yesLiquidity: string;
    noLiquidity: string;
}

export interface PlayerMarketPosition {
    pid: string[];
    marketId: string;
    yesShares: string;
    noShares: string;
    claimed: boolean;
}

export class PredictionMarketAPI {
    private adminKey: any;
    private baseUrl: string;

    constructor(baseUrl: string = API_BASE_URL) {
        this.adminKey = get_server_admin_key();
        this.baseUrl = baseUrl;
    }

    // Get all markets
    async getAllMarkets(): Promise<MarketData[]> {
        const response = await fetch(`${this.baseUrl}/data/markets`);
        const result = await response.json() as any;
        if (!result.success) {
            throw new Error(result.message || 'Failed to get markets data');
        }
        return result.data;
    }

    // Get specific market data
    async getMarket(marketId: string): Promise<MarketData> {
        const response = await fetch(`${this.baseUrl}/data/market/${marketId}`);
        const result = await response.json() as any;
        if (!result.success) {
            throw new Error(result.message || 'Failed to get market data');
        }
        return result.data;
    }

    // Get recent 20 transactions for specific market
    async getMarketRecentTransactions(marketId: string): Promise<TransactionData[]> {
        const response = await fetch(`${this.baseUrl}/data/market/${marketId}/recent`);
        const result = await response.json() as any;
        if (!result.success) {
            throw new Error(result.message || 'Failed to get market recent transactions');
        }
        return result.data;
    }

    // Get player's recent 20 transactions across all markets
    async getPlayerRecentTransactions(pid1: string, pid2: string): Promise<TransactionData[]> {
        const response = await fetch(`${this.baseUrl}/data/player/${pid1}/${pid2}/recent`);
        const result = await response.json() as any;
        if (!result.success) {
            throw new Error(result.message || 'Failed to get player recent transactions');
        }
        return result.data;
    }

    // Get player's recent 20 transactions for specific market
    async getPlayerMarketRecentTransactions(pid1: string, pid2: string, marketId: string): Promise<TransactionData[]> {
        const response = await fetch(`${this.baseUrl}/data/player/${pid1}/${pid2}/market/${marketId}/recent`);
        const result = await response.json() as any;
        if (!result.success) {
            throw new Error(result.message || 'Failed to get player market recent transactions');
        }
        return result.data;
    }

    // Get player market position
    async getPlayerMarketPosition(pid1: string, pid2: string, marketId: string): Promise<PlayerMarketPosition> {
        const response = await fetch(`${this.baseUrl}/data/player/${pid1}/${pid2}/market/${marketId}`);
        const result = await response.json() as any;
        if (!result.success) {
            throw new Error(result.message || 'Failed to get player market position');
        }
        return result.data;
    }

    // Get all player positions across markets
    async getPlayerAllPositions(pid1: string, pid2: string): Promise<PlayerMarketPosition[]> {
        const response = await fetch(`${this.baseUrl}/data/player/${pid1}/${pid2}/positions`);
        const result = await response.json() as any;
        if (!result.success) {
            throw new Error(result.message || 'Failed to get player positions');
        }
        return result.data;
    }

    // Get market liquidity history for recent 100 counters (only liquidity data)
    async getMarketLiquidityHistory(marketId: string): Promise<LiquidityHistoryData[]> {
        const response = await fetch(`${this.baseUrl}/data/market/${marketId}/liquidity`);
        const result = await response.json() as any;
        if (!result.success) {
            throw new Error(result.message || 'Failed to get market liquidity history');
        }
        return result.data;
    }

    // Binary search to find shares for a given bet amount (LMSR)
    // Matches Rust backend's calculate_shares implementation exactly
    calculateShares(betType: number, amount: number, yesLiquidity: bigint, noLiquidity: bigint, b: bigint = 1000000n): bigint {
        const betAmount = BigInt(amount);
        const fee = (betAmount * PLATFORM_FEE_RATE + FEE_BASIS_POINTS - 1n) / FEE_BASIS_POINTS;
        const netAmount = betAmount - fee;
        
        const qYes = BigInt(yesLiquidity);
        const qNo = BigInt(noLiquidity);
        const bBig = BigInt(b);
        
        let lo = 0n;
        let hi = MAX_SHARES;
        
        while (lo < hi) {
            const mid = lo + (hi - lo + 1n) / 2n;
            let quote: bigint;
            
            try {
                quote = betType === 1
                    ? lmsrBuyYesQuote(qYes, qNo, bBig, mid)
                    : lmsrBuyNoQuote(qYes, qNo, bBig, mid);
            } catch {
                hi = mid - 1n;
                continue;
            }
            
            const quoteTokens = quote / FP_SCALE;
            if (quoteTokens <= netAmount) {
                lo = mid;
            } else {
                hi = mid - 1n;
            }
        }
        
        if (lo === 0n) {
            try {
                const singleQuote = betType === 1
                    ? lmsrBuyYesQuote(qYes, qNo, bBig, 1n)
                    : lmsrBuyNoQuote(qYes, qNo, bBig, 1n);
                const singleTokens = singleQuote / FP_SCALE;
                if (singleTokens > netAmount) {
                    return 0n;
                }
                lo = 1n;
            } catch {
                return 0n;
            }
        }
        
        return lo;
    }

    calculateSellDetails(sellType: number, shares: number, yesLiquidity: bigint, noLiquidity: bigint, b: bigint = 1000000n): { netPayout: bigint, fee: bigint } {
        const sharesToSell = BigInt(shares);
        const qYes = BigInt(yesLiquidity);
        const qNo = BigInt(noLiquidity);
        const bBig = BigInt(b);
        
        let grossQuote: bigint;
        if (sellType === 1) {
            grossQuote = lmsrSellYesQuote(qYes, qNo, bBig, sharesToSell);
        } else {
            grossQuote = lmsrSellNoQuote(qYes, qNo, bBig, sharesToSell);
        }
        
        const grossAmount = grossQuote / FP_SCALE;
        const fee = (grossAmount * PLATFORM_FEE_RATE + FEE_BASIS_POINTS - 1n) / FEE_BASIS_POINTS;
        const netPayout = grossAmount - fee;
        
        return { netPayout, fee };
    }

    calculateSellValue(sellType: number, shares: number, yesLiquidity: bigint, noLiquidity: bigint, b: bigint = 1000000n): bigint {
        const result = this.calculateSellDetails(sellType, shares, yesLiquidity, noLiquidity, b);
        return result.netPayout;
    }

    getBuyPrice(betType: number, amount: number, yesLiquidity: bigint, noLiquidity: bigint, b: bigint = 1000000n): number {
        const shares = this.calculateShares(betType, amount, yesLiquidity, noLiquidity, b);
        if (shares === 0n) return 0;
        return (amount * 1000000) / Number(shares); // Return price in terms of precision
    }

    getSellPrice(sellType: number, shares: number, yesLiquidity: bigint, noLiquidity: bigint, b: bigint = 1000000n): number {
        const payout = this.calculateSellValue(sellType, shares, yesLiquidity, noLiquidity, b);
        if (shares === 0) return 0;
        return (Number(payout) * 1000000) / shares; // Return price in terms of precision
    }

    calculateMarketImpact(betType: number, amount: number, yesLiquidity: bigint, noLiquidity: bigint, b: bigint = 1000000n): { 
        currentYesPrice: number, 
        currentNoPrice: number, 
        newYesPrice: number, 
        newNoPrice: number 
    } {
        const currentPrices = this.calculatePrices(yesLiquidity, noLiquidity, b);
        const shares = this.calculateShares(betType, amount, yesLiquidity, noLiquidity, b);
        
        let newYesLiquidity: bigint = yesLiquidity;
        let newNoLiquidity: bigint = noLiquidity;
        if (betType === 1) {
            newYesLiquidity = yesLiquidity + shares;
        } else {
            newNoLiquidity = noLiquidity + shares;
        }
        
        const newPrices = this.calculatePrices(newYesLiquidity, newNoLiquidity, b);
        
        return {
            currentYesPrice: currentPrices.yesPrice,
            currentNoPrice: currentPrices.noPrice,
            newYesPrice: newPrices.yesPrice,
            newNoPrice: newPrices.noPrice
        };
    }

    calculateSlippage(betType: number, amount: number, yesLiquidity: bigint, noLiquidity: bigint, b: bigint = 1000000n): number {
        const impact = this.calculateMarketImpact(betType, amount, yesLiquidity, noLiquidity, b);
        
        if (betType === 1) { // YES bet
            return ((impact.newYesPrice - impact.currentYesPrice) / impact.currentYesPrice) * 100;
        } else { // NO bet
            return ((impact.newNoPrice - impact.currentNoPrice) / impact.currentNoPrice) * 100;
        }
    }

    calculatePrices(yesLiquidity: bigint, noLiquidity: bigint, b: bigint = 1000000n): { yesPrice: number, noPrice: number } {
        const qYes = BigInt(yesLiquidity);
        const qNo = BigInt(noLiquidity);
        const bBig = BigInt(b);
        
        if (qYes === 0n && qNo === 0n) {
            return { yesPrice: 0.5, noPrice: 0.5 };
        }
        
        const yesPrice = Number(lmsrPriceYesFp(qYes, qNo, bBig)) / Number(FP_SCALE);
        const noPrice = Number(lmsrPriceNoFp(qYes, qNo, bBig)) / Number(FP_SCALE);
        
        return { yesPrice, noPrice };
    }
}

// Updated transaction builders for multi-market
export function buildBetTransaction(nonce: number, marketId: bigint, betType: number, amount: bigint): bigint[] {
    return [BigInt(nonce), BigInt(BET), marketId, BigInt(betType), amount];
}

export function buildSellTransaction(nonce: number, marketId: bigint, sellType: number, shares: bigint): bigint[] {
    return [BigInt(nonce), BigInt(SELL), marketId, BigInt(sellType), shares];
}

export function buildResolveTransaction(nonce: number, marketId: bigint, outcome: boolean): bigint[] {
    return [BigInt(nonce), BigInt(RESOLVE), marketId, outcome ? 1n : 0n];
}

export function buildClaimTransaction(nonce: number, marketId: bigint): bigint[] {
    return [BigInt(nonce), BigInt(CLAIM), marketId];
}

export function buildWithdrawFeesTransaction(nonce: number, marketId: bigint): bigint[] {
    return [BigInt(nonce), BigInt(WITHDRAW_FEES), marketId];
}

export function buildCreateMarketTransaction(
    nonce: number,
    title: string,
    startTimeOffset: bigint,     // Offset from current counter
    endTimeOffset: bigint,       // Offset from current counter
    resolutionTimeOffset: bigint, // Offset from current counter
    initialYesLiquidity: bigint, // Initial YES shares for LMSR
    initialNoLiquidity: bigint,  // Initial NO shares for LMSR
    b: bigint                    // LMSR liquidity parameter
): bigint[] {
    // Validate title length before creating transaction
    const titleValidation = validateMarketTitleLength(title);
    if (!titleValidation.valid) {
        throw new Error(titleValidation.message);
    }
    
    const titleU64Array = stringToU64Array(title);
    return [
        BigInt(nonce),
        BigInt(CREATE_MARKET),
        ...titleU64Array,
        startTimeOffset,
        endTimeOffset,
        resolutionTimeOffset,
        initialYesLiquidity,
        initialNoLiquidity,
        b
    ];
}

export function buildWithdrawTransaction(
    nonce: number, 
    amount: bigint, 
    addressHigh: bigint, 
    addressLow: bigint
): bigint[] {
    return [BigInt(nonce), BigInt(WITHDRAW), 0n, amount, addressHigh, addressLow];
}

export function buildDepositTransaction(
    nonce: number,
    targetPid1: bigint,
    targetPid2: bigint,
    amount: bigint
): bigint[] {
    return [BigInt(nonce), BigInt(DEPOSIT), targetPid1, targetPid2, 0n, amount];
}

export function buildInstallPlayerTransaction(nonce: number): bigint[] {
    return [BigInt(nonce), BigInt(INSTALL_PLAYER)];
}

export async function exampleUsage() {
    const api = new PredictionMarketAPI();
    
    // Get all markets
    const markets = await api.getAllMarkets();
    console.log("All markets:", markets);
    
    // Get specific market
    if (markets.length > 0) {
        const marketId = markets[0].marketId;
        const market = await api.getMarket(marketId);
        console.log("Market details:", market);
        
        // Get market recent transactions
        const marketTransactions = await api.getMarketRecentTransactions(marketId);
        console.log("Market recent transactions:", marketTransactions);
        
        // Get market liquidity history
        const liquidityHistory = await api.getMarketLiquidityHistory(marketId);
        console.log("Market liquidity history:", liquidityHistory);
    }
} 
