# Market Configuration Examples (LMSR)

This document shows how to create prediction markets using the LMSR (Logarithmic Market Scoring Rule) algorithm via the market creation API.

## LMSR Overview

The market uses the Logarithmic Market Scoring Rule (LMSR) for price discovery and liquidity management:

- **Cost Function**: `C(q_yes, q_no, b) = b × ln(exp(q_yes/b) + exp(q_no/b))`
- **YES Price**: `exp(q_yes/b) / (exp(q_yes/b) + exp(q_no/b))`
- **NO Price**: `exp(q_no/b) / (exp(q_yes/b) + exp(q_no/b))`

Where:
- `q_yes` = Total YES shares outstanding
- `q_no` = Total NO shares outstanding  
- `b` = Liquidity parameter (market depth)

## Market Creation API

Markets are created dynamically using the `CREATE_MARKET` command with the following signature:

```typescript
createMarket(
  startTimeOffset: bigint,      // Offset from current counter (in ticks)
  endTimeOffset: bigint,        // Offset from current counter (in ticks)
  resolutionTimeOffset: bigint, // Offset from current counter (in ticks)
  initialYesLiquidity: bigint,  // Initial YES shares for LMSR
  initialNoLiquidity: bigint,   // Initial NO shares for LMSR
  b: bigint                     // LMSR liquidity parameter (market depth)
)
```

**Note**: Market titles and metadata should be stored in Sanity CMS with matching market IDs. The smart contract only stores core market logic data.

## Time Conversion Reference

- 1 tick = 5 seconds
- 1 minute = 12 ticks
- 1 hour = 720 ticks  
- 1 day = 17280 ticks
- 1 week = 120960 ticks
- 4 months = 2073600 ticks (120 days)

## LMSR Parameters

### Initial Liquidity (`initialYesLiquidity`, `initialNoLiquidity`)

Initial liquidity sets the starting state of the LMSR market:
- **Higher initial liquidity** = Lower price impact per bet, more stable prices
- **Lower initial liquidity** = Higher price impact per bet, more volatile prices

### Liquidity Parameter `b` (Market Depth)

The `b` parameter controls market depth and price sensitivity:
- **Higher `b`** = More liquidity depth, less price movement per trade
- **Lower `b`** = Less liquidity depth, more price movement per trade
- **Recommended default**: 1,000,000

### Recommended Parameter Combinations

#### Quick Markets (< 1 hour)
- Initial liquidity: 100,000 - 500,000 per side
- `b`: 500,000 - 1,000,000

#### Short Markets (1-24 hours)
- Initial liquidity: 500,000 - 1,000,000 per side
- `b`: 1,000,000 - 2,000,000

#### Medium Markets (1-7 days)
- Initial liquidity: 1,000,000 - 2,000,000 per side
- `b`: 2,000,000 - 5,000,000

#### Long Markets (> 1 week)
- Initial liquidity: 2,000,000+ per side
- `b`: 5,000,000+

## Market Creation Examples

### 1. Short-term Market (1 hour)

```typescript
// Note: Add title "BTC 1-Hour Price Movement" to Sanity CMS with the created market ID
await player.createMarket(
  0n,                    // Start immediately (current counter + 0)
  720n,                  // End after 1 hour (720 ticks)
  720n,                  // Resolution after 1 hour
  500000n,               // Initial YES liquidity
  500000n,               // Initial NO liquidity
  1000000n               // b parameter
);
```

### 2. Medium-term Market (1 day)

```typescript
// Note: Add title "Bitcoin $100K by 2024" to Sanity CMS with the created market ID
await player.createMarket(
  0n,                    // Start immediately
  17280n,                // End after 1 day (17280 ticks)
  17280n,                // Resolution after 1 day
  1000000n,              // Initial YES liquidity
  1000000n,              // Initial NO liquidity
  2000000n               // b parameter
);
```

### 3. Long-term Market (1 week)

```typescript
// Note: Add title "ETH 2.0 Full Launch" to Sanity CMS with the created market ID
await player.createMarket(
  0n,                    // Start immediately
  120960n,               // End after 1 week (120960 ticks)
  120960n,               // Resolution after 1 week
  2000000n,              // Initial YES liquidity
  2000000n,              // Initial NO liquidity
  5000000n               // b parameter
);
```

### 4. Delayed Resolution Market

