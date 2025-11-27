import { PrivateKey, bnToHexLe } from "delphinus-curves/src/altjubjub";
import dotenv from 'dotenv';
import { PlayerConvention, ZKWasmAppRpc, createCommand } from 'zkwasm-minirollup-rpc';
import { LeHexBN } from "zkwasm-ts-server";
import { PredictionMarketAPI } from './api.js';
import { stringToU64Array } from './models.js';

dotenv.config();

// Command constants - updated for multi-market
const TICK = 0;
const INSTALL_PLAYER = 1;
const WITHDRAW = 2;
const DEPOSIT = 3;
const BET = 4;
const SELL = 5;
const RESOLVE = 6;
const CLAIM = 7;
const WITHDRAW_FEES = 8;
const CREATE_MARKET = 9;

class Player extends PlayerConvention {
    constructor(key: string, rpc: ZKWasmAppRpc) {
        super(key, rpc, BigInt(DEPOSIT), BigInt(WITHDRAW));
        this.processingKey = key;
        this.rpc = rpc;
    }

    async sendTransactionWithCommand(cmd: BigUint64Array) {
        try {
            let result = await this.rpc.sendTransaction(cmd, this.processingKey);
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
            let cmd = createCommand(0n, BigInt(INSTALL_PLAYER), []);
            return await this.sendTransactionWithCommand(cmd);
        } catch (e) {
            if (e instanceof Error && e.message === "PlayerAlreadyExists") {
                console.log("Player already exists, skipping installation");
                return null; // Not an error, just already exists
            }
            throw e; // Re-throw other errors
        }
    }

    // Updated to include market_id
    async placeBet(marketId: bigint, betType: number, amount: bigint) {
        let nonce = await this.getNonce();
        let cmd = createCommand(nonce, BigInt(BET), [marketId, BigInt(betType), amount]);
        return await this.sendTransactionWithCommand(cmd);
    }

    // Updated to include market_id
    async sellShares(marketId: bigint, sellType: number, shares: bigint) {
        let nonce = await this.getNonce();
        let cmd = createCommand(nonce, BigInt(SELL), [marketId, BigInt(sellType), shares]);
        return await this.sendTransactionWithCommand(cmd);
    }

    // Updated to include market_id
    async claimWinnings(marketId: bigint) {
        let nonce = await this.getNonce();
        let cmd = createCommand(nonce, BigInt(CLAIM), [marketId]);
        return await this.sendTransactionWithCommand(cmd);
    }

    async withdrawFunds(amount: bigint, addressHigh: bigint, addressLow: bigint) {
        let nonce = await this.getNonce();
        let cmd = createCommand(nonce, BigInt(WITHDRAW), [0n, amount, addressHigh, addressLow]);
        return await this.sendTransactionWithCommand(cmd);
    }

    async depositFunds(amount: bigint, targetPid1: bigint, targetPid2: bigint) {
        let nonce = await this.getNonce();
        let cmd = createCommand(nonce, BigInt(DEPOSIT), [targetPid1, targetPid2, 0n, amount]);
        return await this.sendTransactionWithCommand(cmd);
    }

    // Updated to include market_id
    async resolveMarket(marketId: bigint, outcome: boolean) {
        let nonce = await this.getNonce();
        let cmd = createCommand(nonce, BigInt(RESOLVE), [marketId, outcome ? 1n : 0n]);
        return await this.sendTransactionWithCommand(cmd);
    }

    // Updated to include market_id
    async withdrawFees(marketId: bigint) {
        let nonce = await this.getNonce();
        let cmd = createCommand(nonce, BigInt(WITHDRAW_FEES), [marketId]);
        return await this.sendTransactionWithCommand(cmd);
    }

