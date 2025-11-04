use zkwasm_rest_abi::StorageData;
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


pub struct MarketEvent {
    // Virtual liquidity for AMM pricing
    total_yes_shares: u64,
    total_no_shares: u64,
}

impl StorageData for MarketEvent {
    fn from_data(u64data: &mut std::slice::IterMut<u64>) -> Self {
        MarketEvent {
            total_yes_shares: *u64data.next().unwrap(),
            total_no_shares: *u64data.next().unwrap(),
        }
    }
    fn to_data(&self, data: &mut Vec<u64>) {
        data.push(self.total_yes_shares);
        data.push(self.total_no_shares);
    }
}

impl From<&MarketData> for MarketEvent {
    fn from(m: &MarketData) -> MarketEvent {
        MarketEvent {
            total_yes_shares: m.total_yes_shares,
            total_no_shares: m.total_no_shares,
        }
    }
}
