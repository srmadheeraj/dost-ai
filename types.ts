
export type Role = 'user' | 'model';

export interface Message {
  id: string;
  role: Role;
  text: string;
  timestamp: Date;
}

export type Mood = 'happy' | 'sad' | 'anxious' | 'tired' | 'excited' | 'overthinking' | 'neutral';

export interface UserState {
  name: string;
  currentMood: Mood;
}