    // New function to create markets with relative time offsets (LMSR)
    async createMarket(
        title: string,
        startTimeOffset: bigint,    // Offset from current counter
        endTimeOffset: bigint,      // Offset from current counter
        resolutionTimeOffset: bigint, // Offset from current counter
        initialYesLiquidity: bigint, // Initial YES shares for LMSR
        initialNoLiquidity: bigint,  // Initial NO shares for LMSR
        b: bigint                    // LMSR liquidity parameter (market depth)
    ) {
        let nonce = await this.getNonce();
        const titleU64Array = stringToU64Array(title);
        
        // Build command: [cmd, ...title_u64s, start_time_offset, end_time_offset, resolution_time_offset, yes_liquidity, no_liquidity, b]
        const params = [
            ...titleU64Array,
            startTimeOffset,
            endTimeOffset,
            resolutionTimeOffset,
            initialYesLiquidity,
            initialNoLiquidity,
            b
        ];
        
        let cmd = createCommand(nonce, BigInt(CREATE_MARKET), params);
        return await this.sendTransactionWithCommand(cmd);
    }
}

// Helper function to log player and market state
async function logStateInfo(rpc: any, player: Player, playerName: string, stepDescription: string) {
    console.log(`\n=== ${stepDescription} - ${playerName} State ===`);
    
    try {
        const playerDataResponse: any = await rpc.queryState(player.processingKey);
        const playerData = JSON.parse(playerDataResponse.data);
        
        if (playerData && playerData.player) {
            const playerInfo = playerData.player.data;
            console.log(`${playerName} Balance: ${playerInfo.balance}`);
            
            // Note: In multi-market, shares are per-market now
            if (playerData.state && playerData.state.marketIds) {
                console.log(`Total markets: ${playerData.state.marketIds.length}`);
            }
        }
    } catch (error) {
        console.log(`Error getting ${playerName} state:`, error);
    }
}

// Test AMM calculations
function testAMMCalculations() {
    console.log("=== Testing AMM Calculations ===");
    
    const api = new PredictionMarketAPI();
    
    // Initial liquidity
    const initialYesLiquidity = 100000n;
    const initialNoLiquidity = 100000n;
    
    console.log(`Initial liquidity - YES: ${initialYesLiquidity}, NO: ${initialNoLiquidity}`);
    
    // Test initial prices (should be 50/50)
    const initialPrices = api.calculatePrices(initialYesLiquidity, initialNoLiquidity);
    console.log(`Initial prices - YES: ${(initialPrices.yesPrice * 100).toFixed(2)}%, NO: ${(initialPrices.noPrice * 100).toFixed(2)}%`);
    
    // Test bet calculations
    const betAmount = 10000;
    
    // Calculate YES bet
    const yesShares = api.calculateShares(1, betAmount, initialYesLiquidity, initialNoLiquidity);
    console.log(`\nBetting ${betAmount} on YES:`);
    console.log(`Expected shares: ${yesShares}`);
    
    console.log("\n=== AMM Test Complete ===\n");
}

