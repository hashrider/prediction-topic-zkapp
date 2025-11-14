use serde::Serialize;
use zkwasm_rest_abi::StorageData;
use zkwasm_rest_convention::IndexedObject;
use crate::error::*;
use crate::math_safe::*;


#[derive(Serialize, Clone, Debug)]
pub struct MarketData {
    pub title: Vec<u64>,  // Title encoded as Vec<u64> (8 bytes per u64)
    pub start_time: u64,
    pub end_time: u64,
    pub resolution_time: u64,
    // LMSR state = outstanding shares
    pub total_yes_shares: u64,
    pub total_no_shares: u64,

    // LMSR liquidity parameter b (market depth)
    pub b: u64,

    // Collateral in the AMM bank
    pub pool_balance: u64,

    // Volume stats
    pub total_volume: u64,

    pub resolved: bool,
    pub outcome: Option<bool>, // None = unresolved, Some(true) = Yes wins, Some(false) = No wins
    pub total_fees_collected: u64,
}

impl MarketData {
    pub fn new_with_title_u64_and_liquidity(
        title: Vec<u64>, 
        start_time: u64, 
        end_time: u64, 
        resolution_time: u64,
        initial_yes_liquidity: u64,
        initial_no_liquidity: u64,
        b: u64
    ) -> Result<Self, u32> {
        // 验证标题长度（命令长度限制）
        // CreateMarket命令格式：[cmd_type, title_data..., start, end, resolution, yes_liq, no_liq, b]
        // 总长度必须 < 16，所以 title_len < 9，最大值为8 (16 - 1 - 6 = 9)
        if title.len() > 8 {
            return Err(crate::error::ERROR_INVALID_MARKET_TITLE);
        }
        
        // 验证时间参数
        if start_time >= end_time {
            return Err(crate::error::ERROR_INVALID_MARKET_TIME);
        }
        if end_time > resolution_time {
            return Err(crate::error::ERROR_INVALID_MARKET_TIME);
        }
        
        // 验证初始流动性
        validate_liquidity(initial_yes_liquidity)?;
        validate_liquidity(initial_no_liquidity)?;
        
        // 验证LMSR参数b
        validate_b(b)?;
        
        Ok(MarketData {
            title,
            start_time,
            end_time,
            resolution_time,
            // Virtual liquidity for AMM pricing


            total_yes_shares: initial_yes_liquidity,
            total_no_shares:  initial_no_liquidity,

            b: b,

            pool_balance: 0,
            total_volume: 0,

            resolved: false,
            outcome: None,
            total_fees_collected: 0,
        })
    }



    // Helper function to convert string to Vec<u64>
    pub fn string_to_u64_vec(s: &str) -> Vec<u64> {
        let bytes = s.as_bytes();
        let mut result = Vec::new();
        
        for chunk in bytes.chunks(8) {
            let mut value = 0u64;
            for (i, &byte) in chunk.iter().enumerate() {
                value |= (byte as u64) << (i * 8);
            }
            result.push(value);
        }
        
        result
    }

    // Helper function to convert Vec<u64> back to string
    pub fn u64_vec_to_string(title: &[u64]) -> String {
        let mut bytes = Vec::new();
        
        for &value in title {
            for i in 0..8 {
                let byte = ((value >> (i * 8)) & 0xFF) as u8;
                if byte != 0 {  // Stop at null terminator
                    bytes.push(byte);
                } else {
                    break;
                }
            }
        }
        
        String::from_utf8_lossy(&bytes).to_string()
    }

    pub fn get_title_string(&self) -> String {
        Self::u64_vec_to_string(&self.title)
    }

    pub fn is_active(&self, current_time: u64) -> bool {
        current_time >= self.start_time && current_time < self.end_time && !self.resolved
    }

    pub fn can_resolve(&self, current_time: u64) -> bool {
        current_time >= self.resolution_time && !self.resolved
    }

    // LMSR YES price scaled to PRICE_PRECISION
    pub fn get_yes_price(&self) -> Result<u64, u32> {
        // calculate_yes_price_lmsr returns FP_SCALE=1e6 fixed point,
        // which matches PRICE_PRECISION (1e6), so we can pass it through.
        calculate_yes_price_lmsr(
            self.total_yes_shares,
            self.total_no_shares,
            self.b
        )
    }

