import mongoose from 'mongoose';
import { ObjectEvent } from 'zkwasm-ts-server';

(BigInt.prototype as any).toJSON = function () {
    return BigInt.asUintN(64, this).toString();
};

// With above tojson for bigint we can turn document into json with simple transform that exclude delete
export function docToJSON(doc: mongoose.Document) {
    const obj = doc.toObject({
        transform: (_, ret:any) => {
            delete ret._id;
            return ret;
        }
    });
    return obj;
}

// Market info constants for IndexedObject
export const MARKET_INFO = 1;
export const LIQUIDITY_HISTORY_INFO = 2;

// ActionType enum removed - no longer needed since liquidity history only tracks snapshots

// Price calculation tool class - Note: Actual pricing is now done via LMSR on the backend
// This is kept for reference/compatibility but prices should be fetched from backend
export class PriceCalculator {
    // Deprecated: Use backend LMSR pricing instead
    static calculatePrice(yesLiquidity: bigint, noLiquidity: bigint): { yesPrice: bigint, noPrice: bigint } {
        const totalLiq = yesLiquidity + noLiquidity;
        if (totalLiq === 0n) {
            return { yesPrice: 500000n, noPrice: 500000n }; // 50% each
        }
        return {
            yesPrice: (noLiquidity * 1000000n) / totalLiq,
            noPrice: (yesLiquidity * 1000000n) / totalLiq
        };
    }
    
    static calculateTotalLiquidity(yesLiquidity: bigint, noLiquidity: bigint): bigint {
        return yesLiquidity + noLiquidity;
    }
}

// IndexedObject class like other projects
export class IndexedObject {
    // object index
    index: number;
    // data array
    data: bigint[];

    constructor(index: number, data: bigint[]) {
        this.index = index;
        this.data = data;
    }

    toObject() {
        if (this.index === MARKET_INFO) {
            return MarketData.fromData(this.data);
        } else if (this.index === LIQUIDITY_HISTORY_INFO) {
            return LiquidityHistoryEntry.fromData(this.data);
        } else {
            console.error("Fatal: unexpected object index:", this.index);
            process.exit();
        }
    }

    toJSON() {
        return JSON.stringify(this.toObject());
    }

    static fromEvent(data: BigUint64Array): IndexedObject {
        // Extract index and data, with marketId as second element for MARKET_INFO
        const index = Number(data[0]);
        if (index === MARKET_INFO) {
            // For market info: [index, marketId, ...market_data]
            const marketId = data[1];
            const marketData = Array.from(data.slice(2));
            return new IndexedObject(index, [marketId, ...marketData]);
        } else {
            // For other types, use normal format
            return new IndexedObject(index, Array.from(data.slice(1)));
        }
    }

    async storeRelatedObject() {
        let obj = this.toObject() as any;
        if (this.index === MARKET_INFO) {
            // Store in main MarketModel using IndexedObject pattern
            let doc = await MarketModel.findOneAndUpdate({marketId: obj.marketId}, obj, {upsert: true});
            return doc;
        } else if (this.index === LIQUIDITY_HISTORY_INFO) {
            let doc = await LiquidityHistoryModel.findOneAndUpdate(
                {marketId: obj.marketId, counter: obj.counter}, 
                obj, 
                {upsert: true}
            );
            return doc;
        }
    }
}

// Market data structure matching Rust backend (LMSR)
export class MarketData {
    marketId?: bigint;
    title: bigint[];
    startTime: bigint;
    endTime: bigint;
    resolutionTime: bigint;
    // LMSR state = outstanding shares
    totalYesShares: bigint;
    totalNoShares: bigint;
    // LMSR liquidity parameter b (market depth)
    b: bigint;
    // Collateral in the AMM bank
    poolBalance: bigint;
    // Volume stats
    totalVolume: bigint;
    resolved: boolean;
    outcome: boolean | null;
    totalFeesCollected: bigint;

    constructor(data: any) {
        this.title = data.title || [];
        this.startTime = data.startTime || 0n;
        this.endTime = data.endTime || 0n;
        this.resolutionTime = data.resolutionTime || 0n;
        this.totalYesShares = data.totalYesShares || 0n;
        this.totalNoShares = data.totalNoShares || 0n;
        this.b = data.b || 0n;
        this.poolBalance = data.poolBalance || 0n;
        this.totalVolume = data.totalVolume || 0n;
        this.resolved = data.resolved || false;
        this.outcome = data.outcome;
        this.totalFeesCollected = data.totalFeesCollected || 0n;
    }

