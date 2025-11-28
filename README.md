# Prediction Market - Multi-Market zkWasm Application

A comprehensive zkWasm-based prediction market platform supporting multiple markets with advanced LMSR (Logarithmic Market Scoring Rule) algorithms, real-time event tracking, and IndexedObject pattern implementation.

## 🚀 Features

### Core Market Functions
- **Multi-Market Support**: Create and manage multiple prediction markets simultaneously
- **Dynamic Market Creation**: Admin can create markets with custom titles, timeframes, and initial liquidity
- **LMSR Algorithm**: Logarithmic Market Scoring Rule for efficient price discovery
- **Real-time Pricing**: Continuous price discovery based on liquidity ratios
- **Buy/Sell Operations**: Users can trade YES/NO shares with immediate execution
- **Market Resolution**: Admin-controlled market outcomes with automatic payout calculations

### Advanced Features
- **IndexedObject Pattern**: Modern data storage and event system for efficient querying
- **Liquidity History Tracking**: Historical snapshots of market liquidity at each counter
- **Market Impact Analysis**: Calculate slippage and price impact before trading
- **Transaction History**: Complete transaction logs per player and market
- **Position Management**: Track player positions across multiple markets
- **Fee Management**: 1% platform fee collection with admin withdrawal

### Security & Safety
- **Mathematical Safety**: Comprehensive overflow/underflow protection
- **Input Validation**: Strict validation of all parameters and amounts
- **Error Handling**: Graceful error handling with detailed error codes
- **Access Control**: Role-based permissions for admin vs player operations

## 🏗️ Technical Architecture

### Rust Backend (`src/`)
```
├── lib.rs                 # Application entry point and zkWasm API
├── config.rs              # Configuration constants and settings
├── error.rs               # Error code definitions and handling
├── event.rs               # IndexedObject event system implementation
├── command.rs             # Transaction command processing
├── player.rs              # Player data structures and operations
├── market.rs              # Market logic and LMSR algorithms
├── math_safe.rs           # Safe mathematical operations
├── settlement.rs          # Withdrawal settlement system
├── state.rs               # Global state and market management
└── security_tests.rs      # Comprehensive security test suite
```

### TypeScript Frontend (`ts/src/`)
```
├── service.ts             # Main service with REST API endpoints
├── models.ts              # Data models and MongoDB schemas
├── api.ts                 # Client API and transaction builders
├── test_query.ts          # Comprehensive API testing
└── test_user.ts           # User interaction testing
```

## 📊 LMSR Algorithm

### Logarithmic Market Scoring Rule
- **Cost Function**: `C(q_yes, q_no, b) = b * ln(exp(q_yes/b) + exp(q_no/b))`
- **Price Calculation**: 
  - YES Price = `exp(q_yes/b) / (exp(q_yes/b) + exp(q_no/b))`
  - NO Price = `exp(q_no/b) / (exp(q_yes/b) + exp(q_no/b))`
- **Parameters**:
  - `q_yes`: Total YES shares outstanding
  - `q_no`: Total NO shares outstanding
  - `b`: Liquidity parameter (market depth)
- **Fee Structure**: 1% platform fee on all transactions (向上取整)
- **Liquidity Impact**: Continuous price adjustment based on trading volume

### Example Calculation
```typescript
// Initial state: q_yes = 100,000, q_no = 100,000, b = 1,000,000
// Current prices: YES = 50%, NO = 50%

// User bets 10,000 on YES
// Fee: 100 (1% of 10,000, rounded up)
// Net amount: 9,900
// Cost function calculates shares received based on LMSR
// New prices adjust according to LMSR formula
```

## 🔌 API Endpoints

### Market Data
- `GET /data/markets` - Get all markets
- `GET /data/market/:marketId` - Get specific market details
- `GET /data/market/:marketId/liquidity` - Get market liquidity history

### Transactions
- `GET /data/market/:marketId/recent` - Recent transactions for market
- `GET /data/player/:pid1/:pid2/recent` - Player's recent transactions (all markets)
- `GET /data/player/:pid1/:pid2/market/:marketId/recent` - Player's transactions for specific market

