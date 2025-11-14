#[cfg(test)]
mod security_tests {
    use crate::math_safe::*;
    use crate::error::*;

    #[test]
    fn test_overflow_protection() {
        // 测试乘法溢出保护
        let result = safe_mul(u64::MAX, 2);
        assert_eq!(result, Err(ERROR_OVERFLOW));
        
        let result = safe_mul(u64::MAX / 2, 3);
        assert_eq!(result, Err(ERROR_OVERFLOW));
        
        // 测试安全的乘法
        let result = safe_mul(1000, 2000);
        assert_eq!(result, Ok(2_000_000));
    }

    #[test]
    fn test_division_by_zero_protection() {
        // 测试除零保护
        let result = safe_div(1000, 0);
        assert_eq!(result, Err(ERROR_DIVISION_BY_ZERO));
        
        // 测试安全的除法
        let result = safe_div(1000, 10);
        assert_eq!(result, Ok(100));
    }

    #[test]
    fn test_underflow_protection() {
        // 测试下溢保护
        let result = safe_sub(5, 10);
        assert_eq!(result, Err(ERROR_UNDERFLOW));
        
        let result = safe_sub(0, 1);
        assert_eq!(result, Err(ERROR_UNDERFLOW));
        
        // 测试安全的减法
        let result = safe_sub(100, 50);
        assert_eq!(result, Ok(50));
    }

