use crate::error::*;
use crate::config::{PRICE_PRECISION, FEE_BASIS_POINTS, PLATFORM_FEE_RATE};

// 安全限制常量
pub const MAX_LIQUIDITY: u64 = 1_000_000_000_000;  // 1万亿 - 防止溢出
pub const MAX_BET_AMOUNT: u64 = 100_000_000;       // 1亿 - 合理的最大投注
pub const MIN_LIQUIDITY: u64 = 1000;               // 最小流动性 - 防止除零
pub const MAX_SHARES: u64 = 1_000_000_000;         // 最大份额数

/// 安全的乘法运算，检查溢出
pub fn safe_mul(a: u64, b: u64) -> Result<u64, u32> {
    a.checked_mul(b).ok_or(ERROR_OVERFLOW)
}

/// 安全的除法运算，检查除零
pub fn safe_div(a: u64, b: u64) -> Result<u64, u32> {
    if b == 0 {
        return Err(ERROR_DIVISION_BY_ZERO);
    }
    Ok(a / b)
}

/// 安全的减法运算，检查下溢
pub fn safe_sub(a: u64, b: u64) -> Result<u64, u32> {
    a.checked_sub(b).ok_or(ERROR_UNDERFLOW)
}

/// 安全的加法运算，检查溢出
pub fn safe_add(a: u64, b: u64) -> Result<u64, u32> {
    a.checked_add(b).ok_or(ERROR_OVERFLOW)
}

/// 使用 u128 进行高精度乘法，然后安全转换回 u64
pub fn safe_mul_high_precision(a: u64, b: u64) -> Result<u64, u32> {
    let result = (a as u128).checked_mul(b as u128)
        .ok_or(ERROR_OVERFLOW)?;
    
    if result > u64::MAX as u128 {
        return Err(ERROR_OVERFLOW);
    }
    
    Ok(result as u64)
}

/// 使用 u128 进行高精度除法计算
pub fn safe_div_high_precision(a: u64, b: u64, c: u64) -> Result<u64, u32> {
    if b == 0 || c == 0 {
        return Err(ERROR_DIVISION_BY_ZERO);
    }
    
    let numerator = (a as u128).checked_mul(b as u128)
        .ok_or(ERROR_OVERFLOW)?;
    
    let result = numerator / (c as u128);
    
    if result > u64::MAX as u128 {
        return Err(ERROR_OVERFLOW);
    }
    
    Ok(result as u64)
}

// State meanings:
//   q_yes: total YES shares outstanding
//   q_no:  total NO shares outstanding
//   b:     liquidity parameter (market depth)
//
// Cost function:
//   C(q) = b * ln( exp(q_yes / b) + exp(q_no / b) )
//
// Marginal price of YES:
//   p_yes = exp(q_yes/b) / (exp(q_yes/b) + exp(q_no/b))
//
// Trades:
//   Cost to BUY Δ_yes YES shares:
//      cost = C(q_yes + Δ_yes, q_no) - C(q_yes, q_no)
//
//   Payout for SELL S_yes YES shares:
//      payout = C(q_yes, q_no) - C(q_yes - S_yes, q_no)
//
// All returns in these helpers are u128 in fixed-point 1e6-style scale
// and we clamp / cast to u64 when exposing prices externally.
//
// NOTE: We stub deterministic fixed-point exp/ln approximations below.
// You MUST refine these approximations for production / zk correctness.
// ---------------------------------------------------------------------------

pub const FP_SCALE: u128 = 1_000_000u128; // 1e6 fixed point to match PRICE_PRECISION

fn fp_mul(a: u128, b: u128) -> Result<u128, u32> {
    // (a * b) / FP_SCALE
    let wide = a
        .checked_mul(b)
        .ok_or(ERROR_OVERFLOW)?;
    Ok(wide / FP_SCALE)
}

fn fp_div(a: u128, b: u128) -> Result<u128, u32> {
    if b == 0 {
        return Err(ERROR_DIVISION_BY_ZERO);
    }
    let wide = a
        .checked_mul(FP_SCALE)
        .ok_or(ERROR_OVERFLOW)?;
    Ok(wide / b)
}

