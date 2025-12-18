
import React, { useState, useRef, useEffect } from 'react';
import { AppStatus, NarrationResult, VideoFrame } from './types';
import { analyzeVideo, generateSpeech } from './services/geminiService';
import { decode, decodeAudioData, createWavBlob } from './utils/audioUtils';

const Header: React.FC = () => (
  <header className="py-8 text-center">
    <h1 className="text-4xl md:text-6xl font-bold gradient-text tracking-tight mb-2">VisionNarrator Pro</h1>
    <p className="text-slate-400 text-lg">Narración Profesional Completa • Edición España</p>
  </header>
);

const ProgressBar: React.FC<{ status: AppStatus }> = ({ status }) => {
  const stages = [
    { id: AppStatus.SAMPLING, label: 'Capturando Vídeo' },
    { id: AppStatus.ANALYZING, label: 'IA Analizando Acción' },
    { id: AppStatus.NARRATING, label: 'Locución Profesional' }
  ];

  const getStatusClass = (stageId: AppStatus) => {
    const stageOrder = [AppStatus.SAMPLING, AppStatus.ANALYZING, AppStatus.NARRATING, AppStatus.COMPLETED];
    const currentIndex = stageOrder.indexOf(status);
    const stageIndex = stageOrder.indexOf(stageId);

    if (status === AppStatus.ERROR) return 'bg-red-500 opacity-50';
    if (stageIndex < currentIndex) return 'bg-sky-500 shadow-[0_0_10px_#38bdf8]';
    if (stageIndex === currentIndex) return 'bg-sky-500 animate-pulse';
    return 'bg-slate-700';
  };

  return (
    <div className="w-full max-w-2xl mx-auto mt-8 px-4">
      <div className="flex justify-between mb-2">
        {stages.map((stage) => (
          <span key={stage.id} className={`text-xs font-semibold uppercase ${status === stage.id ? 'text-sky-400' : 'text-slate-500'}`}>
            {stage.label}
          </span>
        ))}
      </div>
      <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden flex">
        {stages.map((stage) => (
          <div key={stage.id} className={`flex-1 h-full mx-0.5 transition-all duration-500 ${getStatusClass(stage.id)}`} />
        ))}
      </div>
    </div>
  );
};

