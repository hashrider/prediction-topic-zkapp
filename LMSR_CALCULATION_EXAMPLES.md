# LMSR Prediction Market Calculation Examples

This document explains how the Logarithmic Market Scoring Rule (LMSR) calculates prices, shares, and rewards in the prediction market.

## Core LMSR Principles

### 1. Two-Layer System
The market uses a two-layer system:
- **LMSR Shares**: Total YES/NO shares outstanding (q_yes, q_no) used for pricing
- **Prize Pool**: Real tokens from user bets that form the reward pool

### 2. LMSR Cost Function (Pricing Layer)
The pricing uses the Logarithmic Market Scoring Rule cost function: **C(q_yes, q_no, b) = b × ln(exp(q_yes/b) + exp(q_no/b))**

Where:
- `q_yes` = Total YES shares outstanding  
- `q_no` = Total NO shares outstanding
- `b` = Liquidity parameter (market depth)
- `C` = Cost function (total cost to create current market state)

### 3. Price Calculation
- **YES price** = exp(q_yes/b) ÷ (exp(q_yes/b) + exp(q_no/b))
- **NO price** = exp(q_no/b) ÷ (exp(q_yes/b) + exp(q_no/b))
- Prices are expressed in basis points (1,000,000 = 100%)

### 4. Prize Pool Mechanism
- All user bet amounts (minus fees) go into a shared **Prize Pool**
- Winners share the entire Prize Pool proportionally based on their shares
- LMSR shares are used for pricing, not for holding actual funds

## Example Scenarios

### Initial State
```
Market: "Will Bitcoin reach $100K by 2024?"

LMSR State (for pricing):
- q_yes (YES shares): 100,000
- q_no (NO shares): 100,000
- b (liquidity parameter): 1,000,000

Real Money Tracking:
- Prize Pool: 0 (starts empty)
- Total YES shares issued: 100,000
- Total NO shares issued: 100,000

Platform fee: 1% (100/10000)
```

**Initial Prices (LMSR):**
- YES price = exp(100000/1000000) ÷ (exp(100000/1000000) + exp(100000/1000000)) = 0.5 = 50%
- NO price = exp(100000/1000000) ÷ (exp(100000/1000000) + exp(100000/1000000)) = 0.5 = 50%

### Example 1: User Buys YES Shares

**Alice bets 100,000 on YES**

**Step 1: Calculate fees**
```
Platform fee = 100,000 × 100 ÷ 10,000 = 1,000
Net amount = 100,000 - 1,000 = 99,000
```

**Step 2: Calculate shares using LMSR cost function**
```
Cost before: C(100000, 100000, 1000000) = 1,000,000 × ln(exp(0.1) + exp(0.1))
                                           = 1,000,000 × ln(2 × exp(0.1))
                                           ≈ 1,200,000

We need to find Δ_yes such that:
C(100000 + Δ_yes, 100000, 1000000) - C(100000, 100000, 1000000) ≈ 99,000

Using binary search or iterative calculation:
Δ_yes ≈ 82,500 shares
```

**Step 3: Updated market state**
```
LMSR State (pricing):
- q_yes: 182,500 (+82,500)
- q_no: 100,000 (unchanged)
- b: 1,000,000

Real Money:
- Prize Pool: 99,000 (Alice's net contribution)
- Total YES shares issued: 182,500
- Total NO shares issued: 100,000
- Total volume: 100,000
- Fees collected: 1,000

New prices (LMSR):
YES price = exp(182500/1000000) ÷ (exp(182500/1000000) + exp(100000/1000000)) ≈ 58.2%
NO price = exp(100000/1000000) ÷ (exp(182500/1000000) + exp(100000/1000000)) ≈ 41.8%
```

### Example 2: Another User Bets on NO

