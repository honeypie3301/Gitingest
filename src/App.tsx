import React, { useState, useEffect, useRef } from 'react';
import { Navbar } from './components/Navbar';
import { GitForm } from './components/GitForm';
import { ResultSection } from './components/ResultSection';
import { TokenModal } from './components/TokenModal';
import { SparkleRed, SparkleGreen } from './components/Sparkles';
import {
  performIngest,
  checkServerTokenStatus,
  getSavedToken,
  setSavedToken,
  isVerifiedOwner,
  verifyBackupKey,
  isSessionUnlocked,
  setSessionUnlocked,
  OWNER_GITHUB_LOGIN,
  OWNER_GITHUB_ID,
} from './services/ingest';
import { verifyGitHubToken } from './services/githubApi';
import { IngestRequest, IngestResponse, TokenStatus } from './types';
import { Lock, ShieldCheck, Key, CheckCircle, AlertCircle, RefreshCw } from 'lucide-react';

export default function App() {
  const [result, setResult] = useState<IngestResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [ingestionStartTime, setIngestionStartTime] = useState<number | null>(null);
  const [ingestionDuration, setIngestionDuration] = useState<number | null>(null);
  const [isTokenModalOpen, setIsTokenModalOpen] = useState(false);
  const [tokenStatus, setTokenStatus] = useState<TokenStatus>({
    configured: false,
    source: 'none',
  });

  const [isLocked, setIsLocked] = useState(false);
  const [authInput, setAuthInput] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [isVerifyingAuth, setIsVerifyingAuth] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);

  const refreshTokens = async () => {
    const status = await checkServerTokenStatus();
    setTokenStatus(status);

    if (isSessionUnlocked()) {
      setIsLocked(false);
      return;
    }

    if (status.user && isVerifiedOwner(status.user)) {
      setSessionUnlocked(true);
      setIsLocked(false);
      return;
    }

    const savedPat = getSavedToken();
    if (savedPat) {
      try {
        const user = await verifyGitHubToken(savedPat);
        if (user && isVerifiedOwner(user)) {
          setSessionUnlocked(true);
          setIsLocked(false);
          setTokenStatus({
            configured: true,
            source: 'saved_pat',
            user,
          });
          return;
        }
      } catch {
        // Fall through to lock
      }
    }

    setIsLocked(true);
  };

  useEffect(() => {
    refreshTokens();
  }, []);

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    const input = authInput.trim();
    if (!input) return;

    setAuthError(null);
    setIsVerifyingAuth(true);

    try {
      // 1. Check if backup key was entered
      if (verifyBackupKey(input)) {
        setSessionUnlocked(true);
        setIsLocked(false);
        setAuthError(null);
        setAuthInput('');
        return;
      }

      // 2. Otherwise verify as GitHub Personal Access Token
      const user = await verifyGitHubToken(input);
      if (!user) {
        setAuthError('Invalid GitHub token or failed to verify. You can also enter your backup key.');
        return;
      }

      if (!isVerifiedOwner(user)) {
        setAuthError(
          `Unauthorized: Signed in as @${user.login} (ID: ${user.id ?? 'unknown'}). This instance is strictly restricted to @${OWNER_GITHUB_LOGIN} (ID: ${OWNER_GITHUB_ID}).`
        );
        return;
      }

      // Validated as owner
      setSavedToken(input);
      setSessionUnlocked(true);
      setIsLocked(false);
      setAuthError(null);
      setAuthInput('');
      setTokenStatus({
        configured: true,
        source: 'saved_pat',
        user,
      });
    } catch {
      setAuthError('Network error while verifying GitHub account. Please try again or use the backup key.');
    } finally {
      setIsVerifyingAuth(false);
    }
  };

  const handleManualLock = () => {
    setSessionUnlocked(false);
    setIsLocked(true);
  };

  const handleCancel = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  };

  const handleIngest = async (req: IngestRequest) => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const startTime = Date.now();
    setIngestionStartTime(startTime);
    setIngestionDuration(null);
    setIsLoading(true);
    setError(null);
    setResult(null);

    try {
      const data = await performIngest(req, abortController.signal);
      if (data.error) {
        setError(data.error);
      } else {
        setIngestionDuration(Date.now() - startTime);
        setResult(data);
      }
    } catch (err: any) {
      if (err.name === 'AbortError' || abortController.signal.aborted || err.message?.includes('cancelled')) {
        setError('Ingestion was cancelled.');
      } else {
        setError(err.message || 'An unexpected error occurred while ingesting the repository.');
      }
    } finally {
      setIsLoading(false);
      setIngestionStartTime(null);
      abortControllerRef.current = null;
    }
  };

  const handleReset = () => {
    handleCancel();
    setResult(null);
    setError(null);
    setIsLoading(false);
    setIngestionStartTime(null);
    setIngestionDuration(null);
  };

  return (
    <div className="min-h-screen bg-[#0d1117] text-[#e6edf3] flex flex-col justify-between selection:bg-amber-500/30 selection:text-amber-200 w-full overflow-x-hidden">
      <div className="w-full">
        {/* Navigation Bar */}
        <Navbar
          tokenStatus={tokenStatus}
          isLocked={isLocked}
          onOpenTokenModal={() => setIsTokenModalOpen(true)}
          onReset={handleReset}
        />

        {/* If Owner Lock is active and visitor hasn't authenticated */}
        {isLocked ? (
          <div className="w-full max-w-md mx-auto px-4 pt-16 sm:pt-24 pb-16">
            <div className="relative">
              <div className="w-full h-full absolute inset-0 bg-black rounded-2xl translate-y-2 translate-x-2"></div>
              <div className="relative z-10 bg-[#161b22] border-[3px] border-[#30363d] rounded-2xl p-6 sm:p-8 text-center space-y-6">
                <div className="w-14 h-14 mx-auto rounded-full bg-amber-500/20 border-2 border-amber-500/50 flex items-center justify-center">
                  <ShieldCheck className="w-7 h-7 text-amber-400" />
                </div>
                <div>
                  <h2 className="text-xl sm:text-2xl font-extrabold text-white">Owner Access Restricted</h2>
                  <p className="text-xs text-gray-400 mt-1.5">
                    This personal instance is restricted to <span className="text-amber-400 font-bold">@{OWNER_GITHUB_LOGIN}</span> (ID: <span className="font-mono text-gray-300">{OWNER_GITHUB_ID}</span>).
                  </p>
                </div>

                <form onSubmit={handleUnlock} className="space-y-4">
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-300 mb-1.5 text-left">
                      GitHub PAT or Emergency Backup Key
                    </label>
                    <input
                      type="password"
                      value={authInput}
                      onChange={(e) => setAuthInput(e.target.value)}
                      placeholder="ghp_... or emergency backup key"
                      required
                      className="w-full px-4 py-2.5 bg-[#0d1117] border-2 border-[#30363d] focus:border-amber-400 rounded-lg text-white font-mono text-sm focus:outline-none placeholder-gray-500"
                    />
                  </div>

                  {authError && (
                    <div className="p-3 bg-red-950/40 border-2 border-red-700/60 rounded-lg text-red-300 text-xs text-left leading-relaxed">
                      {authError}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={isVerifyingAuth}
                    className="w-full py-2.5 px-4 rounded-lg bg-amber-500 hover:bg-amber-400 border-2 border-amber-600 text-gray-950 font-extrabold text-sm transition-transform cursor-pointer shadow-[2px_2px_0_0_#000000] flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {isVerifyingAuth ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>Verifying with GitHub...</span>
                      </>
                    ) : (
                      <>
                        <Lock className="w-4 h-4" />
                        <span>Verify & Unlock</span>
                      </>
                    )}
                  </button>

                  <div className="pt-2 text-[11px] text-gray-400 leading-normal text-left bg-[#0d1117] p-2.5 rounded-lg border border-[#30363d]">
                    <span className="font-bold text-gray-200">Security note:</span> Authenticating verifies your GitHub username and unique permanent ID (<code className="text-amber-400">84184414</code>). If offline, enter your emergency backup key.
                  </div>
                </form>
              </div>
            </div>
          </div>
        ) : (
          /* Main App View */
          <main className="w-full pt-6 sm:pt-10 pb-16">
            {/* Hero Section */}
            <div className="mb-6 sm:mb-10 text-center relative px-4">
              <div className="relative inline-block mx-auto">
                {/* Inline Sparkles never fail to load */}
                <SparkleRed className="sparkle-red hidden sm:block select-none" />
                <SparkleGreen className="sparkle-green hidden sm:block select-none" />

                <h1 className="landing-page-title text-3xl sm:text-5xl md:text-6xl font-black">
                  Prompt-friendly
                  <br />
                  codebase&nbsp;
                </h1>
              </div>

              <p className="mt-3 sm:mt-4 text-sm sm:text-base lg:text-lg text-gray-300 max-w-xl mx-auto font-medium">
                Turn any Git repository into a clean, consolidated text digest for LLMs.
              </p>
            </div>

            {/* Form */}
            <GitForm
              onIngest={handleIngest}
              isLoading={isLoading}
              startTime={ingestionStartTime}
              tokenStatus={tokenStatus}
              onOpenTokenModal={() => setIsTokenModalOpen(true)}
              onCancel={handleCancel}
            />

            {/* Result Area */}
            <ResultSection
              result={result}
              error={error}
              isLoading={isLoading}
              startTime={ingestionStartTime}
              durationMs={ingestionDuration}
              onCancel={handleCancel}
            />
          </main>
        )}
      </div>

      {/* Footer */}
      <footer className="border-t-[3px] border-[#30363d] bg-[#161b22] py-6 sm:py-8 mt-12 sm:mt-16 text-gray-300 w-full">
        <div className="max-w-6xl 2xl:max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 rounded bg-black border border-amber-500/60 flex items-center justify-center font-mono text-xs font-bold text-amber-400">
              G
            </div>
            <span className="text-sm font-extrabold text-white">GitIngest Personal</span>
            <span className="text-xs text-gray-400">| Vercel & GitHub Actions Ready</span>
          </div>

          <div className="flex items-center gap-4 text-xs font-bold text-gray-400">
            {!isLocked && (
              <button
                onClick={handleManualLock}
                className="hover:text-amber-400 transition-colors flex items-center gap-1 cursor-pointer text-amber-400/90"
                title="Lock this session"
              >
                <Lock className="w-3.5 h-3.5" />
                <span>Lock Session</span>
              </button>
            )}

            <button
              onClick={() => setIsTokenModalOpen(true)}
              className="hover:text-amber-400 transition-colors flex items-center gap-1 cursor-pointer"
            >
              <Lock className="w-3.5 h-3.5" />
              <span>PAT & Owner Lock</span>
            </button>
            <span>•</span>
            <a
              href="https://github.com/honeypie3301/gitingest"
              target="_blank"
              rel="noreferrer"
              className="hover:text-amber-400 transition-colors"
            >
              Source Repo
            </a>
          </div>
        </div>
      </footer>

      {/* Token & Security Modal */}
      <TokenModal
        isOpen={isTokenModalOpen}
        onClose={() => setIsTokenModalOpen(false)}
        onTokenUpdated={refreshTokens}
      />
    </div>
  );
}
