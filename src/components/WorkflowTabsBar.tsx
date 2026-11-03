import React from 'react';
import { Plus, X, RefreshCw, CheckCircle2, AlertCircle } from 'lucide-react';

export interface WorkflowTab {
  id: string;
  url: string;
  title: string;
  isLoading: boolean;
  hasResult: boolean;
  hasError: boolean;
  startTime: number | null;
  filesCount?: number;
}

interface WorkflowTabsBarProps {
  tabs: WorkflowTab[];
  activeId: string;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string, e: React.MouseEvent) => void;
  onAddTab: () => void;
  maxTabs?: number;
}

export const WorkflowTabsBar: React.FC<WorkflowTabsBarProps> = ({
  tabs,
  activeId,
  onSelectTab,
  onCloseTab,
  onAddTab,
  maxTabs = 10,
}) => {
  return (
    <div className="w-full max-w-5xl 2xl:max-w-6xl mx-auto px-3 sm:px-6 mb-3">
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
        {tabs.map((tab, idx) => {
          const isActive = tab.id === activeId;
          return (
            <div
              key={tab.id}
              onClick={() => onSelectTab(tab.id)}
              className={`group relative flex items-center gap-2 px-3.5 py-2 rounded-xl border-[2px] transition-all cursor-pointer select-none shrink-0 shadow-[2px_2px_0_0_#000000] ${
                isActive
                  ? 'bg-[#161b22] border-amber-500 text-white font-extrabold'
                  : 'bg-[#0d1117] border-[#30363d] text-gray-400 hover:text-gray-200 hover:border-gray-500 font-medium'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-mono opacity-60">#{idx + 1}</span>
                {tab.isLoading ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-400 shrink-0" />
                ) : tab.hasResult ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                ) : tab.hasError ? (
                  <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                ) : (
                  <span className={`w-2 h-2 rounded-full ${isActive ? 'bg-amber-400' : 'bg-gray-600'}`}></span>
                )}
                <span className="text-xs truncate max-w-[130px] sm:max-w-[180px]">
                  {tab.title || 'New Ingest'}
                </span>
                {tab.filesCount !== undefined && tab.filesCount > 0 && (
                  <span className="text-[10px] bg-emerald-950/60 text-emerald-300 px-1.5 py-0.2 rounded border border-emerald-500/30 font-mono">
                    {tab.filesCount}
                  </span>
                )}
              </div>

              {tabs.length > 1 && (
                <button
                  type="button"
                  onClick={(e) => onCloseTab(tab.id, e)}
                  className="text-gray-500 hover:text-rose-400 hover:bg-rose-500/10 p-0.5 rounded transition-colors ml-1 cursor-pointer"
                  title="Close workflow tab"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          );
        })}

        {tabs.length < maxTabs && (
          <button
            type="button"
            onClick={onAddTab}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border-[2px] border-dashed border-[#30363d] hover:border-amber-400/80 bg-[#161b22]/50 hover:bg-[#161b22] text-gray-400 hover:text-amber-300 text-xs font-bold transition-all shadow-[2px_2px_0_0_#000000] cursor-pointer shrink-0"
            title={`Add new ingest workflow (${tabs.length}/${maxTabs})`}
          >
            <Plus className="w-4 h-4 text-amber-400" />
            <span className="hidden sm:inline">Add Workflow</span>
            <span className="font-mono text-[10px] opacity-60">({tabs.length}/{maxTabs})</span>
          </button>
        )}
      </div>
    </div>
  );
};