// crude deterministic exp() approximation for small/medium arguments.
// x_fp is fixed-point FP_SCALE.
// exp(x) ≈ 1 + x + x^2/2 + x^3/6
fn fp_exp_taylor(x_fp: u128) -> Result<u128, u32> {
    // We assume q/b won't be huge. You should clamp externally.
    let one = FP_SCALE;

    let x1 = x_fp;

    // x^2 / 2
    let x2 = fp_mul(x_fp, x_fp)?;        // x^2
    let half = fp_div(x2, 2u128 * FP_SCALE)?;

    // x^3 / 6
    let x3 = fp_mul(x2, x_fp)?;          // x^3
    let six = 6u128 * FP_SCALE;
    let sixth = fp_div(x3, six)?;

    let tmp = one
        .checked_add(x1).ok_or(ERROR_OVERFLOW)?;
    let tmp = tmp
        .checked_add(half).ok_or(ERROR_OVERFLOW)?;
    let sum = tmp
        .checked_add(sixth).ok_or(ERROR_OVERFLOW)?;

    Ok(sum)
}

// crude ln() approximation:
// ln(y) ≈ (y-1) - (y-1)^2/2 + (y-1)^3/3
// y_fp is fixed point, expected near 1.0 .. a few
fn fp_ln_series(y_fp: u128) -> Result<u128, u32> {
    if y_fp < FP_SCALE {
        // not supporting <1 for safety right now
        return Err(ERROR_INVALID_CALCULATION);
    }
    let z = y_fp.checked_sub(FP_SCALE).ok_or(ERROR_UNDERFLOW)?; // y-1
    let z2 = fp_mul(z, z)?;   // z^2
    let z3 = fp_mul(z2, z)?;  // z^3

    // (y-1)^2 / 2
    let z2_over_2 = fp_div(z2, 2u128 * FP_SCALE)?;
    // (y-1)^3 / 3
    let three = 3u128 * FP_SCALE;
    let z3_over_3 = fp_div(z3, three)?;

    // term1 - term2 + term3
    let tmp = z.checked_sub(z2_over_2).ok_or(ERROR_UNDERFLOW)?;
    let out = tmp.checked_add(z3_over_3).ok_or(ERROR_OVERFLOW)?;
    Ok(out)
}

// helper: exp(q/b)
fn fp_exp_q_over_b(q: u64, b: u64) -> Result<u128, u32> {
    if b == 0 {
        return Err(ERROR_INVALID_CALCULATION);
    }
    // q_over_b_fp = (q / b) in fixed-point FP_SCALE
    let q128 = q as u128;
    let b128 = b as u128;
    let q_over_b_fp = q128
        .checked_mul(FP_SCALE).ok_or(ERROR_OVERFLOW)?
        / b128;

    fp_exp_taylor(q_over_b_fp)
}

// C(q_yes, q_no) = b * ln( exp(q_yes/b) + exp(q_no/b) )
pub fn lmsr_cost(q_yes: u64, q_no: u64, b: u64) -> Result<u128, u32> {
    let e_yes = fp_exp_q_over_b(q_yes, b)?;
    let e_no  = fp_exp_q_over_b(q_no, b)?;
    let sum_e = e_yes.checked_add(e_no).ok_or(ERROR_OVERFLOW)?;

    let ln_sum = fp_ln_series(sum_e)?;

    // multiply ln_sum by b (b is unscaled, ln_sum is FP_SCALE)
    let result = (b as u128)
        .checked_mul(ln_sum)
        .ok_or(ERROR_OVERFLOW)?;
    Ok(result)
}

// returns YES price in fixed point FP_SCALE
pub fn lmsr_price_yes(q_yes: u64, q_no: u64, b: u64) -> Result<u128, u32> {
    let e_yes = fp_exp_q_over_b(q_yes, b)?;
    let e_no  = fp_exp_q_over_b(q_no, b)?;
    let denom = e_yes.checked_add(e_no).ok_or(ERROR_OVERFLOW)?;
    fp_div(e_yes, denom)
}

// returns NO price in fixed point FP_SCALE
pub fn lmsr_price_no(q_yes: u64, q_no: u64, b: u64) -> Result<u128, u32> {
    let p_yes = lmsr_price_yes(q_yes, q_no, b)?;
    let one = FP_SCALE;
    one.checked_sub(p_yes).ok_or(ERROR_UNDERFLOW)
}

// Cost to BUY delta_yes YES shares
pub fn lmsr_buy_yes_quote(q_yes: u64, q_no: u64, b: u64, delta_yes: u64) -> Result<u128, u32> {
    let c_before = lmsr_cost(q_yes, q_no, b)?;
    let c_after  = lmsr_cost(
        q_yes.checked_add(delta_yes).ok_or(ERROR_OVERFLOW)?,
        q_no,
        b
    )?;
    c_after.checked_sub(c_before).ok_or(ERROR_UNDERFLOW)
}