### Player Data
- `GET /data/player/:pid1/:pid2/market/:marketId` - Player's position in specific market
- `GET /data/player/:pid1/:pid2/positions` - Player's positions across all markets

## 🎮 Transaction Commands

| Command ID | Command | Parameters | Permission | Description |
|------------|---------|------------|------------|-------------|
| 0 | TICK | - | Admin | Increment global counter (every 5s) and emit liquidity snapshots |
| 1 | INSTALL_PLAYER | - | Any | Register new player |
| 2 | WITHDRAW | amount, addr_high, addr_low | Player | Withdraw funds to external address |
| 3 | DEPOSIT | target_pid1, target_pid2, amount | Admin | Deposit funds for player |
| 4 | BET | market_id, bet_type (0=NO, 1=YES), amount | Player | Place bet on market |
| 5 | SELL | market_id, sell_type (0=NO, 1=YES), shares | Player | Sell shares |
| 6 | RESOLVE | market_id, outcome (0=NO, 1=YES) | Admin | Resolve market outcome |
| 7 | CLAIM | market_id | Player | Claim winnings from resolved market |
| 8 | WITHDRAW_FEES | market_id | Admin | Withdraw collected fees |
| 9 | CREATE_MARKET | title, time_offsets, liquidity | Admin | Create new market with relative timing |

## 📡 Event System (IndexedObject Pattern)

### Event Types
- **EVENT_BET_UPDATE (3)**: Transaction events for bets and sells
- **EVENT_INDEXED_OBJECT (4)**: Market data and liquidity history updates

### IndexedObject Data
- **MARKET_INFO (1)**: Complete market state with all parameters
- **LIQUIDITY_HISTORY_INFO (2)**: Liquidity snapshots (YES/NO liquidity only)

### Event Emission Strategy
- **Market Updates**: Emitted on every market operation (bet, sell, resolve)
- **Liquidity History**: Emitted only on TICK (every 5 seconds) to avoid duplicates
- **Transaction Events**: Emitted for every bet/sell operation

### Timing Details
- **Counter Increment**: Every 5 seconds via TICK command
- **Liquidity Snapshots**: One per counter (every 5 seconds) for each active market
- **Market Operations**: Can happen multiple times within a single counter period

## 💻 Usage Examples

### Initialize Client
```typescript
import { Player, PredictionMarketAPI } from './api.js';
import { ZKWasmAppRpc } from 'zkwasm-minirollup-rpc';

const rpc = new ZKWasmAppRpc("http://localhost:3000");
const player = new Player("your_private_key", rpc);
const api = new PredictionMarketAPI();

// Install player (first time)
await player.installPlayer();
```

### Market Operations
```typescript
// Get all markets
const markets = await api.getAllMarkets();
console.log(`Found ${markets.length} markets`);

// Get specific market
const market = await api.getMarket("0");
console.log(`Market: ${market.titleString}`);
console.log(`YES: ${market.yesLiquidity}, NO: ${market.noLiquidity}`);

// Calculate current prices (LMSR)
const yesLiq = BigInt(market.totalYesShares);
const noLiq = BigInt(market.totalNoShares);
const b = BigInt(market.b || 1000000); // Default b if not provided
const prices = api.calculatePrices(yesLiq, noLiq, b);
console.log(`Prices - YES: ${(prices.yesPrice * 100).toFixed(2)}%, NO: ${(prices.noPrice * 100).toFixed(2)}%`);
```

### Trading Operations
```typescript
// Place bet
await player.placeBet(0n, 1, 10000n); // Market 0, YES, 10,000 units

// Calculate expected shares (LMSR)
const expectedShares = api.calculateShares(1, 10000, yesLiq, noLiq, b);
console.log(`Expected shares: ${expectedShares}`);

// Sell shares
await player.sellShares(0n, 1, 5000n); // Market 0, YES, 5,000 shares

// Calculate sell value (LMSR)
const sellValue = api.calculateSellValue(1, 5000, yesLiq, noLiq, b);
console.log(`Sell value: ${sellValue}`);
```

