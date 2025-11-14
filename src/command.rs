use crate::error::*;
use crate::event::{insert_event, EVENT_BET_UPDATE, emit_market_indexed_object};
use crate::player::Player;
use crate::state::{GLOBAL_STATE};

#[derive(Clone)]
pub enum Command {
    // Standard activities
    Activity(Activity),
    // Standard withdraw and deposit
    Withdraw(Withdraw),
    Deposit(Deposit),
    // Standard player install and timer
    InstallPlayer,
    Tick,
}

pub trait CommandHandler {
    fn handle(&self, pid: &[u64; 2], nonce: u64, rand: &[u64; 4], counter: u64) -> Result<(), u32>;
}

#[derive(Clone)]
pub struct Withdraw {
    pub data: [u64; 3],
}

impl CommandHandler for Withdraw {
    fn handle(&self, pid: &[u64; 2], nonce: u64, _rand: &[u64; 4], _counter: u64) -> Result<(), u32> {
        let mut player = Player::get_from_pid(pid);
        match player.as_mut() {
            None => Err(ERROR_PLAYER_NOT_EXIST),
            Some(player) => {
                player.check_and_inc_nonce(nonce);
                let balance = player.data.balance;
                let amount = self.data[0] & 0xffffffff;
                unsafe { zkwasm_rust_sdk::require(balance >= amount) };
                player.data.balance -= amount;
                let withdrawinfo = zkwasm_rest_abi::WithdrawInfo::new(&[self.data[0], self.data[1], self.data[2]], 0);
                crate::settlement::SettlementInfo::append_settlement(withdrawinfo);
                player.store();
                Ok(())
            }
        }
    }
}

#[derive(Clone)]
pub struct Deposit {
    pub data: [u64; 3],
}

impl CommandHandler for Deposit {
    fn handle(&self, pid: &[u64; 2], nonce: u64, _rand: &[u64; 4], _counter: u64) -> Result<(), u32> {
        let mut admin = Player::get_from_pid(pid).unwrap();
        admin.check_and_inc_nonce(nonce);
        let mut player = Player::get_from_pid(&[self.data[0], self.data[1]]);
        match player.as_mut() {
            None => Err(ERROR_PLAYER_NOT_EXIST),
            Some(player) => {
                player.data.balance += self.data[2];
                player.store();
                admin.store();
                Ok(())
            }
        }
    }
}

#[derive(Clone)]
pub enum Activity {
    // Prediction market activities
    Bet(u64, u64, u64),        // market_id, bet_type, amount
    Sell(u64, u64, u64),       // market_id, sell_type, shares_amount
    Resolve(u64, u64),         // market_id, outcome
    Claim(u64),                // market_id
    WithdrawFees(u64),         // market_id
    CreateMarket(Vec<u64>, u64, u64, u64, u64, u64, u64), // title_u64_vec, start_time_offset, end_time_offset, resolution_time_offset, yes_liquidity, no_liquidity, b
}

impl CommandHandler for Activity {
    fn handle(&self, pid: &[u64; 2], nonce: u64, _rand: &[u64; 4], counter: u64) -> Result<(), u32> {
        let mut player = Player::get_from_pid(pid);
        match player.as_mut() {
            None => Err(ERROR_PLAYER_NOT_EXIST),
            Some(player) => {
                player.check_and_inc_nonce(nonce);
                match self {
                    Activity::Bet(market_id, bet_type, amount) => {
                        Self::handle_bet(player, *market_id, *bet_type, *amount, counter)
                    },
                    Activity::Sell(market_id, sell_type, shares) => {
                        Self::handle_sell(player, *market_id, *sell_type, *shares, counter)
                    },
                    Activity::Resolve(market_id, outcome) => {
                        // Only admin can resolve - we need to check this at a higher level
                        Self::handle_resolve(*market_id, *outcome, counter)
                    },
                    Activity::Claim(market_id) => {
                        Self::handle_claim(player, *market_id, counter)
                    },
                    Activity::WithdrawFees(market_id) => {
                        // Only admin can withdraw fees - we need to check this at a higher level
                        Self::handle_withdraw_fees(player, *market_id, counter)
                    },
                    Activity::CreateMarket(title_u64_vec, start_time, end_time, resolution_time, yes_liquidity, no_liquidity, b) => {
                        // Only admin can create markets - we need to check this at a higher level
                        Self::handle_create_market(title_u64_vec.clone(), *start_time, *end_time, *resolution_time, *yes_liquidity, *no_liquidity, *b, counter)
                    }
                }
            }
        }
    }
}

