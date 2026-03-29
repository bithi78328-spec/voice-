import React, { useState } from 'react';
import { AudioSegment, SegmentStatus } from '../types';
import { Download, RefreshCw, AlertCircle, X, Volume2, Edit2, Check, XCircle, Loader2 } from 'lucide-react';

interface SegmentListProps {
  segments: AudioSegment[];
  onRetry: (id: string) => void;
  onDelete: (id: string) => void;
  onVolumeChange: (id: string, volume: number) => void;
  onToggleSelect: (id: string) => void;
  onUpdateText: (id: string, newText: string) => void;
}

const SegmentList: React.FC<SegmentListProps> = ({ segments, onRetry, onDelete, onVolumeChange, onToggleSelect, onUpdateText }) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  if (segments.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-500 p-8 text-center border-2 border-dashed border-slate-700 rounded-xl">
        <p className="text-lg mb-2">No audio generated yet.</p>
        <p className="text-sm">Enter your Bengali text on the left and click "Analyze & Chunk" to begin.</p>
      </div>
    );
  }

  const startEditing = (segment: AudioSegment) => {
    setEditingId(segment.id);
    setEditText(segment.text);
  };

  const saveEdit = (id: string) => {
    if (editText.trim()) {
      onUpdateText(id, editText.trim());
    }
    setEditingId(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
  };

  return (
    <div className="space-y-6 pb-20">
      {segments.map((segment, index) => (
        <div 
          key={segment.id} 
          className={`relative p-5 rounded-xl border transition-all duration-500 shadow-xl backdrop-blur-md ${
            segment.isSelected ? 'border-blue-500/40 bg-blue-500/5 ring-1 ring-blue-500/20' : 
            segment.status === SegmentStatus.PROCESSING ? 'border-blue-500/60 bg-blue-500/10 animate-pulse-subtle' :
            segment.status === SegmentStatus.COMPLETED ? 'border-emerald-500/20 bg-emerald-500/5' :
            segment.status === SegmentStatus.ERROR ? 'border-red-500/30 bg-red-500/5' :
            'border-white/5 bg-surface-900/40'
          }`}
        >
          <div className="flex justify-between items-start mb-4 pl-8">
            <div className="absolute top-5 left-4 z-20">
              <input 
                type="checkbox" 
                checked={!!segment.isSelected} 
                onChange={() => onToggleSelect(segment.id)}
                className="w-4 h-4 rounded border-slate-700 bg-surface-950 text-blue-500 focus:ring-offset-surface-950 cursor-pointer transition-all"
              />
            </div>
            
            <div className="flex items-center gap-3">
                <span className="text-[10px] font-mono text-slate-500 bg-surface-950/50 px-2 py-0.5 rounded border border-slate-800/50 uppercase tracking-widest">
                Segment {index + 1}
                </span>
                {segment.status === SegmentStatus.COMPLETED && (
                    <span className="text-[10px] font-bold text-emerald-500/70 uppercase tracking-widest flex items-center gap-1.5">
                        <Check size={10} /> Ready
                    </span>
                )}
            </div>

            <div className="flex gap-1 z-10">
              {editingId === segment.id ? (
                <>
                  <button 
                    onClick={() => saveEdit(segment.id)}
                    className="p-2 hover:bg-emerald-500/10 rounded-lg text-emerald-400 transition-all cursor-pointer" 
                    title="Save"
                  >
                    <Check size={16} />
                  </button>
                  <button 
                    onClick={cancelEdit}
                    className="p-2 hover:bg-red-500/10 rounded-lg text-red-400 transition-all cursor-pointer" 
                    title="Cancel"
                  >
                    <XCircle size={16} />
                  </button>
                </>
              ) : (
                <>
                  <button 
                    onClick={() => startEditing(segment)}
                    className="p-2 hover:bg-surface-800/50 rounded-lg text-slate-500 hover:text-blue-400 transition-all cursor-pointer" 
                    title="Edit text"
                  >
                    <Edit2 size={16} />
                  </button>
                  {segment.status === SegmentStatus.COMPLETED && (
                    <button 
                      onClick={() => onRetry(segment.id)}
                      className="p-2 hover:bg-surface-800/50 rounded-lg text-slate-500 hover:text-amber-400 transition-all cursor-pointer" 
                      title="Regenerate (Try again for different tone)"
                      type="button"
                    >
                      <RefreshCw size={16} className="pointer-events-none" />
                    </button>
                  )}
                  {segment.status === SegmentStatus.ERROR && (
                    <button 
                      onClick={() => onRetry(segment.id)}
                      className="p-2 hover:bg-surface-800/50 rounded-lg text-amber-400 transition-all cursor-pointer" 
                      title="Retry"
                      type="button"
                    >
                      <RefreshCw size={16} className="pointer-events-none" />
                    </button>
                  )}
                  {segment.status === SegmentStatus.COMPLETED && segment.audioUrl && (
                    <a 
                      href={segment.audioUrl} 
                      download={`bangla-part-${index + 1}.wav`}
                      className="p-2 hover:bg-surface-800/50 rounded-lg text-blue-400 transition-all cursor-pointer"
                      title="Download"
                    >
                      <Download size={16} className="pointer-events-none" />
                    </a>
                  )}
                  <button 
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onDelete(segment.id);
                    }}
                    className="p-2 hover:bg-red-500/10 rounded-lg text-slate-600 hover:text-red-400 transition-all cursor-pointer"
                    title="Remove segment"
                  >
                    <X size={16} className="pointer-events-none" />
                  </button>
                </>
              )}
            </div>
          </div>
          
          {editingId === segment.id ? (
            <textarea
              autoFocus
              className="w-full bg-surface-950/50 border border-blue-500/30 rounded-lg p-3 text-sm text-slate-200 font-bengali leading-relaxed mb-4 focus:ring-1 focus:ring-blue-500/20 outline-none min-h-[100px] shadow-inner"
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
            />
          ) : (
            <p className="text-slate-300 text-base mb-5 font-bengali leading-relaxed pr-6 pl-8">
              {segment.text}
            </p>
          )}

          <div className="flex flex-col gap-4 pl-8">
            <div className="flex items-center gap-4 h-8">
              {segment.status === SegmentStatus.QUEUED && (
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-600 flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-700"></span> In Queue
                </span>
              )}
              {segment.status === SegmentStatus.PROCESSING && (
                <span className="text-[10px] font-bold uppercase tracking-widest text-blue-400 flex items-center gap-2">
                  <Loader2 size={12} className="animate-spin" /> Synthesizing...
                </span>
              )}
              {segment.status === SegmentStatus.COMPLETED && segment.audioUrl && (
                <audio controls className="w-full h-8 opacity-90 brightness-90 contrast-125" src={segment.audioUrl} />
              )}
              {segment.status === SegmentStatus.ERROR && (
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-red-400 w-full">
                  <AlertCircle size={12} className="shrink-0" /> 
                  <span title={segment.error} className="truncate block flex-1">{segment.error || "Generation failed"}</span>
                </div>
              )}
            </div>

            {/* Volume Slider for Individual Segment */}
            <div className="flex items-center gap-3 mt-1 bg-surface-950/40 p-2 rounded-lg border border-white/5 w-fit group/vol">
              <Volume2 size={14} className={segment.volume === 0 ? "text-slate-700" : "text-slate-500 group-hover/vol:text-blue-400 transition-colors"} />
              <input 
                type="range" 
                min="0" 
                max="2" 
                step="0.1" 
                value={segment.volume} 
                onChange={(e) => onVolumeChange(segment.id, parseFloat(e.target.value))}
                className="w-32 h-1 bg-surface-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
                title={`Volume: ${Math.round(segment.volume * 100)}%`}
              />
              <span className="text-[10px] font-mono text-slate-500 w-10 text-right group-hover/vol:text-slate-300 transition-colors">
                {Math.round(segment.volume * 100)}%
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

export default SegmentList;