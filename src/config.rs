use serde::Serialize;

lazy_static::lazy_static! {
    pub static ref ADMIN_PUBKEY: [u64; 4] = {
        let bytes = include_bytes!("./admin.pubkey");
        let u64s = unsafe { std::slice::from_raw_parts(bytes.as_ptr() as *const u64, 4) };
        u64s.try_into().unwrap()
    };
}

#[derive(Serialize, Clone)]
pub struct Config {
    actions: [&'static str; 3],
    name: [&'static str; 1],
}

lazy_static::lazy_static! {
    pub static ref CONFIG: Config = Config {
        actions: ["bet", "resolve", "claim"],
        name: ["prediction_market"],
    };
}

impl Config {
    pub fn to_json_string() -> String {
        serde_json::to_string(&CONFIG.clone()).unwrap()
    }

    // enable timer tick
    pub fn autotick() -> bool {
        true
    }
}

// Event types
pub const EVENT_MARKET_UPDATE: u64 = 1;
pub const EVENT_BET_UPDATE: u64 = 2;
pub const EVENT_PLAYER_UPDATE: u64 = 3;

// Market constants
pub const PLATFORM_FEE_RATE: u64 = 100; // 1% platform fee (100/10000)

// New player initial balance
pub const NEW_PLAYER_INITIAL_BALANCE: u64 = 100000; // Initial balance for new players

// Price precision constants
pub const BASIS_POINTS_PRECISION: u64 = 10000;     // 10,000 basis points = 100%
pub const PRICE_PRECISION: u64 = 1000000;          // 1,000,000 = 1.0 (higher precision for calculations)
pub const PERCENTAGE_PRECISION: u64 = 100;         // 100 = 100%

// Conversion helpers
pub const BASIS_POINTS_TO_PRICE: u64 = PRICE_PRECISION / BASIS_POINTS_PRECISION; // 100
pub const PERCENTAGE_TO_PRICE: u64 = PRICE_PRECISION / PERCENTAGE_PRECISION;     // 10,000

// Fee calculation constant (matches PLATFORM_FEE_RATE denominator)
pub const FEE_BASIS_POINTS: u64 = 10000; // Same as BASIS_POINTS_PRECISION for fees

// Default market configuration
pub struct DefaultMarketConfig {
    pub start_time: u64,
    pub end_time: u64,
    pub resolution_time: u64,
    pub initial_yes_liquidity: u64,
    pub initial_no_liquidity: u64,
}

lazy_static::lazy_static! {
    pub static ref DEFAULT_MARKET: DefaultMarketConfig = DefaultMarketConfig {
        start_time: 0,      // Start immediately (counter = 0)
        end_time: TICKS_PER_4_MONTHS,    // End after 4 months
        resolution_time: TICKS_PER_4_MONTHS, // Resolution time same as end time (4 months)
        initial_yes_liquidity: 100000, // Initial YES liquidity for AMM
        initial_no_liquidity: 100000,  // Initial NO liquidity for AMM
    };
}

// Time conversion helpers (5 seconds per tick)
pub const SECONDS_PER_TICK: u64 = 5;
pub const TICKS_PER_MINUTE: u64 = 12;
pub const TICKS_PER_HOUR: u64 = 720;
pub const TICKS_PER_DAY: u64 = 17280;
pub const TICKS_PER_4_MONTHS: u64 = 2073600; // 120 days × 17280 ticks/day

impl DefaultMarketConfig {
    /// Convert seconds to ticks
    pub fn seconds_to_ticks(seconds: u64) -> u64 {
        seconds / SECONDS_PER_TICK
    }
    
    /// Convert ticks to seconds
    pub fn ticks_to_seconds(ticks: u64) -> u64 {
        ticks * SECONDS_PER_TICK
    }
    
    /// Get market duration in ticks
    pub fn duration_ticks(&self) -> u64 {
        self.end_time - self.start_time
    }
    
    /// Get market duration in seconds
    pub fn duration_seconds(&self) -> u64 {
        Self::ticks_to_seconds(self.duration_ticks())
    }
} 