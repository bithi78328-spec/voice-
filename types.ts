export enum SegmentStatus {
  IDLE = 'IDLE',
  QUEUED = 'QUEUED',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  ERROR = 'ERROR',
}

export interface AudioSegment {
  id: string;
  text: string;
  status: SegmentStatus;
  audioUrl?: string;
  error?: string;
  duration?: number; // Estimated or actual
  volume: number; // 1.0 is 100%, range 0.0 to 2.0
  isSelected?: boolean;
}

export interface VoiceConfig {
  name: string;
  label: string;
}

export interface ProjectState {
  id: string;
  name: string;
  inputText: string;
  styleInstruction: string;
  segments: AudioSegment[];
  isProcessing: boolean;
  isExporting: boolean;
  hasExported: boolean;
  selectedVoice: string;
  speakingRate: string;
  exportFilename: string;
  progress: { current: number; total: number };
}

export const VOICES: VoiceConfig[] = [
  { name: 'Sulafat', label: 'Sulafat (Female, Warm)' },
  { name: 'Puck', label: 'Puck (Male, Upbeat)' },
  { name: 'Charon', label: 'Charon (Male, Informative)' },
  { name: 'Kore', label: 'Kore (Female, Firm)' },
  { name: 'Fenrir', label: 'Fenrir (Male, Excitable)' },
  { name: 'Zephyr', label: 'Zephyr (Female, Bright)' },
  { name: 'Leda', label: 'Leda (Female, Youthful)' },
  { name: 'Orus', label: 'Orus (Male, Firm)' },
  { name: 'Aoede', label: 'Aoede (Female, Breezy)' },
  { name: 'Callirrhoe', label: 'Callirrhoe (Female, Easy-going)' },
  { name: 'Autonoe', label: 'Autonoe (Female, Bright)' },
  { name: 'Enceladus', label: 'Enceladus (Male, Breathy)' },
  { name: 'Iapetus', label: 'Iapetus (Male, Clear)' },
  { name: 'Umbriel', label: 'Umbriel (Male, Easy-going)' },
  { name: 'Algieba', label: 'Algieba (Male, Smooth)' },
  { name: 'Despina', label: 'Despina (Female, Smooth)' },
  { name: 'Erinome', label: 'Erinome (Female, Clear)' },
  { name: 'Algenib', label: 'Algenib (Male, Gravelly)' },
  { name: 'Rasalgethi', label: 'Rasalgethi (Female, Informative)' },
  { name: 'Laomedeia', label: 'Laomedeia (Female, Upbeat)' },
  { name: 'Achernar', label: 'Achernar (Male, Soft)' },
  { name: 'Alnilam', label: 'Alnilam (Male, Firm)' },
  { name: 'Schedar', label: 'Schedar (Male, Even)' },
  { name: 'Gacrux', label: 'Gacrux (Male, Mature)' },
  { name: 'Pulcherrima', label: 'Pulcherrima (Female, Forward)' },
  { name: 'Achird', label: 'Achird (Female, Friendly)' },
  { name: 'Zubenelgenubi', label: 'Zubenelgenubi (Male, Casual)' },
  { name: 'Vindemiatrix', label: 'Vindemiatrix (Female, Gentle)' },
  { name: 'Sadachbia', label: 'Sadachbia (Female, Lively)' },
  { name: 'Sadaltager', label: 'Sadaltager (Female, Knowledgeable)' },
];