    // LMSR NO price scaled to PRICE_PRECISION
    pub fn get_no_price(&self) -> Result<u64, u32> {
        calculate_no_price_lmsr(
            self.total_yes_shares,
            self.total_no_shares,
            self.b
        )
    }

    // 验证投注类型的辅助函数
    fn validate_bet_type(bet_type: u64) -> Result<bool, u32> {
        match bet_type {
            0 => Ok(false), // NO bet
            1 => Ok(true),  // YES bet  
            _ => Err(crate::error::ERROR_INVALID_BET_TYPE),
        }
    }

    // New: compute how many shares we mint for the user if they spend `bet_amount`
    // bet_type: 1 = buy YES, 0 = buy NO
    // Returns "delta_shares" to mint.
    //
    // Strategy:
    //   1. compute fee and net_amount
    //   2. binary search Δ such that lmsr_buy_*_quote(...) ~= net_amount
    pub fn calculate_shares(&self, bet_type: u64, bet_amount: u64) -> Result<u64, u32> {
        validate_bet_amount(bet_amount)?;

        let fee = calculate_fee_safe(bet_amount)?;
        let net_amount = safe_sub(bet_amount, fee)?;

        let is_yes_bet = Self::validate_bet_type(bet_type)?;

        // binary search Δ in [0, MAX_SHARES] for monotonic cost
        let mut lo: u64 = 0;
        let mut hi: u64 = MAX_SHARES; // cap

        while lo < hi {
            let mid = lo + (hi - lo + 1) / 2;
            let quote_res = if is_yes_bet {
                lmsr_buy_yes_quote(self.total_yes_shares, self.total_no_shares, self.b, mid)
            } else {
                lmsr_buy_no_quote(self.total_yes_shares, self.total_no_shares, self.b, mid)
            }?;

            // quote_res is in fixed point 1e6. We compare against net_amount (u64 tokens).
            // We assume "1 token" == "1 unit in quote_res / 1e6".
            // So convert quote_res down:
            let quote_tokens = (quote_res / 1_000_000u128) as u64;

            if quote_tokens <= net_amount {
                lo = mid;
            } else {
                hi = mid - 1;
            }
        }

        validate_shares(lo)?;
        Ok(lo)
    }

    // LMSR sell preview.
    // Returns (net_payout_tokens, fee_tokens)
    // sell_type: 1 = sell YES shares, 0 = sell NO shares
    pub fn calculate_sell_details(&self, sell_type: u64, shares_to_sell: u64) -> Result<(u64, u64), u32> {
        validate_shares(shares_to_sell)?;

        let is_yes_sell = Self::validate_bet_type(sell_type)?;

        // gross quote from LMSR (fixed point 1e6)
        let gross_quote_fp = if is_yes_sell {
            lmsr_sell_yes_quote(self.total_yes_shares, self.total_no_shares, self.b, shares_to_sell)?
        } else {
            lmsr_sell_no_quote(self.total_yes_shares, self.total_no_shares, self.b, shares_to_sell)?
        };

        // convert to whole tokens (floor)
        let gross_tokens: u64 = (gross_quote_fp / 1_000_000u128) as u64;

        if gross_tokens == 0 {
            return Ok((0, 0));
        }

        let fee = calculate_fee_safe(gross_tokens)?;
        let net_payout = safe_sub(gross_tokens, fee)?;
        Ok((net_payout, fee))
    }

    // // 统一的买入价格计算（bet_type: 1=YES, 0=NO）- 前端分析用，后端不使用
    // pub fn get_buy_price(&self, bet_type: u64, bet_amount: u64) -> Result<u64, u32> {
    //     let shares = self.calculate_shares(bet_type, bet_amount)?;
    //     calculate_effective_price_safe(bet_amount, shares)
    // }

    // // 统一的卖出价格计算（sell_type: 1=YES, 0=NO）- 前端分析用，后端不使用
    // pub fn get_sell_price(&self, sell_type: u64, shares_to_sell: u64) -> Result<u64, u32> {
    //     let (payout, _) = self.calculate_sell_details(sell_type, shares_to_sell)?;
    //     calculate_effective_price_safe(payout, shares_to_sell)
    // }



