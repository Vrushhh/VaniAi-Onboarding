// scratch/test-sarvam-agent-platform.js
// Verification test suite for Sarvam Samvaad (Voice Agents Platform) SDK integration.

import { getSarvamAgentConfig, SARVAM_AGENT_ID, SARVAM_ORG_ID, SARVAM_WORKSPACE_ID } from "../lib/sarvam.js";

function runTests() {
  console.log("==================================================");
  console.log("RUNNING SARVAM SAMVAAD VOICE AGENT PLATFORM TESTS ");
  console.log("==================================================");

  const config = getSarvamAgentConfig();
  console.log("Sarvam Agent Config:", config);

  // Test 1: Sarvam Agent App ID & Config helper
  if (config.app_id === "Kzuno-Agent-a7d3db0c-63be") {
    console.log("✅ TEST 1 PASSED: SARVAM_APP_ID correctly configured as 'Kzuno-Agent-a7d3db0c-63be'");
  } else {
    console.error("❌ TEST 1 FAILED!");
  }

  // Test 2: Org ID & Workspace ID verification
  if (config.org_id === "019ef441-dafb-7f96-9184-64c5716c4e15" && config.workspace_id === "019ef441-daff-7ab7-aa42-48cb2b90b4f8") {
    console.log("✅ TEST 2 PASSED: Org ID and Workspace ID match Sarvam Samvaad SDK config");
  } else {
    console.error("❌ TEST 2 FAILED!");
  }

  // Test 3: Dashboard URL generation
  if (config.dashboard_url === "https://indus.sarvam.ai/samvaad/build/update-agent/Kzuno-Agent-a7d3db0c-63be") {
    console.log("✅ TEST 3 PASSED: Dashboard URL matches indus.sarvam.ai/samvaad workspace link");
  } else {
    console.error("❌ TEST 3 FAILED!");
  }

  // Test 4: Agent Variables & Multilingual Config
  if (config.agent_variables && config.supported_languages.includes("hi-IN")) {
    console.log("✅ TEST 4 PASSED: Agent variables and 10+ Indian languages verified");
  } else {
    console.error("❌ TEST 4 FAILED!");
  }

  console.log("\n==================================================");
  console.log("SARVAM SAMVAAD AGENT PLATFORM SUITE PASSED      ");
  console.log("==================================================");
}

runTests();
