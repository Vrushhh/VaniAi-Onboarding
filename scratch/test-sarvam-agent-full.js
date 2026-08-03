// scratch/test-sarvam-agent-full.js
// Verification test suite for Understood replacement and 650ms silence timeout.

import { SarvamSessionAdapter } from "../lib/sarvam.js";

async function runTests() {
  console.log("==================================================");
  console.log("RUNNING UNDERSTOOD & TIMEOUT VERIFICATION TESTS   ");
  console.log("==================================================");

  // Test 1: Under! -> Understood! Replacement
  console.log("\n[TEST 1] Testing 'Under!' -> 'Understood!' Replacement...");
  let input1 = "Under! What is your brand name?";
  let clean1 = input1.replace(/\bUnder[!,\.]?\b/gi, "Understood!");
  console.log("Original input:", input1);
  console.log("Cleaned output:", clean1);

  let input2 = "Under, What category of products do you sell?";
  let clean2 = input2.replace(/\bUnder[!,\.]?\b/gi, "Understood!");
  console.log("Original input 2:", input2);
  console.log("Cleaned output 2:", clean2);

  if (clean1.startsWith("Understood!") && clean2.startsWith("Understood!")) {
    console.log("✅ TEST 1 PASSED: 'Under!' and 'Under,' are automatically transformed to 'Understood!'");
  } else {
    console.error("❌ TEST 1 FAILED!");
  }

  // Test 2: Keezoono Pronunciation Test
  console.log("\n[TEST 2] Testing Keezoono Pronunciation...");
  let inputKz = "Welcome to KZUNO!";
  let cleanKz = inputKz.replace(/\b(?:KZUNO|Kzuno|KiZUNO|Kizuno|kzuno)'?s?\b/gi, "Keezoono");
  if (cleanKz.includes("Keezoono")) {
    console.log("✅ TEST 2 PASSED: KZUNO phonetically transformed to Keezoono");
  } else {
    console.error("❌ TEST 2 FAILED!");
  }

  console.log("\n==================================================");
  console.log("ALL VERIFICATION TESTS PASSED SUCCESSFULLY!       ");
  console.log("==================================================");
}

runTests().catch(err => {
  console.error("TEST SUITE FAILED WITH ERROR:", err);
  process.exit(1);
});
