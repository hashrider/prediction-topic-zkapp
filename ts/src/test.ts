import { PrivateKey, bnToHexLe } from "delphinus-curves/src/altjubjub";
import dotenv from "dotenv";
import { PlayerConvention, ZKWasmAppRpc, createCommand } from "zkwasm-minirollup-rpc";
import { LeHexBN } from "zkwasm-ts-server";
import { PredictionMarketAPI } from "./api.js";

dotenv.config();

// Command constants
const TICK = 0;
const INSTALL_PLAYER = 1;
const WITHDRAW = 2;
const DEPOSIT = 3;
const BET = 4;
const SELL = 5;
const RESOLVE = 6;
const CLAIM = 7;
const WITHDRAW_FEES = 8;

class Player extends PlayerConvention {
    constructor(key: string, rpc: ZKWasmAppRpc) {
        super(key, rpc, BigInt(DEPOSIT), BigInt(WITHDRAW));
        this.processingKey = key;
        this.rpc = rpc;
    }

    async sendTransactionWithCommand(cmd: BigUint64Array) {
        try {
            const result = await this.rpc.sendTransaction(cmd, this.processingKey);
            return result;
        } catch (e) {
            if (e instanceof Error) {
                console.log(e.message);
            }
            throw e;
        }
    }

    async installPlayer() {
        try {
            const cmd = createCommand(0n, BigInt(INSTALL_PLAYER), []);
            return await this.sendTransactionWithCommand(cmd);
        } catch (e) {
            if (e instanceof Error && e.message === "PlayerAlreadyExists") {
                console.log("Player already exists, skipping installation");
                return null;
            }
            throw e;
        }
    }

    async placeBet(betType: number, amount: bigint) {
        const nonce = await this.getNonce();
        const cmd = createCommand(nonce, BigInt(BET), [BigInt(betType), amount]);
        return await this.sendTransactionWithCommand(cmd);
    }

    async claimWinnings() {
        const nonce = await this.getNonce();
        const cmd = createCommand(nonce, BigInt(CLAIM), []);
        return await this.sendTransactionWithCommand(cmd);
    }

    async withdrawFunds(amount: bigint, addressHigh: bigint, addressLow: bigint) {
        const nonce = await this.getNonce();
        const cmd = createCommand(nonce, BigInt(WITHDRAW), [0n, amount, addressHigh, addressLow]);
        return await this.sendTransactionWithCommand(cmd);
    }

    async depositFunds(amount: bigint, targetPid1: bigint, targetPid2: bigint) {
        const nonce = await this.getNonce();
        const cmd = createCommand(nonce, BigInt(DEPOSIT), [targetPid1, targetPid2, 0n, amount]);
        return await this.sendTransactionWithCommand(cmd);
    }

    async resolveMarket(outcome: boolean) {
        const nonce = await this.getNonce();
        const cmd = createCommand(nonce, BigInt(RESOLVE), [outcome ? 1n : 0n]);
        return await this.sendTransactionWithCommand(cmd);
    }

    async withdrawFees() {
        const nonce = await this.getNonce();
        const cmd = createCommand(nonce, BigInt(WITHDRAW_FEES), []);
        return await this.sendTransactionWithCommand(cmd);
    }

    async sellShares(sellType: number, shares: bigint) {
        const nonce = await this.getNonce();
        const cmd = createCommand(nonce, BigInt(SELL), [BigInt(sellType), shares]);
        return await this.sendTransactionWithCommand(cmd);
    }
}

// Helper: log player + market state (updated to LMSR fields)
async function logStateInfo(rpc: any, player: Player, playerName: string, stepDescription: string) {
    console.log(`\n=== ${stepDescription} - ${playerName} State ===`);
    try {
        const playerDataResponse: any = await rpc.queryState(player.processingKey);
        const parsed = JSON.parse(playerDataResponse.data);

        if (parsed && parsed.player && parsed.state) {
            const p = parsed.player.data;
            const m = parsed.state.market;

            console.log(`${playerName} Balance: ${p.balance}`);
            console.log(`${playerName} YES Shares: ${p.yes_shares}`);
            console.log(`${playerName} NO Shares: ${p.no_shares}`);
            console.log(`${playerName} Claimed: ${p.claimed}`);

            // LMSR market fields (snake_case from backend state)
            console.log(`Market total_yes_shares: ${m.total_yes_shares}`);
            console.log(`Market total_no_shares: ${m.total_no_shares}`);
            console.log(`Market pool_balance: ${m.pool_balance}`);
            console.log(`Market b (depth): ${m.b}`);
            console.log(`Market Total Volume: ${m.total_volume}`);
            console.log(`Market Total Fees: ${m.total_fees_collected}`);
            console.log(`Market Resolved: ${m.resolved}`);
            if (m.resolved) {
                console.log(`Market Outcome: ${m.outcome ? "YES" : "NO"}`);
            }
        }
    } catch (error) {
        console.log(`Error getting ${playerName} state:`, error);
    }
}

