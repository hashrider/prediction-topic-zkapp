import fetch from 'node-fetch';
import { PlayerConvention, ZKWasmAppRpc, createCommand } from "zkwasm-minirollup-rpc";
import { get_server_admin_key } from "zkwasm-ts-server/src/config.js";

export const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:3000";

// Command constants
const TICK = 0;
const INSTALL_PLAYER = 1;
const WITHDRAW = 2;
const DEPOSIT = 3;
const BET = 4;
const SELL = 5;
const RESOLVE = 6;
const CLAIM = 7;
const WITHDRAW_FEES = 8;

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

    async placeBet(betType: number, amount: bigint) {
        let nonce = await this.getNonce();
        let cmd = createCommand(nonce, BigInt(BET), [BigInt(betType), amount]);
        return await this.sendTransactionWithCommand(cmd);
    }

    async claimWinnings() {
        let nonce = await this.getNonce();
        let cmd = createCommand(nonce, BigInt(CLAIM), []);
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

    async resolveMarket(outcome: boolean) {
        let nonce = await this.getNonce();
        let cmd = createCommand(nonce, BigInt(RESOLVE), [outcome ? 1n : 0n]);
        return await this.sendTransactionWithCommand(cmd);
    }

    async withdrawFees() {
        let nonce = await this.getNonce();
        let cmd = createCommand(nonce, BigInt(WITHDRAW_FEES), []);
        return await this.sendTransactionWithCommand(cmd);
    }

    async sellShares(sellType: number, shares: bigint) {
        let nonce = await this.getNonce();
        let cmd = createCommand(nonce, BigInt(SELL), [BigInt(sellType), shares]);
        return await this.sendTransactionWithCommand(cmd);
    }
}

export interface MarketData {
    title: string;
    description: string;
    startTime: string;
    endTime: string;
    resolutionTime: string;
    totalYesShares: string;
    totalNoShares: string;
    b: string;
    poolBalance: string;
    totalVolume: string;
    resolved: boolean;
    outcome: boolean | null;
    totalFeesCollected: string;
    yesPrice: string;
    noPrice: string;
}

export interface PlayerData {
    balance: string;
    yesShares: string;
    noShares: string;
    claimed: boolean;
}

export interface BetData {
    pid1: string;
    pid2: string;
    betType: number;
    amount: string;
    shares: string;
    timestamp: string;
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

export class PredictionMarketAPI {
    private adminKey: any;
    private baseUrl: string;

    constructor(baseUrl: string = API_BASE_URL) {
        this.adminKey = get_server_admin_key();
        this.baseUrl = baseUrl;
    }

    // Get market data
    async getMarket(): Promise<MarketData> {
        const response = await fetch(`${this.baseUrl}/data/market`);
        const result = await response.json() as any;
        if (!result.success) {
            throw new Error(result.message || 'Failed to get market data');
        }
        return result.data;
    }

    // Get player data
    async getPlayer(pid1: string, pid2: string): Promise<PlayerData> {
        const response = await fetch(`${this.baseUrl}/data/player/${pid1}/${pid2}`);
        const result = await response.json() as any;
        if (!result.success) {
            throw new Error(result.message || 'Failed to get player data');
        }
        return result.data;
    }

    // Get market statistics
    async getStats(): Promise<StatsData> {
        const response = await fetch(`${this.baseUrl}/data/stats`);
        const result = await response.json() as any;
        if (!result.success) {
            throw new Error(result.message || 'Failed to get stats');
        }
        return result.data;
    }

    // Get all bets
    async getAllBets(): Promise<BetData[]> {
        const response = await fetch(`${this.baseUrl}/data/bets`);
        const result = await response.json() as any;
        if (!result.success) {
            throw new Error(result.message || 'Failed to get bets data');
        }
        return result.data;
    }

    // Get player's bets
    async getPlayerBets(pid1: string, pid2: string): Promise<BetData[]> {
        const response = await fetch(`${this.baseUrl}/data/bets/${pid1}/${pid2}`);
        const result = await response.json() as any;
        if (!result.success) {
            throw new Error(result.message || 'Failed to get player bets');
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

// Transaction building utilities
export function buildBetTransaction(nonce: number, betType: number, amount: bigint): bigint[] {
    const commandWithNonce = BigInt(BET) | (BigInt(nonce) << 16n);
    return [commandWithNonce, BigInt(betType), amount, 0n, 0n];
}

export function buildSellTransaction(nonce: number, sellType: number, shares: bigint): bigint[] {
    const commandWithNonce = BigInt(SELL) | (BigInt(nonce) << 16n);
    return [commandWithNonce, BigInt(sellType), shares, 0n, 0n];
}

export function buildResolveTransaction(nonce: number, outcome: boolean): bigint[] {
    const commandWithNonce = BigInt(RESOLVE) | (BigInt(nonce) << 16n);
    return [commandWithNonce, outcome ? 1n : 0n, 0n, 0n, 0n];
}

export function buildClaimTransaction(nonce: number): bigint[] {
    const commandWithNonce = BigInt(CLAIM) | (BigInt(nonce) << 16n);
    return [commandWithNonce, 0n, 0n, 0n, 0n];
}

export function buildWithdrawTransaction(
    nonce: number, 
    amount: bigint, 
    addressHigh: bigint, 
    addressLow: bigint
): bigint[] {
    const commandWithNonce = BigInt(WITHDRAW) | (BigInt(nonce) << 16n);
    return [commandWithNonce, 0n, amount, addressHigh, addressLow];
}

export function buildDepositTransaction(
    nonce: number,
    targetPid1: bigint,
    targetPid2: bigint,
    amount: bigint
): bigint[] {
    const commandWithNonce = BigInt(DEPOSIT) | (BigInt(nonce) << 16n);
    return [commandWithNonce, targetPid1, targetPid2, 0n, amount];
}

export function buildInstallPlayerTransaction(nonce: number): bigint[] {
    const commandWithNonce = BigInt(INSTALL_PLAYER) | (BigInt(nonce) << 16n);
    return [commandWithNonce, 0n, 0n, 0n, 0n];
}

// ===== Example usage updated for LMSR =====
export async function exampleUsage() {
    const api = new PredictionMarketAPI();
    const rpc = new ZKWasmAppRpc("http://localhost:3030"); // zkWasm RPC
    const playerKey = String(get_server_admin_key());
    const player = new Player(playerKey, rpc);

    try {
        console.log("Installing player...");
        await player.installPlayer();

        const market = await api.getMarket();
        console.log("Market:", market);

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
        await player.placeBet(1, BigInt(amount));

        const stats = await api.getStats();
        console.log("Updated stats:", stats);
    } catch (error) {
        console.error("Error in example usage:", error);
    }
}
