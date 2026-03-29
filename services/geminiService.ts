import { GoogleGenAI, Modality, HarmCategory, HarmBlockThreshold } from "@google/genai";

/**
 * Generates speech from text using Gemini 2.5 Flash TTS
 */
export const generateSpeechSegment = async (
  text: string,
  voiceName: string = 'Kore',
  systemInstruction?: string,
  speed: string = 'Normal'
): Promise<string> => {
  try {
    // Check for API Keys at runtime
    // Priority: 1. LocalStorage (User provided list) 2. Environment Variable
    const storedKeys = localStorage.getItem('GEMINI_API_KEY') || "";
    // Split by comma or newline and filter out empty strings
    const apiKeys = storedKeys.split(/[\n,]+/).map(k => k.trim()).filter(k => k.length > 0);
    
    // If no keys in localStorage, try environment variable
    if (apiKeys.length === 0 && process.env.GEMINI_API_KEY) {
      apiKeys.push(process.env.GEMINI_API_KEY);
    }
    
    if (apiKeys.length === 0) {
      throw new Error("API Key not found. Please enter your API Key(s) in the Settings menu.");
    }

    // Construct configuration object
    const config: any = {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: voiceName },
        },
      },
      // Low temperature for maximum consistency and zero variation in tone
      temperature: 0.1,
      topP: 0.95,
      topK: 40,
      // Safety settings to minimize content blocking - set to lowest possible restriction
      safetySettings: [
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_CIVIC_INTEGRITY, threshold: HarmBlockThreshold.BLOCK_NONE },
      ],
    };

    // Construct full instruction text
    let instructions = systemInstruction ? systemInstruction.trim() : "";
    
    // Add a default instruction for tone consistency and neutral narration
    const consistencyPrompt = "Narrate this literary script with a NATURAL, HUMAN-LIKE, and professional voice. Strictly avoid any robotic, mechanical, or artificial tones. The narration must sound like a real person telling an engaging story. Maintain the EXACT same pitch, tone, cadence, and emotional energy from start to finish. This text is part of a continuous long-form story; it is CRITICAL that the voice remains identical to previous segments with zero variation. Do not drift, change character, or rush. Ensure the voice remains stable, deep, and clear throughout. Avoid any distortion or volume fluctuations. IMPORTANT: This is a safe, family-friendly literary story. Do not block or filter any part of this narration.";
    instructions = instructions ? `${instructions} ${consistencyPrompt}` : consistencyPrompt;
    
    // Append speed instruction if not normal
    if (speed && speed !== 'Normal') {
        const speedPrompt = speed === 'Fast' ? "Speak at a fast pace." : 
                            speed === 'Very Fast' ? "Speak very quickly." : 
                            "Speak slowly.";
        
        instructions = instructions ? `${instructions} ${speedPrompt}` : speedPrompt;
    }

    // Format the prompt for the TTS model
    const promptText = `${instructions}\n\nText to read:\n${text}`;

    // Model rotation logic for rate limits and safety blocks
    const models = [
      "gemini-2.5-flash-preview-tts",
      "gemini-3.1-flash-lite-preview",
      "gemini-3.1-flash-preview",
      "gemini-3-flash-preview",
      "gemini-flash-latest"
    ];

    let lastError: any;

    // Nested loop: For each API Key, try each Model
    for (let keyIndex = 0; keyIndex < apiKeys.length; keyIndex++) {
      const apiKey = apiKeys[keyIndex];
      const ai = new GoogleGenAI({ apiKey });

      for (let modelIndex = 0; modelIndex < models.length; modelIndex++) {
        const currentModel = models[modelIndex];
        
        try {
          console.log(`[Key ${keyIndex + 1}/${apiKeys.length}] Attempting TTS with model: ${currentModel}`);
          
          const response = await ai.models.generateContent({
            model: currentModel,
            contents: [{ parts: [{ text: promptText }] }],
            config: config,
          });

          // Check for safety blocks in candidates
          const finishReason = response.candidates?.[0]?.finishReason;
          if (finishReason === 'SAFETY') {
            throw new Error(`Content blocked by safety filters of ${currentModel}.`);
          }

          const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

          if (!base64Audio) {
            throw new Error(`No audio data received from ${currentModel}.`);
          }

          // Convert Base64 to Blob
          const binaryString = atob(base64Audio);
          const len = binaryString.length;
          const bytes = new Uint8Array(len);
          for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          
          // Create Wav URL
          return createWavUrl(bytes, 24000); 
        } catch (error: any) {
          lastError = error;
          const errorMessage = (error.message || "").toLowerCase();
          
          // If it's a quota or rate limit error, skip this KEY entirely for all models
          const isQuotaError = 
            errorMessage.includes("quota") || 
            errorMessage.includes("429") || 
            errorMessage.includes("rate limit") ||
            errorMessage.includes("limit exceeded");

          if (isQuotaError) {
            console.warn(`[Key ${keyIndex + 1}] Quota exceeded or rate limited. Skipping this key entirely...`);
            break; // Break inner loop to try next key
          }

          // For other retryable errors, try next model with same key
          const isModelRetryable = 
            errorMessage.includes("503") || 
            errorMessage.includes("not found") || 
            errorMessage.includes("unsupported") || 
            errorMessage.includes("invalid model") || 
            errorMessage.includes("blocked") || 
            errorMessage.includes("safety") || 
            errorMessage.includes("internal error") || 
            errorMessage.includes("deadline") || 
            errorMessage.includes("unavailable");

          if (isModelRetryable) {
            console.warn(`[Key ${keyIndex + 1}] Model ${currentModel} failed: ${error.message}. Trying next model...`);
            continue; // Try next model in inner loop
          } else {
            // For critical errors like "Invalid API Key", skip this key
            console.error(`[Key ${keyIndex + 1}] Critical error: ${error.message}. Skipping key...`);
            break; // Break inner loop to try next key
          }
        }
      }
      
      // If we reached here, all models failed for this key
      if (keyIndex < apiKeys.length - 1) {
        console.warn(`[Key ${keyIndex + 1}] All models failed. Switching to Key ${keyIndex + 2}...`);
      }
    }

    throw lastError || new Error("Failed after multiple retries across all keys and models");

  } catch (error: any) {
    console.error("Error generating speech:", error);
    
    // Attempt to extract meaningful message from error object or string
    let errorMessage = error.message || "Unknown API Error";
    
    // Check if the error message is a JSON string (common with some client errors)
    if (typeof errorMessage === 'string' && (errorMessage.includes('{') && errorMessage.includes('}'))) {
        try {
            // regex to find JSON object
            const jsonMatch = errorMessage.match(/\{.*\}/);
            if (jsonMatch) {
                const errorObj = JSON.parse(jsonMatch[0]);
                if (errorObj.error && errorObj.error.message) {
                    errorMessage = `${errorObj.error.message}`;
                    if(errorObj.error.code) errorMessage += ` (Code: ${errorObj.error.code})`;
                } else if (errorObj.message) {
                    errorMessage = errorObj.message;
                }
            }
        } catch (e) {
            // If parsing fails, use original message
        }
    }

    throw new Error(errorMessage);
  }
};