impl Activity {
    // Note: Market IndexedObject events are now emitted directly
    // Liquidity history is only emitted during Tick (counter increment)

    fn handle_bet(player: &mut Player, market_id: u64, bet_type: u64, amount: u64, _counter: u64) -> Result<(), u32> {
        if amount == 0 {
            return Err(ERROR_INVALID_BET_AMOUNT);
        }

        // Validate bet_type (0 = NO, 1 = YES)
        if bet_type > 1 {
            return Err(ERROR_INVALID_BET_TYPE);
        }

        // Check if market is active and get txid
        let global_state = GLOBAL_STATE.0.borrow();
        let current_time = global_state.ensure_market_active(market_id)?;
        let txid = global_state.txcounter;

        // Check player balance
        player.data.spend_balance(amount)?;

        // Place bet using unified function
        let mut market = crate::state::MarketManager::get_market(market_id)
            .ok_or(crate::error::ERROR_MARKET_NOT_ACTIVE)?;
        let shares = market.place_bet(bet_type, amount)?;
        crate::state::MarketManager::update_market(market_id, &market);
        
        if bet_type == 1 {
            player.data.add_yes_shares_for_market(&player.player_id, market_id, shares);
        } else {
            player.data.add_no_shares_for_market(&player.player_id, market_id, shares);
        }

        // Store updated data
        player.store();

        // Emit events
        Self::emit_bet_event(player.player_id, market_id, bet_type, amount, shares, txid, current_time);
        
        // Emit IndexedObject event for updated market
        emit_market_indexed_object(&market, market_id);
        
        Ok(())
    }

    fn handle_sell(player: &mut Player, market_id: u64, sell_type: u64, shares: u64, _counter: u64) -> Result<(), u32> {
        if shares == 0 {
            return Err(ERROR_INVALID_BET_AMOUNT);
        }

        // Check if market is active and get txid
        let global_state = GLOBAL_STATE.0.borrow();
        let current_time = global_state.ensure_market_active(market_id)?;
        let txid = global_state.txcounter;

        // Check player has enough shares
        if sell_type == 1 && player.data.get_yes_shares_for_market(&player.player_id, market_id) < shares {
            return Err(ERROR_INSUFFICIENT_BALANCE);
        }
        if sell_type != 1 && player.data.get_no_shares_for_market(&player.player_id, market_id) < shares {
            return Err(ERROR_INSUFFICIENT_BALANCE);
        }

        // Sell shares using unified function
        let mut market = crate::state::MarketManager::get_market(market_id)
            .ok_or(crate::error::ERROR_MARKET_NOT_ACTIVE)?;
        let payout = market.sell_shares(sell_type, shares)?;
        crate::state::MarketManager::update_market(market_id, &market);
        
        // Update player shares
        if sell_type == 1 {
            player.data.subtract_yes_shares_for_market(&player.player_id, market_id, shares)?;
        } else {
            player.data.subtract_no_shares_for_market(&player.player_id, market_id, shares)?;
        }

        // Add payout to player balance
        player.data.balance += payout;

        // Store updated data
        player.store();

        // Emit events
        Self::emit_sell_event(player.player_id, market_id, sell_type, shares, payout, txid, current_time);
        
        // Emit IndexedObject event for updated market
        emit_market_indexed_object(&market, market_id);

        Ok(())
    }

    fn handle_resolve(market_id: u64, outcome: u64, _counter: u64) -> Result<(), u32> {
        let current_time = GLOBAL_STATE.0.borrow().counter;

        let mut market = crate::state::MarketManager::get_market(market_id)
            .ok_or(crate::error::ERROR_MARKET_NOT_ACTIVE)?;

        // TODO: Uncomment this when production is ready
        if !market.can_resolve(current_time) && false {
             return Err(crate::error::ERROR_MARKET_NOT_RESOLVED);
        }

        let outcome_bool = outcome != 0;
        market.resolve(outcome_bool)?;
        crate::state::MarketManager::update_market(market_id, &market);
        
        // Emit IndexedObject event for updated market
        emit_market_indexed_object(&market, market_id);
        
        Ok(())
    }