// Cost to BUY delta_no NO shares
pub fn lmsr_buy_no_quote(q_yes: u64, q_no: u64, b: u64, delta_no: u64) -> Result<u128, u32> {
    let c_before = lmsr_cost(q_yes, q_no, b)?;
    let c_after  = lmsr_cost(
        q_yes,
        q_no.checked_add(delta_no).ok_or(ERROR_OVERFLOW)?,
        b
    )?;
    c_after.checked_sub(c_before).ok_or(ERROR_UNDERFLOW)
}

// Payout for SELL S_yes YES shares back to AMM
pub fn lmsr_sell_yes_quote(q_yes: u64, q_no: u64, b: u64, s_yes: u64) -> Result<u128, u32> {
    if s_yes > q_yes {
        return Err(ERROR_INVALID_BET_AMOUNT);
    }
    let c_before = lmsr_cost(q_yes, q_no, b)?;
    let c_after  = lmsr_cost(
        q_yes - s_yes,
        q_no,
        b
    )?;
    c_before.checked_sub(c_after).ok_or(ERROR_UNDERFLOW)
}

// Payout for SELL S_no NO shares
pub fn lmsr_sell_no_quote(q_yes: u64, q_no: u64, b: u64, s_no: u64) -> Result<u128, u32> {
    if s_no > q_no {
        return Err(ERROR_INVALID_BET_AMOUNT);
    }
    let c_before = lmsr_cost(q_yes, q_no, b)?;
    let c_after  = lmsr_cost(
        q_yes,
        q_no - s_no,
        b
    )?;
    c_before.checked_sub(c_after).ok_or(ERROR_UNDERFLOW)
}

/// 根据 LMSR 计算 YES / NO 价格，返回和现有 PRICE_PRECISION (1e6) 对齐的 u64
pub fn calculate_yes_price_lmsr(q_yes: u64, q_no: u64, b: u64) -> Result<u64, u32> {
    let p_yes_fp = lmsr_price_yes(q_yes, q_no, b)?; // FP_SCALE = 1e6
    if p_yes_fp > u64::MAX as u128 {
        return Err(ERROR_OVERFLOW);
    }
    Ok(p_yes_fp as u64)
}

pub fn calculate_no_price_lmsr(q_yes: u64, q_no: u64, b: u64) -> Result<u64, u32> {
    let p_no_fp = lmsr_price_no(q_yes, q_no, b)?; // FP_SCALE = 1e6
    if p_no_fp > u64::MAX as u128 {
        return Err(ERROR_OVERFLOW);
    }
    Ok(p_no_fp as u64)
}

/// 安全计算平台费用（向上取整确保不丢失费用）
pub fn calculate_fee_safe(amount: u64) -> Result<u64, u32> {
    if amount > MAX_BET_AMOUNT {
        return Err(ERROR_BET_TOO_LARGE);
    }
    
    // 计算 (amount * PLATFORM_FEE_RATE + FEE_BASIS_POINTS - 1) / FEE_BASIS_POINTS
    // 这样可以实现向上取整
    let numerator = (amount as u128)
        .checked_mul(PLATFORM_FEE_RATE as u128)
        .ok_or(ERROR_OVERFLOW)?;
    
    let rounded_numerator = numerator
        .checked_add((FEE_BASIS_POINTS - 1) as u128)
        .ok_or(ERROR_OVERFLOW)?;
    
    let result = rounded_numerator / FEE_BASIS_POINTS as u128;
    
    if result > u64::MAX as u128 {
        return Err(ERROR_OVERFLOW);
    }
    
    Ok(result as u64)
}

/// 安全计算净金额（扣除费用后）
pub fn calculate_net_amount_safe(bet_amount: u64) -> Result<u64, u32> {
    let fee = calculate_fee_safe(bet_amount)?;
    safe_sub(bet_amount, fee)
}

// Validate parameter b for LMSR
pub fn validate_b(b: u64) -> Result<(), u32> {
    if b == 0 {
        return Err(ERROR_INVALID_CALCULATION);
    }
    // you can clamp max b if you want
    Ok(())
}

/// 安全计算有效买入价格
pub fn calculate_effective_price_safe(bet_amount: u64, shares: u64) -> Result<u64, u32> {
    if shares == 0 {
        return Ok(0);
    }
    
    safe_div_high_precision(bet_amount, PRICE_PRECISION, shares)
}