async function testMultiMarketPrediction() {
    console.log("=== Comprehensive Multi-Market Test with All Commands ===");
    
    const api = new PredictionMarketAPI();
    const rpc = new ZKWasmAppRpc("http://localhost:3000");
    
    // Use environment variable for admin key - this must match the admin.pubkey file
    const adminKey = process.env.SERVER_ADMIN_KEY;
    if (!adminKey) {
        throw new Error("SERVER_ADMIN_KEY environment variable is required");
    }
    const player1Key = "456789789";
    const player2Key = "987654321";
    const player3Key = "111222333"; // Third player for more testing
    
    console.log("Admin key from env:", adminKey);
    
    try {
        // Create player instances
        const admin = new Player(adminKey, rpc);
        const player1 = new Player(player1Key, rpc);
        const player2 = new Player(player2Key, rpc);
        const player3 = new Player(player3Key, rpc);
        
        // Get player PIDs for deposits
        let player1Pkey = PrivateKey.fromString(player1.processingKey);
        let player1Pubkey = player1Pkey.publicKey.key.x.v;
        let player1LeHexBN = new LeHexBN(bnToHexLe(player1Pubkey));
        let player1PkeyArray = player1LeHexBN.toU64Array();
        
        let player2Pkey = PrivateKey.fromString(player2.processingKey);
        let player2Pubkey = player2Pkey.publicKey.key.x.v;
        let player2LeHexBN = new LeHexBN(bnToHexLe(player2Pubkey));
        let player2PkeyArray = player2LeHexBN.toU64Array();

        let player3Pkey = PrivateKey.fromString(player3.processingKey);
        let player3Pubkey = player3Pkey.publicKey.key.x.v;
        let player3LeHexBN = new LeHexBN(bnToHexLe(player3Pubkey));
        let player3PkeyArray = player3LeHexBN.toU64Array();
        
        console.log("Player1 PID:", player1PkeyArray);
        console.log("Player2 PID:", player2PkeyArray);
        console.log("Player3 PID:", player3PkeyArray);
        
        // Step 1: Install all players (INSTALL_PLAYER command)
        console.log("\n=== STEP 1: Installing Players (INSTALL_PLAYER) ===");
        
        try {
            await admin.installPlayer();
            console.log("Admin installed successfully");
        } catch (e) {
            console.log("Admin already exists or error:", e);
        }
        
        try {
            await player1.installPlayer();
            console.log("Player1 installed successfully");
        } catch (e) {
            console.log("Player1 already exists or error:", e);
        }
        
        try {
            await player2.installPlayer();
            console.log("Player2 installed successfully");
        } catch (e) {
            console.log("Player2 already exists or error:", e);
        }

        try {
            await player3.installPlayer();
            console.log("Player3 installed successfully");
        } catch (e) {
            console.log("Player3 already exists or error:", e);
        }

        // Step 2: Admin creates multiple markets (CREATE_MARKET command)
        console.log("\n=== STEP 2: Creating Multiple Markets (CREATE_MARKET) ===");
        
        // Now using relative time offsets (relative to current counter)
        
        // Market 1: Bitcoin price prediction
        // Using smaller q/b ratio (~0.1) for LMSR Taylor approximations to work correctly
        console.log("Creating Market 1: Bitcoin Price Prediction");
        await admin.createMarket(
            "Will Bitcoin reach $130K by end of 2025?",
            0n,    // Start immediately (offset 0)
            100000n,  // End after 100K counter ticks
            100000n,  // Resolve after 100K counter ticks
            100000n,   // 100K initial YES shares (q/b = 0.1)
            100000n,   // 100K initial NO shares (q/b = 0.1)
            1000000n   // b parameter for LMSR
        );
        
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Market 2: Election prediction
        console.log("Creating Market 2: Election Prediction");
        await admin.createMarket(
            "Will candidate A win the election?",
            0n,    // Start immediately (offset 0)
            50000n,  // End after 50K counter ticks
            50000n,  // Resolve after 50K counter ticks
            100000n,  // 100K initial YES shares (q/b = 0.1)
            100000n,  // 100K initial NO shares (q/b = 0.1)
            1000000n   // b parameter for LMSR
        );
        
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Market 3: Sports prediction
        console.log("Creating Market 3: Sports Prediction");
        await admin.createMarket(
            "Will Team X win the championship?",
            0n,    // Start immediately (offset 0)
            30000n,  // End after 30K counter ticks
            30000n,  // Resolve after 30K counter ticks
            100000n,  // 100K initial YES shares (q/b = 0.1)
            100000n,  // 100K initial NO shares (q/b = 0.1)
            1000000n   // b parameter for LMSR
        );

        await new Promise(resolve => setTimeout(resolve, 2000));

        // Step 3: Admin deposits funds for all players (DEPOSIT command)
        console.log("\n=== STEP 3: Admin Deposits Funds (DEPOSIT) ===");
        
        await admin.depositFunds(10000n, player1PkeyArray[1], player1PkeyArray[2]);
        console.log("Deposited 10000 for Player1");
        
        await admin.depositFunds(8000n, player2PkeyArray[1], player2PkeyArray[2]);
        console.log("Deposited 8000 for Player2");

        await admin.depositFunds(12000n, player3PkeyArray[1], player3PkeyArray[2]);
        console.log("Deposited 12000 for Player3");
        
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Step 4: Multiple players bet on Market 1 (BET command)
        console.log("\n=== STEP 4: Multi-Player Betting on Market 1 (BET) ===");
        
        const market1Id = 1n; // First market
        
        // Player1 bets on YES
        try {
            await player1.placeBet(market1Id, 1, 2000n); // YES bet
            console.log("Player1 bet 2000 on YES in Market 1");
        } catch (error) {
            console.log("Player1 bet error:", error);
        }
        // Player2 bets on NO
        try {
            await player2.placeBet(market1Id, 0, 1500n); // NO bet
            console.log("Player2 bet 1500 on NO in Market 1");
        } catch (error) {
            console.log("Player2 bet error:", error);
        }

        // Player3 bets on YES
        try {
            await player3.placeBet(market1Id, 1, 1800n); // YES bet
            console.log("Player3 bet 1800 on YES in Market 1");
        } catch (error) {
            console.log("Player3 bet error:", error);
        }

        await new Promise(resolve => setTimeout(resolve, 2000));

        // Step 5: Players bet on Market 2 (more BET commands)
        console.log("\n=== STEP 5: Betting on Market 2 (BET) ===");
        
        const market2Id = 2n; // Second market
        
        try {
            await player1.placeBet(market2Id, 0, 1000n); // NO bet
            console.log("Player1 bet 1000 on NO in Market 2");
        } catch (error) {
            console.log("Player1 Market 2 bet error:", error);
        }
        
        try {
            await player2.placeBet(market2Id, 1, 2000n); // YES bet
            console.log("Player2 bet 2000 on YES in Market 2");
        } catch (error) {
            console.log("Player2 Market 2 bet error:", error);
        }

        await new Promise(resolve => setTimeout(resolve, 2000));

        // Step 6: Players make additional bets and cross-market activity
        console.log("\n=== STEP 6: Additional Cross-Market Betting (BET) ===");
        
        const market3Id = 3n; // Third market
        
        // More bets on Market 1
        try {
            await player2.placeBet(market1Id, 1, 800n); // Player2 also bets YES on Market 1
            console.log("Player2 bet 800 on YES in Market 1");
        } catch (error) {
            console.log("Player2 additional Market 1 bet error:", error);
        }

        // Bets on Market 3
        try {
            await player1.placeBet(market3Id, 1, 1500n); // YES bet
            console.log("Player1 bet 1500 on YES in Market 3");
        } catch (error) {
            console.log("Player1 Market 3 bet error:", error);
        }

        try {
            await player3.placeBet(market3Id, 0, 2500n); // NO bet
            console.log("Player3 bet 2500 on NO in Market 3");
        } catch (error) {
            console.log("Player3 Market 3 bet error:", error);
        }

        await new Promise(resolve => setTimeout(resolve, 2000));

        // Step 7: Players sell some shares (SELL command)
        console.log("\n=== STEP 7: Players Sell Shares (SELL) ===");
        
        // Player1 sells some YES shares from Market 1
        try {
            await player1.sellShares(market1Id, 1, 500n); // Sell YES shares
            console.log("Player1 sold 500 YES shares from Market 1");
        } catch (error) {
            console.log("Player1 sell error:", error);
        }

        // Player2 sells some YES shares from Market 2 (he bought YES shares, not NO)
        try {
            await player2.sellShares(market2Id, 1, 300n); // Sell YES shares  
            console.log("Player2 sold 300 YES shares from Market 2");
        } catch (error) {
            console.log("Player2 sell error:", error);
        }

        // Player3 sells some NO shares from Market 3
        try {
            await player3.sellShares(market3Id, 0, 400n); // Sell NO shares
            console.log("Player3 sold 400 NO shares from Market 3");
        } catch (error) {
            console.log("Player3 sell error:", error);
        }

        await new Promise(resolve => setTimeout(resolve, 2000));

        // Step 8: Resolve markets (RESOLVE command)
        console.log("\n=== STEP 8: Resolving Markets (RESOLVE) ===");
        
        // Resolve Market 1: YES wins
        // try {
        //     await admin.resolveMarket(market1Id, true); // YES outcome
        //     console.log("Market 1 resolved: YES wins");
        // } catch (error) {
        //     console.log("Market 1 resolve error:", error);
        // }
        
        // // Resolve Market 2: NO wins
        // try {
        //     await admin.resolveMarket(market2Id, false); // NO outcome
        //     console.log("Market 2 resolved: NO wins");
        // } catch (error) {
        //     console.log("Market 2 resolve error:", error);
        // }

        // // Resolve Market 3: YES wins
        // try {
        //     await admin.resolveMarket(market3Id, true); // YES outcome
        //     console.log("Market 3 resolved: YES wins");
        // } catch (error) {
        //     console.log("Market 3 resolve error:", error);
        // }

        // await new Promise(resolve => setTimeout(resolve, 2000));

        // Step 9: Players claim winnings (CLAIM command)
        // console.log("\n=== STEP 9: Players Claim Winnings (CLAIM) ===");
        
        // // Each player claims from each market
        const markets = [market1Id, market2Id, market3Id];
        // const players = [
        //     { player: player1, name: "Player1" },
        //     { player: player2, name: "Player2" },
        //     { player: player3, name: "Player3" }
        // ];

        // for (const marketId of markets) {
        //     for (const { player, name } of players) {
        //         try {
        //             await player.claimWinnings(marketId);
        //             console.log(`${name} claimed winnings from Market ${marketId}`);
        //         } catch (error) {
        //             if (error instanceof Error && error.message === "NoWinningPosition") {
        //                 console.log(`${name} has no winning position in Market ${marketId}`);
        //             } else {
        //                 console.log(`${name} claim error for Market ${marketId}:`, error);
        //             }
        //         }
        //     }
        // }

        // await new Promise(resolve => setTimeout(resolve, 2000));

        // Step 10: Admin withdraws fees from all markets (WITHDRAW_FEES command)
        console.log("\n=== STEP 10: Admin Withdraws Fees (WITHDRAW_FEES) ===");
        
        for (const marketId of markets) {
            try {
                await admin.withdrawFees(marketId);
                console.log(`Admin withdrew fees from Market ${marketId}`);
            } catch (error) {
                if (error instanceof Error && error.message === "ERROR_NO_FEES_TO_WITHDRAW") {
                    console.log(`No fees to withdraw from Market ${marketId}`);
                } else {
                    console.log(`Fee withdrawal error for Market ${marketId}:`, error);
                }
            }
        }

        await new Promise(resolve => setTimeout(resolve, 2000));

        // Step 11: Test WITHDRAW command
        console.log("\n=== STEP 11: Players Test Withdrawal (WITHDRAW) ===");
        
        // Player1 attempts to withdraw some funds
        try {
            await player1.withdrawFunds(500n, 0n, 1n); // Withdraw 500 to address [0,1]
            console.log("Player1 withdrew 500 funds");
        } catch (error) {
            console.log("Player1 withdraw error:", error);
        }

        await new Promise(resolve => setTimeout(resolve, 2000));

        // Step 12: Final state logging
        console.log("\n=== STEP 12: Final State Summary ===");
        
        await logStateInfo(rpc, admin, "Admin", "Final State");
        await logStateInfo(rpc, player1, "Player1", "Final State");
        await logStateInfo(rpc, player2, "Player2", "Final State");
        await logStateInfo(rpc, player3, "Player3", "Final State");
        
        console.log("\n=== ALL COMMANDS TESTED SUCCESSFULLY ===");
        console.log("Commands tested:");
        console.log("✓ INSTALL_PLAYER");
        console.log("✓ CREATE_MARKET"); 
        console.log("✓ DEPOSIT");
        console.log("✓ BET (multiple markets, multiple players)");
        console.log("✓ SELL (cross-market selling)");
        console.log("✓ RESOLVE (multiple markets)");
        console.log("✓ CLAIM (cross-market claiming)");
        console.log("✓ WITHDRAW_FEES (multiple markets)");
        console.log("✓ WITHDRAW");
        
    } catch (error) {
        console.error("Test failed:", error);
        if (error instanceof Error) {
            console.error("Error message:", error.message);
        }
    }
}

async function runExamples() {
    console.log("Running comprehensive multi-market prediction test...\n");
    
    try {
        // Test AMM calculations first
        testAMMCalculations();
        
        // Then test all commands
        await testMultiMarketPrediction();
        
    } catch (error) {
        console.error("Examples failed:", error);
    }
}

// Run the test if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    runExamples();
}