    fn handle_claim(player: &mut Player, market_id: u64, _counter: u64) -> Result<(), u32> {
        let market = crate::state::MarketManager::get_market(market_id)
            .ok_or(crate::error::ERROR_MARKET_NOT_ACTIVE)?;
        
        if !market.resolved {
            return Err(crate::error::ERROR_MARKET_NOT_RESOLVED);
        }

        // Check if already claimed
        player.data.claim_winnings_for_market(&player.player_id, market_id)?;

        // Calculate payout
        let yes_shares = player.data.get_yes_shares_for_market(&player.player_id, market_id);
        let no_shares = player.data.get_no_shares_for_market(&player.player_id, market_id);
        let payout = market.calculate_payout(yes_shares, no_shares)?;

        if payout == 0 {
            return Err(crate::error::ERROR_NO_WINNING_POSITION);
        }

        // Add payout to balance
        player.data.add_balance(payout);
        player.store();

        Ok(())
    }

    fn handle_withdraw_fees(player: &mut Player, market_id: u64, _counter: u64) -> Result<(), u32> {
        let mut market = crate::state::MarketManager::get_market(market_id)
            .ok_or(crate::error::ERROR_MARKET_NOT_ACTIVE)?;
        
        let fees_collected = market.total_fees_collected;
        
        if fees_collected == 0 {
            return Err(crate::error::ERROR_NO_FEES_TO_WITHDRAW);
        }

        // Transfer fees to admin's balance
        player.data.add_balance(fees_collected);
        
        // Reset collected fees to zero
        market.total_fees_collected = 0;
        crate::state::MarketManager::update_market(market_id, &market);

        // Store updated player data
        player.store();

        Ok(())
    }

    fn handle_create_market(title_u64_vec: Vec<u64>, start_time_offset: u64, end_time_offset: u64, resolution_time_offset: u64, yes_liquidity: u64, no_liquidity: u64, b: u64, counter: u64) -> Result<(), u32> {
        // Calculate absolute times by adding offsets to current counter
        let absolute_start_time = counter + start_time_offset;
        let absolute_end_time = counter + end_time_offset;
        let absolute_resolution_time = counter + resolution_time_offset;
        
        let _market_id = crate::state::MarketManager::create_market_with_title_u64_and_liquidity(
            title_u64_vec,
            absolute_start_time,
            absolute_end_time,
            absolute_resolution_time,
            yes_liquidity,
            no_liquidity,
            b,
        )?;

        Ok(())
    }

    fn emit_bet_event(player_id: [u64; 2], market_id: u64, bet_type: u64, amount: u64, shares: u64, txid: u64, counter: u64) {
        let mut data = vec![
            txid,
            player_id[0],
            player_id[1],
            market_id,
            bet_type,
            amount,
            shares,
            counter,
        ];
        insert_event(EVENT_BET_UPDATE, &mut data);
    }

    fn emit_sell_event(player_id: [u64; 2], market_id: u64, sell_type: u64, shares: u64, payout: u64, txid: u64, counter: u64) {
        let mut data = vec![
            txid,
            player_id[0],
            player_id[1],
            market_id,
            sell_type + 10, // 11 = SELL_YES, 12 = SELL_NO (distinguish from bet events)
            shares,
            payout,
            counter,
        ];
        insert_event(EVENT_BET_UPDATE, &mut data); // Reuse BET_UPDATE event for now
    }
}

pub fn decode_error(e: u32) -> &'static str {
    match e {
        ERROR_INVALID_BET_AMOUNT => "InvalidBetAmount",
        ERROR_MARKET_NOT_ACTIVE => "MarketNotActive", 
        ERROR_MARKET_NOT_RESOLVED => "MarketNotResolved",
        ERROR_NO_WINNING_POSITION => "NoWinningPosition",
        ERROR_ALREADY_CLAIMED => "AlreadyClaimed",
        ERROR_UNAUTHORIZED => "Unauthorized",
        ERROR_INSUFFICIENT_BALANCE => "InsufficientBalance",
        ERROR_MARKET_ALREADY_RESOLVED => "MarketAlreadyResolved",
        ERROR_INVALID_MARKET_TIME => "InvalidMarketTime",
        ERROR_INVALID_MARKET_TITLE => "InvalidMarketTitle",
        ERROR_INVALID_BET_TYPE => "InvalidBetType",
        ERROR_PLAYER_NOT_EXIST => "PlayerNotExist",
        ERROR_PLAYER_ALREADY_EXISTS => "PlayerAlreadyExists",
        ERROR_NO_FEES_TO_WITHDRAW => "NoFeesToWithdraw",
        _ => "Unknown",
    }
} 
