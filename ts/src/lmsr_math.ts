export const FP_SCALE = 1_000_000n;
export const MAX_SHARES = 1_000_000_000n;

export function fpMul(a: bigint, b: bigint): bigint {
    return (a * b) / FP_SCALE;
}

export function fpDiv(a: bigint, b: bigint): bigint {
    if (b === 0n) {
        throw new Error("Division by zero");
    }
    return (a * FP_SCALE) / b;
}

export function fpExpTaylor(x: bigint): bigint {
    const one = FP_SCALE;
    const x1 = x;
    const x2 = fpMul(x, x);
    const half = fpDiv(x2, 2n);
    const x3 = fpMul(x2, x);
    const sixth = fpDiv(x3, 6n);

    return one + x1 + half + sixth;
}

export function fpExpQOverB(q: bigint, b: bigint): bigint {
    if (b === 0n) {
        throw new Error("Invalid LMSR parameter b");
    }
    const qOverB = (q * FP_SCALE) / b;
    return fpExpTaylor(qOverB);
}

export function fpLnSeries(value: bigint): bigint {
    if (value < FP_SCALE) {
        throw new Error("ln() input must be >= 1.0 in fixed point");
    }
    const x = value - FP_SCALE;
    const x2 = fpMul(x, x);
    const x3 = fpMul(x2, x);
    return x - fpDiv(x2, 2n) + fpDiv(x3, 3n);
}

export function lmsrCost(qYes: bigint, qNo: bigint, b: bigint): bigint {
    const eYes = fpExpQOverB(qYes, b);
    const eNo = fpExpQOverB(qNo, b);
    const sumE = eYes + eNo;
    const lnSum = fpLnSeries(sumE);
    return b * lnSum;
}

export function lmsrPriceYesFp(qYes: bigint, qNo: bigint, b: bigint): bigint {
    const eYes = fpExpQOverB(qYes, b);
    const eNo = fpExpQOverB(qNo, b);
    const denom = eYes + eNo;
    return fpDiv(eYes, denom);
}

export function lmsrPriceNoFp(qYes: bigint, qNo: bigint, b: bigint): bigint {
    return FP_SCALE - lmsrPriceYesFp(qYes, qNo, b);
}

export function lmsrBuyYesQuote(qYes: bigint, qNo: bigint, b: bigint, deltaYes: bigint): bigint {
    const cBefore = lmsrCost(qYes, qNo, b);
    const cAfter = lmsrCost(qYes + deltaYes, qNo, b);
    return cAfter - cBefore;
}

export function lmsrBuyNoQuote(qYes: bigint, qNo: bigint, b: bigint, deltaNo: bigint): bigint {
    const cBefore = lmsrCost(qYes, qNo, b);
    const cAfter = lmsrCost(qYes, qNo + deltaNo, b);
    return cAfter - cBefore;
}

export function lmsrSellYesQuote(qYes: bigint, qNo: bigint, b: bigint, sYes: bigint): bigint {
    if (sYes > qYes) {
        throw new Error("Cannot sell more YES shares than owned");
    }
    const cBefore = lmsrCost(qYes, qNo, b);
    const cAfter = lmsrCost(qYes - sYes, qNo, b);
    return cBefore - cAfter;
}

export function lmsrSellNoQuote(qYes: bigint, qNo: bigint, b: bigint, sNo: bigint): bigint {
    if (sNo > qNo) {
        throw new Error("Cannot sell more NO shares than owned");
    }
    const cBefore = lmsrCost(qYes, qNo, b);
    const cAfter = lmsrCost(qYes, qNo - sNo, b);
    return cBefore - cAfter;
}

