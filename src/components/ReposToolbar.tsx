import React from 'react';
import { FolderGit2, Lock, RefreshCw } from 'lucide-react';
import { RepoSummary } from '../services/githubApi';

interface ReposToolbarProps {
  repos: RepoSummary[];
  isLoading: boolean;
  onSelectRepo: (fullName: string) => void;
}

export const ReposToolbar: React.FC<ReposToolbarProps> = ({
  repos,
  isLoading,
  onSelectRepo,
}) => {
  return (
    <div className="w-full max-w-5xl 2xl:max-w-6xl mx-auto px-3 sm:px-6 mb-4">
      <div className="relative">
        <div className="w-full h-full absolute inset-0 bg-black rounded-xl translate-y-1 translate-x-1"></div>
        <div className="relative z-10 bg-[#161b22] border-[3px] border-[#30363d] rounded-xl px-4 py-2.5 flex items-center justify-between gap-3 text-gray-200">
          <div className="flex items-center gap-2 shrink-0">
            <FolderGit2 className="w-4 h-4 text-amber-400" />
            <span className="text-xs font-black uppercase tracking-wider text-gray-300">Your Repos:</span>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 overflow-x-auto py-1 no-scrollbar flex-1">
            {isLoading ? (
              <span className="text-xs text-gray-400 flex items-center gap-1.5">
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-400" />
                <span>Loading repositories...</span>
              </span>
            ) : repos.length > 0 ? (
              repos.slice(0, 10).map((repo) => (
                <button
                  key={repo.full_name}
                  type="button"
                  onClick={() => onSelectRepo(repo.full_name)}
                  className="text-xs font-semibold px-2.5 py-1 bg-[#21262d] hover:bg-[#30363d] text-gray-200 hover:text-white rounded-lg border border-[#30363d] hover:border-amber-500/70 transition-all flex items-center gap-1.5 shrink-0 shadow-[1px_1px_0_0_#000000] cursor-pointer"
                  title={repo.is_private ? 'Private Repository' : 'Public Repository'}
                >
                  {repo.is_private && <Lock className="w-3 h-3 text-amber-400" />}
                  <span>{repo.name}</span>
                </button>
              ))
            ) : (
              <span className="text-xs text-gray-500 italic">No repositories found.</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
