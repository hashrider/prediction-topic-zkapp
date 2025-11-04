use zkwasm_rest_abi::StorageData;
use zkwasm_rest_convention::IndexedObject;
use std::convert::From;
use crate::market::MarketData;

/// External Events that are handled by external handler
pub static mut EVENTS: Vec<u64> = vec![];

pub fn clear_events(a: Vec<u64>) -> Vec<u64> {
    let mut c = a;
    unsafe {
        c.append(&mut EVENTS);
    }
    return c;
}

pub fn insert_event(typ: u64, data: &mut Vec<u64>) {
    unsafe {
        EVENTS.push((typ << 32) + data.len() as u64);
        EVENTS.append(data);
    }
}

// Event type constants for prediction market
pub const EVENT_PLAYER_UPDATE: u64 = 1;
pub const EVENT_MARKET_UPDATE: u64 = 2;
pub const EVENT_BET_UPDATE: u64 = 3;
pub const EVENT_INDEXED_OBJECT: u64 = 4;

// Market info constants for IndexedObject
pub const MARKET_INFO: u64 = 1;
pub const LIQUIDITY_HISTORY_INFO: u64 = 2;

pub struct MarketEvent {
    // Virtual liquidity for AMM pricing
    total_yes_shares: u64,
    total_no_shares: u64,
    // Market status
    resolved: u64, // 0 = false, 1 = true
    outcome: u64,  // 0 = NO won, 1 = YES won, meaningless if not resolved
}

impl StorageData for MarketEvent {
    fn from_data(u64data: &mut std::slice::IterMut<u64>) -> Self {
        MarketEvent {
            total_yes_shares: *u64data.next().unwrap(),
            total_no_shares: *u64data.next().unwrap(),
            resolved: *u64data.next().unwrap(),
            outcome: *u64data.next().unwrap(),
        }
    }
    fn to_data(&self, data: &mut Vec<u64>) {
        data.push(self.total_yes_shares);
        data.push(self.total_no_shares);
        data.push(self.resolved);
        data.push(self.outcome);
    }
}

impl From<&MarketData> for MarketEvent {
    fn from(m: &MarketData) -> MarketEvent {
        MarketEvent {
            total_yes_shares: m.total_yes_shares,
            total_no_shares: m.total_no_shares,
            resolved: if m.resolved { 1 } else { 0 },
            outcome: if m.outcome == Some(true) { 1 } else { 0 },
        }
    }
}

// New struct for historical liquidity tracking - simplified to only track liquidity snapshots
#[derive(Debug, Clone)]
pub struct LiquidityHistoryEntry {
    pub market_id: u64,
    pub counter: u64,
    pub total_yes_shares: u64,
    pub total_no_shares: u64,
}

impl StorageData for LiquidityHistoryEntry {
    fn from_data(u64data: &mut std::slice::IterMut<u64>) -> Self {
        LiquidityHistoryEntry {
            market_id: *u64data.next().unwrap(),
            counter: *u64data.next().unwrap(),
            total_yes_shares: *u64data.next().unwrap(),
            total_no_shares: *u64data.next().unwrap(),
        }
    }
    fn to_data(&self, data: &mut Vec<u64>) {
        data.push(self.market_id);
        data.push(self.counter);
        data.push(self.total_yes_shares);
        data.push(self.total_no_shares);
    }
}

impl IndexedObject<LiquidityHistoryEntry> for LiquidityHistoryEntry {
    const PREFIX: u64 = 0x2dd4;
    const POSTFIX: u64 = 0xfee4;
    const EVENT_NAME: u64 = 0x03;
}

// Helper function to emit IndexedObject events for market data
pub fn emit_market_indexed_object(market: &MarketData, market_id: u64) {
    let mut data = Vec::new();
    data.push(MARKET_INFO); // object index
    data.push(market_id); // market ID for proper indexing
    
    // Add market data - this will be the structure stored in IndexedObject
    market.to_data(&mut data);
    
    insert_event(EVENT_INDEXED_OBJECT, &mut data);
}

// Helper function to emit liquidity history - simplified to only track liquidity snapshots
pub fn emit_liquidity_history(market_id: u64, counter: u64, total_yes_shares: u64, total_no_shares: u64) {
    let history_entry = LiquidityHistoryEntry {
        market_id,
        counter,
        total_yes_shares,
        total_no_shares,
    };
    
    let mut data = Vec::new();
    data.push(LIQUIDITY_HISTORY_INFO); // object index
    history_entry.to_data(&mut data);
    
    insert_event(EVENT_INDEXED_OBJECT, &mut data);
}