### Market Analysis
```typescript
// Market impact analysis (LMSR)
const impact = api.calculateMarketImpact(1, 50000, yesLiq, noLiq, b);
console.log(`Price impact: ${(impact.currentYesPrice * 100).toFixed(2)}% → ${(impact.newYesPrice * 100).toFixed(2)}%`);

// Slippage calculation (LMSR)
const slippage = api.calculateSlippage(1, 50000, yesLiq, noLiq, b);
console.log(`Slippage: ${slippage.toFixed(4)}%`);

// Get liquidity history
const history = await api.getMarketLiquidityHistory("0");
console.log(`Liquidity data points: ${history.length}`);
```

### Admin Operations
```typescript
const admin = new Player("admin_private_key", rpc);

// Create new market with relative time offsets (LMSR)
await admin.createMarket(
    "Will Ethereum reach $5000 in 2024?",
    0n,      // Start immediately (0 ticks offset = 0 seconds)
    17280n,  // End in 1 day (17280 ticks * 5s = 86400s = 1 day)
    17400n,  // Resolution 10 minutes after end (17400 ticks * 5s = 87000s)
    100000n, // Initial YES shares
    100000n, // Initial NO shares
    1000000n // b parameter (LMSR liquidity parameter)
);

// Time calculation examples:
// - 1 minute = 12 ticks (12 * 5s = 60s)
// - 1 hour = 720 ticks (720 * 5s = 3600s)
// - 1 day = 17280 ticks (17280 * 5s = 86400s)
// All times are RELATIVE offsets from market creation time

// Resolve market
await admin.resolveMarket(1n, true); // Market 1, YES outcome

// Withdraw fees
await admin.withdrawFees(1n); // From market 1
```

### Player Data
```typescript
// Get player positions
const pubkey = [0n, 123n, 456n, 0n]; // Player's public key
const positions = await api.getPlayerAllPositions(
    pubkey[1].toString(), 
    pubkey[2].toString()
);

positions.forEach(pos => {
    console.log(`Market ${pos.marketId}: YES=${pos.yesShares}, NO=${pos.noShares}`);
});

// Get transaction history
const transactions = await api.getPlayerRecentTransactions(
    pubkey[1].toString(), 
    pubkey[2].toString()
);

transactions.forEach(tx => {
    console.log(`${tx.transactionType}: ${tx.amount} → ${tx.shares} shares`);
});
```

## 🔧 Build and Run

### Prerequisites
- Rust (latest stable)
- Node.js 18+
- MongoDB (for data persistence)

### Build Rust Backend
```bash
# Build the zkWasm application
make build

# Run security tests
cargo test security_tests

# Run all tests
cargo test
```

### Setup TypeScript Service
```bash
cd ts

# Install dependencies
npm install

# Build TypeScript
npm run build

# Start the service
node dist/service.js
```

### Testing
```bash
# Run comprehensive API tests
node dist/test_query.js

# Run user interaction tests  
node dist/test_user.js
```

## ⚙️ Configuration

### Market Parameters (src/config.rs)
```rust
pub const PLATFORM_FEE_RATE: u64 = 100;        // 1% (100/10000)
pub const FEE_BASIS_POINTS: u64 = 10000;       // Basis points denominator
pub const NEW_PLAYER_INITIAL_BALANCE: u64 = 0; // Starting balance
pub const ADMIN_PUBKEY: [u64; 4] = [...];      // Admin public key
```

### Market Title Length Limits
Due to command length restrictions in the zkWasm system, market titles have strict length limits:

- **Maximum u64 count**: 9 (command format: `[cmd_type, ...title_data, start, end, resolution, yes_liq, no_liq]`)
- **Maximum bytes**: 72 bytes (9 u64s × 8 bytes each)
- **Typical character limit**: ~60-70 characters for English text (depends on UTF-8 encoding)

**Examples:**
- ✅ "Will Bitcoin reach $100K by 2024?" (38 chars, 38 bytes, 5 u64s)
- ✅ "Apple Stock Price Prediction Q4 2024" (39 chars, 39 bytes, 5 u64s)
- ✅ "Will the cryptocurrency market exceed all expectations this quarter?" (68 chars, 68 bytes, 9 u64s)
- ❌ "Will the extremely long and detailed prediction about cryptocurrency market movements exceed expectations?" (102 chars, 102 bytes, 13 u64s)