**Bob bets 50,000 on NO (after Alice's bet)**

**Current state before Bob's bet:**
```
q_yes: 182,500
q_no: 100,000
b: 1,000,000
```

**Step 1: Calculate fees**
```
Platform fee = 50,000 × 100 ÷ 10,000 = 500
Net amount = 50,000 - 500 = 49,500
```

**Step 2: Calculate shares using LMSR**
```
Cost before: C(182500, 100000, 1000000) ≈ 1,299,000

We need to find Δ_no such that:
C(182500, 100000 + Δ_no, 1000000) - C(182500, 100000, 1000000) ≈ 49,500

Using binary search:
Δ_no ≈ 40,000 shares
```

**Step 3: Final market state**
```
LMSR State (pricing):
- q_yes: 182,500 (unchanged)
- q_no: 140,000 (+40,000)

Real Money:
- Prize Pool: 148,500 (99,000 + 49,500)
- Total YES shares issued: 182,500
- Total NO shares issued: 140,000
- Total volume: 150,000
- Fees collected: 1,500

Final prices (LMSR):
YES price = exp(182500/1000000) ÷ (exp(182500/1000000) + exp(140000/1000000)) ≈ 56.1%
NO price = exp(140000/1000000) ÷ (exp(182500/1000000) + exp(140000/1000000)) ≈ 43.9%
```

### Example 3: User Sells Shares

**Charlie sells 20,000 YES shares (after Alice and Bob's bets)**

**Current state before Charlie's sell:**
```
LMSR State: q_yes = 182,500, q_no = 140,000
Prize Pool: 148,500
Total YES shares: 182,500
Total NO shares: 140,000
```

**Step 1: Calculate sell value using LMSR**
```
Cost before: C(182500, 140000, 1000000) ≈ 1,348,500
Cost after: C(162500, 140000, 1000000) ≈ 1,323,000

Gross payout = 1,348,500 - 1,323,000 = 25,500
Platform fee = 25,500 × 100 ÷ 10,000 = 255
Net payout to Charlie = 25,500 - 255 = 25,245
```

**Step 2: Updated market state after sell**
```
LMSR State:
- q_yes: 162,500 (-20,000)
- q_no: 140,000 (unchanged)

Real Money:
- Prize Pool: 123,255 (148,500 - 25,245)
- Total YES shares: 162,500 (182,500 - 20,000)
- Total NO shares: 140,000 (unchanged)
- Total fees collected: 1,755 (1,500 + 255)

New prices (LMSR):
YES price = exp(162500/1000000) ÷ (exp(162500/1000000) + exp(140000/1000000)) ≈ 55.6%
NO price = exp(140000/1000000) ÷ (exp(162500/1000000) + exp(140000/1000000)) ≈ 44.4%
```

## Reward Calculation

### Scenario A: YES Wins (Bitcoin reaches $100K)

**Market resolves with outcome = YES (after Charlie's sell)**

**Alice's reward:**
```
Alice has 82,500 YES shares out of 162,500 total YES shares remaining
Total prize pool: 123,255 (after Charlie's sell)
Alice's payout = (82,500 ÷ 162,500) × 123,255 = 62,623
Alice's profit = 62,623 - 100,000 = -37,377 (loss due to selling activity)
Return rate = 62,623 ÷ 100,000 = 62.6%
```

**Bob's reward:**
```
Bob has 40,000 NO shares
NO shares are worthless when YES wins
Bob's payout = 0
Bob's loss = 50,000 (total loss)
```

**Charlie's result:**
```
Charlie sold 20,000 YES shares for 25,245 tokens
If he had held until YES wins: (20,000 ÷ 162,500) × 123,255 = 15,181
Charlie's opportunity cost = 15,181 - 25,245 = -10,064 (actually gained by selling early)
```

### Scenario B: NO Wins (Bitcoin doesn't reach $100K)

**Market resolves with outcome = NO (after Charlie's sell)**

**Alice's reward:**
```
Alice has 82,500 YES shares
YES shares are worthless when NO wins
Alice's payout = 0
Alice's loss = 100,000 (total loss)
```

**Bob's reward:**
```
Bob has 40,000 NO shares out of 140,000 total NO shares
Total prize pool: 123,255 (after Charlie's sell)
Bob's payout = (40,000 ÷ 140,000) × 123,255 = 35,216
Bob's profit = 35,216 - 50,000 = -14,784 (loss)
Return rate = 35,216 ÷ 50,000 = 70.4%
```

**Charlie's result:**
```
Charlie sold 20,000 YES shares for 25,245 tokens
If NO wins, his YES shares would be worthless
Charlie's smart move: avoided total loss
Charlie's gain from selling = 25,245 (vs 0 if held to resolution)
```

## Key Insights

### 1. Price Impact
Larger bets cause bigger price movements:
- Alice's 100,000 bet moved YES price from 50% to 58.2%
- Bob's 50,000 bet moved NO price from 41.8% to 43.9%
- Charlie's 20,000 share sell moved YES price from 56.1% to 55.6%

### 2. Effective Price Paid/Received
```
Alice's effective price = 100,000 ÷ 82,500 = 1.212 per YES share
Bob's effective price = 50,000 ÷ 40,000 = 1.25 per NO share
Charlie's effective sell price = 25,245 ÷ 20,000 = 1.262 per YES share
```

### 3. Sell vs Hold Strategy
```
Charlie's sell analysis:
- Sold 20,000 YES shares for 25,245 tokens (1.262 per share)
- If YES wins: would have received 15,181 (opportunity cost: -10,064, actually gained)
- If NO wins: saved from total loss (gain: 25,245 vs 0)
- Break-even: Charlie profits in both scenarios by selling early
```

### 4. Risk/Reward Analysis (After Charlie's sell)
```
For Alice (YES bettor):
- Risk: 100,000 (100% of bet)
- Max reward: 62,623 (if YES wins, reduced due to selling activity)
- Actual reward depends on remaining YES shares

For Bob (NO bettor):
- Risk: 50,000 (100% of bet)  
- Max reward: 35,216 (if NO wins, reduced due to selling activity)
- Gets proportional share of remaining prize pool if NO wins

For Charlie (seller):
- Guaranteed: 25,245 (locked in value)
- No further exposure to market outcome
```

### 5. Prize Pool Distribution (After Sells)
```
Remaining Prize Pool: 123,255 (reduced by sell payouts)
- If YES wins: All 123,255 distributed among remaining 162,500 YES shares
- If NO wins: All 123,255 distributed among 140,000 NO shares
- Selling reduces total prize pool but provides immediate liquidity
```

### 6. Liquidity and Slippage
```
Selling shares provides exit liquidity but affects pricing:
- Large sells move prices against the seller
- Charlie's 20,000 share sell reduced YES price by 0.5%
- LMSR ensures continuous liquidity for both buying and selling
```

## LMSR Advantages

1. **Continuous Liquidity**: Always possible to buy/sell shares
2. **Price Discovery**: Prices reflect supply/demand automatically via cost function
3. **No Counterparty Risk**: No need to match with other users
4. **Proportional Slippage**: Larger bets pay higher effective prices
5. **Information Aggregation**: Prices converge to true probability estimates
6. **Bounded Loss**: Market maker's worst-case loss is bounded by b × ln(2)

## Platform Economics

```
Total bets: 150,000
Platform fees collected: 1,500 (1%)
Prize pool (user funds): 148,500 (99% of bets)
LMSR shares (protocol): Used for pricing only, not real money

Total shares issued: 182,500 + 140,000 = 322,500
Prize pool per share: 148,500 ÷ 322,500 ≈ 0.46 average value
```

## Key Advantages of Prize Pool Model with LMSR

1. **Fair Distribution**: All user funds go to winners, minus small platform fee
2. **No Protocol Risk**: Protocol doesn't need to hold reserves for payouts  
3. **Clear Accounting**: Prize pool = sum of all net bets
4. **Proportional Rewards**: Larger shareholders get proportionally larger rewards
5. **LMSR Pricing**: Efficient price discovery with bounded market maker loss
6. **Information Efficiency**: Prices automatically reflect market consensus

This model ensures that user tokens actually enter the system as a prize pool, making the reward mechanism transparent and fair, while LMSR provides efficient price discovery.

