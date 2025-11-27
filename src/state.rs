use serde::Serialize;
use zkwasm_rest_abi::{StorageData, MERKLE_MAP};
use std::cell::RefCell;
use crate::market::MarketData;
use crate::error::ERROR_MARKET_NOT_ACTIVE;
use crate::event::{emit_market_indexed_object, emit_liquidity_history};


#[derive(Serialize)]
pub struct QueryState {
    counter: u64,
    total_players: u64,
    total_markets: u64,
}

#[derive(Serialize, Clone)]
pub struct GlobalState {
    pub counter: u64,
    pub market_ids: Vec<u64>,  // List of active market IDs
    pub next_market_id: u64,   // Auto-incrementing market ID
    pub total_players: u64,
    pub txsize: u64,
    pub txcounter: u64,
}

impl GlobalState {
    pub fn new() -> Self {
        GlobalState {
            counter: 0,
            market_ids: vec![],  // Start with no markets
            next_market_id: 1,
            total_players: 0,
            txsize: 0,
            txcounter: 0,
        }
    }

    pub fn snapshot() -> String {
        let state = GLOBAL_STATE.0.borrow();
        serde_json::to_string(&*state).unwrap()
    }

    pub fn get_state(pid: Vec<u64>) -> String {
        use crate::player::PredictionMarketPlayer;
        let player = PredictionMarketPlayer::get(&pid.try_into().unwrap()).unwrap();
        serde_json::to_string(&player).unwrap()
    }

    pub fn ensure_market_active(&self, market_id: u64) -> Result <u64, u32> {
        let current_time = self.counter;
        if let Some(market) = MarketManager::get_market(market_id) {
            if !market.is_active(current_time) {
                return Err(ERROR_MARKET_NOT_ACTIVE);
            } else {
                Ok(current_time)
            }
        } else {
            Err(ERROR_MARKET_NOT_ACTIVE)
        }
    }

    pub fn preempt() -> bool {
        let mut state = GLOBAL_STATE.0.borrow_mut();
        let counter = state.counter;
        let txsize = state.txsize;
        let withdraw_size = crate::settlement::SettlementInfo::settlement_size();
        if counter % 600 == 0 || txsize >= 40 || withdraw_size > 40 {
            state.txsize = 0;
            return true;
        } else {
            return false;
        }
    }

    pub fn flush_settlement() -> Vec<u8> {
        crate::settlement::SettlementInfo::flush_settlement()
    }

    pub fn rand_seed() -> u64 {
        0
    }

    pub fn store() {
        let mut data = vec![];
        GLOBAL_STATE.0.borrow_mut().to_data(&mut data);
        let kvpair = unsafe { &mut MERKLE_MAP };
        kvpair.set(&[0, 0, 0, 0], data.as_slice());
    }

    pub fn initialize() {
        let kvpair = unsafe { &mut MERKLE_MAP };
        let mut data = kvpair.get(&[0, 0, 0, 0]);
        if !data.is_empty() {
            let mut u64data = data.iter_mut();
            *GLOBAL_STATE.0.borrow_mut() = Self::from_data(&mut u64data);
        }
    }

    pub fn get_counter() -> u64 {
        GLOBAL_STATE.0.borrow().counter
    }
}

impl StorageData for GlobalState {
    fn from_data(u64data: &mut std::slice::IterMut<u64>) -> Self {
        let counter = *u64data.next().unwrap();
        let total_players = *u64data.next().unwrap();
        let txsize = *u64data.next().unwrap();
        let txcounter = *u64data.next().unwrap();
        let next_market_id = *u64data.next().unwrap();
        let market_count = *u64data.next().unwrap();
        
        let mut market_ids = Vec::new();
        for _ in 0..market_count {
            if let Some(id) = u64data.next() {
                market_ids.push(*id);
            }
        }
        
        GlobalState {
            counter,
            total_players,
            txsize,
            txcounter,
            next_market_id,
            market_ids,
        }
    }

    fn to_data(&self, data: &mut Vec<u64>) {
        data.push(self.counter);
        data.push(self.total_players);
        data.push(self.txsize);
        data.push(self.txcounter);
        data.push(self.next_market_id);
        data.push(self.market_ids.len() as u64);
        data.extend(self.market_ids.iter().cloned());
    }
}

pub struct SafeState(pub RefCell<GlobalState>);
unsafe impl Sync for SafeState {}

lazy_static::lazy_static! {
    pub static ref GLOBAL_STATE: SafeState = SafeState(RefCell::new(GlobalState::new()));
}