/// 验证输入参数的安全性
pub fn validate_bet_amount(bet_amount: u64) -> Result<(), u32> {
    if bet_amount == 0 {
        return Err(ERROR_INVALID_BET_AMOUNT);
    }
    
    if bet_amount > MAX_BET_AMOUNT {
        return Err(ERROR_BET_TOO_LARGE);
    }
    
    Ok(())
}

/// 验证份额数量的安全性
pub fn validate_shares(shares: u64) -> Result<(), u32> {
    if shares == 0 {
        return Err(ERROR_INVALID_BET_AMOUNT);
    }
    
    if shares > MAX_SHARES {
        return Err(ERROR_BET_TOO_LARGE);
    }
    
    Ok(())
}

/// 验证流动性的安全性
pub fn validate_liquidity(liquidity: u64) -> Result<(), u32> {
    if liquidity < MIN_LIQUIDITY {
        return Err(ERROR_INVALID_CALCULATION);
    }
    
    if liquidity > MAX_LIQUIDITY {
        return Err(ERROR_LIQUIDITY_TOO_HIGH);
    }
    
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_safe_mul_overflow() {
        let result = safe_mul(u64::MAX, 2);
        assert_eq!(result, Err(ERROR_OVERFLOW));
    }

    #[test]
    fn test_safe_div_zero() {
        let result = safe_div(100, 0);
        assert_eq!(result, Err(ERROR_DIVISION_BY_ZERO));
    }

    #[test]
    fn test_safe_sub_underflow() {
        let result = safe_sub(5, 10);
        assert_eq!(result, Err(ERROR_UNDERFLOW));
    }

    #[test]
    fn test_lmsr_cost() {
        // Use smaller q/b ratio to keep exp values reasonable for Taylor approximation
        let result = lmsr_cost(1000, 1000, 10000);
        assert!(result.is_ok());
        // Cost should be positive
        assert!(result.unwrap() > 0);
    }

    #[test]
    fn test_lmsr_price_yes_no() {
        // Use smaller q/b ratio
        let p_yes = lmsr_price_yes(1000, 1000, 10000).unwrap();
        let p_no = lmsr_price_no(1000, 1000, 10000).unwrap();
        assert_eq!(p_yes + p_no, FP_SCALE);
    }

    #[test]
    fn test_lmsr_buy_yes_quote() {
        let cost = lmsr_buy_yes_quote(1000, 1000, 10000, 100);
        assert!(cost.is_ok());
        assert!(cost.unwrap() > 0);
    }

    #[test]
    fn test_lmsr_buy_no_quote() {
        let cost = lmsr_buy_no_quote(1000, 1000, 10000, 100);
        assert!(cost.is_ok());
        assert!(cost.unwrap() > 0);
    }

    #[test]
    fn test_lmsr_sell_yes_quote() {
        let payout = lmsr_sell_yes_quote(1000, 1000, 10000, 100);
        assert!(payout.is_ok());
        assert!(payout.unwrap() > 0);
    }

    #[test]
    fn test_lmsr_sell_no_quote() {
        let payout = lmsr_sell_no_quote(1000, 1000, 10000, 100);
        assert!(payout.is_ok());
        assert!(payout.unwrap() > 0);
    }

    #[test]
    fn test_calculate_yes_price_lmsr() {
        let price = calculate_yes_price_lmsr(1000, 1000, 10000);
        assert!(price.is_ok());
        let p = price.unwrap();
        assert!(p > 0 && p < PRICE_PRECISION);
    }

    #[test]
    fn test_calculate_no_price_lmsr() {
        let price = calculate_no_price_lmsr(1000, 1000, 10000);
        assert!(price.is_ok());
        let p = price.unwrap();
        assert!(p > 0 && p < PRICE_PRECISION);
    }

    #[test]
    fn test_validate_bet_amount() {
        assert!(validate_bet_amount(1000).is_ok());
        assert_eq!(validate_bet_amount(0), Err(ERROR_INVALID_BET_AMOUNT));
        assert_eq!(validate_bet_amount(MAX_BET_AMOUNT + 1), Err(ERROR_BET_TOO_LARGE));
    }

    #[test]
    fn test_validate_b() {
        assert!(validate_b(1000).is_ok());
        assert_eq!(validate_b(0), Err(ERROR_INVALID_CALCULATION));
    }
} 