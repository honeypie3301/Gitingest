import React, { useState, useEffect, useRef } from 'react';
import { ArrowRight, ShieldCheck, Key, RefreshCw, ChevronDown, Lock, FolderGit2, XCircle } from 'lucide-react';
import { IngestRequest, PatternType, TokenStatus } from '../types';
import { getSavedPatterns, savePatterns, getSavedToken, getSavedDecompileClasses, saveDecompileClasses } from '../services/ingest';
import { fetchUserRepos, RepoSummary } from '../services/githubApi';
import { IngestionTimer } from './IngestionTimer';

interface GitFormProps {
  onIngest: (req: IngestRequest) => void;
  isLoading: boolean;
  startTime?: number | null;
  tokenStatus: TokenStatus;
  onOpenTokenModal: () => void;
  onCancel?: () => void;
  initialUrl?: string;
  onUrlChange?: (url: string) => void;
}

export const GitForm: React.FC<GitFormProps> = React.memo(({
  onIngest,
  isLoading,
  startTime,
  tokenStatus,
  onOpenTokenModal,
  onCancel,
  initialUrl = '',
  onUrlChange,
}) => {
  const [url, setUrl] = useState(initialUrl);

  useEffect(() => {
    setUrl(initialUrl);
  }, [initialUrl]);
  const [patternType, setPatternType] = useState<PatternType>('exclude');
  const [pattern, setPattern] = useState('');
  const [maxFileSize, setMaxFileSize] = useState(50); // In MB
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [userRepos, setUserRepos] = useState<RepoSummary[]>([]);
  const [isLoadingRepos, setIsLoadingRepos] = useState(false);
  const [decompileClasses, setDecompileClasses] = useState(false);

  useEffect(() => {
    const saved = getSavedPatterns();
    setPatternType(saved.type);
    setPattern(saved.pattern);
    setMaxFileSize(saved.maxFileSize || 50);
    setDecompileClasses(getSavedDecompileClasses());

    loadDynamicRepos();
  }, [tokenStatus]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const loadDynamicRepos = async () => {
    setIsLoadingRepos(true);
    const token = getSavedToken();
    const repos = await fetchUserRepos(token || undefined, tokenStatus.user?.login || 'honeypie3301');
    setUserRepos(repos);
    setIsLoadingRepos(false);
  };

  const handleDecompileChange = (enabled: boolean) => {
    setDecompileClasses(enabled);
    saveDecompileClasses(enabled);
  };

  const handlePatternTypeSelect = (type: PatternType) => {
    setPatternType(type);
    savePatterns(type, pattern, maxFileSize);
    setIsDropdownOpen(false);
  };

  const handlePatternChange = (newPattern: string) => {
    setPattern(newPattern);
    savePatterns(patternType, newPattern, maxFileSize);
  };

  const handleFileSizeChange = (newSize: number) => {
    setMaxFileSize(newSize);
    savePatterns(patternType, pattern, newSize);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    savePatterns(patternType, pattern, maxFileSize);
    onIngest({
      input_text: url.trim(),
      pattern_type: patternType,
      pattern: pattern.trim(),
      max_file_size: maxFileSize,
      decompile_classes: decompileClasses,
    });
  };

  const handleRepoClick = (repoFullName: string) => {
    const repoUrl = `https://github.com/${repoFullName}`;
    setUrl(repoUrl);
    savePatterns(patternType, pattern, maxFileSize);
    onIngest({
      input_text: repoUrl,
      pattern_type: patternType,
      pattern: pattern.trim(),
      max_file_size: maxFileSize,
      decompile_classes: decompileClasses,
    });
  };

  return (
    <div className="w-full max-w-5xl 2xl:max-w-6xl mx-auto px-3 sm:px-6">
      {/* Dark Brutalist Shadow Box */}
      <div className="relative">
        <div className="w-full h-full absolute inset-0 bg-black rounded-2xl translate-y-1.5 translate-x-1.5 sm:translate-y-2 sm:translate-x-2"></div>

        {/* Main Container */}
        <div className="rounded-2xl relative z-20 p-3.5 sm:p-6 lg:p-8 border-[3px] border-[#30363d] bg-[#161b22] text-gray-100">
          <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-5">
            {/* Main URL Input Row */}
            <div className="flex flex-col sm:flex-row gap-2.5 sm:gap-3 items-stretch">
              <div className="relative flex-1 min-w-0">
                <div className="w-full h-full rounded bg-black translate-y-1 translate-x-1 absolute inset-0 z-10"></div>
                <div className="relative z-20 flex items-center bg-[#0d1117] border-[3px] border-[#30363d] focus-within:border-amber-400 rounded transition-colors">
                  <input
                    type="text"
                    value={url}
                    onChange={(e) => {
                      setUrl(e.target.value);
                      onUrlChange?.(e.target.value);
                    }}
                    placeholder="https://github.com/owner/repository"
                    required
                    className="w-full px-3.5 sm:px-5 py-2.5 sm:py-3.5 bg-transparent placeholder-gray-500 text-white font-medium text-xs sm:text-base focus:outline-none"
                  />
                </div>
              </div>

              <div className="relative shrink-0 flex items-center gap-2">
                <div className="w-full h-full rounded bg-black translate-y-1 translate-x-1 absolute inset-0 z-10"></div>
                {isLoading ? (
                  <div className="relative z-20 flex items-center gap-2 w-full sm:w-auto">
                    <div className="flex-1 sm:flex-initial px-4 sm:px-6 py-2.5 sm:py-3.5 rounded border-[3px] border-amber-500 font-extrabold text-sm sm:text-base bg-amber-500 text-gray-950 flex items-center justify-center gap-2 shadow-[2px_2px_0_0_#000000]">
                      <RefreshCw className="w-4 h-4 sm:w-5 sm:h-5 animate-spin" />
                      <span>Ingesting...</span>
                      {startTime && (
                        <span className="font-mono text-xs sm:text-sm bg-gray-950/15 px-1.5 py-0.5 rounded font-bold">
                          <IngestionTimer startTime={startTime} />
                        </span>
                      )}
                    </div>
                    {onCancel && (
                      <button
                        type="button"
                        onClick={onCancel}
                        className="px-4 py-2.5 sm:py-3.5 rounded border-[3px] border-red-600 font-extrabold text-sm sm:text-base bg-red-600 hover:bg-red-500 text-white flex items-center justify-center gap-1.5 cursor-pointer shadow-[2px_2px_0_0_#000000] active:translate-y-0.5 transition-transform"
                        title="Cancel current ingestion"
                      >
                        <XCircle className="w-4 h-4" />
                        <span>Cancel</span>
                      </button>
                    )}
                  </div>
                ) : (
                  <button
                    type="submit"
                    disabled={!url.trim()}
                    className="w-full sm:w-auto relative z-20 px-5 sm:px-8 py-2.5 sm:py-3.5 rounded border-[3px] border-amber-500 font-extrabold text-sm sm:text-base lg:text-lg bg-amber-500 text-gray-950 hover:bg-amber-400 active:translate-y-0.5 active:translate-x-0.5 transition-all disabled:opacity-60 flex items-center justify-center gap-2 cursor-pointer shadow-[2px_2px_0_0_#000000]"
                  >
                    <span>Ingest</span>
                    <ArrowRight className="w-4 h-4 sm:w-5 sm:h-5" />
                  </button>
                )}
              </div>
            </div>

            {/* Dynamic Personal Repositories Section */}
            {userRepos.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 pt-0.5">
                <span className="text-[11px] sm:text-xs font-bold text-gray-400 uppercase tracking-wider mr-1 flex items-center gap-1">
                  <FolderGit2 className="w-3.5 h-3.5 text-amber-400" />
                  <span>Your Repos:</span>
                </span>

                {isLoadingRepos && (
                  <span className="text-[11px] text-gray-500 flex items-center gap-1">
                    <RefreshCw className="w-3 h-3 animate-spin text-amber-500" />
                    <span>Loading repos...</span>
                  </span>
                )}

                {!isLoadingRepos && userRepos.slice(0, 8).map((repo) => (
                  <button
                    key={repo.full_name}
                    type="button"
                    onClick={() => handleRepoClick(repo.full_name)}
                    className="text-[11px] sm:text-xs font-semibold px-2 py-1 bg-[#21262d] hover:bg-[#30363d] text-gray-200 hover:text-white rounded border border-[#30363d] hover:border-amber-500/60 transition-colors flex items-center gap-1 shadow-[1px_1px_0_0_#000000] cursor-pointer"
                    title={repo.is_private ? 'Private Repository' : 'Public Repository'}
                  >
                    {repo.is_private && <Lock className="w-3 h-3 text-amber-400 shrink-0" />}
                    <span className="truncate max-w-[140px] sm:max-w-none">{repo.name}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Controls Row: Pattern filter & Max Size Slider (up to 500 MB) */}
            <div className="pt-3 border-t-2 border-[#30363d] grid grid-cols-1 md:grid-cols-12 gap-3 sm:gap-4 items-center">
              {/* Pattern Type & Pattern Input */}
              <div className="md:col-span-7 relative">
                <div className="w-full h-full rounded bg-black translate-y-1 translate-x-1 absolute inset-0"></div>
                <div className="relative z-10 flex border-[3px] border-[#30363d] rounded bg-[#0d1117] focus-within:border-amber-400 transition-colors">
                  
                  {/* Custom Dropdown */}
                  <div className="relative shrink-0" ref={dropdownRef}>
                    <button
                      type="button"
                      onClick={() => setIsDropdownOpen((prev) => !prev)}
                      className="h-full bg-[#1e242c] hover:bg-[#252d37] font-extrabold text-[11px] sm:text-xs uppercase px-2.5 sm:px-3 py-2 border-r-2 border-[#30363d] text-amber-400 flex items-center gap-1 focus:outline-none cursor-pointer transition-colors select-none"
                    >
                      <span>{patternType}</span>
                      <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`} />
                    </button>

                    {isDropdownOpen && (
                      <div className="absolute left-0 top-full mt-1.5 w-36 bg-[#161b22] border-2 border-amber-500/80 rounded-lg shadow-[4px_4px_0_0_#000000] py-1 z-50 overflow-hidden">
                        <button
                          type="button"
                          onClick={() => handlePatternTypeSelect('exclude')}
                          className={`w-full text-left px-3.5 py-2 text-xs font-bold uppercase tracking-wider flex items-center justify-between cursor-pointer transition-colors ${
                            patternType === 'exclude'
                              ? 'bg-amber-500/20 text-amber-300'
                              : 'text-gray-300 hover:bg-[#21262d] hover:text-white'
                          }`}
                        >
                          <span>EXCLUDE</span>
                          {patternType === 'exclude' && <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>}
                        </button>
                        <button
                          type="button"
                          onClick={() => handlePatternTypeSelect('include')}
                          className={`w-full text-left px-3.5 py-2 text-xs font-bold uppercase tracking-wider flex items-center justify-between cursor-pointer transition-colors ${
                            patternType === 'include'
                              ? 'bg-amber-500/20 text-amber-300'
                              : 'text-gray-300 hover:bg-[#21262d] hover:text-white'
                          }`}
                        >
                          <span>INCLUDE</span>
                          {patternType === 'include' && <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>}
                        </button>
                      </div>
                    )}
                  </div>

                  <input
                    type="text"
                    value={pattern}
                    onChange={(e) => handlePatternChange(e.target.value)}
                    placeholder="e.g. *.md, tests/, docs/"
                    className="w-full px-3 py-2 text-xs sm:text-sm text-white focus:outline-none placeholder-gray-500 font-mono bg-transparent min-w-0"
                  />
                </div>
              </div>

              {/* Max File Size Slider (1 MB to 500 MB) */}
              <div className="md:col-span-5 flex items-center justify-between gap-2.5 bg-[#0d1117] p-2 sm:p-2.5 rounded border-[3px] border-[#30363d] shadow-[2px_2px_0_0_#000000]">
                <span className="text-[10px] sm:text-xs font-extrabold text-gray-300 uppercase tracking-wider whitespace-nowrap">
                  Max Size:
                </span>
                <input
                  type="range"
                  min="1"
                  max="500"
                  step="5"
                  value={maxFileSize}
                  onChange={(e) => handleFileSizeChange(Number(e.target.value))}
                  className="w-full accent-amber-500 cursor-pointer"
                />
                <span className="text-[10px] sm:text-xs font-mono font-bold bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded border border-amber-500/50 whitespace-nowrap">
                  {maxFileSize} MB
                </span>
              </div>
            </div>

            {/* Private Repository / PAT Custom Status Bar */}
            <div className="p-2.5 sm:p-3 bg-[#0d1117] rounded-xl border-2 border-[#30363d] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5">
              <div className="flex items-center gap-2">
                {tokenStatus.configured ? (
                  <>
                    <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                    <div className="text-[11px] sm:text-xs text-gray-300">
                      <span className="font-bold text-emerald-300">Private Repos Ready:</span>{' '}
                      {tokenStatus.user ? (
                        <span>Connected as <strong className="text-white">@{tokenStatus.user.login}</strong></span>
                      ) : (
                        <span>Saved PAT will auto-authenticate private repos</span>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <Key className="w-4 h-4 text-amber-400 shrink-0" />
                    <div className="text-[11px] sm:text-xs text-gray-300">
                      <span className="font-bold text-white">Private Repos:</span>{' '}
                      Configure Personal Access Token to unlock private repositories.
                    </div>
                  </>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto justify-between sm:justify-end">
                <label
                  className="flex items-center gap-1.5 cursor-pointer select-none text-[11px] sm:text-xs text-gray-300 hover:text-white px-2.5 py-1 rounded-lg border-2 border-[#30363d] bg-[#161b22] hover:border-amber-500/50 transition-colors shadow-[1px_1px_0_0_#000000]"
                  title="Decompile Java .class bytecode files into readable source code"
                >
                  <input
                    type="checkbox"
                    checked={decompileClasses}
                    onChange={(e) => handleDecompileChange(e.target.checked)}
                    className="w-3.5 h-3.5 accent-amber-500 rounded cursor-pointer"
                  />
                  <span className="font-bold text-gray-200">Decompile .class</span>
                </label>

                <button
                  type="button"
                  onClick={onOpenTokenModal}
                  className="text-[11px] sm:text-xs font-bold px-3 py-1 rounded-lg border-2 border-[#30363d] bg-[#21262d] text-gray-200 hover:bg-[#30363d] hover:text-white transition-colors shrink-0 shadow-[1px_1px_0_0_#000000] cursor-pointer"
                >
                  {tokenStatus.configured ? 'Manage PAT' : 'Configure PAT'}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
});
