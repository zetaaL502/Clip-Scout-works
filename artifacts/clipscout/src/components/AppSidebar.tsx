import { Film, Send, Mic, MessageSquareText } from 'lucide-react';
import type { Page } from '../types';

interface Props {
  currentPage: Page;
  onNavigate: (page: Page) => void;
}

const navItems = [
  { id: 'home' as Page, label: 'Video Studio', icon: Film },
  { id: 'quicksend' as Page, label: 'Quick Send', icon: Send },
  { id: 'subtitles' as Page, label: 'Subtitles', icon: Mic },
  { id: 'text-automation' as Page, label: 'Text Automation', icon: MessageSquareText },
];

export function AppSidebar({ currentPage, onNavigate }: Props) {
  const activePage = currentPage === 'grid' ? 'home' : currentPage;

  return (
    <aside className="fixed left-0 top-0 bottom-0 z-40 flex flex-col w-14 sm:w-48 bg-[#0d0d0d] border-r border-gray-800">
      <div className="flex items-center justify-center sm:justify-start gap-2 px-0 sm:px-4 h-14 border-b border-gray-800">
        <span className="font-black text-white text-base hidden sm:block">ClipScout</span>
        <span className="font-black text-white text-base sm:hidden">CS</span>
      </div>

      <nav className="flex flex-col gap-1 p-2 flex-1">
        {navItems.map(({ id, label, icon: Icon }) => {
          const isActive = activePage === id;
          return (
            <button
              key={id}
              onClick={() => onNavigate(id)}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors w-full text-left
                ${isActive
                  ? 'bg-[#22c55e]/10 text-[#22c55e]'
                  : 'text-gray-400 hover:text-white hover:bg-gray-800/50'
                }`}
              aria-current={isActive ? 'page' : undefined}
            >
              <Icon size={18} className="shrink-0" />
              <span className="hidden sm:block">{label}</span>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