// Transaction constants
const TICK: u64 = 0;
const INSTALL_PLAYER: u64 = 1;
const WITHDRAW: u64 = 2;
const DEPOSIT: u64 = 3;
const BET: u64 = 4;
const SELL: u64 = 5;
const RESOLVE: u64 = 6;
const CLAIM: u64 = 7;
const WITHDRAW_FEES: u64 = 8;
const CREATE_MARKET: u64 = 9;

pub struct Transaction {
    command: crate::command::Command,
    nonce: u64,
}

impl Transaction {
    pub fn decode_error(e: u32) -> &'static str {
        crate::command::decode_error(e)
    }

    pub fn decode(params: &[u64]) -> Self {
        use crate::command::{Command, Activity, Withdraw, Deposit};
        use zkwasm_rest_abi::enforce;
        
        let command = params[0] & 0xff;
        let nonce = params[0] >> 16;
        
        let command = if command == WITHDRAW {
            enforce(params.len() == 5, "withdraw needs 5 params");
            Command::Withdraw(Withdraw {
                data: [params[2], params[3], params[4]]
            })
        } else if command == DEPOSIT {
            enforce(params.len() == 5, "deposit needs 5 params");
            enforce(params[3] == 0, "check deposit index"); // only token index 0 is supported
            Command::Deposit(Deposit {
                data: [params[1], params[2], params[4]]
            })
        } else if command == BET {
            enforce(params.len() == 4, "bet needs 4 params");
            Command::Activity(Activity::Bet(params[1], params[2], params[3]))
        } else if command == SELL {
            enforce(params.len() == 4, "sell needs 4 params");
            Command::Activity(Activity::Sell(params[1], params[2], params[3]))
        } else if command == RESOLVE {
            enforce(params.len() == 3, "resolve needs 3 params");
            Command::Activity(Activity::Resolve(params[1], params[2]))
        } else if command == CLAIM {
            enforce(params.len() == 2, "claim needs 2 params");
            Command::Activity(Activity::Claim(params[1]))
        } else if command == WITHDRAW_FEES {
            enforce(params.len() == 2, "withdraw_fees needs 2 params");
            Command::Activity(Activity::WithdrawFees(params[1]))
        } else if command == CREATE_MARKET {
            enforce(params.len() >= 6, "create_market needs at least 6 params");
            // Calculate title length: total_params - 6 (other params) = title_len
            // params = [title_data..., start_time, end_time, resolution_time, yes_liquidity, no_liquidity, b]
            let title_len = params.len() - 6;
            enforce(title_len <= 8, "create_market title too long");
            let title_u64_vec = params[0..title_len].to_vec();
            let start_time = params[title_len];
            let end_time = params[title_len+1];
            let resolution_time = params[title_len+2];
            let yes_liquidity = params[title_len+3];
            let no_liquidity = params[title_len+4];
            let b = params[title_len+5];
            Command::Activity(Activity::CreateMarket(title_u64_vec, start_time, end_time, resolution_time, yes_liquidity, no_liquidity, b))
        } else if command == INSTALL_PLAYER {
            Command::InstallPlayer
        } else {
            unsafe { zkwasm_rust_sdk::require(command == TICK) };
            Command::Tick
        };
        
        Transaction { command, nonce }
    }

    pub fn create_player(&self, pkey: &[u64; 4]) -> Result<(), u32> {
        use crate::player::Player;
        use crate::error::{ERROR_PLAYER_ALREADY_EXISTS};
        use crate::config::NEW_PLAYER_INITIAL_BALANCE;
        
        let player_id = Player::pkey_to_pid(pkey);
        let player = Player::get_from_pid(&player_id);
        match player {
            Some(_) => Err(ERROR_PLAYER_ALREADY_EXISTS), // Player already exists
            None => {
                let mut player = Player::new_from_pid(player_id);
                // Set initial balance for new player
                player.data.balance = NEW_PLAYER_INITIAL_BALANCE;
                player.store();
                Ok(())
            }
        }
    }

    pub fn tick(&self) {
        let (new_counter, market_ids) = {
            let mut global_state = GLOBAL_STATE.0.borrow_mut();
            global_state.counter += 1;
            let new_counter = global_state.counter;
            // Get all active market IDs
            let market_ids = global_state.market_ids.clone();
            
            (new_counter, market_ids)
        }; // global_state is dropped here
        
        // Emit shares history for each market at this counter
        // Note: Market IndexedObject events are emitted directly during operations (bet, sell, resolve)
        for market_id in market_ids {
            if let Some(market) = MarketManager::get_market(market_id) {
                emit_liquidity_history(
                    market_id,
                    new_counter,
                    market.total_yes_shares,
                    market.total_no_shares
                );
            }
        }
    }

    pub fn inc_tx_number(&self) {
        let mut global_state = GLOBAL_STATE.0.borrow_mut();
        global_state.txsize += 1;
        global_state.txcounter += 1;
    }

    pub fn process(&self, pkey: &[u64; 4], rand: &[u64; 4]) -> Vec<u64> {
        use crate::command::{Activity, CommandHandler};
        use crate::config::ADMIN_PUBKEY;
        use crate::event::clear_events;
        use crate::player::Player;
        use zkwasm_rust_sdk::require;
        
        let pid = Player::pkey_to_pid(pkey);
        let counter = GLOBAL_STATE.0.borrow().counter;
        
        let e = match &self.command {
            crate::command::Command::Tick => {
                unsafe { require(*pkey == *ADMIN_PUBKEY) };
                self.tick();
                0
            },
            crate::command::Command::InstallPlayer => self.create_player(pkey)
                .map_or_else(|e| e, |_| 0),
            crate::command::Command::Withdraw(cmd) => cmd.handle(&pid, self.nonce, rand, counter)
                .map_or_else(|e| e, |_| 0),
            crate::command::Command::Activity(cmd) => {
                // Check admin permissions for resolve, withdraw fees, and create market commands
                if let Activity::Resolve(_, _) = cmd {
                    unsafe { require(*pkey == *ADMIN_PUBKEY) };
                }
                if let Activity::WithdrawFees(_) = cmd {
                    unsafe { require(*pkey == *ADMIN_PUBKEY) };
                }
                if let Activity::CreateMarket(_, _, _, _, _, _, _) = cmd {
                    unsafe { require(*pkey == *ADMIN_PUBKEY) };
                }
                cmd.handle(&pid, self.nonce, rand, counter)
                    .map_or_else(|e| e, |_| 0)
            },
            crate::command::Command::Deposit(cmd) => {
                unsafe { require(*pkey == *ADMIN_PUBKEY) };
                cmd.handle(&pid, self.nonce, rand, counter)
                    .map_or_else(|e| e, |_| 0)
            },
        };

        if e == 0 {
            match self.command {
                crate::command::Command::Tick => (),
                _ => {
                    self.inc_tx_number();
                }
            }
        }
        let eventid = {
            let state = GLOBAL_STATE.0.borrow();
            (state.counter << 32) + state.txcounter
        };
        clear_events(vec![e as u64, eventid])
    }
}

