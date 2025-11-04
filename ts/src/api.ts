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
    yesLiquidity: string;
    noLiquidity: string;
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

    // Unified shares calculation function (betType: 1=YES, 0=NO)
    calculateShares(betType: number, amount: number, yesLiquidity: bigint, noLiquidity: bigint): bigint {
        if (amount <= 0) return 0n;

        // 向上取整计算费用：(amount * rate + basis - 1) / basis
        const fee = (BigInt(amount) * PLATFORM_FEE_RATE + FEE_BASIS_POINTS - 1n) / FEE_BASIS_POINTS;
        const netAmount = BigInt(amount) - fee;
        const k = yesLiquidity * noLiquidity;
        const isYesBet = betType === 1;

        if (isYesBet) { // YES bet
            const newNoLiquidity = noLiquidity + netAmount;
            const newYesLiquidity = k / newNoLiquidity;
            return yesLiquidity > newYesLiquidity ? yesLiquidity - newYesLiquidity : 0n;
        } else { // NO bet
            const newYesLiquidity = yesLiquidity + netAmount;
            const newNoLiquidity = k / newYesLiquidity;
            return noLiquidity > newNoLiquidity ? noLiquidity - newNoLiquidity : 0n;
        }
    }



    // Calculate sell details (net payout and fee) - unified function
    calculateSellDetails(sellType: number, shares: number, yesLiquidity: bigint, noLiquidity: bigint): { netPayout: bigint, fee: bigint } {
        if (shares <= 0) return { netPayout: 0n, fee: 0n };

        const k = yesLiquidity * noLiquidity;
        const isYesSell = sellType === 1;

        let grossAmount = 0n;

        if (isYesSell) { // Sell YES shares
            const newYesLiquidity = yesLiquidity + BigInt(shares);
            const newNoLiquidity = k / newYesLiquidity;
            if (noLiquidity > newNoLiquidity) {
                grossAmount = noLiquidity - newNoLiquidity;
            }
        } else { // Sell NO shares
            const newNoLiquidity = noLiquidity + BigInt(shares);
            const newYesLiquidity = k / newNoLiquidity;
            if (yesLiquidity > newYesLiquidity) {
                grossAmount = yesLiquidity - newYesLiquidity;
            }
        }

        if (grossAmount === 0n) {
            return { netPayout: 0n, fee: 0n };
        }

        // 向上取整计算费用：(amount * rate + basis - 1) / basis
        const fee = (grossAmount * PLATFORM_FEE_RATE + FEE_BASIS_POINTS - 1n) / FEE_BASIS_POINTS;
        const netPayout = grossAmount - fee;
        
        return { netPayout, fee };
    }

    // Calculate expected payout for selling shares (backward compatible)
    calculateSellValue(sellType: number, shares: number, yesLiquidity: bigint, noLiquidity: bigint): bigint {
        const { netPayout } = this.calculateSellDetails(sellType, shares, yesLiquidity, noLiquidity);
        return netPayout;
    }

    // Get effective buy price per share
    getBuyPrice(betType: number, amount: number, yesLiquidity: bigint, noLiquidity: bigint): number {
        if (amount <= 0) return 0;

        const shares = this.calculateShares(betType, amount, yesLiquidity, noLiquidity);
        if (shares === 0n) return 0;

        // Return price per share (1.0 = 1 token per share)
        return Number(BigInt(amount) * 1000000n / shares) / 1000000;
    }

    // Get effective sell price per share
    getSellPrice(sellType: number, shares: number, yesLiquidity: bigint, noLiquidity: bigint): number {
        if (shares <= 0) return 0;

        const payout = this.calculateSellValue(sellType, shares, yesLiquidity, noLiquidity);
        if (payout === 0n) return 0;

        // Return price per share (1.0 = 1 token per share)
        return Number(payout * 1000000n / BigInt(shares)) / 1000000;
    }

    // Calculate market impact (price change after trade)
    calculateMarketImpact(betType: number, amount: number, yesLiquidity: bigint, noLiquidity: bigint): { 
        currentYesPrice: number, 
        currentNoPrice: number, 
        newYesPrice: number, 
        newNoPrice: number 
    } {
        const currentPrices = this.calculatePrices(yesLiquidity, noLiquidity);
        
        if (amount <= 0) {
            return {
                currentYesPrice: currentPrices.yesPrice,
                currentNoPrice: currentPrices.noPrice,
                newYesPrice: currentPrices.yesPrice,
                newNoPrice: currentPrices.noPrice
            };
        }

        // Simulate the trade using unified calculation
        const shares = this.calculateShares(betType, amount, yesLiquidity, noLiquidity);
        // 向上取整计算费用：(amount * rate + basis - 1) / basis
        const fee = (BigInt(amount) * PLATFORM_FEE_RATE + FEE_BASIS_POINTS - 1n) / FEE_BASIS_POINTS;
        const netAmount = BigInt(amount) - fee;

        const k = yesLiquidity * noLiquidity;
        let newYesLiquidity = yesLiquidity;
        let newNoLiquidity = noLiquidity;

        if (betType === 1) { // YES bet
            newNoLiquidity = noLiquidity + netAmount;
            newYesLiquidity = k / newNoLiquidity;
        } else { // NO bet
            newYesLiquidity = yesLiquidity + netAmount;
            newNoLiquidity = k / newYesLiquidity;
        }

        const newPrices = this.calculatePrices(newYesLiquidity, newNoLiquidity);

        return {
            currentYesPrice: currentPrices.yesPrice,
            currentNoPrice: currentPrices.noPrice,
            newYesPrice: newPrices.yesPrice,
            newNoPrice: newPrices.noPrice
        };
    }

    // Calculate slippage (difference between market price and effective price)
    calculateSlippage(betType: number, amount: number, yesLiquidity: bigint, noLiquidity: bigint): number {
        if (amount <= 0) return 0;

        const currentPrices = this.calculatePrices(yesLiquidity, noLiquidity);
        const currentPrice = betType === 1 ? currentPrices.yesPrice : currentPrices.noPrice;
        
        const effectivePrice = this.getBuyPrice(betType, amount, yesLiquidity, noLiquidity);
        
        return Math.max(0, effectivePrice - currentPrice);
    }

    // Calculate current prices
    calculatePrices(yesLiquidity: bigint, noLiquidity: bigint): { yesPrice: number, noPrice: number } {
        const totalLiquidity = yesLiquidity + noLiquidity;
        if (totalLiquidity === 0n) {
            return { yesPrice: 0.5, noPrice: 0.5 };
        }

        const yesPrice = Number(noLiquidity * 1000000n / totalLiquidity) / 1000000;
        const noPrice = Number(yesLiquidity * 1000000n / totalLiquidity) / 1000000;

        return { yesPrice, noPrice };
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

// Example usage
export async function exampleUsage() {
    const api = new PredictionMarketAPI();
    const rpc = new ZKWasmAppRpc("http://localhost:3000");
    
    // Create player instance (replace with actual key)
    const playerKey = "123";
    const player = new Player(playerKey, rpc);

    try {
        // Install player
        console.log("Installing player...");
        await player.installPlayer();

        // Get market data
        const marketData = await api.getMarket();
        console.log("Market data:", marketData);

        // Calculate prices and expected values
        if (marketData.yesLiquidity && marketData.noLiquidity) {
            const yesLiquidity = BigInt(marketData.yesLiquidity);
            const noLiquidity = BigInt(marketData.noLiquidity);
            
            // Current market prices
            const prices = api.calculatePrices(yesLiquidity, noLiquidity);
            console.log(`Current market prices: YES=${prices.yesPrice.toFixed(3)}, NO=${prices.noPrice.toFixed(3)}`);

            // Calculate buy prices for 1000 units
            const yesBuyPrice = api.getBuyPrice(1, 1000, yesLiquidity, noLiquidity);
            const noBuyPrice = api.getBuyPrice(0, 1000, yesLiquidity, noLiquidity);
            console.log(`Buy prices for 1000 units: YES=${yesBuyPrice.toFixed(3)}, NO=${noBuyPrice.toFixed(3)}`);

            // Calculate market impact
            const yesImpact = api.calculateMarketImpact(1, 1000, yesLiquidity, noLiquidity);
            console.log(`YES bet impact: ${yesImpact.currentYesPrice.toFixed(3)} → ${yesImpact.newYesPrice.toFixed(3)}`);

            // Calculate slippage
            const yesSlippage = api.calculateSlippage(1, 1000, yesLiquidity, noLiquidity);
            console.log(`YES bet slippage: ${yesSlippage.toFixed(3)}`);

            // Calculate expected shares and sell prices
            const expectedYesShares = api.calculateShares(1, 1000, yesLiquidity, noLiquidity);
            const yesSellPrice = api.getSellPrice(1, Number(expectedYesShares), yesLiquidity, noLiquidity);
            console.log(`Expected YES shares: ${expectedYesShares}, sell price: ${yesSellPrice.toFixed(3)}`);

            // Place a bet
            console.log("Placing YES bet...");
            await player.placeBet(1, 1000n); // YES bet for 1000 units

            // Get updated market stats
            const stats = await api.getStats();
            console.log("Updated market stats:", stats);
        }
    } catch (error) {
        console.error("Error in example usage:", error);
    }
} 
