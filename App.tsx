import React, { useState, useCallback, useRef, useEffect } from 'react';
import { AudioSegment, SegmentStatus, VOICES, ProjectState } from './types';
import { generateSpeechSegment, createWavUrl } from './services/geminiService';
import SegmentList from './components/SegmentList';
import { Split, PlayCircle, Loader2, Trash2, StopCircle, FileAudio, RotateCcw, Plus, X, FolderOpen, Edit2, Volume2, Square, RefreshCw, Settings, Key, Save, AlertCircle } from 'lucide-react';

// Fix for "Cannot set property fetch of #<Window> which has only a getter"
// This happens when some polyfills try to overwrite the read-only window.fetch
if (typeof window !== 'undefined') {
  const originalFetch = window.fetch;
  try {
    // Try to define a dummy global object if it doesn't exist to redirect polyfill assignments
    if (!(window as any).global) (window as any).global = window;
    
    // If we are in an environment where fetch is read-only, we can't do much about the assignment itself
    // but we can try to prevent the error by making the property configurable if possible, 
    // or just ensuring our code uses the original one.
  } catch (e) {
    console.warn("Could not protect fetch property:", e);
  }
}

// Maximum characters per chunk (approx 2 minutes of speech)
// Larger chunks allow for more continuous narration but require stable model performance
const MAX_CHUNK_LENGTH = 1800;

// Simple, robust ID generator that works in all contexts
const generateId = () => Date.now().toString(36) + Math.random().toString(36).substring(2);

const STYLE_PRESETS = [
  { label: 'Romantic', text: 'Say it romantically.' },
  { label: 'Sylheti', text: 'Speak with a Sylheti accent.' },
  { label: 'News Anchor', text: 'Speak like a professional news anchor.' },
  { label: 'Storyteller', text: 'Speak like an engaging storyteller.' },
  { label: 'Sad', text: 'Speak in a sad tone.' },
  { label: 'Excited', text: 'Speak with excitement.' },
];

interface AppState {
  inputText: string;
  styleInstruction: string;
  segments: AudioSegment[];
  isProcessing: boolean;
  isExporting: boolean;
  hasExported: boolean;
  selectedVoice: string;
  exportFilename: string;
  progress: { current: number; total: number };
}

