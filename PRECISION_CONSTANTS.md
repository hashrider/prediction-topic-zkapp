# Precision Constants Explanation

This document explains the precision constants used in the prediction market system and why they are necessary.

## What are Basis Points?

**Basis Points (基点)** are a standard unit of measurement in finance:
- 1 basis point = 0.01% = 0.0001
- 100 basis points = 1%
- 10,000 basis points = 100%

## Precision Constants in Our System

### 1. BASIS_POINTS_PRECISION = 10,000
```rust
pub const BASIS_POINTS_PRECISION: u64 = 10000;     // 10,000 basis points = 100%
```

**Purpose**: Standard financial precision for percentages
- Used for platform fees: `PLATFORM_FEE_RATE = 25` means 25/10,000 = 0.25%
- Used for percentage calculations where 10,000 = 100%

**Example**:
```rust
// 0.25% platform fee
let fee = (amount * 25) / 10000;
// For 1000 tokens: fee = (1000 * 25) / 10000 = 2.5 tokens
```

### 2. PRICE_PRECISION = 1,000,000
```rust
pub const PRICE_PRECISION: u64 = 1000000;          // 1,000,000 = 1.0
```

**Purpose**: High precision for price calculations
- Used for LMSR price calculations where precision is critical
- Allows for 6 decimal places of precision
- 1,000,000 represents 1.0 (100%)

**Example**:
```rust
// Market price calculation
let yes_price = (no_liquidity * PRICE_PRECISION) / total_liquidity;
// If no_liquidity = 600,000 and total_liquidity = 1,000,000:
// yes_price = (600000 * 1000000) / 1000000 = 600,000
// This represents 60% (600,000 / 1,000,000 = 0.6)
```

### 3. PERCENTAGE_PRECISION = 100
```rust
pub const PERCENTAGE_PRECISION: u64 = 100;         // 100 = 100%
```

**Purpose**: Simple percentage calculations
- Used when you need basic percentage representation
- 100 represents 100%

### 4. FEE_BASIS_POINTS = 10,000
```rust
pub const FEE_BASIS_POINTS: u64 = 10000; // Same as BASIS_POINTS_PRECISION
```

**Purpose**: Specifically for fee calculations
- Makes fee calculations explicit and clear
- Same value as BASIS_POINTS_PRECISION but semantically different

## Conversion Constants

### BASIS_POINTS_TO_PRICE = 100
```rust
pub const BASIS_POINTS_TO_PRICE: u64 = PRICE_PRECISION / BASIS_POINTS_PRECISION; // 100
```

**Purpose**: Convert basis points to price precision
- Multiply basis points by 100 to get price precision units

**Example**:
```rust
// Convert 5000 basis points (50%) to price precision
let price_units = 5000 * BASIS_POINTS_TO_PRICE; // 500,000
// This represents 50% in PRICE_PRECISION units
```

### PERCENTAGE_TO_PRICE = 10,000
```rust
pub const PERCENTAGE_TO_PRICE: u64 = PRICE_PRECISION / PERCENTAGE_PRECISION; // 10,000
```

**Purpose**: Convert simple percentages to price precision
- Multiply percentage by 10,000 to get price precision units

## Why Different Precisions?

### 1. **Avoiding Hardcoded Numbers**
❌ **Bad**: `let fee = (amount * 25) / 10000;` (magic numbers)
✅ **Good**: `let fee = (amount * PLATFORM_FEE_RATE) / FEE_BASIS_POINTS;`

### 2. **Semantic Clarity**
Different constants for different purposes make code self-documenting:
- `FEE_BASIS_POINTS` - clearly for fee calculations
- `PRICE_PRECISION` - clearly for price calculations
- `BASIS_POINTS_PRECISION` - clearly for basis point conversions

### 3. **Precision Requirements**
Different calculations need different precision levels:
- **Fees**: 0.01% precision (basis points) is sufficient
- **Prices**: 0.0001% precision needed for accurate LMSR calculations
- **Simple percentages**: 1% precision is often enough

## Practical Examples

### Fee Calculation
```rust
// Platform fee of 0.25%
const PLATFORM_FEE_RATE: u64 = 25; // 25 basis points
const FEE_BASIS_POINTS: u64 = 10000;

let bet_amount = 100000; // 100,000 tokens
let fee = (bet_amount * PLATFORM_FEE_RATE) / FEE_BASIS_POINTS;
// fee = (100000 * 25) / 10000 = 250 tokens (0.25%)
```

### Price Calculation
```rust
const PRICE_PRECISION: u64 = 1000000;

let yes_liquidity = 800000;
let no_liquidity = 1200000;
let total_liquidity = yes_liquidity + no_liquidity; // 2,000,000

// YES price calculation
let yes_price = (no_liquidity * PRICE_PRECISION) / total_liquidity;
// yes_price = (1200000 * 1000000) / 2000000 = 600,000
// This represents 60% (600,000 / 1,000,000 = 0.6)
```

### Converting Between Precisions
```rust
// Convert 60% from PRICE_PRECISION to basis points
let price_in_precision = 600000; // 60% in PRICE_PRECISION
let price_in_basis_points = price_in_precision / BASIS_POINTS_TO_PRICE;
// price_in_basis_points = 600000 / 100 = 6000 (60% in basis points)

// Convert back
let back_to_price = price_in_basis_points * BASIS_POINTS_TO_PRICE;
// back_to_price = 6000 * 100 = 600,000 ✓
```

## Display Functions

For user interfaces, you'll want to convert these internal representations to human-readable formats:

```rust
// Convert PRICE_PRECISION to percentage for display
fn price_to_percentage(price: u64) -> f64 {
    (price as f64) / (PRICE_PRECISION as f64) * 100.0
}

// Convert PRICE_PRECISION to decimal for display  
fn price_to_decimal(price: u64) -> f64 {
    (price as f64) / (PRICE_PRECISION as f64)
}

// Example usage
let yes_price = 600000; // Internal representation
println!("YES price: {:.2}%", price_to_percentage(yes_price)); // "YES price: 60.00%"
println!("YES price: {:.4}", price_to_decimal(yes_price));     // "YES price: 0.6000"
```

## Benefits of This Approach

1. **No Magic Numbers**: All constants are named and documented
2. **Type Safety**: Different precisions prevent mixing incompatible values
3. **Maintainability**: Easy to change precision levels if needed
4. **Clarity**: Code is self-documenting about what precision is being used
5. **Consistency**: All similar calculations use the same constants
6. **Accuracy**: High precision prevents rounding errors in critical calculations

This system ensures that all price and fee calculations are accurate, consistent, and maintainable. 