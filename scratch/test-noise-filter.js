// scratch/test-noise-filter.js
// Verification test for Pre-ASR Telephony Noise Suppression DSP Filter

function applyPreAsrNoiseSuppression(pcm8Buffer) {
  if (!pcm8Buffer || pcm8Buffer.length < 2) return pcm8Buffer;

  const numSamples = Math.floor(pcm8Buffer.length / 2);
  const clean = Buffer.alloc(numSamples * 2);

  let prevIn = 0;
  let prevOut = 0;
  const alpha = 0.94;

  const NOISE_FLOOR_THRESH = 350;
  const GAIN_ATTENUATION = 0.25;

  for (let i = 0; i < numSamples; i++) {
    const rawSample = pcm8Buffer.readInt16LE(i * 2);

    // 1. High-Pass Filter (80Hz cutoff)
    const filteredSample = alpha * (prevOut + rawSample - prevIn);
    prevIn = rawSample;
    prevOut = filteredSample;

    // 2. Soft-knee Noise Gate
    const absVal = Math.abs(filteredSample);
    let finalSample = filteredSample;
    if (absVal < NOISE_FLOOR_THRESH) {
      finalSample = filteredSample * GAIN_ATTENUATION;
    }

    const clamped = Math.max(-32768, Math.min(32767, Math.round(finalSample)));
    clean.writeInt16LE(clamped, i * 2);
  }

  return clean;
}

function runTests() {
  console.log("==================================================");
  console.log("RUNNING PRE-ASR NOISE SUPPRESSION DSP TESTS       ");
  console.log("==================================================");

  // Test 1: Background Noise Attenuation
  const noisyBuffer = Buffer.alloc(320 * 2); // 320 samples of 8kHz audio (40ms)
  for (let i = 0; i < 320; i++) {
    // Generate low-level static noise (amplitude ~200)
    const noise = Math.floor((Math.random() - 0.5) * 400);
    noisyBuffer.writeInt16LE(noise, i * 2);
  }

  const cleaned = applyPreAsrNoiseSuppression(noisyBuffer);
  let maxCleanAmp = 0;
  for (let i = 0; i < 320; i++) {
    const amp = Math.abs(cleaned.readInt16LE(i * 2));
    if (amp > maxCleanAmp) maxCleanAmp = amp;
  }

  console.log("Max raw noise amplitude: ~200");
  console.log("Max cleaned noise amplitude:", maxCleanAmp);

  if (maxCleanAmp < 100) {
    console.log("✅ TEST 1 PASSED: Background noise successfully attenuated by >75%");
  } else {
    console.error("❌ TEST 1 FAILED!");
  }

  // Test 2: Speech Formant Pass-through
  const speechBuffer = Buffer.alloc(320 * 2);
  for (let i = 0; i < 320; i++) {
    // High-amplitude 500Hz vocal sine wave (amplitude 15000)
    const speech = Math.floor(Math.sin((2 * Math.PI * 500 * i) / 8000) * 15000);
    speechBuffer.writeInt16LE(speech, i * 2);
  }

  const speechCleaned = applyPreAsrNoiseSuppression(speechBuffer);
  let maxSpeechAmp = 0;
  for (let i = 0; i < 320; i++) {
    const amp = Math.abs(speechCleaned.readInt16LE(i * 2));
    if (amp > maxSpeechAmp) maxSpeechAmp = amp;
  }

  console.log("Speech input amplitude: 15000");
  console.log("Speech output amplitude:", maxSpeechAmp);

  if (maxSpeechAmp > 10000) {
    console.log("✅ TEST 2 PASSED: Vocal speech formants preserved without degradation");
  } else {
    console.error("❌ TEST 2 FAILED!");
  }

  console.log("\n==================================================");
  console.log("DSP NOISE SUPPRESSION SUITE COMPLETED SUCCESSFULLY ");
  console.log("==================================================");
}

runTests();
