import fetch from 'node-fetch';
import { PlayerConvention, ZKWasmAppRpc, createCommand } from "zkwasm-minirollup-rpc";
import { get_server_admin_key } from "zkwasm-ts-server/src/config.js";
import { stringToU64Array, validateMarketTitleLength } from "./models.js";

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

// ===== Fixed-point (1e6) helpers for deterministic LMSR =====
const PRICE_SCALE = 1_000_000n; // 1e6, matches Rust PRICE_PRECISION

function fpMul(a: bigint, b: bigint): bigint {
    return (a * b) / PRICE_SCALE;
}
function fpDiv(a: bigint, b: bigint): bigint {
    if (b === 0n) throw new Error("divide by zero");
    return (a * PRICE_SCALE) / b;
}
// exp(x) ≈ 1 + x + x^2/2 + x^3/6   where x is fixed-point (1e6)
function fpExpTaylor(x_fp: bigint): bigint {
    const one = PRICE_SCALE;
    const x1 = x_fp;
    const x2 = fpMul(x_fp, x_fp);
    const half = fpDiv(x2, 2n * PRICE_SCALE);
    const x3 = fpMul(x2, x_fp);
    const sixth = fpDiv(x3, 6n * PRICE_SCALE);
    return one + x1 + half + sixth;
}
// ln(y) ≈ (y-1) - (y-1)^2/2 + (y-1)^3/3, y>=1
function fpLnSeries(y_fp: bigint): bigint {
    if (y_fp < PRICE_SCALE) throw new Error("ln(y<1) unsupported");
    const z = y_fp - PRICE_SCALE;
    const z2 = fpMul(z, z);
    const z3 = fpMul(z2, z);
    const z2_over_2 = fpDiv(z2, 2n * PRICE_SCALE);
    const z3_over_3 = fpDiv(z3, 3n * PRICE_SCALE);
    return z - z2_over_2 + z3_over_3;
}
// exp(q/b), q,b are unscaled share counts / liquidity param
function fpExpQOverB(q: bigint, b: bigint): bigint {
    if (b === 0n) throw new Error("b=0");
    const q_over_b_fp = (q * PRICE_SCALE) / b;
    return fpExpTaylor(q_over_b_fp);
}

// ===== LMSR core =====
// C(q) = b * ln( exp(qYes/b) + exp(qNo/b) )  (fixed-point result)
function lmsrCost(qYes: bigint, qNo: bigint, b: bigint): bigint {
    const eYes = fpExpQOverB(qYes, b);
    const eNo  = fpExpQOverB(qNo, b);
    const lnSum = fpLnSeries(eYes + eNo);
    return b * lnSum; // still 1e6 fixed point
}
function lmsrPriceYes(qYes: bigint, qNo: bigint, b: bigint): bigint {
    const eYes = fpExpQOverB(qYes, b);
    const eNo  = fpExpQOverB(qNo, b);
    return fpDiv(eYes, eYes + eNo); // 1e6
}
function lmsrPriceNo(qYes: bigint, qNo: bigint, b: bigint): bigint {
    return PRICE_SCALE - lmsrPriceYes(qYes, qNo, b);
}
function lmsrBuyYesQuote(qYes: bigint, qNo: bigint, b: bigint, dYes: bigint): bigint {
    return lmsrCost(qYes + dYes, qNo, b) - lmsrCost(qYes, qNo, b);
}
function lmsrBuyNoQuote(qYes: bigint, qNo: bigint, b: bigint, dNo: bigint): bigint {
    return lmsrCost(qYes, qNo + dNo, b) - lmsrCost(qYes, qNo, b);
}
function lmsrSellYesQuote(qYes: bigint, qNo: bigint, b: bigint, sYes: bigint): bigint {
    if (sYes > qYes) throw new Error("sell YES exceeds outstanding");
    return lmsrCost(qYes, qNo, b) - lmsrCost(qYes - sYes, qNo, b);
}
function lmsrSellNoQuote(qYes: bigint, qNo: bigint, b: bigint, sNo: bigint): bigint {
    if (sNo > qNo) throw new Error("sell NO exceeds outstanding");
    return lmsrCost(qYes, qNo, b) - lmsrCost(qYes, qNo - sNo, b);
}

// Convert a fixed-point (1e6) quote to whole tokens (floor)
function quoteFpToTokens(fpAmount: bigint): bigint {
    return fpAmount / PRICE_SCALE;
}

