export interface QAPair {
  id?: string;
  question: string;
  answer: string;
  sourceDetail?: string;
  ownerId?: string;
}

export interface HistoryItem {
  id: string;
  timestamp: number;
  question: string;
  matchedQuestion?: string;
  originalQuery?: string;
  answer: string;
  source: 'kb' | 'ai';
  imageUrl?: string;
  sourceDetail?: string;
}
