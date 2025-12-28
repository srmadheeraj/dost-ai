
import { GoogleGenAI, Chat, Modality, LiveServerMessage } from "@google/genai";
import { SYSTEM_INSTRUCTION } from "../constants";

export class DostService {
  private ai: GoogleGenAI;
  private chat: Chat | null = null;

  constructor() {
    this.ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
  }

  initChat() {
    this.chat = this.ai.chats.create({
      model: 'gemini-3-flash-preview',
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        temperature: 0.95,
      },
    });
    return this.chat;
  }

  async *sendMessageStream(message: string) {
    if (!this.chat) this.initChat();
    
    try {
      const result = await this.chat!.sendMessageStream({ message });
      for await (const chunk of result) {
        yield chunk.text;
      }
    } catch (error) {
      console.error("Gemini Error:", error);
      throw error;
    }
  }

  connectVoice(callbacks: {
    onAudioChunk: (data: string) => void;
    onInterrupted: () => void;
    onClose: () => void;
    onError: (e: any) => void;
    onTranscription?: (text: string, isUser: boolean) => void;
    onTurnComplete?: () => void;
  }) {
    // Re-instantiate on every call to ensure the latest API key is used
    const voiceAi = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
    
    return voiceAi.live.connect({
      model: 'gemini-2.5-flash-native-audio-preview-09-2025',
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } },
        },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        systemInstruction: SYSTEM_INSTRUCTION + "\n\nCRITICAL VOICE RULES:\n- Reply in natural Hinglish.\n- Use conversational fillers: 'hmm', 'acha', 'suno yaar', 'theek hai'.\n- Do not be robotic. Be warm like a real Indian best friend.\n- If the user stops talking, wait a moment then gently acknowledge.",
      },
      callbacks: {
        onopen: () => console.debug("Dost session live"),
        onmessage: (message: LiveServerMessage) => {
          if (message.serverContent?.modelTurn?.parts[0]?.inlineData?.data) {
            callbacks.onAudioChunk(message.serverContent.modelTurn.parts[0].inlineData.data);
          }
          if (message.serverContent?.interrupted) {
            callbacks.onInterrupted();
          }
          if (message.serverContent?.inputTranscription) {
            callbacks.onTranscription?.(message.serverContent.inputTranscription.text, true);
          }
          if (message.serverContent?.outputTranscription) {
            callbacks.onTranscription?.(message.serverContent.outputTranscription.text, false);
          }
          if (message.serverContent?.turnComplete) {
            callbacks.onTurnComplete?.();
          }
        },
        onclose: callbacks.onClose,
        onerror: callbacks.onError,
      }
    });
  }
}

export const dostService = new DostService();

export function decodeBase64(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

export function createPcmBlob(data: Float32Array): { data: string; mimeType: string } {
  const int16 = new Int16Array(data.length);
  for (let i = 0; i < data.length; i++) {
    int16[i] = data[i] * 32768;
  }
  
  // Custom manual base64 encoding to follow guidelines
  let binary = '';
  const bytes = new Uint8Array(int16.buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  
  return {
    data: btoa(binary),
    mimeType: 'audio/pcm;rate=16000',
  };
}
