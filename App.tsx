
import React, { useState, useRef, useEffect } from 'react';
import { AppStatus, NarrationResult, VideoFrame } from './types';
import { analyzeVideo, generateSpeech } from './services/geminiService';
import { decode, decodeAudioData, createWavBlob } from './utils/audioUtils';

const Header: React.FC = () => (
  <header className="py-6 text-center drag-region">
    <div className="flex items-center justify-center gap-2 mb-1">
      <div className="w-8 h-8 bg-sky-500 rounded-lg flex items-center justify-center shadow-lg shadow-sky-500/20">
        <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
      </div>
      <h1 className="text-3xl font-bold gradient-text tracking-tighter">VisionNarrator Pro</h1>
    </div>
    <p className="text-slate-400 text-[10px] uppercase tracking-[0.2em] font-black">Desktop Edition v1.0</p>
  </header>
);

const ProgressBar: React.FC<{ status: AppStatus }> = ({ status }) => {
  const stageOrder = [AppStatus.SAMPLING, AppStatus.ANALYZING, AppStatus.NARRATING, AppStatus.COMPLETED];
  const currentIndex = stageOrder.indexOf(status);
  
  const stages = [
    { label: 'Vídeo' },
    { label: 'Acción' },
    { label: 'Voz' }
  ];

  return (
    <div className="w-full max-w-md mx-auto mb-8">
      <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden flex gap-1 px-1 py-0.5">
        {stages.map((_, idx) => (
          <div 
            key={idx} 
            className={`flex-1 h-full rounded-full transition-all duration-700 ${
              idx < currentIndex ? 'bg-sky-500' : 
              idx === currentIndex ? 'bg-sky-400 animate-pulse' : 'bg-slate-700'
            }`} 
          />
        ))}
      </div>
      <div className="flex justify-between mt-2">
        {stages.map((s, idx) => (
          <span key={idx} className={`text-[9px] font-bold uppercase tracking-widest ${idx === currentIndex ? 'text-sky-400' : 'text-slate-600'}`}>
            {s.label}
          </span>
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
  const [isPlaying, setIsPlaying] = useState(false);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const activeSourceRef = useRef<AudioBufferSourceNode | null>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      setVideoUrl(URL.createObjectURL(file));
      setResult(null);
      setStatus(AppStatus.IDLE);
    }
  };

  const processVideo = async () => {
    if (!videoRef.current) return;
    try {
      setStatus(AppStatus.SAMPLING);
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const frames: VideoFrame[] = [];
      const frameCount = 15;
      const duration = videoRef.current.duration;

      for (let i = 0; i < frameCount; i++) {
        videoRef.current.currentTime = (duration / (frameCount - 1)) * i;
        await new Promise(r => setTimeout(r, 150));
        if (ctx) {
          canvas.width = 640;
          canvas.height = (640 / videoRef.current.videoWidth) * videoRef.current.videoHeight;
          ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
          frames.push({ data: canvas.toDataURL('image/jpeg', 0.6).split(',')[1], mimeType: 'image/jpeg' });
        }
      }

      setStatus(AppStatus.ANALYZING);
      const prompt = `Analiza este vídeo. Estilo: ${mode}. Duración objetivo: ${targetDuration} segundos. ESPAÑOL DE ESPAÑA.`;
      const { narration, analysis, genreDetected } = await analyzeVideo(frames, prompt);
      
      setStatus(AppStatus.NARRATING);
      const isSports = mode === 'SPORTS' || genreDetected?.toLowerCase().includes('deport');
      const audioBase64 = await generateSpeech(narration, voice, isSports);
      
      setResult({ text: narration, thinkingProcess: analysis, audioData: audioBase64, genreDetected });
      setStatus(AppStatus.COMPLETED);
      if (audioBase64) playAudio(audioBase64);
    } catch (err: any) {
      setError("Error en el proceso. Revisa tu conexión.");
      setStatus(AppStatus.ERROR);
    }
  };

  const playAudio = async (base64: string) => {
    if (activeSourceRef.current) activeSourceRef.current.stop();
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    }
    const ctx = audioContextRef.current;
    const audioBuffer = await decodeAudioData(decode(base64), ctx, 24000, 1);
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);
    source.onended = () => setIsPlaying(false);
    activeSourceRef.current = source;
    source.start(0);
    setIsPlaying(true);
  };

  return (
    <div className="min-h-screen bg-[#0f172a] text-slate-200 select-none overflow-x-hidden">
      <Header />
      
      <main className="max-w-4xl mx-auto p-4 space-y-6">
        {/* Video Port */}
        <div className="glass rounded-3xl overflow-hidden shadow-2xl border border-white/5 bg-black/40">
          {!videoUrl ? (
            <label className="flex flex-col items-center justify-center h-64 cursor-pointer hover:bg-white/5 transition-all">
              <div className="w-16 h-16 bg-sky-500/10 rounded-full flex items-center justify-center mb-4">
                <svg className="w-8 h-8 text-sky-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" /></svg>
              </div>
              <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">Arrastra o haz clic para subir vídeo</p>
              <input type="file" className="hidden" accept="video/*" onChange={handleFileUpload} />
            </label>
          ) : (
            <div className="relative group">
              <video ref={videoRef} src={videoUrl} controls className="w-full aspect-video" />
              <button onClick={() => setVideoUrl(null)} className="absolute top-4 right-4 p-2 bg-red-500/20 hover:bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-all">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
          )}
        </div>

        {/* Configuration Panel */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-slate-800/50 p-4 rounded-2xl border border-white/5">
            <label className="text-[10px] font-black uppercase text-slate-500 mb-2 block tracking-widest">Modo</label>
            <select value={mode} onChange={(e) => setMode(e.target.value as any)} className="w-full bg-slate-900 border-none rounded-xl text-xs py-2 px-3 outline-none ring-1 ring-white/10 focus:ring-sky-500/50">
              <option value="AUTO">Automático</option>
              <option value="SPORTS">Deportes</option>
              <option value="NEWS">Noticias</option>
            </select>
          </div>
          <div className="bg-slate-800/50 p-4 rounded-2xl border border-white/5">
            <label className="text-[10px] font-black uppercase text-slate-500 mb-2 block tracking-widest">Locutor</label>
            <select value={voice} onChange={(e) => setVoice(e.target.value)} className="w-full bg-slate-900 border-none rounded-xl text-xs py-2 px-3 outline-none ring-1 ring-white/10 focus:ring-sky-500/50">
              <option value="Kore">Kore (Mujer)</option>
              <option value="Puck">Puck (Hombre)</option>
              <option value="Charon">Charon (Grave)</option>
            </select>
          </div>
          <button 
            disabled={status !== AppStatus.IDLE && status !== AppStatus.COMPLETED} 
            onClick={processVideo}
            className="bg-sky-500 hover:bg-sky-400 disabled:opacity-30 text-white font-black rounded-2xl text-[10px] uppercase tracking-widest shadow-lg shadow-sky-500/20 transition-all active:scale-95"
          >
            {status === AppStatus.IDLE || status === AppStatus.COMPLETED ? 'Iniciar Narrativa' : 'Analizando...'}
          </button>
        </div>

        {status !== AppStatus.IDLE && status !== AppStatus.COMPLETED && <ProgressBar status={status} />}

        {result && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 animate-in fade-in slide-in-from-bottom-4">
            <div className="bg-slate-900/60 p-6 rounded-3xl border border-white/5 space-y-4">
              <h4 className="text-[10px] font-black uppercase text-sky-400 tracking-widest">Texto de Locución</h4>
              <p className="text-sm italic text-slate-300 leading-relaxed border-l-2 border-sky-500/20 pl-4">{result.text}</p>
              <div className="flex gap-2">
                <button onClick={() => playAudio(result.audioData!)} className="flex-1 bg-slate-800 py-2 rounded-xl text-[10px] font-bold uppercase hover:bg-slate-700 transition-all">Reproducir</button>
                <button 
                  onClick={() => {
                    const blob = createWavBlob(decode(result.audioData!), 24000);
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = "narracion.wav";
                    a.click();
                  }}
                  className="px-4 bg-slate-800 py-2 rounded-xl text-[10px] font-bold uppercase hover:bg-slate-700 transition-all"
                >
                  Descargar
                </button>
              </div>
            </div>
            <div className="bg-slate-800/30 p-6 rounded-3xl border border-white/5 space-y-4">
              <h4 className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Análisis del Evento</h4>
              <div className="text-[11px] text-slate-400 whitespace-pre-wrap max-h-48 overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-slate-700">
                {result.thinkingProcess}
              </div>
            </div>
          </div>
        )}
      </main>
      
      <footer className="py-8 text-center opacity-30">
        <p className="text-[9px] font-bold uppercase tracking-[0.4em]">Powered by Google Gemini 3 Pro</p>
      </footer>
    </div>
  );
}
