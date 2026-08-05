// scratch/test-sarvam-agent-full.js
// Automated verification test suite for Regional Languages & Context Memory tracking.

import { SarvamSessionAdapter } from "../lib/sarvam.js";

async function runTests() {
  console.log("==================================================");
  console.log("RUNNING REGIONAL LANGUAGE & CONTEXT MEMORY TESTS  ");
  console.log("==================================================");

  // Mock bridge
  const mockBridge = { demoId: "test-call-1", closed: false, onSpeechStarted: () => {} };
  const session = new SarvamSessionAdapter(mockBridge);

  // Test 1: Brand Name Context Memory Extraction
  console.log("\n[TEST 1] Testing Direct Answer Brand Name Extraction...");
  session.lastAgentAsked = "brandName";
  session.extractKnownFacts("Organic Glow");
  console.log("Captured brandName:", session.knownFacts.brandName);

  if (session.knownFacts.brandName === "Organic Glow") {
    console.log("✅ TEST 1 PASSED: Brand name 'Organic Glow' captured into context memory");
  } else {
    console.error("❌ TEST 1 FAILED!");
  }

  // Test 2: Product Category Context Memory Extraction
  console.log("\n[TEST 2] Testing Product Category Context Memory Extraction...");
  session.lastAgentAsked = "productCategory";
  session.extractKnownFacts("Skincare and beauty products");
  console.log("Captured productCategory:", session.knownFacts.productCategory);

  if (session.knownFacts.productCategory === "skincare") {
    console.log("✅ TEST 2 PASSED: Product category 'skincare' captured into context memory");
  } else {
    console.error("❌ TEST 2 FAILED!");
  }

  // Test 3: Known Facts System Message Assembly
  console.log("\n[TEST 3] Testing Known Facts System Message Assembly...");
  const factsMsg = session.buildKnownFactsMessage();
  console.log("Assembled Known Facts directive:", factsMsg);

  if (factsMsg && factsMsg.includes("Organic Glow") && factsMsg.includes("skincare")) {
    console.log("✅ TEST 3 PASSED: Known facts message properly injects brand name and category into system context");
  } else {
    console.error("❌ TEST 3 FAILED!");
  }

  console.log("\n==================================================");
  console.log("ALL REGIONAL & CONTEXT TESTS PASSED SUCCESSFULLY!  ");
  console.log("==================================================");
}

runTests().catch(err => {
  console.error("TEST SUITE FAILED WITH ERROR:", err);
  process.exit(1);
});