    // // 市场影响分析（安全版本）- 前端分析用，后端不使用
    // pub fn get_buy_market_impact(&self, bet_type: u64, bet_amount: u64) -> Result<(u64, u64), u32> {
    //     let current_yes_price = self.get_yes_price()?;
    //     let current_no_price = self.get_no_price()?;
    //     
    //     if bet_amount == 0 {
    //         return Ok((current_yes_price, current_no_price));
    //     }
    //     
    //     // 模拟交易
    //     let mut temp_market = self.clone();
    //     let _ = temp_market.place_bet(bet_type, bet_amount)?;
    //     
    //     let new_yes_price = temp_market.get_yes_price()?;
    //     let new_no_price = temp_market.get_no_price()?;
    //     
    //     Ok((new_yes_price, new_no_price))
    // }

    // // 滑点计算（安全版本）- 前端分析用，后端不使用
    // pub fn get_slippage(&self, bet_type: u64, bet_amount: u64) -> Result<u64, u32> {
    //     if bet_amount == 0 {
    //         return Ok(0);
    //     }
    //     
    //     let current_price = if bet_type == 1 {
    //         self.get_yes_price()?
    //     } else {
    //         self.get_no_price()?
    //     };
    //     
    //     let effective_price = self.get_buy_price(bet_type, bet_amount)?;
    //     
    //     if effective_price > current_price {
    //         safe_sub(effective_price, current_price)
    //     } else {
    //         Ok(0)
    //     }
    // }

    pub fn place_bet(&mut self, bet_type: u64, bet_amount: u64) -> Result<u64, u32> {
        validate_bet_amount(bet_amount)?;

        // how many shares will we mint?
        let shares = self.calculate_shares(bet_type, bet_amount)?;
        if shares == 0 {
            return Err(ERROR_INVALID_BET_AMOUNT);
        }

        // recompute fee / net (tokens)
        let fee_tokens = calculate_fee_safe(bet_amount)?;
        let net_tokens = safe_sub(bet_amount, fee_tokens)?;

        let is_yes_bet = bet_type == 1;

        // Mint shares into outstanding supply
        if is_yes_bet {
            self.total_yes_shares = safe_add(self.total_yes_shares, shares)?;
        } else {
            self.total_no_shares = safe_add(self.total_no_shares, shares)?;
        }

        // AMM balance bookkeeping
        // - only NET tokens fund the pool
        // - fees go to the fee vault (`total_fees_collected`)
        self.pool_balance = safe_add(self.pool_balance, net_tokens)?;
        self.total_volume = safe_add(self.total_volume, bet_amount)?;
        self.total_fees_collected = safe_add(self.total_fees_collected, fee_tokens)?;

        // NOTE: net_tokens goes to bankroll "backing" payouts, fee_tokens can later be skimmed.

        Ok(shares)
    }

    pub fn sell_shares(&mut self, sell_type: u64, shares_to_sell: u64) -> Result<u64, u32> {
        // Check balance
        let (current_shares, is_yes_sell) = if sell_type == 1 {
            (self.total_yes_shares, true)
        } else {
            (self.total_no_shares, false)
        };

        if shares_to_sell > current_shares {
            return Err(ERROR_INSUFFICIENT_BALANCE);
        }

        // Get net payout + fee in tokens
        let (payout_tokens, fee_tokens) = self.calculate_sell_details(sell_type, shares_to_sell)?;
        if payout_tokens == 0 {
            return Err(ERROR_INVALID_BET_AMOUNT);
        }

        // AMM must have enough collateral
        if payout_tokens > self.pool_balance {
            return Err(ERROR_INSUFFICIENT_BALANCE);
        }

        // Burn the user's shares from total supply
        if is_yes_sell {
            self.total_yes_shares = safe_sub(self.total_yes_shares, shares_to_sell)?;
        } else {
            self.total_no_shares = safe_sub(self.total_no_shares, shares_to_sell)?;
        }

        // Pay the trader only the net payout from the pool;
        // protocol fee is *not* paid out — it’s retained
        self.pool_balance = safe_sub(self.pool_balance, payout_tokens)?;
        self.total_fees_collected = safe_add(self.total_fees_collected, fee_tokens)?;

        // Record economic size: sell-side trade value = payout + fee
        let tx_value = safe_add(payout_tokens, fee_tokens)?;
        self.total_volume = safe_add(self.total_volume, tx_value)?;

        Ok(payout_tokens)
    }