    #[test]
    fn test_k_calculation_safety() {
        // 测试正常情况
        let result = calculate_k_safe(1_000_000, 1_000_000);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), 1_000_000_000_000u128);
        
        // 测试流动性过高
        let result = calculate_k_safe(MAX_LIQUIDITY + 1, 1_000_000);
        assert_eq!(result, Err(ERROR_LIQUIDITY_TOO_HIGH));
        
        // 测试流动性过低
        let result = calculate_k_safe(MIN_LIQUIDITY - 1, 1_000_000);
        assert_eq!(result, Err(ERROR_INVALID_CALCULATION));
        
        // 测试边界值
        let result = calculate_k_safe(MAX_LIQUIDITY, MAX_LIQUIDITY);
        assert!(result.is_ok());
    }

    #[test]
    fn test_new_liquidity_calculation_safety() {
        let k = 1_000_000_000_000u128; // 1M * 1M
        
        // 测试除零
        let result = calculate_new_liquidity_safe(k, 0);
        assert_eq!(result, Err(ERROR_DIVISION_BY_ZERO));
        
        // 测试正常情况
        let result = calculate_new_liquidity_safe(k, 1_000_000);
        assert_eq!(result, Ok(1_000_000));
        
        // 测试结果过大
        let huge_k = (MAX_LIQUIDITY as u128) * (MAX_LIQUIDITY as u128);
        let result = calculate_new_liquidity_safe(huge_k, 1);
        assert_eq!(result, Err(ERROR_OVERFLOW));
    }

    #[test]
    fn test_bet_amount_validation() {
        // 测试零投注
        assert_eq!(validate_bet_amount(0), Err(ERROR_INVALID_BET_AMOUNT));
        
        // 测试过大投注
        assert_eq!(validate_bet_amount(MAX_BET_AMOUNT + 1), Err(ERROR_BET_TOO_LARGE));
        
        // 测试正常投注
        assert!(validate_bet_amount(1000).is_ok());
        assert!(validate_bet_amount(MAX_BET_AMOUNT).is_ok());
    }

    #[test]
    fn test_shares_validation() {
        // 测试零份额
        assert_eq!(validate_shares(0), Err(ERROR_INVALID_BET_AMOUNT));
        
        // 测试过大份额
        assert_eq!(validate_shares(MAX_SHARES + 1), Err(ERROR_BET_TOO_LARGE));
        
        // 测试正常份额
        assert!(validate_shares(1000).is_ok());
        assert!(validate_shares(MAX_SHARES).is_ok());
    }

    #[test]
    fn test_liquidity_validation() {
        // 测试过小流动性
        assert_eq!(validate_liquidity(MIN_LIQUIDITY - 1), Err(ERROR_INVALID_CALCULATION));
        
        // 测试过大流动性
        assert_eq!(validate_liquidity(MAX_LIQUIDITY + 1), Err(ERROR_LIQUIDITY_TOO_HIGH));
        
        // 测试正常流动性
        assert!(validate_liquidity(MIN_LIQUIDITY).is_ok());
        assert!(validate_liquidity(MAX_LIQUIDITY).is_ok());
        assert!(validate_liquidity(1_000_000).is_ok());
    }

    #[test]
    fn test_fee_calculation_safety() {
        // 测试正常费用计算
        let result = calculate_fee_safe(10000);
        assert!(result.is_ok());
        
        // 验证费用计算正确性 (1% = 100/10000，向上取整)
        let fee = result.unwrap();
        assert_eq!(fee, 100); // 10000 * 100 / 10000 = 100（恰好整除）
        
        // 测试向上取整的费用计算
        // 1960 * 100 / 10000 = 19.6，应该向上取整为 20
        let result = calculate_fee_safe(1960);
        assert!(result.is_ok());
        let fee = result.unwrap();
        assert_eq!(fee, 20); // 向上取整
        
        // 测试另一个向上取整的例子
        // 99 * 100 / 10000 = 0.99，应该向上取整为 1
        let result = calculate_fee_safe(99);
        assert!(result.is_ok());
        let fee = result.unwrap();
        assert_eq!(fee, 1); // 向上取整，确保最小费用
        
        // 测试100以内的小额费用
        // 50 * 100 / 10000 = 0.5，应该向上取整为 1
        let result = calculate_fee_safe(50);
        assert!(result.is_ok());
        let fee = result.unwrap();
        assert_eq!(fee, 1); // 向上取整
        
        // 10 * 100 / 10000 = 0.1，应该向上取整为 1
        let result = calculate_fee_safe(10);
        assert!(result.is_ok());
        let fee = result.unwrap();
        assert_eq!(fee, 1); // 向上取整
        
        // 1 * 100 / 10000 = 0.01，应该向上取整为 1
        let result = calculate_fee_safe(1);
        assert!(result.is_ok());
        let fee = result.unwrap();
        assert_eq!(fee, 1); // 向上取整，确保最小费用为1
        
        // 测试过大金额
        let result = calculate_fee_safe(MAX_BET_AMOUNT + 1);
        assert_eq!(result, Err(ERROR_BET_TOO_LARGE));
    }

    #[test]
    fn test_net_amount_calculation_safety() {
        // 测试正常净金额计算
        let result = calculate_net_amount_safe(10000);
        assert!(result.is_ok());
        
        let net = result.unwrap();
        assert_eq!(net, 9900); // 10000 - 100 = 9900
        
        // 测试向上取整对净金额的影响
        let result = calculate_net_amount_safe(1960);
        assert!(result.is_ok());
        let net = result.unwrap();
        assert_eq!(net, 1940); // 1960 - 20 = 1940
        
        // 测试过大金额
        let result = calculate_net_amount_safe(MAX_BET_AMOUNT + 1);
        assert_eq!(result, Err(ERROR_BET_TOO_LARGE));
    }

    #[test]
    fn test_high_precision_calculations() {
        // 测试高精度乘法
        let result = safe_mul_high_precision(1000, 1000000);
        assert_eq!(result, Ok(1_000_000_000));
        
        // 测试高精度除法
        let result = safe_div_high_precision(1000, 1000000, 1000);
        assert_eq!(result, Ok(1_000_000));
        
        // 测试溢出保护
        let result = safe_mul_high_precision(u64::MAX, u64::MAX);
        assert_eq!(result, Err(ERROR_OVERFLOW));
        
        // 测试除零保护
        let result = safe_div_high_precision(1000, 1000000, 0);
        assert_eq!(result, Err(ERROR_DIVISION_BY_ZERO));
    }

    #[test]
    fn test_price_calculation_safety() {
        // 测试正常价格计算
        let result = calculate_price_safe(600000, 1000000);
        assert!(result.is_ok());
        
        // 测试除零情况（应返回默认50%价格）
        let result = calculate_price_safe(600000, 0);
        assert_eq!(result, Ok(500000)); // PRICE_PRECISION / 2
    }

    #[test]
    fn test_effective_price_calculation_safety() {
        // 测试正常有效价格计算
        let result = calculate_effective_price_safe(1000, 500);
        assert!(result.is_ok());
        
        // 测试零份额情况
        let result = calculate_effective_price_safe(1000, 0);
        assert_eq!(result, Ok(0));
    }

    #[test]
    fn test_edge_cases() {
        // 测试最大值边界
        let result = safe_add(u64::MAX - 1, 1);
        assert_eq!(result, Ok(u64::MAX));
        
        let result = safe_add(u64::MAX, 1);
        assert_eq!(result, Err(ERROR_OVERFLOW));
        
        // 测试最小值边界
        let result = safe_sub(1, 1);
        assert_eq!(result, Ok(0));
        
        let result = safe_sub(0, 1);
        assert_eq!(result, Err(ERROR_UNDERFLOW));
    }

    #[test]
    fn test_realistic_amm_scenarios() {
        // 模拟真实AMM场景
        let initial_yes = 1_000_000u64;
        let initial_no = 1_000_000u64;
        
        // 计算K值
        let k = calculate_k_safe(initial_yes, initial_no).unwrap();
        assert_eq!(k, 1_000_000_000_000u128);
        
        // 模拟大额投注
        let bet_amount = 100_000u64;
        let net_amount = calculate_net_amount_safe(bet_amount).unwrap();
        
        // 计算新的流动性
        let new_no_liquidity = safe_add(initial_no, net_amount).unwrap();
        let new_yes_liquidity = calculate_new_liquidity_safe(k, new_no_liquidity).unwrap();
        
        // 验证常量乘积保持（使用新的流动性计算新的k）
        let new_k = calculate_k_safe(new_yes_liquidity, new_no_liquidity).unwrap();
        
        // 由于费用的存在，新的k会略小于原始k，这是正常的
        assert!(new_k <= k);
        assert!(new_k > 0);
        
        // 验证份额计算
        let shares = safe_sub(initial_yes, new_yes_liquidity).unwrap();
        assert!(shares > 0);
        
        // 验证流动性变化是合理的
        assert!(new_yes_liquidity < initial_yes); // YES流动性减少
        assert!(new_no_liquidity > initial_no);   // NO流动性增加
    }
}