The system will automatically validate title length and reject transactions with overly long titles.

### Timing Configuration
```rust
// Each counter tick represents 5 seconds
pub const SECONDS_PER_TICK: u64 = 5;
pub const TICKS_PER_MINUTE: u64 = 12;          // 60s / 5s = 12
pub const TICKS_PER_HOUR: u64 = 720;           // 3600s / 5s = 720  
pub const TICKS_PER_DAY: u64 = 17280;          // 86400s / 5s = 17280

// Market timing examples (all are relative offsets from creation time)
// - Start immediately: 0
// - End in 1 hour: 720
// - End in 1 day: 17280
// - Resolution 2 hours after end: end_offset + 1440
```

### Environment Variables
```bash
# API service
API_BASE_URL=http://localhost:3000

# Database
MONGODB_URI=mongodb://localhost:27017/prediction-market

# zkWasm RPC
ZKWASM_RPC_URL=http://localhost:3000
```

## 🔒 Security Features

### Mathematical Safety
- **Overflow Protection**: All arithmetic operations use safe math functions
- **Underflow Protection**: Prevents negative values in calculations
- **Division by Zero**: Graceful handling of edge cases
- **Precision Maintenance**: High-precision calculations for accurate pricing

### Input Validation
- **Amount Limits**: Configurable maximum bet amounts and shares
- **Liquidity Bounds**: Minimum and maximum liquidity constraints  
- **Parameter Validation**: Strict validation of all transaction parameters
- **Access Control**: Role-based permissions for sensitive operations

### Error Handling
- **Graceful Degradation**: Continues operation when possible
- **Detailed Error Codes**: Specific error messages for debugging
- **Transaction Safety**: Atomic operations with rollback capability
- **State Consistency**: Ensures data integrity across operations

## 📈 Data Models

### Market Data
```typescript
interface MarketData {
    marketId: string;
    title: string;
    titleString?: string;         // Human-readable title
    startTime: string;
    endTime: string;
    resolutionTime: string;
    totalYesShares: string;       // Total YES shares (LMSR q_yes)
    totalNoShares: string;         // Total NO shares (LMSR q_no)
    b: string;                    // LMSR liquidity parameter
    prizePool: string;            // Real user funds for payouts
    totalVolume: string;          // Cumulative trading volume
    totalYesShares: string;       // Total YES shares issued
    totalNoShares: string;        // Total NO shares issued
    resolved: boolean;
    outcome: boolean | null;
    totalFeesCollected: string;
}
```

### Liquidity History (Simplified)
```typescript
interface LiquidityHistoryData {
    marketId: string;
    counter: string;              // Global counter when recorded
    yesLiquidity: string;         // YES liquidity snapshot
    noLiquidity: string;          // NO liquidity snapshot
    // Note: total_volume can be retrieved from MarketData
    // Note: action_type removed as history only records counter snapshots
}
```

### Player Position
```typescript
interface PlayerMarketPosition {
    pid: string[];                // [pid1, pid2]
    marketId: string;
    yesShares: string;
    noShares: string;
    claimed: boolean;             // Whether winnings were claimed
}
```

## 🎯 Project Status

### Current Version: v2.0 (IndexedObject Pattern)
- ✅ Multi-market support
- ✅ IndexedObject event system  
- ✅ Simplified liquidity history
- ✅ Comprehensive API endpoints
- ✅ Security test suite
- ✅ Mathematical safety features
- ✅ Real-time event tracking
- ✅ MongoDB data persistence

### Recent Improvements
- **Simplified Liquidity History**: Removed redundant fields (action_type, total_volume)
- **Optimized Event Emission**: Liquidity history only emitted on counter increments (every 5s)
- **Enhanced API**: Comprehensive REST endpoints for all data access
- **Code Cleanup**: Removed unnecessary wrapper functions and duplicate code
- **Improved Testing**: Enhanced test coverage with realistic scenarios
- **Clarified Timing System**: All market times use relative offsets (ticks) from creation time

## 📝 License

This project is part of the zkWasm ecosystem and follows the applicable licensing terms.

---

For detailed implementation examples and advanced usage patterns, see the test files in `ts/src/test_*.ts`. 