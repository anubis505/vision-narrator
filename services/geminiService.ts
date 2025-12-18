
import { GoogleGenAI, Modality, Type } from "@google/genai";
import { VideoFrame } from "../types";

const API_KEY = process.env.API_KEY || "";

export const analyzeVideo = async (frames: VideoFrame[], prompt: string) => {
  const ai = new GoogleGenAI({ apiKey: API_KEY });
  
  const contents = {
    parts: [
      ...frames.map(f => ({
        inlineData: {
          data: f.data,
          mimeType: f.mimeType
        }
      })),
      { text: prompt }
    ]
  };

  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: contents,
    config: {
      thinkingConfig: { thinkingBudget: 32768 },
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          narration: { type: Type.STRING, description: "El guion completo de la locución para todo el vídeo." },
          analysis: { type: Type.STRING, description: "Análisis detallado de la acción minuto a minuto." },
          genreDetected: { type: Type.STRING, description: "Género detectado (Deportes, Noticias, etc.)" }
        },
        required: ["narration", "analysis", "genreDetected"]
      }
    },
  });

  return JSON.parse(response.text);
};

export const generateSpeech = async (text: string, voice: string = 'Kore', isSports: boolean = false) => {
  const ai = new GoogleGenAI({ apiKey: API_KEY });
  
  // Refined prompt for TTS to match the energy of the genre
  const styleInstruction = isSports 
    ? "Locuta este guion con la ENERGÍA Y PASIÓN de un narrador deportivo de élite de España (estilo Radio o TV). Ritmo rápido, vibrante y emocionante."
    : "Locuta este texto con un tono profesional, pausado y claro, típico de un presentador de noticias de España.";

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-tts",
    contents: [{ parts: [{ text: `${styleInstruction}\n\nTexto: ${text}` }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: voice },
        },
      },
    },
  });

  const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  return base64Audio;
};