    static fromData(data: bigint[]): MarketData {
        // Parse the data array according to Rust MarketData::to_data format
        // First element is marketId from IndexedObject
        let index = 0;
        const marketId = data[index++];
        
        // Read title length and title data
        const titleLen = Number(data[index++]);
        const title = data.slice(index, index + titleLen);
        index += titleLen;
        
        const startTime = data[index++];
        const endTime = data[index++];
        const resolutionTime = data[index++];
        const totalYesShares = data[index++];
        const totalNoShares = data[index++];
        const b = data[index++];
        const poolBalance = data[index++];
        const totalVolume = data[index++];
        const resolved = data[index++] === 1n;
        const outcomeValue = data[index++];
        const outcome = outcomeValue === 0n ? null : (outcomeValue === 2n ? true : false);
        const totalFeesCollected = data[index++];

        const marketData = new MarketData({
            title,
            startTime,
            endTime,
            resolutionTime,
            totalYesShares,
            totalNoShares,
            b,
            poolBalance,
            totalVolume,
            resolved,
            outcome,
            totalFeesCollected
        });
        marketData.marketId = marketId;
        return marketData;
    }
}

// Shares History Entry - tracks LMSR shares snapshots
export class LiquidityHistoryEntry {
    marketId: bigint;
    counter: bigint;
    yesLiquidity: bigint;  // Kept name for backward compatibility, but now represents totalYesShares
    noLiquidity: bigint;   // Kept name for backward compatibility, but now represents totalNoShares

    constructor(data: any) {
        this.marketId = data.marketId;
        this.counter = data.counter;
        this.yesLiquidity = data.yesLiquidity;
        this.noLiquidity = data.noLiquidity;
    }

    static fromData(data: bigint[]): LiquidityHistoryEntry {
        return new LiquidityHistoryEntry({
            marketId: data[0],
            counter: data[1],
            yesLiquidity: data[2],
            noLiquidity: data[3]
        });
    }
}

// Market Object Schema for IndexedObject pattern - main storage (LMSR)
const marketObjectSchema = new mongoose.Schema({
    marketId: { type: BigInt, required: true, unique: true },
    title: { type: [BigInt], required: true },
    startTime: { type: BigInt, required: true },
    endTime: { type: BigInt, required: true },
    resolutionTime: { type: BigInt, required: true },
    totalYesShares: { type: BigInt, required: true },
    totalNoShares: { type: BigInt, required: true },
    b: { type: BigInt, required: true },
    poolBalance: { type: BigInt, default: 0n },
    totalVolume: { type: BigInt, default: 0n },
    resolved: { type: Boolean, default: false },
    outcome: { type: Boolean, default: null },
    totalFeesCollected: { type: BigInt, default: 0n },
});

marketObjectSchema.pre('init', ObjectEvent.uint64FetchPlugin);

// Liquidity History Schema - simplified snapshots
const liquidityHistorySchema = new mongoose.Schema({
    marketId: { type: BigInt, required: true },
    counter: { type: BigInt, required: true },
    yesLiquidity: { type: BigInt, required: true },
    noLiquidity: { type: BigInt, required: true },
});

liquidityHistorySchema.pre('init', ObjectEvent.uint64FetchPlugin);
liquidityHistorySchema.index({ marketId: 1, counter: 1 }, { unique: true });
liquidityHistorySchema.index({ marketId: 1, counter: -1 });

// Multi-Market Bet Interface
export interface Bet {
    index: bigint;
    pid: bigint[],
    marketId: bigint,
    betType: number,
    amount: bigint,
    shares: bigint,
    counter: bigint,
}

// Bet Schema - updated for multi-market
const betSchema = new mongoose.Schema<Bet>({
    index: { type: BigInt, required: true, unique: true},
    pid: { type: [BigInt], required: true },
    marketId: { type: BigInt, required: true },
    betType: { type: Number, required: true }, // 0 = NO, 1 = YES
    amount: { type: BigInt, required: true },
    shares: { type: BigInt, required: true },
    counter: { type: BigInt, required: true}
});

betSchema.pre('init', ObjectEvent.uint64FetchPlugin);
betSchema.index({ pid: 1 });
betSchema.index({ marketId: 1 });
betSchema.index({ counter: -1 });

// Player Market Position Interface
interface PlayerMarketPosition {
    pid: bigint[];
    marketId: bigint;
    yesShares: bigint;
    noShares: bigint;
    claimed: boolean;
}

// Player Market Position Schema
const playerMarketPositionSchema = new mongoose.Schema<PlayerMarketPosition>({
    pid: { type: [BigInt], required: true },
    marketId: { type: BigInt, required: true },
    yesShares: { type: BigInt, default: 0n },
    noShares: { type: BigInt, default: 0n },
    claimed: { type: Boolean, default: false }
});

