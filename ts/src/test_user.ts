import { Player, PredictionMarketAPI } from "./api.js";
import { PrivateKey, bnToHexLe } from "delphinus-curves/src/altjubjub";
//import { LeHexBN, ZKWasmAppRpc} from "zkwasm-minirollup-rpc";
import { LeHexBN, query, ZKWasmAppRpc } from "zkwasm-ts-server";

const adminAccount = process.env.SERVER_ADMIN_KEY || '';
const player1Key = "456789789";
const player2Key = "987654321";

// Function to pause execution for a given duration
function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const rpc: any = new ZKWasmAppRpc("http://localhost:3000");
  const adminPlayer = new Player(adminAccount, rpc);
  const player1 = new Player(player1Key, rpc);
  const player2 = new Player(player2Key, rpc);
  const api = new PredictionMarketAPI();

  const adminPubkey = new LeHexBN(query(adminAccount).pkx).toU64Array();
  const pubkey1 = new LeHexBN(query(player1Key).pkx).toU64Array();
  const pubkey2 = new LeHexBN(query(player2Key).pkx).toU64Array();
  
  console.log("Admin pubkey:", adminPubkey);
  console.log("Player 1 pubkey:", pubkey1);
  console.log("Player 2 pubkey:", pubkey2);

  
        // Get player PIDs for deposits
        let player1Pkey = PrivateKey.fromString(player1.processingKey);
        let player1Pubkey = player1Pkey.publicKey.key.x.v;
        let player1LeHexBN = new LeHexBN(bnToHexLe(player1Pubkey));
        let player1PkeyArray = player1LeHexBN.toU64Array();
        
        let player2Pkey = PrivateKey.fromString(player2.processingKey);
        let player2Pubkey = player2Pkey.publicKey.key.x.v;
        let player2LeHexBN = new LeHexBN(bnToHexLe(player2Pubkey));
        let player2PkeyArray = player2LeHexBN.toU64Array();


  try {
    console.log("=== Simplified Multi-Market User Testing ===\n");

    // Step 1: Install players
    console.log("1. Installing players...");
  try {
      await adminPlayer.installPlayer();
      console.log("  Admin installed");
    } catch (e) {
      console.log("  Admin already exists");
    }

    try {
      await player1.installPlayer();
      console.log("  Player 1 installed");
    } catch (e) {
      console.log("  Player 1 already exists");
    }

    try {
      await player2.installPlayer();
      console.log("  Player 2 installed");
    } catch (e) {
      console.log("  Player 2 already exists");
    }
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Step 2: Create a new market (admin only)
    console.log("\n2. Creating a new market...");
    try {
      const marketTitle = "Will Bitcoin reach $100K by 2025?";
      // Using relative time offsets (relative to current counter)
      const startTimeOffset = 0n;    // Start immediately 
      const endTimeOffset = 100000n;    // End after 100k counter ticks
      const resolutionTimeOffset = 100000n; // Resolve after 100k counter ticks
      const initialLiquidity = 100000n; // 100,000 units initial shares (q/b = 0.1 for LMSR)
      
      console.log(`  Creating market: "${marketTitle}"`);
      console.log(`  Initial shares: ${initialLiquidity} each side`);
      console.log(`  Time offsets: start=${startTimeOffset}, end=${endTimeOffset}, resolve=${resolutionTimeOffset}`);
      
      await adminPlayer.createMarket(
        marketTitle,
        startTimeOffset,
        endTimeOffset,
        resolutionTimeOffset,
        initialLiquidity,
        initialLiquidity,
        1000000n  // b parameter for LMSR (q/b = 0.1)
      );
      await new Promise(resolve => setTimeout(resolve, 2000));
      console.log("  Market created successfully!");
  } catch (e) {
      console.log("  Market creation failed:", e);
  }
    await delay(3000);

    await adminPlayer.depositFunds(10000n, player1PkeyArray[1], player1PkeyArray[2]);
    console.log("Deposited 10000 for Player1");
    
    await adminPlayer.depositFunds(8000n, player2PkeyArray[1], player2PkeyArray[2]);
    console.log("Deposited 8000 for Player2");

    // Step 3: Get all markets
    console.log("\n3. Fetching available markets...");
    const markets = await api.getAllMarkets();
    console.log(`  Found ${markets.length} markets`);
    
    if (markets.length === 0) {
      console.log("  No markets available for testing");
      return;
    }

    // Use the first available market for testing
    const testMarket = markets[0];
    const marketId = BigInt(testMarket.marketId);
    console.log(`  Using market ${testMarket.marketId}: "${testMarket.titleString || 'No title'}"`);
    console.log(`  Total YES Shares: ${testMarket.totalYesShares}`);
    console.log(`  Total NO Shares: ${testMarket.totalNoShares}`);
    console.log(`  Pool Balance: ${testMarket.poolBalance}`);
    console.log(`  LMSR Parameter b: ${testMarket.b}`);
    console.log(`  Total Volume: ${testMarket.totalVolume}`);
    await delay(1000);

    // Step 4: Player 1 places a YES bet
    console.log("\n4. Player 1 placing YES bet...");
  try {
      const betAmount = 5000n;
      console.log(`  Betting ${betAmount} on YES`);
      
      const result = await player1.placeBet(marketId, 1, betAmount); // 1 = YES
      console.log("  YES bet placed successfully!");
      console.log("  Transaction result:", result);
    } catch (e) {
      console.log("  YES bet failed:", e);
    }
    await delay(3000);

    // Step 5: Player 2 places a NO bet
    console.log("\n5. Player 2 placing NO bet...");
    try {
      const betAmount = 3000n;
      console.log(`  Betting ${betAmount} on NO`);
      
      const result = await player2.placeBet(marketId, 0, betAmount); // 0 = NO
      console.log("  NO bet placed successfully!");
      console.log("  Transaction result:", result);
    } catch (e) {
      console.log("  NO bet failed:", e);
    }
    await delay(3000);

    // Step 6: Check updated market state
    console.log("\n6. Checking updated market state...");
    const updatedMarket = await api.getMarket(testMarket.marketId);
    console.log("  Updated market data:");
    console.log(`    Title: ${updatedMarket.titleString || 'No title'}`);
    console.log(`    Total YES Shares: ${updatedMarket.totalYesShares}`);
    console.log(`    Total NO Shares: ${updatedMarket.totalNoShares}`);
    console.log(`    Pool Balance: ${updatedMarket.poolBalance}`);
    console.log(`    LMSR Parameter b: ${updatedMarket.b}`);
    console.log(`    Total Volume: ${updatedMarket.totalVolume}`);
    console.log(`    Total YES Shares: ${updatedMarket.totalYesShares}`);
    console.log(`    Total NO Shares: ${updatedMarket.totalNoShares}`);
    console.log(`    Fees Collected: ${updatedMarket.totalFeesCollected}`);

    // Calculate new prices (AMM approximation - backend uses LMSR)
    const yesShares = BigInt(updatedMarket.totalYesShares);
    const noShares = BigInt(updatedMarket.totalNoShares);
    const prices = api.calculatePrices(yesShares, noShares);
    console.log(`    Current prices (AMM approx): YES=${(prices.yesPrice * 100).toFixed(2)}%, NO=${(prices.noPrice * 100).toFixed(2)}%`);
    await delay(1000);

    // Step 8: Check player positions
    console.log("\n8. Checking player positions...");
    
    console.log("  Player 1 position in this market:");
    const player1Position = await api.getPlayerMarketPosition(
      pubkey1[1].toString(), 
      pubkey1[2].toString(),
      testMarket.marketId
    );
    console.log(`    YES Shares: ${player1Position.yesShares}`);
    console.log(`    NO Shares: ${player1Position.noShares}`);
    console.log(`    Claimed: ${player1Position.claimed}`);

    console.log("  Player 2 position in this market:");
    const player2Position = await api.getPlayerMarketPosition(
      pubkey2[1].toString(), 
      pubkey2[2].toString(),
      testMarket.marketId
    );
    console.log(`    YES Shares: ${player2Position.yesShares}`);
    console.log(`    NO Shares: ${player2Position.noShares}`);
    console.log(`    Claimed: ${player2Position.claimed}`);

    console.log("  Player 1 all positions:");
    const player1AllPositions = await api.getPlayerAllPositions(
      pubkey1[1].toString(), 
      pubkey1[2].toString()
    );
    player1AllPositions.forEach((pos, idx) => {
      console.log(`    Market ${pos.marketId}: YES=${pos.yesShares}, NO=${pos.noShares}, Claimed=${pos.claimed}`);
    });
    await delay(1000);

    // Step 9: Get market recent transactions
    console.log("\n9. Market recent activity...");
    const marketTransactions = await api.getMarketRecentTransactions(testMarket.marketId);
    console.log(`  Found ${marketTransactions.length} recent transactions in this market:`);
    marketTransactions.forEach((tx, idx) => {
      const player = `[${tx.pid[0]}, ${tx.pid[1]}]`;
      console.log(`    ${idx + 1}. ${player} - ${tx.transactionType}: ${tx.amount} units → ${tx.shares} shares`);
    });
    await delay(1000);

    // Step 10: Get player transaction history
    console.log("\n10. Player transaction history...");
    
    console.log("  Player 1 recent transactions across all markets:");
    const player1Transactions = await api.getPlayerRecentTransactions(
      pubkey1[1].toString(), 
      pubkey1[2].toString()
    );
    player1Transactions.forEach((tx, idx) => {
      console.log(`    ${idx + 1}. Market ${tx.marketId} - ${tx.transactionType}: ${tx.amount} → ${tx.shares}`);
    });

    console.log("  Player 1 transactions in this market:");
    const player1MarketTransactions = await api.getPlayerMarketRecentTransactions(
      pubkey1[1].toString(), 
      pubkey1[2].toString(),
      testMarket.marketId
    );
    player1MarketTransactions.forEach((tx, idx) => {
      console.log(`    ${idx + 1}. ${tx.transactionType}: ${tx.amount} → ${tx.shares}`);
    });

    console.log("  Player 2 recent transactions across all markets:");
    const player2Transactions = await api.getPlayerRecentTransactions(
      pubkey2[1].toString(), 
      pubkey2[2].toString()
    );
    player2Transactions.forEach((tx, idx) => {
      console.log(`    ${idx + 1}. Market ${tx.marketId} - ${tx.transactionType}: ${tx.amount} → ${tx.shares}`);
    });
    await delay(1000);

    // Step 11: Get market liquidity history and calculate prices
    console.log("\n11. Market liquidity history analysis...");
    const liquidityHistory = await api.getMarketLiquidityHistory(testMarket.marketId);
    console.log(`  Found ${liquidityHistory.length} liquidity data points`);
    
    if (liquidityHistory.length > 0) {
      const firstPoint = liquidityHistory[0];
      const lastPoint = liquidityHistory[liquidityHistory.length - 1];
      
      // Calculate prices on frontend
      const calcPrice = (yesLiq: string, noLiq: string) => {
        const yesLiqBig = BigInt(yesLiq);
        const noLiqBig = BigInt(noLiq);
        const totalLiq = yesLiqBig + noLiqBig;
        const yesPrice = totalLiq > 0n ? Number(noLiqBig) / Number(totalLiq) : 0.5;
        const noPrice = totalLiq > 0n ? Number(yesLiqBig) / Number(totalLiq) : 0.5;
        return { yesPrice, noPrice };
      };
      
      const firstPrices = calcPrice(firstPoint.yesLiquidity, firstPoint.noLiquidity);
      const lastPrices = calcPrice(lastPoint.yesLiquidity, lastPoint.noLiquidity);
      
      console.log("  Price evolution (calculated on frontend):");
      console.log(`    Initial: YES=${(firstPrices.yesPrice * 100).toFixed(2)}%, NO=${(firstPrices.noPrice * 100).toFixed(2)}%`);
      console.log(`    Current: YES=${(lastPrices.yesPrice * 100).toFixed(2)}%, NO=${(lastPrices.noPrice * 100).toFixed(2)}%`);
      
      const yesChange = ((lastPrices.yesPrice - firstPrices.yesPrice) * 100).toFixed(2);
      console.log(`    YES price change: ${yesChange}%`);
      
      // Show recent liquidity movements
      if (liquidityHistory.length > 5) {
        console.log("  Recent liquidity movements (last 5 data points):");
        liquidityHistory.slice(-5).forEach((point, idx) => {
          const prices = calcPrice(point.yesLiquidity, point.noLiquidity);
          console.log(`    Counter ${point.counter}: YES Liq=${point.yesLiquidity}, NO Liq=${point.noLiquidity}, Prices: YES=${(prices.yesPrice * 100).toFixed(2)}%, NO=${(prices.noPrice * 100).toFixed(2)}%`);
        });
      }
    }
    await delay(1000);

    // Step 12: Platform statistics calculated from markets
    console.log("\n12. Platform statistics...");
    let totalYesShares = 0n;
    let totalNoShares = 0n;
    let totalVolume = 0n;
    let activeMarkets = 0;
    let resolvedMarkets = 0;
    
    markets.forEach(m => {
      totalYesShares += BigInt(m.totalYesShares);
      totalNoShares += BigInt(m.totalNoShares);
      totalVolume += BigInt(m.totalVolume || "0");
      if (m.resolved) {
        resolvedMarkets++;
      } else {
        activeMarkets++;
      }
    });
    
    console.log("  Platform overview:");
    console.log(`    Total Markets: ${markets.length}`);
    console.log(`    Active Markets: ${activeMarkets}`);
    console.log(`    Resolved Markets: ${resolvedMarkets}`);
    console.log(`    Total Platform Shares: ${totalYesShares + totalNoShares}`);
    console.log(`    Total Platform Volume: ${totalVolume}`);
    
    // Calculate platform-wide average price (AMM approximation)
    const platformAvgYesPrice = totalNoShares > 0n ? 
      Number(totalNoShares) / Number(totalYesShares + totalNoShares) : 0.5;
    console.log(`    Platform Average YES Price (AMM approx): ${(platformAvgYesPrice * 100).toFixed(2)}%`);

  } catch (e) {
    console.error("Error during testing:", e);
  }

  console.log("\n=== User Testing Complete ===");
}

main();