#[cfg(test)]
mod market_safe_tests {
    use crate::market::MarketData;
    use crate::error::*;
    use crate::math_safe::{MAX_BET_AMOUNT, MAX_SHARES};

    fn create_test_market() -> MarketData {
        let title = MarketData::string_to_u64_vec("Test Market");
        MarketData::new_with_title_u64_and_liquidity(
            title,
            0,
            1000,
            1000,
            1_000_000, // initial_yes_liquidity
            1_000_000, // initial_no_liquidity
            1_000_000  // b
        ).unwrap()
    }

    #[test]
    fn test_safe_market_creation() {
        let title = MarketData::string_to_u64_vec("Test Market");
        let market = MarketData::new_with_title_u64_and_liquidity(
            title,
            0,
            1000,
            1000,
            1_000_000, // initial_yes_liquidity
            1_000_000, // initial_no_liquidity
            1_000_000  // b
        );
        assert!(market.is_ok());
    }

    #[test]
    fn test_safe_bet_amount_limits() {
        let mut market = create_test_market();
        
        // 测试过大投注
        let result = market.place_bet(1, MAX_BET_AMOUNT + 1);
        assert_eq!(result, Err(ERROR_BET_TOO_LARGE));
        
        // 测试零投注
        let result = market.place_bet(1, 0);
        assert_eq!(result, Err(ERROR_INVALID_BET_AMOUNT));
        
        // 测试正常投注
        let result = market.place_bet(1, 1000);
        assert!(result.is_ok());
    }

    #[test]
    fn test_safe_price_calculations() {
        let market = create_test_market();
        
        // 测试价格计算
        let yes_price = market.get_yes_price();
        assert!(yes_price.is_ok());
        
        let no_price = market.get_no_price();
        assert!(no_price.is_ok());
        
        // 验证价格和应该接近100%
        let total_price = yes_price.unwrap() + no_price.unwrap();
        assert!((total_price as i64 - 1_000_000i64).abs() < 1000); // 允许小误差
    }

    #[test]
    fn test_safe_shares_calculation() {
        let market = create_test_market();
        
        // 测试正常份额计算
        let shares = market.calculate_shares(1, 10000);
        assert!(shares.is_ok());
        assert!(shares.unwrap() > 0);
        
        // 测试过大投注
        let shares = market.calculate_shares(1, MAX_BET_AMOUNT + 1);
        assert_eq!(shares, Err(ERROR_BET_TOO_LARGE));
    }