playerMarketPositionSchema.pre('init', ObjectEvent.uint64FetchPlugin);
playerMarketPositionSchema.index({ pid: 1, marketId: 1 }, { unique: true });

// Main market model using IndexedObject pattern
export const MarketModel = mongoose.model('Market', marketObjectSchema);
export const LiquidityHistoryModel = mongoose.model('LiquidityHistory', liquidityHistorySchema);
export const BetModel = mongoose.model('Bet', betSchema);
export const PlayerMarketPositionModel = mongoose.model('PlayerMarketPosition', playerMarketPositionSchema);

// Event handling classes for BET events only (MarketEvent removed as unused)

export class BetEvent {
    index: bigint;
    data: bigint[];
    constructor(
        index: bigint, data: bigint[]
    ) {
        this.index = index;
        this.data = data;
    }

    static fromEvent(data: BigUint64Array): BetEvent {
        // For BetEvent, the data directly contains the 8 elements we need
        // [txid, pid1, pid2, market_id, bet_type, amount, shares, counter]
        return new BetEvent(0n, Array.from(data));
    }

    toObject(): Bet {
        // Add data length validation
        if (this.data.length < 8) {
            console.error("BetEvent data length insufficient:", this.data.length, "expected 8, data:", this.data);
            throw new Error(`Invalid BetEvent data length: ${this.data.length}, expected 8`);
        }
        
        // Event data format differs between bet and sell:
        // BET:  [txid, pid1, pid2, market_id, bet_type, amount, shares, counter]
        // SELL: [txid, pid1, pid2, market_id, sell_type+10, shares, payout, counter]
        const betType = Number(this.data[4]);
        const isSell = betType >= 10;
        
        // Validate betType range
        if (betType < 0 || betType > 12) {
            console.error("Invalid betType:", betType, "data:", this.data);
            throw new Error(`Invalid betType: ${betType}`);
        }
        
        return {
            index: this.data[0], // txid
            pid: [this.data[1], this.data[2]], // pid1, pid2
            marketId: this.data[3], // market_id
            betType: betType,
            amount: isSell ? this.data[6] : this.data[5], // For sell: use payout as amount
            shares: isSell ? this.data[5] : this.data[6], // For sell: data[5] is shares sold
            counter: this.data[7],
        };
    }
}

// Global State Interface for tracking all markets
interface GlobalState {
    counter: bigint;
    marketIds: bigint[];
    nextMarketId: bigint;
    totalPlayers: bigint;
}

const globalStateSchema = new mongoose.Schema<GlobalState>({
    counter: { type: BigInt, required: true },
    marketIds: { type: [BigInt], required: true },
    nextMarketId: { type: BigInt, required: true },
    totalPlayers: { type: BigInt, required: true }
});

globalStateSchema.pre('init', ObjectEvent.uint64FetchPlugin);

export const GlobalStateModel = mongoose.model('GlobalState', globalStateSchema);

// Helper function to convert u64 array to string (for market titles)
export function u64ArrayToString(u64Array: bigint[]): string {
    let bytes: number[] = [];
    
    for (const value of u64Array) {
        for (let i = 0; i < 8; i++) {
            const byte = Number((value >> BigInt(i * 8)) & 0xFFn);
            if (byte !== 0) {
                bytes.push(byte);
            } else {
                break;
            }
        }
    }
    
    return new TextDecoder().decode(new Uint8Array(bytes));
}

// Helper function to convert string to u64 array (for market titles)
export function stringToU64Array(str: string): bigint[] {
    const bytes = new TextEncoder().encode(str);
    const result: bigint[] = [];
    
    for (let i = 0; i < bytes.length; i += 8) {
        let value = 0n;
        for (let j = 0; j < 8 && i + j < bytes.length; j++) {
            value |= BigInt(bytes[i + j]) << BigInt(j * 8);
        }
        result.push(value);
    }
    
    return result;
}

// Market title length validation
export function validateMarketTitleLength(title: string): { valid: boolean; message?: string; u64Count?: number } {
    const u64Array = stringToU64Array(title);
    const MAX_TITLE_U64_COUNT = 8; // Command length limit: 1 + title_len + 6 < 16, so title_len < 9, max value is 8 (for LMSR with b parameter)
    
    if (u64Array.length > MAX_TITLE_U64_COUNT) {
        return {
            valid: false,
            message: `Title too long: ${u64Array.length} u64s (max: ${MAX_TITLE_U64_COUNT}). Current title: "${title}" (${title.length} chars, ${new TextEncoder().encode(title).length} bytes)`,
            u64Count: u64Array.length
        };
    }
    
    return {
        valid: true,
        u64Count: u64Array.length
    };
}


