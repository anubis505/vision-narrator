
export interface NarrationResult {
  text: string;
  audioData?: string;
  thinkingProcess?: string;
}

export enum AppStatus {
  IDLE = 'IDLE',
  UPLOADING = 'UPLOADING',
  SAMPLING = 'SAMPLING',
  ANALYZING = 'ANALYZING',
  NARRATING = 'NARRATING',
  COMPLETED = 'COMPLETED',
  ERROR = 'ERROR'
}

export interface VideoFrame {
  data: string;
  mimeType: string;
}
