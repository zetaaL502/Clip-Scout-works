import { Film, Send, Mic, BarChart3, Settings } from "lucide-react";
import type { Page } from "../types";

interface Props {
  currentPage: Page;
  onNavigate: (page: Page) => void;
  onSettings?: () => void;
}

const navItems = [
  { id: "grid" as Page, label: "Video Studio", icon: Film },
  { id: "quicksend" as Page, label: "Quick Send", icon: Send },
  { id: "subtitles" as Page, label: "Subtitles", icon: Mic },
  { id: "youtube-analytics" as Page, label: "YouTube", icon: BarChart3 },
];

export function AppSidebar({ currentPage, onNavigate }: Props) {
  const activePage = currentPage;

  return (
    <>
      <aside className="hidden md:flex fixed left-0 top-0 bottom-0 z-40 flex-col w-48 bg-[#0d0d0d] border-r border-gray-800">
        <div className="flex items-center justify-start gap-2 px-4 h-14 border-b border-gray-800">
          <span className="font-black text-yellow-400 text-base">
            ClipScout
          </span>
        </div>

        <nav className="flex flex-col gap-1 p-2 flex-1">
          {navItems.map(({ id, label, icon: Icon }) => {
            const isActive = activePage === id;
            return (
              <button
                key={id}
                onClick={() => onNavigate(id)}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors w-full text-left
                  ${
                    isActive
                      ? "bg-[#22c55e]/10 text-[#22c55e]"
                      : "text-gray-400 hover:text-white hover:bg-gray-800/50"
                  }`}
                aria-current={isActive ? "page" : undefined}
              >
                <Icon size={18} className="shrink-0" />
                <span>{label}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-[#0d0d0d] border-t border-gray-800 safe-area-bottom">
        <div className="flex justify-around items-center h-16 px-2">
          {navItems.map(({ id, label, icon: Icon }) => {
            const isActive = activePage === id;
            return (
              <button
                key={id}
                onClick={() => onNavigate(id)}
                className={`flex flex-col items-center justify-center gap-1 px-3 py-2 rounded-xl transition-colors
                  ${isActive ? "text-[#22c55e]" : "text-gray-400"}`}
              >
                <Icon size={22} />
                <span className="text-[10px] font-medium">{label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
}