/**
 * Helper to add a WAV header to raw PCM data so it plays in standard players
 * 24000Hz is the sample rate used in the Gemini guidelines examples
 */
export const createWavUrl = (samples: Uint8Array, sampleRate: number): string => {
  const buffer = new ArrayBuffer(44 + samples.length);
  const view = new DataView(buffer);

  const writeString = (view: DataView, offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  // RIFF identifier
  writeString(view, 0, 'RIFF');
  // file length
  view.setUint32(4, 36 + samples.length, true);
  // RIFF type
  writeString(view, 8, 'WAVE');
  // format chunk identifier
  writeString(view, 12, 'fmt ');
  // format chunk length
  view.setUint32(16, 16, true);
  // sample format (raw)
  view.setUint16(20, 1, true);
  // channel count (1)
  view.setUint16(22, 1, true);
  // sample rate
  view.setUint32(24, sampleRate, true);
  // byte rate (sampleRate * blockAlign)
  view.setUint32(28, sampleRate * 2, true);
  // block align (channel count * bytes per sample)
  view.setUint16(32, 2, true);
  // bits per sample
  view.setUint16(34, 16, true);
  // data chunk identifier
  writeString(view, 36, 'data');
  // data chunk length
  view.setUint32(40, samples.length, true);

  // Write the PCM samples
  const pcmData = new Uint8Array(buffer, 44);
  pcmData.set(samples);

  const blob = new Blob([buffer], { type: 'audio/wav' });
  return URL.createObjectURL(blob);
};