// Market management system using indexed storage
pub struct MarketManager;

impl MarketManager {
    const MARKET_PREFIX: [u64; 2] = [1, 0]; // Prefix for market storage keys
    
    pub fn store_market(market_id: u64, market: &MarketData) {
        let mut data = vec![];
        market.to_data(&mut data);
        let kvpair = unsafe { &mut MERKLE_MAP };
        let key = [Self::MARKET_PREFIX[0], Self::MARKET_PREFIX[1], market_id, 0];
        kvpair.set(&key, data.as_slice());
    }
    
    pub fn get_market(market_id: u64) -> Option<MarketData> {
        let kvpair = unsafe { &mut MERKLE_MAP };
        let key = [Self::MARKET_PREFIX[0], Self::MARKET_PREFIX[1], market_id, 0];
        let mut data = kvpair.get(&key);
        if !data.is_empty() {
            let mut u64data = data.iter_mut();
            Some(MarketData::from_data(&mut u64data))
        } else {
            None
        }
    }
    
    pub fn update_market(market_id: u64, market: &MarketData) {
        Self::store_market(market_id, market);
    }

    pub fn create_market_with_title_u64_and_liquidity(
        title_u64_vec: Vec<u64>, 
        start_time: u64, 
        end_time: u64, 
        resolution_time: u64,
        initial_yes_liquidity: u64,
        initial_no_liquidity: u64,
        b: u64
    ) -> Result<u64, u32> {
        let market = MarketData::new_with_title_u64_and_liquidity(
            title_u64_vec, 
            start_time, 
            end_time, 
            resolution_time,
            initial_yes_liquidity,
            initial_no_liquidity,
            b
        )?;
        
        let market_id = {
            let mut global_state = GLOBAL_STATE.0.borrow_mut();
            let market_id = global_state.next_market_id;
            global_state.next_market_id += 1;
            global_state.market_ids.push(market_id);
            
            market_id
        }; // global_state is automatically dropped here
        
        Self::store_market(market_id, &market);
        
        // Emit IndexedObject event for new market
        emit_market_indexed_object(&market, market_id);
        
        Ok(market_id)
    }

    pub fn get_active_market_ids() -> Vec<u64> {
        GLOBAL_STATE.0.borrow().market_ids.clone()
    }
}