// Lightweight AMM test using LMSR helpers
function testAMMCalculations() {
    console.log("=== Testing LMSR Calculations ===");

    const api = new PredictionMarketAPI();

    // Seed outstanding shares and b (depth). Typical safe start: b ≈ starting shares per outcome.
    const qYes = 1_000_000n;
    const qNo = 1_000_000n;
    const b = 1_000_000n;

    console.log(`Initial shares - YES: ${qYes}, NO: ${qNo}, b: ${b}`);

    // Initial prices (should be ~0.5/0.5)
    const initial = api.calculatePrices(qYes, qNo, b);
    console.log(
        `Initial prices - YES: ${(initial.yesPrice * 100).toFixed(2)}%, NO: ${(initial.noPrice * 100).toFixed(2)}%`
    );

    const betAmount = 10_000; // tokens

    // Calculate expected YES shares for betAmount using LMSR + fees
    const yesShares = api.calculateShares(1, betAmount, qYes, qNo, b);
    console.log(`\nBetting ${betAmount} on YES:`);
    console.log(`Expected LMSR-minted YES shares: ${yesShares}`);

    console.log("\n=== LMSR Test Complete ===\n");
}

async function testPredictionMarket() {
    console.log("=== Enhanced Prediction Market Test with Two Players (LMSR) ===");

    const api = new PredictionMarketAPI();
    const rpc = new ZKWasmAppRpc("http://localhost:3000");

    // Admin key must match admin.pubkey
    const adminKey = process.env.SERVER_ADMIN_KEY;
    if (!adminKey) {
        throw new Error("SERVER_ADMIN_KEY environment variable is required");
    }
    const player1Key = "456789789";
    const player2Key = "987654321";

    console.log("Admin key from env:", adminKey);

    try {
        // Create players
        const admin = new Player(adminKey, rpc);
        const player1 = new Player(player1Key, rpc);
        const player2 = new Player(player2Key, rpc);

        // Resolve PIDs for deposits
        const p1pk = PrivateKey.fromString(player1.processingKey);
        const p1x = p1pk.publicKey.key.x.v;
        const p1hex = new LeHexBN(bnToHexLe(p1x));
        const p1Arr = p1hex.toU64Array();

        const p2pk = PrivateKey.fromString(player2.processingKey);
        const p2x = p2pk.publicKey.key.x.v;
        const p2hex = new LeHexBN(bnToHexLe(p2x));
        const p2Arr = p2hex.toU64Array();

        console.log("Player1 PID:", p1Arr);
        console.log("Player2 PID:", p2Arr);

        // STEP 1: install players
        console.log("\n=== STEP 1: Installing Players ===");
        try {
            await admin.installPlayer();
            console.log("Admin installed successfully");
        } catch (e) {
            if (e instanceof Error && e.message === "PlayerAlreadyExists") console.log("Admin already exists");
            else throw e;
        }
        try {
            await player1.installPlayer();
            console.log("Player1 installed successfully");
        } catch (e) {
            if (e instanceof Error && e.message === "PlayerAlreadyExists") console.log("Player1 already exists");
            else throw e;
        }
        try {
            await player2.installPlayer();
            console.log("Player2 installed successfully");
        } catch (e) {
            if (e instanceof Error && e.message === "PlayerAlreadyExists") console.log("Player2 already exists");
            else throw e;
        }

        // STEP 2: admin deposits to players
        console.log("\n=== STEP 2: Admin Deposits Funds ===");
        await admin.depositFunds(5000n, p1Arr[1], p1Arr[2]);
        console.log("Deposited 5000 for Player1");
        await logStateInfo(rpc, player1, "Player1", "After Deposit");

        await admin.depositFunds(3000n, p2Arr[1], p2Arr[2]);
        console.log("Deposited 3000 for Player2");
        await logStateInfo(rpc, player2, "Player2", "After Deposit");

        // STEP 3: Player1 YES bets
        console.log("\n=== STEP 3: Player1 Places YES Bets ===");
        try {
            await player1.placeBet(1, 1000n);
            console.log("Player1 bet 1000 on YES");
        } catch (error) {
            console.log("Player1 first YES bet error:", error instanceof Error ? error.message : error);
        }
        await logStateInfo(rpc, player1, "Player1", "After First YES Bet");

        try {
            await player1.placeBet(1, 500n);
            console.log("Player1 bet 500 more on YES");
        } catch (error) {
            console.log("Player1 second YES bet error:", error instanceof Error ? error.message : error);
        }
        await logStateInfo(rpc, player1, "Player1", "After Second YES Bet");

        // STEP 4: Player2 NO bets
        console.log("\n=== STEP 4: Player2 Places NO Bets ===");
        try {
            await player2.placeBet(0, 800n);
            console.log("Player2 bet 800 on NO");
        } catch (error) {
            console.log("Player2 first NO bet error:", error instanceof Error ? error.message : error);
        }
        await logStateInfo(rpc, player2, "Player2", "After First NO Bet");

        try {
            await player2.placeBet(0, 600n);
            console.log("Player2 bet 600 more on NO");
        } catch (error) {
            console.log("Player2 second NO bet error:", error instanceof Error ? error.message : error);
        }
        await logStateInfo(rpc, player2, "Player2", "After Second NO Bet");

        // STEP 5: Player1 also bets NO
        console.log("\n=== STEP 5: Player1 Also Bets on NO ===");
        try {
            await player1.placeBet(0, 700n);
            console.log("Player1 bet 700 on NO");
        } catch (error) {
            console.log("Player1 NO bet error:", error instanceof Error ? error.message : error);
        }
        await logStateInfo(rpc, player1, "Player1", "After NO Bet");

        // STEP 6: Sell some shares
        console.log("\n=== STEP 6: Players Sell Some Shares ===");
        try {
            await player1.placeBet(1, 300n); // ensure enough YES to sell
            console.log("Player1 bought 300 more YES shares");
        } catch (error) {
            console.log("Player1 additional YES bet error:", error instanceof Error ? error.message : error);
        }
        await logStateInfo(rpc, player1, "Player1", "After Additional YES Purchase");

        try {
            await player1.sellShares(1, 200n);
            console.log("Player1 sold 200 YES shares");
        } catch (error) {
            console.log("Player1 YES sell error:", error instanceof Error ? error.message : error);
        }
        await logStateInfo(rpc, player1, "Player1", "After Selling YES Shares");

        try {
            await player2.sellShares(0, 150n);
            console.log("Player2 sold 150 NO shares");
        } catch (error) {
            console.log("Player2 NO sell error:", error instanceof Error ? error.message : error);
        }
        await logStateInfo(rpc, player2, "Player2", "After Selling NO Shares");

        try {
            await player1.sellShares(0, 100n);
            console.log("Player1 sold 100 NO shares");
        } catch (error) {
            console.log("Player1 NO sell error:", error instanceof Error ? error.message : error);
        }
        await logStateInfo(rpc, player1, "Player1", "After Selling NO Shares");

        // STEP 7: resolve (YES wins)
        console.log("\n=== STEP 7: Admin Resolves Market (YES Wins) ===");
        await admin.resolveMarket(true);
        console.log("Market resolved: YES wins");
        await logStateInfo(rpc, admin, "Admin", "After Market Resolution");

        // STEP 8: claims
        console.log("\n=== STEP 8: Players Claim Winnings ===");
        try {
            await player1.claimWinnings();
            console.log("Player1 claimed winnings");
        } catch (error) {
            if (error instanceof Error && error.message === "NoWinningPosition") {
                console.log("Player1 has no winning position to claim");
            } else {
                console.log("Player1 claim error:", error);
            }
        }
        await logStateInfo(rpc, player1, "Player1", "After Claiming Attempt");

        try {
            await player2.claimWinnings();
            console.log("Player2 claimed winnings");
        } catch (error) {
            if (error instanceof Error && error.message === "NoWinningPosition") {
                console.log("Player2 has no winning position to claim");
            } else {
                console.log("Player2 claim error:", error);
            }
        }
        await logStateInfo(rpc, player2, "Player2", "After Claiming Attempt");

        // STEP 9: admin withdraws fees
        console.log("\n=== STEP 9: Admin Withdraws Fees ===");
        await admin.withdrawFees();
        console.log("Admin withdrew collected fees");
        await logStateInfo(rpc, admin, "Admin", "After Fee Withdrawal");

        // STEP 10: final snapshot
        console.log("\n=== STEP 10: Final State Summary ===");
        await logStateInfo(rpc, admin, "Admin", "Final State");
        await logStateInfo(rpc, player1, "Player1", "Final State");
        await logStateInfo(rpc, player2, "Player2", "Final State");

        console.log("=== Test completed successfully ===");
    } catch (error) {
        console.error("Test failed:", error);
        if (error instanceof Error) {
            console.error("Error message:", error?.message);
        }
    }
}

async function runExamples() {
    console.log("Running prediction market examples...\n");
    try {
        testAMMCalculations();
        await testPredictionMarket();
        console.log("\n" + "=".repeat(50));
    } catch (error) {
        console.error("Examples failed:", error);
    }
}

// Run the test if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    runExamples();
}