export default function App() {
  const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [result, setResult] = useState<NarrationResult & { genreDetected?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [voice, setVoice] = useState('Kore');
  const [mode, setMode] = useState<'AUTO' | 'SPORTS' | 'NEWS'>('AUTO');
  const [targetDuration, setTargetDuration] = useState<string>('auto');
  
  // Audio state
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const activeSourceRef = useRef<AudioBufferSourceNode | null>(null);

  useEffect(() => {
    return () => {
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, []);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      resetAll();
      setVideoUrl(url);
    }
  };

  const resetAll = () => {
    stopAudio();
    setResult(null);
    setError(null);
    setStatus(AppStatus.IDLE);
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setVideoUrl(null);
  };

  const clearResults = () => {
    stopAudio();
    setResult(null);
    setError(null);
    setStatus(AppStatus.IDLE);
  };

  const sampleFrames = async (video: HTMLVideoElement): Promise<VideoFrame[]> => {
    return new Promise((resolve) => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const frames: VideoFrame[] = [];
      const frameCount = 20; 
      const duration = video.duration;
      let currentFrame = 0;

      video.currentTime = 0;

      const onSeeked = () => {
        if (ctx) {
          canvas.width = 640;
          canvas.height = (640 / video.videoWidth) * video.videoHeight;
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const base64 = canvas.toDataURL('image/jpeg', 0.6).split(',')[1];
          frames.push({ data: base64, mimeType: 'image/jpeg' });
        }

        currentFrame++;
        if (currentFrame < frameCount) {
          video.currentTime = (duration / (frameCount - 1)) * currentFrame;
        } else {
          video.removeEventListener('seeked', onSeeked);
          resolve(frames);
        }
      };

      video.addEventListener('seeked', onSeeked);
      setTimeout(() => { video.currentTime = 0.05; }, 100);
    });
  };

  const processVideo = async () => {
    if (!videoRef.current) return;
    
    try {
      setStatus(AppStatus.SAMPLING);
      const frames = await sampleFrames(videoRef.current);
      const videoDuration = videoRef.current.duration;
      
      setStatus(AppStatus.ANALYZING);
      
      const durationVal = targetDuration === 'auto' ? videoDuration : parseInt(targetDuration);
      const durationMinutes = Math.floor(durationVal / 60);
      const durationSeconds = Math.floor(durationVal % 60);
      const durationLabel = durationMinutes > 0 ? `${durationMinutes}m ${durationSeconds}s` : `${durationSeconds}s`;

      const durationInstruction = `Genera un GUION DETALLADO de locución que dure aproximadamente ${durationLabel}.`;

      const prompt = `Analiza este vídeo de ${videoDuration.toFixed(1)} segundos en profundidad. 
      MODO DE NARRACIÓN: ${mode === 'SPORTS' ? 'NARRADOR DEPORTIVO VIBRANTE' : mode === 'NEWS' ? 'PERIODISTA DE NOTICIAS' : 'DETECCIÓN AUTOMÁTICA'}.
      
      INSTRUCCIONES CRÍTICAS:
      1. ${durationInstruction} Cubre los momentos clave con una narrativa coherente para todo el tiempo solicitado.
      2. Utiliza EXCLUSIVAMENTE ESPAÑOL DE ESPAÑA (Castellano). 
      3. Si es deporte: imprime pasión, emoción, usa términos como "¡Ojo!", "¡Atención!", "¡Increíble!", describe la técnica, el esfuerzo de los deportistas y el desenlace. 
      4. Ajusta el ritmo del lenguaje para que encaje naturalmente en el tiempo solicitado.
      5. Si el vídeo es más corto que el tiempo solicitado, extiende la narrativa con análisis técnico o contexto. Si es más largo, condensa lo más importante.`;
      
      const { narration, analysis, genreDetected } = await analyzeVideo(frames, prompt);
      
      setStatus(AppStatus.NARRATING);
      const isSports = mode === 'SPORTS' || (mode === 'AUTO' && genreDetected?.toLowerCase().includes('deport'));
      const audioBase64 = await generateSpeech(narration, voice, isSports);
      
      setResult({
        text: narration,
        thinkingProcess: analysis,
        audioData: audioBase64,
        genreDetected
      });
      
      setStatus(AppStatus.COMPLETED);
      
      if (audioBase64) {
        startNewAudio(audioBase64);
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Error al procesar el vídeo. Inténtalo de nuevo.");
      setStatus(AppStatus.ERROR);
    }
  };

  const startNewAudio = async (base64: string) => {
    stopAudio();
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    }
    const ctx = audioContextRef.current;
    if (ctx.state === 'suspended') await ctx.resume();

    const bytes = decode(base64);
    const audioBuffer = await decodeAudioData(bytes, ctx, 24000, 1);
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);
    
    source.onended = () => {
      setIsPlaying(false);
      setIsPaused(false);
      activeSourceRef.current = null;
    };

    activeSourceRef.current = source;
    source.start(0);
    setIsPlaying(true);
    setIsPaused(false);
  };

  const togglePlayback = async () => {
    if (!audioContextRef.current) return;
    const ctx = audioContextRef.current;

    if (isPaused) {
      await ctx.resume();
      setIsPaused(false);
      setIsPlaying(true);
    } else if (isPlaying) {
      await ctx.suspend();
      setIsPaused(true);
      setIsPlaying(false);
    } else if (result?.audioData) {
      startNewAudio(result.audioData);
    }
  };

  const stopAudio = () => {
    if (activeSourceRef.current) {
      try {
        activeSourceRef.current.stop();
      } catch (e) {}
      activeSourceRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume();
    }
    setIsPlaying(false);
    setIsPaused(false);
  };

  const downloadAudio = () => {
    if (!result?.audioData) return;
    const bytes = decode(result.audioData);
    const wavBlob = createWavBlob(bytes, 24000);
    const url = URL.createObjectURL(wavBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `locucion_visionnarrator_${Date.now()}.wav`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen pb-20 px-4 max-w-6xl mx-auto">
      <Header />

      <main className="space-y-8">
        {/* Upload & Controls */}
        <section className="glass rounded-3xl p-6 md:p-10 flex flex-col items-center justify-center border-slate-700/50 hover:border-sky-500/30 transition-all group relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-sky-500 to-transparent opacity-30"></div>
          
          {!videoUrl ? (
            <label className="cursor-pointer flex flex-col items-center space-y-4 py-10">
              <div className="w-24 h-24 bg-sky-500/10 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform shadow-lg shadow-sky-500/5">
                <svg className="w-12 h-12 text-sky-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </div>
              <div className="text-center">
                <p className="text-2xl font-semibold text-slate-100 mb-1">Carga tu prueba o evento</p>
                <p className="text-slate-400">Analizaremos y locutaremos el vídeo a tu medida</p>
              </div>
              <input type="file" className="hidden" accept="video/*" onChange={handleFileUpload} />
            </label>
          ) : (
            <div className="w-full space-y-6">
              <div className="relative rounded-2xl overflow-hidden bg-black aspect-video max-w-4xl mx-auto shadow-[0_20px_50px_rgba(0,0,0,0.5)] border border-slate-800">
                <video ref={videoRef} src={videoUrl} controls className="w-full h-full" />
                <button 
                  onClick={resetAll} 
                  className="absolute top-4 right-4 bg-red-500/20 hover:bg-red-500 text-white p-2 rounded-full transition-all backdrop-blur-md z-10"
                  title="Borrar Vídeo y Reiniciar"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                </button>
              </div>

              <div className="flex flex-wrap items-center justify-center gap-4 bg-slate-900/40 p-4 rounded-2xl border border-white/5">
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] uppercase font-bold text-slate-500 ml-1">Estilo de Narración</label>
                  <select 
                    value={mode} 
                    onChange={(e) => setMode(e.target.value as any)}
                    className="bg-slate-800 border border-slate-700 rounded-xl px-4 py-2 text-sm text-slate-200 outline-none focus:ring-2 ring-sky-500/50"
                  >
                    <option value="AUTO">Detección Automática</option>
                    <option value="SPORTS">Deportes (Vibrante/Pasional)</option>
                    <option value="NEWS">Noticias/Docu (Serio/Claro)</option>
                  </select>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[10px] uppercase font-bold text-slate-500 ml-1">Tiempo de Locución</label>
                  <select 
                    value={targetDuration} 
                    onChange={(e) => setTargetDuration(e.target.value)}
                    className="bg-slate-800 border border-slate-700 rounded-xl px-4 py-2 text-sm text-slate-200 outline-none focus:ring-2 ring-sky-500/50"
                  >
                    <option value="auto">Auto (Vídeo Completo)</option>
                    <option value="30">30 segundos</option>
                    <option value="60">1 minuto</option>
                    <option value="120">2 minutos</option>
                    <option value="300">5 minutos</option>
                    <option value="600">10 minutos</option>
                    <option value="900">15 minutos (Máximo)</option>
                  </select>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[10px] uppercase font-bold text-slate-500 ml-1">Voz del Locutor</label>
                  <select 
                    value={voice} 
                    onChange={(e) => setVoice(e.target.value)}
                    className="bg-slate-800 border border-slate-700 rounded-xl px-4 py-2 text-sm text-slate-200 outline-none focus:ring-2 ring-sky-500/50"
                  >
                    <optgroup label="Mujeres (España)">
                      <option value="Kore">Kore (Profesional)</option>
                      <option value="Zephyr">Zephyr (Enérgica)</option>
                    </optgroup>
                    <optgroup label="Hombres (España)">
                      <option value="Puck">Puck (Juvenil)</option>
                      <option value="Charon">Charon (Narrador)</option>
                      <option value="Fenrir">Fenrir (Voz Grave/Potente)</option>
                    </optgroup>
                  </select>
                </div>
                
                <button 
                  disabled={status !== AppStatus.IDLE && status !== AppStatus.COMPLETED}
                  onClick={processVideo}
                  className="bg-sky-500 hover:bg-sky-400 disabled:opacity-50 disabled:cursor-not-allowed text-white px-10 py-3.5 rounded-xl font-bold shadow-xl shadow-sky-500/20 transition-all active:scale-95 flex items-center gap-2 mt-auto"
                >
                  {status === AppStatus.IDLE || status === AppStatus.COMPLETED ? (
                    <>
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                      {targetDuration === 'auto' ? 'Locutar Vídeo' : `Generar ${Math.floor(parseInt(targetDuration)/60) > 0 ? Math.floor(parseInt(targetDuration)/60)+'m' : parseInt(targetDuration)+'s'}`}
                    </>
                  ) : 'Analizando cada detalle...'}
                </button>
              </div>
            </div>
          )}
        </section>

        {status !== AppStatus.IDLE && status !== AppStatus.COMPLETED && <ProgressBar status={status} />}
        
        {error && (
          <div className="max-w-2xl mx-auto bg-red-500/10 border border-red-500/20 p-4 rounded-xl text-red-400 text-center animate-bounce">
            {error}
          </div>
        )}

        {/* Results */}
        {result && (
          <div className="grid lg:grid-cols-5 gap-8 animate-in fade-in slide-in-from-bottom-8 duration-700">
            <div className="lg:col-span-2 glass rounded-3xl p-8 space-y-4 border border-white/5">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-sky-500/10 rounded-lg">
                  <svg className="w-5 h-5 text-sky-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
                </div>
                <div className="flex-1">
                  <h3 className="text-xl font-bold text-slate-100">Acción Detectada</h3>
                  <p className="text-slate-500 text-xs uppercase tracking-wider font-semibold">Razonamiento IA</p>
                </div>
                <button onClick={clearResults} className="p-2 hover:bg-white/10 rounded-lg text-slate-500 hover:text-red-400 transition-colors" title="Limpiar resultados">
                   <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                </button>
              </div>
              <div className="bg-slate-950/40 rounded-2xl p-6 text-slate-300 leading-relaxed text-sm max-h-[500px] overflow-y-auto scrollbar-thin scrollbar-thumb-slate-700 border border-white/5">
                <div className="mb-4 flex flex-wrap gap-2">
                  <div className="px-3 py-1 bg-sky-500/20 text-sky-400 rounded-full text-[10px] font-bold uppercase">
                    Género: {result.genreDetected || 'General'}
                  </div>
                  <div className="px-3 py-1 bg-slate-700/50 text-slate-300 rounded-full text-[10px] font-bold uppercase">
                    Config: {targetDuration === 'auto' ? 'Adaptativo' : `${targetDuration}s`}
                  </div>
                </div>
                <div className="whitespace-pre-wrap">{result.thinkingProcess}</div>
              </div>
            </div>

            <div className="lg:col-span-3 glass rounded-3xl p-8 space-y-6 border-l-4 border-sky-500/50 shadow-2xl relative overflow-hidden">
              <div className="absolute top-0 right-0 p-10 opacity-[0.03] pointer-events-none">
                <svg className="w-40 h-40 text-sky-400" fill="currentColor" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-1 2l5 5h-5V4zM6 20V4h5v7h7v9H6z" /></svg>
              </div>
              
              <div className="flex flex-wrap items-center justify-between relative z-10 gap-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-sky-500/10 rounded-lg">
                    <svg className="w-5 h-5 text-sky-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
                  </div>
                  <div>
                    <h3 className="text-2xl font-black text-slate-100 italic tracking-tight uppercase">Locución Final</h3>
                    <p className="text-slate-500 text-xs font-medium">Controles de reproducción</p>
                  </div>
                </div>
                
                <div className="flex items-center gap-2 bg-slate-800/80 p-2 rounded-2xl border border-white/5 backdrop-blur-sm">
                  {result.audioData && (
                    <>
                      <button 
                        onClick={togglePlayback}
                        className={`p-3 rounded-xl transition-all shadow-lg active:scale-90 flex items-center gap-2 ${isPaused ? 'bg-amber-500 text-white' : isPlaying ? 'bg-sky-500 text-white animate-pulse' : 'bg-sky-600 text-white hover:bg-sky-500'}`}
                        title={isPlaying ? 'Pausar' : 'Reproducir'}
                      >
                        {isPlaying && !isPaused ? (
                          <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>
                        ) : (
                          <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                        )}
                      </button>
                      
                      <button 
                        onClick={stopAudio}
                        className="p-3 bg-slate-700 text-white rounded-xl hover:bg-red-500 transition-all shadow-lg active:scale-90"
                        title="Parar"
                      >
                        <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M6 6h12v12H6z" /></svg>
                      </button>
                      
                      <div className="w-px h-6 bg-slate-600 mx-1"></div>

                      <button 
                        onClick={downloadAudio}
                        className="p-3 bg-slate-700 text-white rounded-xl hover:bg-slate-600 transition-all shadow-lg active:scale-90"
                        title="Descargar (.wav)"
                      >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                      </button>
                    </>
                  )}
                </div>
              </div>
              
              <div className="bg-slate-900/60 rounded-3xl p-8 border border-white/5 relative z-10">
                <blockquote className="text-2xl font-serif text-slate-50 leading-relaxed italic opacity-90 first-letter:text-5xl first-letter:font-bold first-letter:text-sky-400 first-letter:mr-3 first-letter:float-left">
                  {result.text}
                </blockquote>
              </div>
            </div>
          </div>
        )}
      </main>

      <footer className="fixed bottom-0 left-0 right-0 py-4 glass text-center text-[10px] text-slate-500 border-t border-slate-800 z-50 uppercase tracking-widest font-bold">
        Engineered with Gemini 3 Pro Vision • Locución Profesional con Controles Completos
      </footer>
    </div>
  );
}