function App() {
  // State for the application
  const [state, setState] = useState<AppState>({
    inputText: '',
    styleInstruction: 'Say it romantically.',
    segments: [],
    isProcessing: false,
    isExporting: false,
    hasExported: false,
    selectedVoice: 'Sulafat',
    exportFilename: "",
    progress: { current: 0, total: 0 },
  });

  // Preview state
  const [previewAudio, setPreviewAudio] = useState<HTMLAudioElement | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);

  // Refs for managing independent processing loops
  const stopSignalRef = useRef<boolean>(false);

  // API Key Settings State
  const [showSettings, setShowSettings] = useState(false);
  const [tempApiKey, setTempApiKey] = useState(localStorage.getItem('GEMINI_API_KEY') || '');
  const [isKeySaved, setIsKeySaved] = useState(!!localStorage.getItem('GEMINI_API_KEY'));

  const handleSaveApiKey = () => {
    if (tempApiKey.trim()) {
      localStorage.setItem('GEMINI_API_KEY', tempApiKey.trim());
      setIsKeySaved(true);
      setShowSettings(false);
      // Force a reload of the Gemini client by just letting the next request use the new key
    } else {
      localStorage.removeItem('GEMINI_API_KEY');
      setIsKeySaved(false);
      alert("API Key removed. The app will now use the default environment key if available.");
    }
  };

  // Cleanup preview audio on unmount
  useEffect(() => {
    return () => {
      if (previewAudio) {
        previewAudio.pause();
        previewAudio.src = "";
      }
    };
  }, [previewAudio]);

  // Helper to update state
  const updateState = (updates: Partial<AppState> | ((prev: AppState) => Partial<AppState>)) => {
    setState(prev => {
      const newValues = typeof updates === 'function' ? updates(prev) : updates;
      return { ...prev, ...newValues };
    });
  };

  // --- PREVIEW HANDLER ---
  const handlePreviewVoice = async () => {
    // If currently playing, stop it
    if (previewAudio) {
      previewAudio.pause();
      previewAudio.src = "";
      setPreviewAudio(null);
      return;
    }

    setIsPreviewLoading(true);
    try {
      // Use a fixed Bengali phrase for the preview to judge quality accurately
      // "Hello, I am your selected voice."
      const previewText = "হ্যালো, আমি আপনার নির্বাচিত ভয়েস।";
      console.log(`Generating preview for voice: ${state.selectedVoice}`);
      
      const url = await generateSpeechSegment(
        previewText, 
        state.selectedVoice, 
        state.styleInstruction, 
        'Normal'
      );
      
      console.log("Preview URL generated:", url);
      
      const audio = new Audio();
      
      // Use a promise to wait for play to start
      const playPromise = new Promise((resolve, reject) => {
        audio.oncanplaythrough = () => resolve(true);
        audio.onerror = (e) => reject(e);
        audio.src = url;
        audio.load();
      });

      await playPromise;
      
      audio.onended = () => {
        console.log("Preview ended");
        setPreviewAudio(null);
      };
      
      audio.onerror = (e) => {
        console.error("Audio playback error:", e);
        setPreviewAudio(null);
      };

      setPreviewAudio(audio);
      await audio.play();
      console.log("Preview playing...");
    } catch (error) {
      console.error("Preview failed", error);
      alert("Could not generate preview. Check API limits or try again.");
    } finally {
      setIsPreviewLoading(false);
    }
  };

  // --- AUDIO LOGIC HANDLERS ---

  const handleChunkText = () => {
    if (!state.inputText.trim()) return;

    // Simple heuristic to split by sentence endings while respecting max length
    const rawSegments = state.inputText
      .replace(/([।?!])/g, "$1|")
      .split("|")
      .map(s => s.trim())
      .filter(s => s.length > 0);

    const newSegments: AudioSegment[] = [];
    let currentChunk = "";

    const addChunk = (text: string) => {
      if (!text.trim()) return;
      newSegments.push({
        id: generateId(),
        text: text.trim(),
        status: SegmentStatus.IDLE,
        volume: 1.0,
        isSelected: false,
      });
    };

    rawSegments.forEach((sentence) => {
      // If a single sentence is already too long, we need to split it by words/spaces
      if (sentence.length > MAX_CHUNK_LENGTH) {
        // Flush current chunk first
        if (currentChunk) {
          addChunk(currentChunk);
          currentChunk = "";
        }

        // Split long sentence by spaces
        const words = sentence.split(/\s+/);
        let subChunk = "";
        
        words.forEach(word => {
          if ((subChunk.length + word.length + 1) < MAX_CHUNK_LENGTH) {
            subChunk += (subChunk ? " " : "") + word;
          } else {
            if (subChunk) addChunk(subChunk);
            subChunk = word;
          }
        });
        
        if (subChunk) currentChunk = subChunk;
      } 
      else if ((currentChunk.length + sentence.length + 1) < MAX_CHUNK_LENGTH) {
        currentChunk += (currentChunk ? " " : "") + sentence;
      } else {
        if (currentChunk) {
          addChunk(currentChunk);
        }
        currentChunk = sentence;
      }
    });
    
    if (currentChunk) {
      addChunk(currentChunk);
    }

    updateState((prev) => ({
      segments: [...prev.segments, ...newSegments],
      inputText: "", // Clear input after chunking
      hasExported: false
    }));
  };

  const processQueue = useCallback(async () => {
    if (state.isProcessing) return;

    // Set processing flag
    updateState({ isProcessing: true });
    
    // Reset stop signal
    stopSignalRef.current = false;

    // Find segments to process
    const segmentsToProcess = state.segments.filter(s => s.status === SegmentStatus.IDLE || s.status === SegmentStatus.QUEUED);
    const total = segmentsToProcess.length;

    if (total === 0) {
        updateState({ isProcessing: false });
        return;
    }

    // Mark segments as processing VISUALLY
    setState(prev => ({
        ...prev,
        progress: { current: 0, total },
        segments: prev.segments.map(s => 
            segmentsToProcess.some(sp => sp.id === s.id) 
            ? { ...s, status: SegmentStatus.PROCESSING, error: undefined } 
            : s
        )
    }));

    // Capture necessary config variables to avoid closure staleness issues
    const { selectedVoice, styleInstruction } = state;

    const CONCURRENCY_LIMIT = 1; // Set to 1 for maximum stability with long generations
    const executing = new Set<Promise<void>>();
    let completedCount = 0;

    for (const segment of segmentsToProcess) {
      // Check stop signal
      if (stopSignalRef.current) break;

      // Add a delay between starting requests to avoid bursts and respect rate limits
      // Increased to 3 seconds for better stability with long segments
      if (completedCount > 0) {
        await new Promise(resolve => setTimeout(resolve, 3000));
      }

      const p = (async () => {
        try {
            const audioUrl = await generateSpeechSegment(segment.text, selectedVoice, styleInstruction, 'Normal');
            
            if (stopSignalRef.current) return;
            
            // Update segment success
            setState(prev => ({
                ...prev,
                segments: prev.segments.map(s => s.id === segment.id ? { ...s, status: SegmentStatus.COMPLETED, audioUrl } : s)
            }));

        } catch (error: any) {
            if (stopSignalRef.current) return;
            
            console.error(`Segment ${segment.id} failed:`, error);
            // Update segment failure
            setState(prev => ({
                ...prev,
                segments: prev.segments.map(s => s.id === segment.id ? { ...s, status: SegmentStatus.ERROR, error: error.message || 'Generation failed' } : s)
            }));
        } finally {
            if (!stopSignalRef.current) {
                completedCount++;
                // Update progress
                setState(prev => ({ ...prev, progress: { ...prev.progress, current: completedCount } }));
            }
        }
      })();

      executing.add(p);
      const clean = () => executing.delete(p);
      p.then(clean).catch(clean);

      if (executing.size >= CONCURRENCY_LIMIT) {
        await Promise.race(executing);
      }
    }

    await Promise.all(executing);

    // Finished
    updateState({ 
        isProcessing: false, 
        progress: { current: 0, total: 0 } 
    });

  }, [state.segments, state.isProcessing, state.selectedVoice, state.styleInstruction]);

  const handleStop = () => {
    stopSignalRef.current = true;
    updateState({ isProcessing: false });
  };

  const handleClearAll = () => {
    if (state.segments.length > 0) {
      handleStop(); // Stop current
      updateState({
          segments: [],
          hasExported: false
      });
    }
  };

  const handleRetry = useCallback((id: string) => {
    updateState((prev) => ({
        hasExported: false,
        segments: prev.segments.map(s => s.id === id ? { ...s, status: SegmentStatus.QUEUED, error: undefined } : s)
    }));
  }, []); 

  const handleDeleteSegment = useCallback((id: string) => {
    updateState((prev) => ({
        hasExported: false,
        segments: prev.segments.filter(s => s.id !== id)
    }));
  }, []);

  const handleUpdateSegmentText = useCallback((id: string, newText: string) => {
    updateState((prev) => ({
        hasExported: false,
        segments: prev.segments.map(s => s.id === id ? { ...s, text: newText, status: SegmentStatus.IDLE, error: undefined } : s)
    }));
  }, []);

  // --- VOLUME & SELECTION HANDLERS ---
  const handleVolumeChange = (id: string, newVolume: number) => {
    updateState(prev => ({
        segments: prev.segments.map(s => s.id === id ? { ...s, volume: newVolume } : s),
        hasExported: false
    }));
  };

  const handleToggleSelect = (id: string) => {
    updateState(prev => ({
        segments: prev.segments.map(s => s.id === id ? { ...s, isSelected: !s.isSelected } : s)
    }));
  };

  const handleSelectAll = (shouldSelect: boolean) => {
      updateState(prev => ({
          segments: prev.segments.map(s => ({ ...s, isSelected: shouldSelect }))
      }));
  };

  const handleRetryAllErrors = () => {
      const errorSegments = state.segments.filter(s => s.status === SegmentStatus.ERROR);
      if (errorSegments.length === 0) return;
      
      updateState(prev => ({
          segments: prev.segments.map(s => 
              s.status === SegmentStatus.ERROR 
                  ? { ...s, status: SegmentStatus.QUEUED, error: undefined } 
                  : s
          )
      }));

      // We need to wait for the state update to propagate before starting the queue
      // But since processQueue uses the current state, we can just call it
      // if we ensure it sees the new segments. 
      // Actually, processQueue is memoized on state.segments, so it will be recreated.
  };

  const handleRegenerateSelected = () => {
    const selectedSegments = state.segments.filter(s => s.isSelected);
    if (selectedSegments.length === 0) return;
    
    updateState(prev => ({
        segments: prev.segments.map(s => 
            s.isSelected 
                ? { ...s, status: SegmentStatus.QUEUED, error: undefined } 
                : s
        )
    }));
  };

  const handleBulkVolumeChange = (newVolume: number) => {
      updateState(prev => {
          const hasSelection = prev.segments.some(s => s.isSelected);
          return {
              segments: prev.segments.map(s => {
                  // If items are selected, only update those. If none selected, update all.
                  if (hasSelection && !s.isSelected) return s; 
                  return { ...s, volume: newVolume };
              }),
              hasExported: false
          };
      });
  };

  const handleExportMerged = async () => {
    const completedSegments = state.segments.filter(s => s.status === SegmentStatus.COMPLETED && s.audioUrl);
    
    if (completedSegments.length === 0) {
      alert("No audio generated yet to export.");
      return;
    }

    updateState({ isExporting: true });

    try {
      const buffers: Uint8Array[] = [];
      let totalLength = 0;

      for (const segment of completedSegments) {
        if (!segment.audioUrl) continue;
        const response = await window.fetch(segment.audioUrl);
        const arrayBuffer = await response.arrayBuffer();
        
        if (arrayBuffer.byteLength > 44) {
             const rawData = new Uint8Array(arrayBuffer.slice(44));
             
             // Handle volume adjustment if volume is not 1.0 (100%)
             // 16-bit PCM is signed integer
             const volume = segment.volume !== undefined ? segment.volume : 1.0;
             
             if (Math.abs(volume - 1.0) > 0.01) {
                // Parse as 16-bit signed integers
                const int16View = new Int16Array(rawData.buffer, rawData.byteOffset, rawData.byteLength / 2);
                
                // Adjust volume
                for (let i = 0; i < int16View.length; i++) {
                    let val = int16View[i] * volume;
                    // Hard clipping (clamping) to prevent overflow distortion
                    if (val > 32767) val = 32767;
                    if (val < -32768) val = -32768;
                    int16View[i] = val;
                }
                // rawData reflects changes because it shares the buffer
             }

             buffers.push(rawData);
             totalLength += rawData.length;
        }
      }

      if (totalLength === 0) {
        alert("No valid audio data to export.");
        updateState({ isExporting: false });
        return;
      }

      const mergedBuffer = new Uint8Array(totalLength);
      let offset = 0;
      for (const buffer of buffers) {
        mergedBuffer.set(buffer, offset);
        offset += buffer.length;
      }

      const mergedUrl = createWavUrl(mergedBuffer, 24000);
      const link = document.createElement('a');
      link.href = mergedUrl;
      
      let fileName = state.exportFilename.trim() || "rakib";
      if (!fileName.toLowerCase().endsWith('.wav')) {
        fileName += '.wav';
      }
      
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      updateState({ hasExported: true });

    } catch (e) {
      console.error("Merge failed", e);
      alert("Failed to merge audio files.");
    } finally {
      updateState({ isExporting: false });
    }
  };

  const completedCount = state.segments.filter(s => s.status === SegmentStatus.COMPLETED).length;
  const hasCompleted = completedCount > 0;
  
  // Computed values for UI
  const selectedCount = state.segments.filter(s => s.isSelected).length;
  const allSelected = state.segments.length > 0 && selectedCount === state.segments.length;
  const isIndeterminate = selectedCount > 0 && !allSelected;
  
  // Determine slider display value: 
  // If selection, use first selected vol. If no selection, use first vol. Default 1.0.
  let displayVolume = 1.0;
  const targetSegments = selectedCount > 0 ? state.segments.filter(s => s.isSelected) : state.segments;
  if (targetSegments.length > 0) {
      displayVolume = targetSegments[0].volume;
  }

  return (
    <div className="flex flex-col h-screen w-full bg-surface-950 text-slate-100 overflow-hidden">
      
      {/* --- SETTINGS MODAL --- */}
      {showSettings && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-surface-950/80 backdrop-blur-md">
          <div className="w-full max-w-md bg-surface-900 border border-white/10 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-300">
            <div className="p-6 border-b border-white/5 flex justify-between items-center bg-surface-800/50">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-500/20 rounded-lg text-blue-400">
                  <Key size={20} />
                </div>
                <div>
                  <h3 className="text-sm font-black uppercase tracking-widest text-slate-200">API Configuration</h3>
                  <p className="text-[10px] text-slate-500 font-bold uppercase tracking-tighter">Local Desktop Settings</p>
                </div>
              </div>
              <button 
                onClick={() => setShowSettings(false)}
                className="p-2 hover:bg-white/5 rounded-full text-slate-500 hover:text-white transition-colors cursor-pointer"
              >
                <X size={20} />
              </button>
            </div>
            
            <div className="p-8 space-y-6">
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Gemini API Key</label>
                  <a 
                    href="https://aistudio.google.com/app/apikey" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-[10px] font-bold text-blue-400 hover:text-blue-300 underline underline-offset-4"
                  >
                    Get Key
                  </a>
                </div>
                <div className="relative">
                  <textarea 
                    value={tempApiKey}
                    onChange={(e) => setTempApiKey(e.target.value)}
                    placeholder="Enter API Keys (one per line or comma separated)..."
                    rows={4}
                    className="w-full glass-input px-4 py-3 text-sm font-mono tracking-wider focus:ring-2 focus:ring-blue-500/20 resize-none"
                  />
                </div>
                <p className="text-[10px] text-slate-500 leading-relaxed italic">
                  * You can enter multiple API keys (one per line). If one fails, the app will automatically try the next one.
                </p>
              </div>

              {!isKeySaved && (
                <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl flex gap-4 items-start">
                  <AlertCircle className="text-amber-500 shrink-0" size={18} />
                  <p className="text-xs text-amber-200/80 leading-relaxed">
                    আপনি যদি আপনার পিসিতে এই টুলসটি ব্যবহার করতে চান, তবে এখানে আপনার <strong>Gemini API Key</strong> দিতে হবে। এটি ছাড়া অডিও জেনারেট হবে না। আপনি চাইলে একাধিক কি দিতে পারেন (প্রতি লাইনে একটি করে)।
                  </p>
                </div>
              )}

              <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-xl">
                <p className="text-[10px] text-blue-200/80 leading-relaxed uppercase font-bold tracking-widest mb-2">Desktop Setup Guide:</p>
                <ol className="text-[10px] text-slate-400 space-y-1 list-decimal list-inside">
                  <li>Go to Google AI Studio and get your API Key.</li>
                  <li>Paste the key(s) in the box above.</li>
                  <li>Save the configuration.</li>
                  <li>Start generating high-quality Bangla voice!</li>
                </ol>
              </div>

              <button 
                onClick={handleSaveApiKey}
                className="w-full py-4 bg-blue-600 hover:bg-blue-500 text-white rounded-xl flex items-center justify-center gap-3 font-bold text-sm uppercase tracking-[0.2em] transition-all duration-300 shadow-xl shadow-blue-900/20 cursor-pointer active:scale-[0.98]"
              >
                <Save size={18} />
                Save Configuration
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- MAIN CONTENT AREA --- */}
      <div className="flex flex-1 overflow-hidden">
        
        {/* Left Panel: Input & Controls */}
        <div className="w-1/2 flex flex-col border-r border-white/5 p-8 bg-surface-900/20 backdrop-blur-sm">
          <header className="mb-8 flex justify-between items-start">
            <div>
                <h1 className="text-3xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-br from-blue-400 via-indigo-400 to-emerald-400 mb-1">
                BANGLA VOICE
                </h1>
                <div className="flex items-center gap-3">
                  <span className="text-xs font-mono text-slate-500 tracking-widest uppercase">Professional TTS Engine</span>
                  <div className="h-px w-8 bg-slate-800"></div>
                  <span className="text-[10px] font-mono text-blue-500/70">v2.5.0-FLASH</span>
                </div>
            </div>
            <div className="text-right flex flex-col items-end gap-2">
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => setShowSettings(true)}
                  className={`p-2 rounded-lg border transition-all duration-300 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest cursor-pointer ${
                    isKeySaved 
                    ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30' 
                    : 'bg-amber-500/10 text-amber-500 border-amber-500/30 animate-pulse'
                  }`}
                >
                  <Settings size={14} />
                  {isKeySaved ? 'API Configured' : 'Setup API Key'}
                </button>
              </div>
              <div>
                <p className="text-slate-400 text-xs font-bold tracking-tight uppercase">Rakib Ahmed</p>
                <p className="text-slate-600 text-[10px] font-mono mt-0.5 tracking-tighter">01733263106</p>
              </div>
            </div>
          </header>

          <div className="flex flex-col gap-6 mb-6">
            <div className="grid grid-cols-1 gap-6">
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] ml-1">
                  Voice Engine
                </label>
                <div className="flex gap-3">
                    <select 
                      value={state.selectedVoice} 
                      onChange={(e) => updateState({ selectedVoice: e.target.value })}
                      className="flex-1 glass-input px-4 py-2.5 text-sm appearance-none cursor-pointer"
                    >
                      {VOICES.map(v => (
                        <option key={v.name} value={v.name} className="bg-surface-900">{v.label}</option>
                      ))}
                    </select>
                    <button
                        onClick={handlePreviewVoice}
                        disabled={isPreviewLoading}
                        className={`p-3 rounded-lg border transition-all duration-300 ${
                            previewAudio 
                            ? 'bg-amber-500/10 text-amber-500 border-amber-500/30 shadow-[0_0_15px_rgba(245,158,11,0.1)]' 
                            : 'bg-surface-800/50 text-slate-400 border-slate-700/50 hover:bg-surface-700 hover:text-white hover:border-slate-600'
                        } cursor-pointer`}
                        title="Preview Voice"
                    >
                        {isPreviewLoading ? (
                            <Loader2 size={18} className="animate-spin" />
                        ) : previewAudio ? (
                            <Square size={18} fill="currentColor" />
                        ) : (
                            <Volume2 size={18} />
                        )}
                    </button>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] ml-1">
                Narrative Style
              </label>
              
              <div className="flex flex-wrap gap-2 mb-3">
                {STYLE_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    onClick={() => updateState({ styleInstruction: preset.text })}
                    className={`px-3 py-1 text-[10px] font-bold rounded-full border transition-all duration-300 cursor-pointer uppercase tracking-wider ${
                      state.styleInstruction === preset.text
                      ? 'bg-blue-500/20 text-blue-400 border-blue-500/40 shadow-[0_0_10px_rgba(59,130,246,0.1)]'
                      : 'bg-surface-800/30 text-slate-500 border-slate-700/50 hover:text-slate-300 hover:border-slate-600'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>

              <textarea 
                value={state.styleInstruction} 
                onChange={(e) => updateState({ styleInstruction: e.target.value })}
                placeholder="Describe the desired tone, pace, and emotion..."
                className="w-full glass-input p-4 text-sm resize-none h-24 placeholder-slate-700 font-medium"
              />
            </div>
          </div>

          <div className="flex-1 flex flex-col min-h-0 mb-6">
            <div className="flex justify-between items-end mb-2 ml-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em]">
                Source Text (Bengali)
              </label>
              <span className="text-[10px] font-mono text-slate-600 uppercase tracking-widest">
                {state.inputText.length} chars
              </span>
            </div>
            <textarea
              className="flex-1 glass-input p-6 text-slate-200 resize-none font-bengali leading-relaxed text-xl shadow-inner placeholder-slate-800"
              placeholder="আপনার বাংলা পাঠ্য এখানে পেস্ট করুন..."
              value={state.inputText}
              onChange={(e) => updateState({ inputText: e.target.value })}
            ></textarea>
          </div>

          <button
            onClick={handleChunkText}
            disabled={!state.inputText.trim()}
            className="w-full py-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-xl flex items-center justify-center gap-3 font-bold text-sm uppercase tracking-[0.2em] transition-all duration-300 shadow-xl shadow-blue-900/20 disabled:opacity-30 disabled:grayscale cursor-pointer active:scale-[0.98]"
          >
            <Split size={20} />
            Process & Queue
          </button>
        </div>

        {/* Right Panel: Segments & Output */}
        <div className="w-1/2 flex flex-col bg-surface-950/40 relative">
          <div className="p-6 border-b border-white/5 flex flex-col bg-surface-900/60 backdrop-blur-xl sticky top-0 z-10 gap-6">
            {/* Top Row: Title, Processing status, Main Buttons */}
            <div className="flex justify-between items-center w-full">
                <div className="flex flex-col">
                <h2 className="text-sm font-black uppercase tracking-[0.3em] text-slate-400 flex items-center gap-3">
                    Audio Stack 
                    <span className="bg-blue-500/10 text-blue-400 text-[10px] px-2 py-0.5 rounded border border-blue-500/20 font-mono">
                    {state.segments.length}
                    </span>
                </h2>
                {state.isProcessing && (
                    <div className="flex items-center gap-2 mt-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></div>
                      <p className="text-[10px] font-bold text-blue-400 uppercase tracking-widest">
                        Synthesizing {state.progress.current} / {state.progress.total}
                      </p>
                    </div>
                )}
                {state.isExporting && (
                    <div className="flex items-center gap-2 mt-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
                      <p className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest">
                        Merging {completedCount} Segments
                      </p>
                    </div>
                )}
                </div>
                
                <div className="flex items-center gap-3">
                {/* Filename Input */}
                <div className="flex items-center group">
                    <input 
                        type="text" 
                        value={state.exportFilename}
                        onChange={(e) => updateState({ exportFilename: e.target.value })}
                        placeholder="filename"
                        className="w-28 bg-surface-950/50 border border-slate-700/50 text-slate-200 text-[10px] font-bold uppercase tracking-widest rounded-l-lg px-3 py-2.5 outline-none focus:border-blue-500/50 placeholder-slate-700 transition-all focus:w-40"
                        title="Export filename"
                    />
                    <span className="bg-surface-800/50 border border-l-0 border-slate-700/50 text-slate-500 text-[10px] font-mono px-3 py-2.5 rounded-r-lg select-none">.WAV</span>
                </div>

                {/* Merge / New Project Button */}
                {state.hasExported ? (
                    <button 
                    onClick={handleClearAll}
                    className="px-5 py-2.5 bg-surface-800 hover:bg-red-500/20 hover:text-red-400 border border-slate-700/50 text-slate-300 rounded-lg text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 transition-all cursor-pointer"
                    >
                        <RotateCcw size={14} />
                        Reset
                    </button>
                ) : (
                    <button 
                    onClick={handleExportMerged}
                    disabled={state.isProcessing || state.isExporting || !hasCompleted}
                    className={`px-5 py-2.5 rounded-lg text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 transition-all shadow-xl ${
                        hasCompleted && !state.isProcessing && !state.isExporting
                        ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-900/20 cursor-pointer' 
                        : 'bg-surface-800/50 text-slate-600 border border-slate-700/50 cursor-not-allowed'
                    }`}
                    >
                        {state.isExporting ? <Loader2 size={14} className="animate-spin" /> : <FileAudio size={14} />}
                        Merge & Export
                    </button>
                )}

                {state.isProcessing ? (
                    <button 
                    onClick={handleStop}
                    className="px-5 py-2.5 bg-amber-600/10 text-amber-500 border border-amber-500/30 hover:bg-amber-600/20 rounded-lg text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 cursor-pointer transition-all"
                    >
                    <StopCircle size={14} /> Stop
                    </button>
                ) : (
                    <button 
                    onClick={() => processQueue()}
                    disabled={state.segments.every(s => s.status === SegmentStatus.COMPLETED) || state.segments.length === 0}
                    className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 disabled:opacity-30 shadow-xl shadow-blue-900/20 transition-all cursor-pointer"
                    >
                    {state.segments.some(s => s.status === SegmentStatus.PROCESSING) ? <Loader2 size={14} className="animate-spin" /> : <PlayCircle size={14} />}
                    Generate
                    </button>
                )}
                
                {/* Conditional small trash button */}
                {!state.hasExported && (
                    <button 
                        type="button"
                        onClick={handleClearAll}
                        disabled={state.segments.length === 0}
                        className="p-2.5 bg-surface-800/50 hover:bg-red-500/20 text-slate-500 hover:text-red-400 rounded-lg border border-slate-700/50 transition-all disabled:opacity-20 cursor-pointer"
                        title="Clear All"
                    >
                        <Trash2 size={14} />
                    </button>
                )}
                </div>
            </div>

            {/* Bulk Controls Toolbar */}
            {state.segments.length > 0 && (
                <div className="flex items-center gap-6 py-3 px-4 bg-surface-950/30 rounded-xl border border-white/5">
                     <label className="flex items-center gap-3 cursor-pointer select-none group">
                         <input 
                            type="checkbox" 
                            checked={allSelected} 
                            ref={input => { if(input) input.indeterminate = isIndeterminate; }}
                            onChange={(e) => handleSelectAll(e.target.checked)}
                            className="w-4 h-4 rounded border-slate-700 bg-surface-900 text-blue-500 focus:ring-offset-surface-950 cursor-pointer transition-all"
                         />
                         <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 group-hover:text-slate-300 transition-colors">Select All</span>
                     </label>

                     {state.segments.some(s => s.status === SegmentStatus.ERROR) && (
                        <button 
                          onClick={handleRetryAllErrors}
                          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[10px] font-bold hover:bg-amber-500/20 transition-all cursor-pointer uppercase tracking-widest"
                        >
                          <RefreshCw size={12} /> Retry All Errors
                        </button>
                     )}

                     {state.segments.some(s => s.isSelected) && (
                        <button 
                          onClick={handleRegenerateSelected}
                          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 text-[10px] font-bold hover:bg-blue-500/20 transition-all cursor-pointer uppercase tracking-widest"
                        >
                          <RefreshCw size={12} /> Regenerate Selected
                        </button>
                     )}

                     <div className="h-4 w-px bg-slate-800"></div>

                     <div className="flex items-center gap-4 flex-1">
                         <Volume2 size={14} className={selectedCount > 0 ? "text-blue-400" : "text-slate-600"} />
                         <input 
                            type="range" 
                            min="0" 
                            max="2" 
                            step="0.1" 
                            value={displayVolume} 
                            onChange={(e) => handleBulkVolumeChange(parseFloat(e.target.value))}
                            className="w-40 accent-blue-500 h-1 bg-surface-800 rounded-lg appearance-none cursor-pointer"
                         />
                         <span className="text-[10px] font-mono text-slate-400 w-10 text-right">{Math.round(displayVolume * 100)}%</span>
                         
                         <span className="text-[10px] font-bold uppercase tracking-widest text-slate-600 ml-2">
                            {selectedCount > 0 
                                ? `Adjusting ${selectedCount} selected` 
                                : "Global Volume"}
                         </span>
                     </div>
                </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-8 scroll-smooth custom-scrollbar">
            <SegmentList 
              segments={state.segments} 
              onRetry={handleRetry} 
              onDelete={handleDeleteSegment}
              onVolumeChange={handleVolumeChange}
              onToggleSelect={handleToggleSelect}
              onUpdateText={handleUpdateSegmentText}
            />
          </div>
          
          {/* Footer info */}
          <div className="py-3 px-6 text-center text-[10px] font-bold uppercase tracking-[0.2em] text-slate-700 border-t border-white/5 bg-surface-950/80 backdrop-blur-sm">
            WAV 24kHz • Local Browser Merge • High Fidelity Output
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
