import { Player, PredictionMarketAPI } from "./api.js";
//import { LeHexBN, ZKWasmAppRpc} from "zkwasm-minirollup-rpc";
import { LeHexBN, query, ZKWasmAppRpc } from "zkwasm-ts-server";

let account = "456789789";

const rpc: any = new ZKWasmAppRpc("http://127.0.0.1:3000");
let player = new Player(account, rpc);
let api = new PredictionMarketAPI("http://127.0.0.1:3000");

// Function to pause execution for a given duration
function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const pubkey = new LeHexBN(query(account).pkx).toU64Array();
  console.log("Player pubkey:", pubkey);

  try {
    console.log("=== Testing Updated Multi-Market API ===\n");

    // Test 1: Get all markets
    console.log("1. Fetching all markets...");
    const markets = await api.getAllMarkets();
    console.log(`Found ${markets.length} markets:`);
    markets.forEach((market, index) => {
      console.log(`  Market ${index + 1}:`);
      console.log(`    ID: ${market.marketId}`);
      console.log(`    Title: ${market.titleString || 'No title'}`);
      console.log(`    YES Liquidity: ${market.yesLiquidity}`);
      console.log(`    NO Liquidity: ${market.noLiquidity}`);
      console.log(`    Prize Pool: ${market.prizePool}`);
      console.log(`    Total Volume: ${market.totalVolume}`);
      console.log(`    Resolved: ${market.resolved}`);
      if (market.resolved) {
        console.log(`    Outcome: ${market.outcome ? 'YES' : 'NO'}`);
      }
    });
    await delay(1000);

    if (markets.length === 0) {
      console.log("No markets available for testing");
      return;
    }

    // Test 2: Get specific market details
    const firstMarketId = markets[0].marketId;
    console.log(`\n2. Fetching details for market ${firstMarketId}...`);
    const marketDetails = await api.getMarket(firstMarketId);
    console.log("Market details:", {
      id: marketDetails.marketId,
      title: marketDetails.titleString || 'No title',
      yesLiquidity: marketDetails.yesLiquidity,
      noLiquidity: marketDetails.noLiquidity,
      prizePool: marketDetails.prizePool,
      totalVolume: marketDetails.totalVolume,
      totalYesShares: marketDetails.totalYesShares,
      totalNoShares: marketDetails.totalNoShares,
      resolved: marketDetails.resolved,
      outcome: marketDetails.outcome
    });
    await delay(1000);

    // Test 3: Get market recent transactions
    console.log(`\n3. Fetching recent transactions for market ${firstMarketId}...`);
    const marketTransactions = await api.getMarketRecentTransactions(firstMarketId);
    console.log(`Found ${marketTransactions.length} recent transactions for this market`);
    if (marketTransactions.length > 0) {
      console.log("Recent market transactions:");
      marketTransactions.slice(0, 5).forEach((tx, index) => {
        console.log(`  Transaction ${index + 1}:`);
        console.log(`    Player: [${tx.pid[0]}, ${tx.pid[1]}]`);
        console.log(`    Type: ${tx.transactionType}`);
        console.log(`    Amount: ${tx.amount}`);
        console.log(`    Shares: ${tx.shares}`);
      });
    }
    await delay(1000);

    // Test 4: Get player recent transactions across all markets
    console.log(`\n4. Fetching player recent transactions across all markets...`);
    const playerTransactions = await api.getPlayerRecentTransactions(
      pubkey[1].toString(), 
      pubkey[2].toString()
    );
    console.log(`Player has made ${playerTransactions.length} recent transactions across all markets`);
    if (playerTransactions.length > 0) {
      console.log("Player recent transactions:");
      playerTransactions.forEach((tx, index) => {
        console.log(`  Transaction ${index + 1}:`);
        console.log(`    Market ID: ${tx.marketId}`);
        console.log(`    Type: ${tx.transactionType}`);
        console.log(`    Amount: ${tx.amount}`);
        console.log(`    Shares: ${tx.shares}`);
      });
    }
    await delay(1000);

    // Test 5: Get player recent transactions for specific market
    console.log(`\n5. Fetching player recent transactions for market ${firstMarketId}...`);
    const playerMarketTransactions = await api.getPlayerMarketRecentTransactions(
      pubkey[1].toString(), 
      pubkey[2].toString(),
      firstMarketId
    );
    console.log(`Player has made ${playerMarketTransactions.length} recent transactions in this market`);
    if (playerMarketTransactions.length > 0) {
      console.log("Player market transactions:");
      playerMarketTransactions.forEach((tx, index) => {
        console.log(`  Transaction ${index + 1}:`);
        console.log(`    Type: ${tx.transactionType}`);
        console.log(`    Amount: ${tx.amount}`);
        console.log(`    Shares: ${tx.shares}`);
      });
    }
    await delay(1000);

    // Test 6: Get player market position
    console.log(`\n6. Fetching player position in market ${firstMarketId}...`);
    const playerPosition = await api.getPlayerMarketPosition(
      pubkey[1].toString(), 
      pubkey[2].toString(),
      firstMarketId
    );
    console.log("Player market position:", {
      marketId: playerPosition.marketId,
      yesShares: playerPosition.yesShares,
      noShares: playerPosition.noShares,
      claimed: playerPosition.claimed
    });
    await delay(1000);

    // Test 7: Get all player positions
    console.log(`\n7. Fetching all player positions...`);
    const allPositions = await api.getPlayerAllPositions(
      pubkey[1].toString(), 
      pubkey[2].toString()
    );
    console.log(`Player has positions in ${allPositions.length} markets:`);
    allPositions.forEach((position, index) => {
      console.log(`  Position ${index + 1}:`);
      console.log(`    Market ID: ${position.marketId}`);
      console.log(`    YES Shares: ${position.yesShares}`);
      console.log(`    NO Shares: ${position.noShares}`);
      console.log(`    Claimed: ${position.claimed}`);
    });
    await delay(1000);

    // Test 8: Get market liquidity history
    console.log(`\n8. Fetching liquidity history for market ${firstMarketId}...`);
    const liquidityHistory = await api.getMarketLiquidityHistory(firstMarketId);
    console.log(`Found ${liquidityHistory.length} liquidity data points`);
    if (liquidityHistory.length > 0) {
      console.log("Liquidity history (showing last 5 points):");
      liquidityHistory.slice(-5).forEach((point, index) => {
        console.log(`  Point ${index + 1}:`);
        console.log(`    Counter: ${point.counter}`);
        console.log(`    YES Liquidity: ${point.yesLiquidity}`);
        console.log(`    NO Liquidity: ${point.noLiquidity}`);
        
        // Calculate prices on frontend side
        const yesLiq = BigInt(point.yesLiquidity);
        const noLiq = BigInt(point.noLiquidity);
        const totalLiq = yesLiq + noLiq;
        const yesPrice = totalLiq > 0n ? Number(noLiq) / Number(totalLiq) : 0.5;
        const noPrice = totalLiq > 0n ? Number(yesLiq) / Number(totalLiq) : 0.5;
        console.log(`    Calculated YES Price: ${(yesPrice * 100).toFixed(2)}%`);
        console.log(`    Calculated NO Price: ${(noPrice * 100).toFixed(2)}%`);
      });
    }
    await delay(1000);

    // Test 9: Price calculations for first market (frontend calculations)
    const market = markets[0];
    console.log(`\n9. Frontend price calculations for market ${market.marketId}:`);
    
    const yesLiquidity = BigInt(market.yesLiquidity);
    const noLiquidity = BigInt(market.noLiquidity);
    
    // Current prices
    const prices = api.calculatePrices(yesLiquidity, noLiquidity, BigInt(market.b));
    console.log(`  Current prices: YES=${(prices.yesPrice * 100).toFixed(2)}%, NO=${(prices.noPrice * 100).toFixed(2)}%`);
    
    // Expected shares for 1000 unit bet
    const betAmount = 1000;
    const expectedYesShares = api.calculateShares(1, betAmount, yesLiquidity, noLiquidity, BigInt(market.b));
    const expectedNoShares = api.calculateShares(0, betAmount, yesLiquidity, noLiquidity, BigInt(market.b));
    console.log(`  Expected shares for ${betAmount} units: YES=${expectedYesShares}, NO=${expectedNoShares}`);
    
    // Buy prices
    const yesBuyPrice = api.getBuyPrice(1, betAmount, yesLiquidity, noLiquidity, BigInt(market.b));
    const noBuyPrice = api.getBuyPrice(0, betAmount, yesLiquidity, noLiquidity, BigInt(market.b));
    console.log(`  Buy prices: YES=${yesBuyPrice.toFixed(6)}, NO=${noBuyPrice.toFixed(6)}`);
    
    // Market impact
    const yesImpact = api.calculateMarketImpact(1, betAmount, yesLiquidity, noLiquidity, BigInt(market.b));
    console.log(`  YES bet impact: ${(yesImpact.currentYesPrice * 100).toFixed(2)}% → ${(yesImpact.newYesPrice * 100).toFixed(2)}%`);
    
    // Slippage
    const yesSlippage = api.calculateSlippage(1, betAmount, yesLiquidity, noLiquidity, BigInt(market.b));
    console.log(`  YES bet slippage: ${yesSlippage.toFixed(4)}%`);

    // Test 10: Platform statistics (calculated from markets data)
    console.log(`\n10. Platform statistics (calculated from markets):`);
    let totalYesLiquidity = 0n;
    let totalNoLiquidity = 0n;
    let totalVolume = 0n;
    let resolvedMarkets = 0;
    
    markets.forEach(m => {
      totalYesLiquidity += BigInt(m.yesLiquidity);
      totalNoLiquidity += BigInt(m.noLiquidity);
      totalVolume += BigInt(m.totalVolume || "0");
      if (m.resolved) resolvedMarkets++;
    });
    
    console.log(`  Total Markets: ${markets.length}`);
    console.log(`  Resolved Markets: ${resolvedMarkets}`);
    console.log(`  Active Markets: ${markets.length - resolvedMarkets}`);
    console.log(`  Total YES Liquidity: ${totalYesLiquidity}`);
    console.log(`  Total NO Liquidity: ${totalNoLiquidity}`);
    console.log(`  Total Platform Volume: ${totalVolume}`);

  } catch (e) {
    console.error("Error during testing:", e);
  }

  console.log("\n=== Testing Complete ===");
}

main();
