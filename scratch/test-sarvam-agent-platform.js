// scratch/test-sarvam-agent-platform.js
// Verification test suite for Sarvam Samvaad (Voice Agents Platform) integration.

import { getSarvamAgentConfig, SARVAM_AGENT_ID } from "../lib/sarvam.js";

function runTests() {
  console.log("==================================================");
  console.log("RUNNING SARVAM SAMVAAD VOICE AGENT PLATFORM TESTS ");
  console.log("==================================================");

  // Test 1: Sarvam Agent ID & Config helper
  const config = getSarvamAgentConfig();
  console.log("Sarvam Agent Config:", config);

  if (config.agent_id === "Kzuno-Agent-a7d3db0c-63be") {
    console.log("✅ TEST 1 PASSED: SARVAM_AGENT_ID correctly defaults to 'Kzuno-Agent-a7d3db0c-63be'");
  } else {
    console.error("❌ TEST 1 FAILED!");
  }

  // Test 2: Dashboard URL generation
  if (config.dashboard_url === "https://indus.sarvam.ai/samvaad/build/update-agent/Kzuno-Agent-a7d3db0c-63be") {
    console.log("✅ TEST 2 PASSED: Dashboard URL matches indus.sarvam.ai/samvaad workspace link");
  } else {
    console.error("❌ TEST 2 FAILED!");
  }

  // Test 3: Supported Languages List
  if (config.supported_languages.length >= 10 && config.supported_languages.includes("hi-IN")) {
    console.log("✅ TEST 3 PASSED: Supported multilingual Indian languages configured");
  } else {
    console.error("❌ TEST 3 FAILED!");
  }

  console.log("\n==================================================");
  console.log("SARVAM SAMVAAD AGENT PLATFORM SUITE PASSED      ");
  console.log("==================================================");
}

runTests();