```typescript
// Note: Add title "Stock Market Close Prediction" to Sanity CMS with the created market ID
await player.createMarket(
  0n,                    // Start immediately
  5760n,                 // Stop betting after 8 hours (5760 ticks)
  7200n,                 // Can only resolve after 10 hours (7200 ticks)
  750000n,               // Initial YES liquidity
  750000n,               // Initial NO liquidity
  1500000n               // b parameter
);
```

### 5. Custom Time Market (30 minutes)

```typescript
// 30 minutes = 1800 seconds = 360 ticks
// Note: Add title "30-Minute Quick Prediction" to Sanity CMS with the created market ID
await player.createMarket(
  0n,                    // Start immediately
  360n,                  // End after 30 minutes (360 ticks)
  360n,                  // Resolution after 30 minutes
  250000n,               // Initial YES liquidity
  250000n,               // Initial NO liquidity
  500000n                // b parameter
);
```

### 6. Asymmetric Initial Liquidity (Biased Market)

```typescript
// Market biased toward NO (cheaper YES bets initially)
// Note: Add title "Market with NO Bias" to Sanity CMS with the created market ID
await player.createMarket(
  0n,
  17280n,                // 1 day
  17280n,
  800000n,               // Lower YES liquidity
  1200000n,              // Higher NO liquidity
  2000000n               // b parameter
);

// Market biased toward YES (cheaper NO bets initially)
// Note: Add title "Market with YES Bias" to Sanity CMS with the created market ID
await player.createMarket(
  0n,
  17280n,                // 1 day
  17280n,
  1200000n,             // Higher YES liquidity
  800000n,              // Lower NO liquidity
  2000000n              // b parameter
);
```

### 7. Future Start Time Market

```typescript
// Market that starts 1 hour from now
const currentCounter = await getCurrentCounter(); // Get current counter from global state
// Note: Add title "Future Market" to Sanity CMS with the created market ID
await player.createMarket(
  720n,                  // Start 1 hour from now (current counter + 720)
  25920n,                // End 1.5 days from now (current counter + 25920)
  25920n,                // Resolution at end time
  1000000n,
  1000000n,
  2000000n
);
```

## Time Offset Calculation

Time offsets are relative to the current counter when the market is created:

```typescript
// Example: Create a market that starts in 2 hours and ends in 1 day
const TICKS_PER_HOUR = 720n;
const TICKS_PER_DAY = 17280n;

// Note: Add title "Delayed Start Market" to Sanity CMS with the created market ID
await player.createMarket(
  TICKS_PER_HOUR * 2n,  // Start 2 hours from now
  TICKS_PER_DAY,        // End 1 day from now
  TICKS_PER_DAY,        // Resolution at end time
  1000000n,
  1000000n,
  2000000n
);
```

## Important Notes

- **Time offsets** are relative to the current counter when `createMarket` is called
- `endTimeOffset` must be greater than `startTimeOffset`
- `resolutionTimeOffset` must be greater than or equal to `endTimeOffset`
- **Initial liquidity** sets the starting state but doesn't lock funds (LMSR uses a cost function)
- **`b` parameter** should typically be 1-5x the initial liquidity for balanced markets
- Higher `b` values provide more liquidity depth but require larger trades to move prices
- Lower `b` values make prices more sensitive to trading activity

## Market Creation Best Practices

1. **Match `b` to expected trading volume**: Higher volume markets benefit from higher `b` values
2. **Balance initial liquidity**: Equal YES/NO liquidity starts at 50/50 prices
3. **Consider market duration**: Longer markets typically need higher liquidity and `b` values
4. **Test with small values first**: Start with lower liquidity and `b` for testing
5. **Monitor price impact**: Adjust `b` based on observed slippage in your markets

## Example: Complete Market Creation Flow

```typescript
import { Player } from './api';
import { ZKWasmAppRpc } from 'zkwasm-minirollup-rpc';

// Initialize player
const rpc = new ZKWasmAppRpc("http://localhost:3000");
const player = new Player(adminKey, rpc);

// Create a 1-day market
// Note: Add title "Will Bitcoin reach $100K by end of 2024?" to Sanity CMS with the created market ID
const marketResult = await player.createMarket(
  0n,                    // Start immediately
  17280n,                // End after 1 day
  17280n,                // Resolution at end time
  1000000n,              // 1M initial YES shares
  1000000n,              // 1M initial NO shares
  2000000n               // b = 2M for good liquidity depth
);

console.log("Market created:", marketResult);
// After market is created, add the title and metadata to Sanity CMS with the matching market ID
```
