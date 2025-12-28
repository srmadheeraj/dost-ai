
import React from 'react';
import { MOODS } from '../constants';
import { Mood } from '../types';

interface MoodSelectorProps {
  onSelect: (mood: Mood) => void;
  selectedMood: Mood | null;
}

export const MoodSelector: React.FC<MoodSelectorProps> = ({ onSelect, selectedMood }) => {
  return (
    <div className="flex flex-wrap gap-2 justify-center py-2 lg:py-4 max-w-full lg:max-w-2xl mx-auto px-4">
      {MOODS.map((m) => (
        <button
          key={m.value}
          onClick={() => onSelect(m.value as Mood)}
          className={`flex items-center gap-2 px-3 lg:px-5 py-2 lg:py-3 rounded-2xl transition-all duration-500 border text-[10px] lg:text-xs font-black uppercase tracking-wider ${
            selectedMood === m.value
              ? 'bg-amber-500/10 border-amber-500/50 text-amber-500 scale-105 shadow-[0_0_30px_rgba(245,158,11,0.1)]'
              : 'bg-white/5 border-white/10 text-gray-500 hover:border-white/30 hover:bg-white/10 active:scale-95'
          }`}
        >
          <span className="text-sm lg:text-base">{m.icon}</span>
          <span className="opacity-80">{m.label}</span>
        </button>
      ))}
    </div>
  );
};