// Binary search Δshares s.t. quote(Δ) ≤ netBudgetTokens
function solveDeltaSharesForBudget(
    sideYes: boolean,
    qYes: bigint,
    qNo: bigint,
    b: bigint,
    netBudgetTokens: bigint,
    maxSearch: bigint = 1_000_000_000n
): { deltaShares: bigint; costTokens: bigint } {
    let lo = 0n, hi = maxSearch;
    while (lo < hi) {
    const mid = (lo + hi + 1n) / 2n;
    const quoteFp = sideYes
        ? lmsrBuyYesQuote(qYes, qNo, b, mid)
        : lmsrBuyNoQuote(qYes, qNo, b, mid);
    const quoteTokens = quoteFpToTokens(quoteFp);
    if (quoteTokens <= netBudgetTokens) lo = mid;
    else hi = mid - 1n;
    }
    const finalQuote = sideYes
    ? lmsrBuyYesQuote(qYes, qNo, b, lo)
    : lmsrBuyNoQuote(qYes, qNo, b, lo);
    return { deltaShares: lo, costTokens: quoteFpToTokens(finalQuote) };
}
  
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

    // Create markets with relative time offsets
    async createMarket(
        title: string,
        startTimeOffset: bigint,    // Offset from current counter
        endTimeOffset: bigint,      // Offset from current counter
        resolutionTimeOffset: bigint, // Offset from current counter
        yesLiquidity: bigint,
        noLiquidity: bigint,
        b: bigint
    ) {
        // Validate title length before creating market
        const titleValidation = validateMarketTitleLength(title);
        if (!titleValidation.valid) {
            throw new Error(titleValidation.message);
        }
        
        let nonce = await this.getNonce();
        const titleU64Array = stringToU64Array(title);
        
        // Build command: [cmd, ...title_u64s, start_time_offset, end_time_offset, resolution_time_offset, yes_liquidity, no_liquidity]
        const params = [
            ...titleU64Array,
            startTimeOffset,
            endTimeOffset,
            resolutionTimeOffset,
            yesLiquidity,
            noLiquidity,
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

// Updated interfaces for multi-market support
export interface MarketData {
    marketId: string;
    title: string;
    titleString?: string; // Converted from u64 array to string
    startTime: string;
    endTime: string;
    resolutionTime: string;
    yesLiquidity: string;
    noLiquidity: string;
    prizePool: string;
    totalVolume: string;
    totalYesShares: string;
    totalNoShares: string;
    b: string;
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
export interface StatsData {
    totalVolume: string;
    totalBets: number;
    totalPlayers: number;
    totalFeesCollected: string;
    poolBalance: string;
    totalYesShares: string;
    totalNoShares: string;
    b: string;
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
    // Unified shares calculation using LMSR + binary search
    // betType: 1=YES, 0=NO ; amount: tokens (number)
    calculateShares(
        betType: number,
        amount: number,
        qYes: bigint,
        qNo: bigint,
        b: bigint
    ): bigint {
        if (amount <= 0) return 0n;
        const gross = BigInt(amount);
        // fee (ceil-like original): (amount * rate + basis - 1) / basis
        const fee = (gross * PLATFORM_FEE_RATE + FEE_BASIS_POINTS - 1n) / FEE_BASIS_POINTS;
        const net = gross - fee;
        const sideYes = betType === 1;
        const { deltaShares } = solveDeltaSharesForBudget(sideYes, qYes, qNo, b, net);
        return deltaShares;
    }

    // Calculate sell details (net payout and fee) - unified function under LMSR
    calculateSellDetails(
        sellType: number,
        shares: number,
        qYes: bigint,
        qNo: bigint,
        b: bigint
    ): { netPayout: bigint, fee: bigint } {
        if (shares <= 0) return { netPayout: 0n, fee: 0n };
        const s = BigInt(shares);
        const grossFp = (sellType === 1)
        ? lmsrSellYesQuote(qYes, qNo, b, s)
        : lmsrSellNoQuote(qYes, qNo, b, s);
        const grossTokens = quoteFpToTokens(grossFp);
        if (grossTokens <= 0n) return { netPayout: 0n, fee: 0n };
    
        const fee = (grossTokens * PLATFORM_FEE_RATE + FEE_BASIS_POINTS - 1n) / FEE_BASIS_POINTS;
        const netPayout = grossTokens - fee;
        return { netPayout, fee };
    }
    

    // Calculate expected payout for selling shares (backward compatible)
    calculateSellValue(
        sellType: number,
        shares: number,
        qYes: bigint,
        qNo: bigint,
        b: bigint
    ): bigint {
        const { netPayout } = this.calculateSellDetails(sellType, shares, qYes, qNo, b);
        return netPayout;
    }

    // Get effective buy price per share
    getBuyPrice(
        betType: number,
        amount: number,
        qYes: bigint,
        qNo: bigint,
        b: bigint
    ): number {
        if (amount <= 0) return 0;
        const shares = this.calculateShares(betType, amount, qYes, qNo, b);
        if (shares === 0n) return 0;
        // avg price = total spend / shares
        return Number((BigInt(amount) * PRICE_SCALE) / shares) / Number(PRICE_SCALE);
    }

    // Get effective sell price per share
    getSellPrice(
        sellType: number,
        shares: number,
        qYes: bigint,
        qNo: bigint,
        b: bigint
    ): number {
        if (shares <= 0) return 0;
        const payout = this.calculateSellValue(sellType, shares, qYes, qNo, b);
        if (payout === 0n) return 0;
        return Number((payout * PRICE_SCALE) / BigInt(shares)) / Number(PRICE_SCALE);
    }

    // Current LMSR prices
    calculatePrices(
        qYes: bigint,
        qNo: bigint,
        b: bigint
    ): { yesPrice: number, noPrice: number } {
        const pYes = lmsrPriceYes(qYes, qNo, b);
        const pNo  = lmsrPriceNo(qYes, qNo, b);
        return {
        yesPrice: Number(pYes) / Number(PRICE_SCALE),
        noPrice:  Number(pNo)  / Number(PRICE_SCALE),
        };
    }

    // Calculate market impact (price change after trade) (using LMSR)
    calculateMarketImpact(
        betType: number,
        amount: number,
        qYes: bigint,
        qNo: bigint,
        b: bigint
    ): {
        currentYesPrice: number,
        currentNoPrice: number,
        newYesPrice: number,
        newNoPrice: number
    } {
        const current = this.calculatePrices(qYes, qNo, b);
        if (amount <= 0) {
        return {
            currentYesPrice: current.yesPrice,
            currentNoPrice: current.noPrice,
            newYesPrice: current.yesPrice,
            newNoPrice: current.noPrice,
        };
        }
        const shares = this.calculateShares(betType, amount, qYes, qNo, b);
        const sideYes = betType === 1;
        const qYesNew = sideYes ? (qYes + shares) : qYes;
        const qNoNew  = sideYes ? qNo : (qNo + shares);
        const next = this.calculatePrices(qYesNew, qNoNew, b);
        return {
        currentYesPrice: current.yesPrice,
        currentNoPrice: current.noPrice,
        newYesPrice: next.yesPrice,
        newNoPrice: next.noPrice,
        };
    }

    // Calculate slippage (difference between market price and effective price)
    calculateSlippage(
        betType: number,
        amount: number,
        qYes: bigint,
        qNo: bigint,
        b: bigint
    ): number {
        if (amount <= 0) return 0;
        const { yesPrice, noPrice } = this.calculatePrices(qYes, qNo, b);
        const marginal = (betType === 1) ? yesPrice : noPrice;
        const effective = this.getBuyPrice(betType, amount, qYes, qNo, b);
        return Math.max(0, effective - marginal);
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
    yesLiquidity: bigint,
    noLiquidity: bigint,
    b: bigint
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
        yesLiquidity,
        noLiquidity,
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

// ===== Example usage updated for LMSR =====
export async function exampleUsage() {
    const api = new PredictionMarketAPI();
    const rpc = new ZKWasmAppRpc("http://localhost:3030"); // zkWasm RPC
    const playerKey = String(get_server_admin_key());
    const player = new Player(playerKey, rpc);

    // Get all markets
    const markets = await api.getAllMarkets();
    console.log("All markets:", markets);
    
    // Get specific market
    try {
        console.log("Installing player...");
        await player.installPlayer();


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

            const qYes = BigInt(market.totalYesShares);
            const qNo  = BigInt(market.totalNoShares);
            const b    = BigInt(market.b);

            const prices = api.calculatePrices(qYes, qNo, b);
            console.log(`Current LMSR prices: YES=${prices.yesPrice.toFixed(3)} NO=${prices.noPrice.toFixed(3)}`);

            const amount = 1000; // tokens
            const yesBuyPrice = api.getBuyPrice(1, amount, qYes, qNo, b);
            console.log(`YES avg buy price for ${amount}: ${yesBuyPrice.toFixed(4)}`);

            const impact = api.calculateMarketImpact(1, amount, qYes, qNo, b);
            console.log(`Impact YES ${impact.currentYesPrice.toFixed(3)} → ${impact.newYesPrice.toFixed(3)}`);

            console.log("Placing YES bet...");
            await player.placeBet(BigInt(marketId), 1, BigInt(amount));
        }
    } catch (error) {
        console.error("Error in example usage:", error);
    }
}