    #[test]
    fn test_safe_sell_operations() {
        let mut market = create_test_market();
        
        // 先投注获得份额
        let shares = market.place_bet(1, 10000).unwrap();
        
        // 测试正常卖出
        let payout = market.sell_shares(1, shares / 2);
        assert!(payout.is_ok());
        
        // 测试卖出过多份额
        let payout = market.sell_shares(1, shares * 2);
        assert_eq!(payout, Err(ERROR_INSUFFICIENT_BALANCE));
        
        // 测试过大份额数
        let payout = market.sell_shares(1, MAX_SHARES + 1);
        assert_eq!(payout, Err(ERROR_BET_TOO_LARGE));
    }

    #[test]
    fn test_safe_payout_calculation() {
        let mut market = create_test_market();
        
        // 投注并解决市场
        let yes_shares = market.place_bet(1, 10000).unwrap();
        let no_shares = market.place_bet(0, 5000).unwrap();
        
        market.resolve(true).unwrap(); // YES 获胜
        
        // 测试奖金计算
        let payout = market.calculate_payout(yes_shares, 0);
        assert!(payout.is_ok());
        assert!(payout.unwrap() > 0);
        
        // NO持有者应该没有奖金
        let payout = market.calculate_payout(0, no_shares);
        assert_eq!(payout.unwrap(), 0);
    }

    #[test]
    fn test_title_encoding_and_decoding() {
        let original_title = "Test Market Title";
        let title_u64_vec = MarketData::string_to_u64_vec(original_title);
        let decoded_title = MarketData::u64_vec_to_string(&title_u64_vec);
        
        assert_eq!(original_title, decoded_title);
    }

    #[test]
    fn test_long_title_encoding() {
        let long_title = "Predict CASADADSA Will Launch on binance perp or not in three months";
        let title_u64_vec = MarketData::string_to_u64_vec(long_title);
        
        // Should need 9 u64s for 68 characters
        assert_eq!(title_u64_vec.len(), 9);
        
        let decoded_title = MarketData::u64_vec_to_string(&title_u64_vec);
        assert_eq!(long_title, decoded_title);
    }

    #[test]
    fn test_market_with_custom_liquidity() {
        let title = MarketData::string_to_u64_vec("Custom Liquidity Market");
        let market = MarketData::new_with_title_u64_and_liquidity(
            title,
            0,
            1000,
            1000,
            500_000,  // Low YES liquidity
            2_000_000, // High NO liquidity
            1_250_000  // b (average of initial shares)
        ).unwrap();
        
        // YES should be more expensive due to lower liquidity
        let yes_price = market.get_yes_price().unwrap();
        let no_price = market.get_no_price().unwrap();
        
        assert!(yes_price > no_price);
    }

    fn test_lmsr_price_bounds() {
        // simple config
        let q_yes: u64 = 10_000;
        let q_no:  u64 = 10_000;
        let b: u64 = 5_000;

        let p_yes = calculate_yes_price_lmsr(q_yes, q_no, b).unwrap();
        let p_no  = calculate_no_price_lmsr(q_yes, q_no, b).unwrap();

        assert!(p_yes <= PRICE_PRECISION);
        assert!(p_no  <= PRICE_PRECISION);

        // prices should roughly sum to ~1.0 in PRICE_PRECISION scale
        let sum = p_yes + p_no;
        assert!(sum > PRICE_PRECISION - 10); // allow small approx slack
        assert!(sum < PRICE_PRECISION + 10);
    }

    #[test]
    fn test_lmsr_buy_and_sell_quotes_nonzero() {
        let q_yes: u64 = 1000;
        let q_no:  u64 = 1000;
        let b: u64 = 500;

        // Buy 100 YES shares
        let buy_quote = lmsr_buy_yes_quote(q_yes, q_no, b, 100).unwrap();
        assert!(buy_quote > 0);

        // Sell 100 YES shares
        let sell_quote = lmsr_sell_yes_quote(q_yes + 100, q_no, b, 100).unwrap();
        assert!(sell_quote > 0);
    }
} 