    // 市场解决
    pub fn resolve(&mut self, outcome: bool) -> Result<(), u32> {
        if self.resolved {
            return Err(ERROR_MARKET_ALREADY_RESOLVED);
        }
        
        self.resolved = true;
        self.outcome = Some(outcome);
        Ok(())
    }

    // 安全计算奖金
    pub fn calculate_payout(&self, yes_shares: u64, no_shares: u64) -> Result<u64, u32> {
        if !self.resolved || self.pool_balance == 0 {
            return Ok(0);
        }

        match self.outcome {
            Some(true) => {
                // YES 获胜
                if self.total_yes_shares == 0 {
                    return Ok(0);
                }
                safe_div_high_precision(yes_shares, self.pool_balance, self.total_yes_shares)
            },
            Some(false) => {
                // NO 获胜
                if self.total_no_shares == 0 {
                    return Ok(0);
                }
                safe_div_high_precision(no_shares, self.pool_balance, self.total_no_shares)
            },
            None => Ok(0),
        }
    }

    // // 获取份额价值（解决前估算）- 前端分析用，后端不使用
    // pub fn get_share_value(&self, is_yes_share: bool) -> Result<u64, u32> {
    //     if self.prize_pool == 0 {
    //         return Ok(0);
    //     }
    //     
    //     if is_yes_share {
    //         if self.total_yes_shares == 0 { return Ok(0); }
    //         let total_shares = safe_add(self.total_yes_shares, self.total_no_shares)?;
    //         safe_div(self.prize_pool, total_shares)
    //     } else {
    //         if self.total_no_shares == 0 { return Ok(0); }
    //         let total_shares = safe_add(self.total_yes_shares, self.total_no_shares)?;
    //         safe_div(self.prize_pool, total_shares)
    //     }
    // }


    pub fn withdraw_fees(&mut self, amount: u64) -> Result<u64, u32> {
        if amount == 0 || amount > self.total_fees_collected {
            return Err(ERROR_INVALID_BET_AMOUNT);
        }
        self.total_fees_collected = safe_sub(self.total_fees_collected, amount)?;
        // no impact on pool_balance; fees are separate by design
        Ok(amount)
    }
}

impl StorageData for MarketData {
    fn from_data(u64data: &mut std::slice::IterMut<u64>) -> Self {
        let title_len = *u64data.next().unwrap() as usize;
        let mut title = Vec::new();
        for _ in 0..title_len {
            title.push(*u64data.next().unwrap());
        }
        
        MarketData {
            title,
            start_time: *u64data.next().unwrap(),
            end_time: *u64data.next().unwrap(),
            resolution_time: *u64data.next().unwrap(),
            total_yes_shares: *u64data.next().unwrap(),
            total_no_shares: *u64data.next().unwrap(),
            b: *u64data.next().unwrap(),
            pool_balance: *u64data.next().unwrap(),
            total_volume: *u64data.next().unwrap(),
            resolved: *u64data.next().unwrap() != 0,
            outcome: {
                let outcome_val = *u64data.next().unwrap();
                if outcome_val == 0 { None }
                else if outcome_val == 1 { Some(false) }
                else { Some(true) }
            },
            total_fees_collected: *u64data.next().unwrap(),
        }
    }

    fn to_data(&self, data: &mut Vec<u64>) {
        data.push(self.title.len() as u64);
        data.extend_from_slice(&self.title);
        data.push(self.start_time);
        data.push(self.end_time);
        data.push(self.resolution_time);
        data.push(self.total_yes_shares);
        data.push(self.total_no_shares);
        data.push(self.b);
        data.push(self.pool_balance);
        data.push(self.total_volume);
        data.push(if self.resolved { 1 } else { 0 });
        data.push(match self.outcome {
            None => 0,
            Some(false) => 1,
            Some(true) => 2,
        });
        data.push(self.total_fees_collected);
    }
}

impl IndexedObject<MarketData> for MarketData {
    const PREFIX: u64 = 0x1ee3;
    const POSTFIX: u64 = 0xfee3;
    const EVENT_NAME: u64 = 0x02;
} 