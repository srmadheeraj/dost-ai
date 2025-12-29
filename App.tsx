
import React, { useState, useRef, useEffect } from 'react';
import { dostService, decodeBase64, decodeAudioData, createPcmBlob } from './services/geminiService';
import { MOODS } from './constants';
import { Mood } from './types';
import { MoodSelector } from './components/MoodSelector';

const App: React.FC = () => {
  const [status, setStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [transcription, setTranscription] = useState<{ text: string; isUser: boolean; timestamp: Date }[]>([]);
  const [currentMood, setCurrentMood] = useState<Mood | null>(null);

  const audioContextIn = useRef<AudioContext | null>(null);
  const audioContextOut = useRef<AudioContext | null>(null);
  const nextStartTime = useRef<number>(0);
  const sources = useRef<Set<AudioBufferSourceNode>>(new Set());
  const sessionPromise = useRef<Promise<any> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const mainScrollRef = useRef<HTMLDivElement>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);

  // Auto-scroll transcription drawer
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcription, isHistoryOpen]);

  // Desktop/Laptop responsive sidebar logic
  useEffect(() => {
    const checkViewport = () => {
      if (window.innerWidth >= 1280) setIsHistoryOpen(true);
      else setIsHistoryOpen(false);
    };
    checkViewport();
    window.addEventListener('resize', checkViewport);
    return () => window.removeEventListener('resize', checkViewport);
  }, []);

  const endCall = async () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }

    sources.current.forEach(s => {
      try { s.stop(); } catch (e) {}
    });
    sources.current.clear();

    if (audioContextIn.current && audioContextIn.current.state !== 'closed') {
      try { await audioContextIn.current.close(); } catch (e) {}
    }
    audioContextIn.current = null;

    if (audioContextOut.current && audioContextOut.current.state !== 'closed') {
      try { await audioContextOut.current.close(); } catch (e) {}
    }
    audioContextOut.current = null;

    if (sessionPromise.current) {
      const session = await sessionPromise.current;
      try { session.close(); } catch (e) {}
      sessionPromise.current = null;
    }

    setStatus('idle');
    setIsSpeaking(false);
    nextStartTime.current = 0;
  };

  const handleConnectionError = (err: any) => {
    console.error("Dost Connection Error:", err);
    let msg = err?.message || String(err);
    
    // Check for specific API Key / Project errors
    if (msg.includes("Requested entity was not found") || msg.includes("API key")) {
      msg = "API Key error. Please click the button below to select a valid key.";
      if ((window as any).aistudio) {
        (window as any).aistudio.openSelectKey();
      }
    } else if (msg.includes("Network error") || msg.includes("Failed to fetch")) {
      msg = "Network error. Please check your internet or API key settings.";
    }

    setErrorMessage(msg);
    setStatus('error');
    endCall();
  };

  const startCall = async () => {
    setStatus('connecting');
    setErrorMessage('');

    // Handle key selection requirement for certain environments (like AI Studio/Vercel previews)
    const aistudio = (window as any).aistudio;
    if (aistudio) {
      const hasKey = await aistudio.hasSelectedApiKey();
      if (!hasKey) {
        await aistudio.openSelectKey();
        // Assume success after trigger as per guidelines
      }
    }

    try {
      // 1. Microphone Access
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      
      const AudioContextClass = (window.AudioContext || (window as any).webkitAudioContext);
      audioContextIn.current = new AudioContextClass({ sampleRate: 16000 });
      audioContextOut.current = new AudioContextClass({ sampleRate: 24000 });

      // 2. Connect to Gemini Live
      const session = dostService.connectVoice({
        onAudioChunk: async (base64) => {
          if (!audioContextOut.current || audioContextOut.current.state === 'closed') return;
          setIsSpeaking(true);
          try {
            const audioBuffer = await decodeAudioData(decodeBase64(base64), audioContextOut.current, 24000, 1);
            const source = audioContextOut.current.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(audioContextOut.current.destination);
            
            // Sync playback timing
            nextStartTime.current = Math.max(nextStartTime.current, audioContextOut.current.currentTime);
            source.start(nextStartTime.current);
            nextStartTime.current += audioBuffer.duration;
            
            sources.current.add(source);
            source.onended = () => {
              sources.current.delete(source);
              if (sources.current.size === 0) setIsSpeaking(false);
            };
          } catch (e) {
            console.error("Audio playback error:", e);
          }
        },
        onInterrupted: () => {
          sources.current.forEach(s => { try { s.stop(); } catch(e){} });
          sources.current.clear();
          nextStartTime.current = 0;
          setIsSpeaking(false);
        },
        onTranscription: (text, isUser) => {
          setTranscription(prev => [...prev, { text, isUser, timestamp: new Date() }]);
        },
        onClose: () => {
          if (status !== 'idle') endCall();
        },
        onError: handleConnectionError
      });

      sessionPromise.current = session;
      await session; // Wait for session to be fully resolved
      setStatus('connected');

      // 3. Audio Processing Node
      const micSource = audioContextIn.current.createMediaStreamSource(stream);
      const processor = audioContextIn.current.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;
      
      processor.onaudioprocess = (e) => {
        if (!sessionPromise.current) return;
        const inputData = e.inputBuffer.getChannelData(0);
        const pcmBlob = createPcmBlob(inputData);
        
        // Critical: Send input only after session resolves
        sessionPromise.current.then(s => {
          try { 
            s.sendRealtimeInput({ media: pcmBlob }); 
          } catch (err) {
            console.error("Failed to send audio input:", err);
          }
        });
      };
      
      micSource.connect(processor);
      processor.connect(audioContextIn.current.destination);

    } catch (err) {
      handleConnectionError(err);
    }
  };

  return (
    <div className="flex h-screen w-full bg-[#0f1115] overflow-hidden text-[#e5e7eb] select-none">
      
      {/* SIDEBAR: Archives */}
      <aside className={`
        fixed inset-0 z-[100] xl:relative xl:inset-auto
        w-full xl:w-[400px] 
        bg-[#0f1115]/98 xl:bg-black/40 
        backdrop-blur-3xl 
        border-r border-white/5 
        transition-all duration-700 cubic-bezier(0.4, 0, 0.2, 1)
        ${isHistoryOpen ? 'translate-x-0 opacity-100' : '-translate-x-full xl:-ml-[400px] opacity-0 pointer-events-none'}
      `}>
        <div className="h-full flex flex-col p-6 lg:p-10 safe-pt safe-pb">
          <div className="flex justify-between items-center mb-10">
            <div>
              <h2 className="serif text-2xl lg:text-3xl font-bold text-white tracking-tight">Archives</h2>
              <p className="text-[9px] text-amber-500/60 uppercase tracking-[0.3em] font-black mt-2">Dost Memoirs</p>
            </div>
            <button 
              onClick={() => setIsHistoryOpen(false)}
              className="xl:hidden bg-white/5 border border-white/10 w-10 h-10 flex items-center justify-center rounded-xl text-amber-500 active:scale-95 transition-all"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-5 h-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          
          <div className="flex-1 overflow-y-auto pr-2 space-y-6 scroll-smooth" ref={scrollRef}>
            {transcription.length === 0 ? (
              <div className="h-full flex items-center justify-center text-center opacity-30 px-6">
                <p className="text-sm italic font-medium leading-relaxed">
                  "Koi memory nahi hai abhi tak. Kuch bolo toh sahi, yaar."
                </p>
              </div>
            ) : (
              transcription.map((t, i) => (
                <div key={i} className={`flex flex-col ${t.isUser ? 'items-end' : 'items-start animate-in fade-in slide-in-from-bottom-2'}`}>
                  <span className={`text-[8px] uppercase tracking-widest font-black mb-1.5 ${t.isUser ? 'text-amber-500' : 'text-blue-400 opacity-60'}`}>
                    {t.isUser ? 'You' : 'Dost'}
                  </span>
                  <div className={`max-w-[90%] px-4 py-3 rounded-2xl text-xs sm:text-sm leading-relaxed shadow-xl ${
                    t.isUser ? 'bg-amber-500 text-black font-semibold' : 'bg-white/5 border border-white/10 text-gray-300'
                  }`}>
                    {t.text}
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="pt-6 border-t border-white/5 opacity-20 text-center">
             <p className="text-[8px] uppercase tracking-widest font-black">Private & Secure</p>
          </div>
        </div>
      </aside>

      {/* MAIN CONTENT AREA */}
      <main className="flex-1 flex flex-col relative min-w-0 h-full overflow-hidden">
        
        {/* Fixed Header */}
        <header className="shrink-0 w-full px-6 lg:px-12 py-6 lg:py-8 flex justify-between items-center bg-transparent z-50 safe-pt">
          <div className="flex flex-col">
            <h1 className="serif text-3xl lg:text-4xl font-black text-white leading-none tracking-tighter">Dost</h1>
            <p className="text-[9px] lg:text-[10px] text-amber-500 uppercase tracking-[0.4em] font-black mt-2 opacity-90">Your Best Friend</p>
          </div>
          
          {!isHistoryOpen && (
            <button 
              onClick={() => setIsHistoryOpen(true)}
              className="w-10 h-10 lg:w-12 lg:h-12 flex items-center justify-center rounded-xl bg-white/5 border border-white/10 text-white/60 hover:text-white transition-all active:scale-95 shadow-2xl group"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5 lg:w-6 lg:h-6 group-hover:scale-110 transition-transform">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
              </svg>
            </button>
          )}
        </header>

        {/* Responsive Content Container */}
        <div 
          ref={mainScrollRef}
          className="flex-1 overflow-y-auto relative no-scrollbar"
        >
          <div className="min-h-full w-full flex flex-col items-center justify-start sm:justify-center pt-4 pb-20 px-6 lg:px-20 relative">
            
            {status === 'idle' || status === 'error' ? (
              <div className="w-full max-w-2xl flex flex-col items-center text-center space-y-8 lg:space-y-12 animate-in fade-in duration-700">
                <div className="relative">
                  <div className={`absolute inset-0 rounded-full ${status === 'error' ? 'bg-red-500/5' : 'bg-amber-500/10'} animate-pulse-slow blur-[60px]`}></div>
                  <div className={`relative w-40 h-40 lg:w-56 lg:h-56 bg-white/5 rounded-full flex items-center justify-center border ${status === 'error' ? 'border-red-500/30' : 'border-white/10'} shadow-[0_40px_80px_rgba(0,0,0,0.4)]`}>
                     <span className="text-6xl lg:text-8xl orb-glow">
                      {status === 'error' ? '⚠️' : '🫂'}
                     </span>
                  </div>
                </div>
                
                <div className="space-y-4 px-2">
                  <h2 className="serif text-3xl lg:text-6xl font-bold text-white tracking-tight leading-tight">
                    {status === 'error' ? 'Oops, check connection' : 'Baat karein?'}
                  </h2>
                  <p className="text-gray-400 text-sm lg:text-lg max-w-md mx-auto italic font-medium opacity-70 leading-relaxed px-4">
                    {status === 'error' 
                      ? errorMessage
                      : 'Main yahin hoon. Share what’s on your mind—tension mat le, main sab samajh lunga.'}
                  </p>
                </div>

                {(status === 'idle' || !errorMessage.includes('API key')) && (
                  <div className="w-full flex flex-col items-center">
                    <p className="text-[10px] uppercase tracking-[0.3em] font-black text-amber-500/40 mb-5">Current Mood</p>
                    <MoodSelector onSelect={setCurrentMood} selectedMood={currentMood} />
                  </div>
                )}

                <div className="w-full max-w-sm px-6">
                  <button 
                    onClick={startCall}
                    className="w-full bg-white text-black hover:bg-amber-500 hover:scale-[1.02] transition-all duration-300 py-5 lg:py-6 rounded-2xl font-black text-[11px] lg:text-xs uppercase tracking-[0.4em] shadow-[0_20px_40px_rgba(0,0,0,0.4)] active:scale-95 flex items-center justify-center gap-3"
                  >
                    {status === 'error' ? (errorMessage.includes('key') ? 'Select API Key' : 'Retry Connection') : 'Enter Sanctuary'}
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 lg:w-5 lg:h-5">
                      <path fillRule="evenodd" d="M16.72 7.72a.75.75 0 0 1 1.06 0l3.75 3.75a.75.75 0 0 1 0 1.06l-3.75 3.75a.75.75 0 1 1-1.06-1.06l2.47-2.47H3a.75.75 0 0 1 0-1.5h16.19l-2.47-2.47a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
                    </svg>
                  </button>
                  <p className="text-[8px] text-gray-500 uppercase tracking-widest mt-6 font-medium">Click to start voice interaction</p>
                </div>
              </div>
            ) : (
              <div className="w-full max-w-4xl flex flex-col items-center justify-center space-y-12 lg:space-y-16 animate-in fade-in duration-500 py-10">
                <div className="relative flex items-center justify-center">
                  <div className={`absolute -inset-20 lg:-inset-40 rounded-full bg-amber-500/10 transition-all duration-1000 blur-[80px] ${isSpeaking ? 'scale-125 opacity-100' : 'scale-100 opacity-30'}`}></div>
                  <div className={`absolute -inset-1 rounded-full border border-amber-500/20 transition-all duration-1000 ${status === 'connected' ? 'animate-ping' : 'opacity-0'}`}></div>
                  
                  <div className={`
                    relative w-56 h-56 lg:w-72 lg:h-72 
                    bg-[#0d0f13] rounded-full 
                    flex items-center justify-center 
                    shadow-[0_40px_80px_rgba(0,0,0,0.6)] border border-white/10 
                    transition-all duration-500 
                    ${isSpeaking ? 'scale-105 border-amber-500/30 shadow-[0_0_50px_rgba(245,158,11,0.2)]' : 'scale-100'}
                  `}>
                    <div className="flex items-end gap-1.5 lg:gap-2 h-12 lg:h-20">
                      {[...Array(9)].map((_, i) => (
                        <div 
                          key={i} 
                          className={`w-1 lg:w-1.5 rounded-full transition-all duration-150 ${isSpeaking ? 'bg-amber-500' : 'bg-white/10'}`} 
                          style={{ 
                            height: isSpeaking ? `${20 + Math.random() * 80}%` : '6px',
                          }}
                        ></div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="text-center space-y-4 px-6">
                  <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10">
                     <div className={`w-1.5 h-1.5 rounded-full ${status === 'connected' ? 'bg-green-500 animate-pulse' : 'bg-amber-400'}`}></div>
                     <span className="text-[9px] uppercase tracking-[0.3em] font-black text-gray-400">
                        Sanctuary Active
                     </span>
                  </div>
                  <h2 className="serif text-2xl lg:text-6xl font-bold text-white tracking-tight">
                    {status === 'connecting' ? 'Connecting...' : isSpeaking ? 'Listening to Dost...' : 'Bolte raho, main sun raha hoon'}
                  </h2>
                </div>

                <div className="w-full max-w-xs px-6">
                   <button 
                      onClick={endCall}
                      className="w-full bg-white/5 hover:bg-red-500/10 hover:text-red-500 hover:border-red-500/30 text-gray-500 py-5 lg:py-6 rounded-2xl font-black text-[9px] lg:text-[10px] uppercase tracking-[0.4em] border border-white/10 transition-all duration-300 active:scale-95 flex items-center justify-center gap-3 group"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 transition-transform group-hover:rotate-90">
                         <path fillRule="evenodd" d="M5.47 5.47a.75.75 0 0 1 1.06 0L12 10.94l5.47-5.47a.75.75 0 1 1 1.06 1.06L13.06 12l5.47 5.47a.75.75 0 1 1-1.06 1.06L12 13.06l-5.47 5.47a.75.75 0 1 1-1.06-1.06L10.94 12 5.47 6.53a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
                      </svg>
                      End Connection
                    </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Global Footer info */}
        <footer className="shrink-0 px-8 py-6 flex justify-between items-center opacity-20 safe-pb">
          <p className="text-[8px] uppercase tracking-[0.4em] font-black">Dost Companion</p>
          <div className="flex gap-6">
             <span className="text-[8px] uppercase tracking-widest font-black italic">Hinglish Mode</span>
             <span className="text-[8px] uppercase tracking-widest font-black">Encrypted</span>
          </div>
        </footer>
      </main>

      <style>{`
        .no-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .no-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>
    </div>
  );
};

export default App;
