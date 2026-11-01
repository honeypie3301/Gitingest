import React, { useState, useEffect } from 'react';
import { Key, CheckCircle, AlertCircle, X, Shield, ExternalLink, RefreshCw, Lock, Unlock, UserCheck, ShieldCheck } from 'lucide-react';
import { verifyGitHubToken } from '../services/githubApi';
import {
  getSavedToken,
  setSavedToken,
  getAutoInjectToken,
  setAutoInjectToken,
  OWNER_GITHUB_LOGIN,
  OWNER_GITHUB_ID,
  isVerifiedOwner,
} from '../services/ingest';
import { GitHubUser } from '../types';

interface TokenModalProps {
  isOpen: boolean;
  onClose: () => void;
  onTokenUpdated: () => void;
}

export const TokenModal: React.FC<TokenModalProps> = ({ isOpen, onClose, onTokenUpdated }) => {
  const [tokenInput, setTokenInput] = useState('');
  const [autoInject, setAutoInject] = useState(true);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifiedUser, setVerifiedUser] = useState<GitHubUser | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'token' | 'owner_lock'>('token');

  useEffect(() => {
    if (isOpen) {
      const current = getSavedToken();
      setTokenInput(current);
      setAutoInject(getAutoInjectToken());
      if (current) {
        verify(current);
      }
    }
  }, [isOpen]);

  const verify = async (token: string) => {
    if (!token.trim()) {
      setVerifiedUser(null);
      setVerifyError(null);
      return;
    }
    setIsVerifying(true);
    setVerifyError(null);
    try {
      const user = await verifyGitHubToken(token);
      if (user) {
        setVerifiedUser(user);
        setVerifyError(null);
      } else {
        setVerifiedUser(null);
        setVerifyError('Invalid token or expired. Make sure it has "repo" scope for private repositories.');
      }
    } catch {
      setVerifyError('Failed to verify token with GitHub.');
    } finally {
      setIsVerifying(false);
    }
  };

  const handleSave = () => {
    setSavedToken(tokenInput.trim());
    setAutoInjectToken(autoInject);
    onTokenUpdated();
    onClose();
  };

  const handleClear = () => {
    setSavedToken('');
    setTokenInput('');
    setVerifiedUser(null);
    setVerifyError(null);
    onTokenUpdated();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs">
      <div className="relative w-full max-w-lg">
        {/* Dark Brutalist Shadow Box */}
        <div className="absolute inset-0 bg-black rounded-xl translate-x-2 translate-y-2"></div>
        <div className="relative bg-[#161b22] border-[3px] border-[#30363d] rounded-xl p-6 sm:p-8 z-10 text-gray-100">
          {/* Header */}
          <div className="flex items-center justify-between pb-4 border-b-2 border-[#30363d] mb-5">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-amber-500/20 border-2 border-amber-500/60 rounded-lg">
                <Key className="w-6 h-6 text-amber-400" />
              </div>
              <div>
                <h3 className="text-xl font-extrabold text-white">Access & Security Settings</h3>
                <p className="text-xs text-gray-400">PAT Persistence & Owner Protection</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1 rounded-lg hover:bg-[#21262d] border-2 border-[#30363d] transition-colors text-gray-400 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Navigation Tabs */}
          <div className="flex border-b-2 border-[#30363d] mb-5">
            <button
              onClick={() => setActiveTab('token')}
              className={`pb-2.5 px-3 text-xs font-bold uppercase tracking-wider transition-colors border-b-2 -mb-0.5 ${
                activeTab === 'token'
                  ? 'border-amber-400 text-amber-400'
                  : 'border-transparent text-gray-400 hover:text-gray-200'
              }`}
            >
              Personal Access Token
            </button>
            <button
              onClick={() => setActiveTab('owner_lock')}
              className={`pb-2.5 px-3 text-xs font-bold uppercase tracking-wider transition-colors border-b-2 -mb-0.5 flex items-center gap-1.5 ${
                activeTab === 'owner_lock'
                  ? 'border-amber-400 text-amber-400'
                  : 'border-transparent text-gray-400 hover:text-gray-200'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Owner Account & Backup</span>
            </button>
          </div>

          {activeTab === 'token' ? (
            <div className="space-y-4">
              {/* Token Input */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-300 mb-1.5">
                  Personal Access Token (classic or fine-grained)
                </label>
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={tokenInput}
                    onChange={(e) => {
                      setTokenInput(e.target.value);
                      setVerifiedUser(null);
                      setVerifyError(null);
                    }}
                    onBlur={() => {
                      if (tokenInput.trim().length > 15) {
                        verify(tokenInput);
                      }
                    }}
                    placeholder="ghp_... or github_pat_..."
                    className="flex-1 px-4 py-2.5 bg-[#0d1117] border-2 border-[#30363d] rounded-lg font-mono text-sm focus:outline-none focus:border-amber-400 text-white placeholder-gray-500"
                  />
                  <button
                    type="button"
                    onClick={() => verify(tokenInput)}
                    disabled={isVerifying || !tokenInput.trim()}
                    className="px-4 py-2.5 bg-[#21262d] hover:bg-[#30363d] border-2 border-[#30363d] text-amber-400 font-bold rounded-lg text-xs cursor-pointer disabled:opacity-50 transition-colors"
                  >
                    Verify
                  </button>
                </div>
              </div>

              {/* Status */}
              {isVerifying && (
                <div className="flex items-center gap-2 text-xs text-amber-400 font-medium">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Validating token with GitHub API...</span>
                </div>
              )}

              {verifiedUser && (
                <div className="flex items-center gap-3 p-3 bg-emerald-950/40 border-2 border-emerald-600/60 rounded-lg text-emerald-200 text-xs">
                  <img
                    src={verifiedUser.avatar_url}
                    alt={verifiedUser.login}
                    className="w-8 h-8 rounded-full border border-emerald-500"
                  />
                  <div>
                    <div className="flex items-center gap-1 font-bold text-emerald-300">
                      <CheckCircle className="w-4 h-4 text-emerald-400" />
                      <span>Authenticated as @{verifiedUser.login}</span>
                    </div>
                    <span className="text-emerald-400">
                      {isVerifiedOwner(verifiedUser) ? 'Verified Owner Account' : 'External GitHub Account'}
                    </span>
                  </div>
                </div>
              )}

              {verifyError && (
                <div className="flex items-start gap-2 p-3 bg-red-950/40 border-2 border-red-700/60 rounded-lg text-red-200 text-xs">
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  <span>{verifyError}</span>
                </div>
              )}

              {/* Auto-inject */}
              <div className="flex items-center justify-between pt-1">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={autoInject}
                    onChange={(e) => setAutoInject(e.target.checked)}
                    className="w-4 h-4 accent-amber-500 rounded cursor-pointer"
                  />
                  <span className="text-xs font-semibold text-gray-200">
                    Auto-inject token for all private repos
                  </span>
                </label>

                <a
                  href="https://github.com/settings/tokens/new?description=GitIngest-Personal&scopes=repo"
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-amber-400 hover:text-amber-300 underline flex items-center gap-1 font-medium"
                >
                  <span>New token</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          ) : (
            /* Owner Lock & Backup Tab */
            <div className="space-y-4">
              <div className="text-xs leading-relaxed bg-[#0d1117] p-3.5 rounded-lg border-2 border-[#30363d] text-gray-300">
                <div className="flex items-start gap-2">
                  <ShieldCheck className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
                  <div>
                    <span className="font-bold text-white">Owner Account Restriction</span>
                    <p className="mt-1">
                      This instance strictly permits access exclusively to your GitHub account:{' '}
                      <span className="text-amber-400 font-bold">@{OWNER_GITHUB_LOGIN}</span>.
                    </p>
                  </div>
                </div>
              </div>

              <div className="p-3.5 bg-[#0d1117] border-2 border-[#30363d] rounded-lg space-y-2 text-xs">
                <div className="flex items-center justify-between text-gray-300">
                  <span className="font-semibold text-gray-400">Authorized GitHub Username:</span>
                  <span className="font-mono text-amber-400 font-bold">@{OWNER_GITHUB_LOGIN}</span>
                </div>
                <div className="flex items-center justify-between text-gray-300">
                  <span className="font-semibold text-gray-400">Immutable Account ID:</span>
                  <span className="font-mono text-white">{OWNER_GITHUB_ID}</span>
                </div>
                <div className="text-[11px] text-gray-400 pt-1 border-t border-[#21262d]">
                  Verification checks your immutable numerical GitHub ID (<code className="text-amber-400">84184414</code>) so no other user with the same username can access your app.
                </div>
              </div>

              <div className="p-3.5 bg-amber-950/20 border-2 border-amber-600/40 rounded-lg text-xs space-y-1.5">
                <span className="font-bold text-amber-300 block">Server-Side Secret Access Key</span>
                <p className="text-gray-300 text-[11px] leading-relaxed">
                  Configured via <code className="text-amber-400">OWNER_ACCESS_KEY</code> in your deployment environment variables (.env / Vercel). Verified strictly on the server to prevent exposure.
                </p>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex items-center justify-between gap-4 pt-5 mt-6 border-t-2 border-[#30363d]">
            {tokenInput ? (
              <button
                type="button"
                onClick={handleClear}
                className="px-4 py-2 border-2 border-red-900/60 rounded-lg text-xs font-bold bg-red-950/40 text-red-300 hover:bg-red-900/60 transition-colors"
              >
                Clear Token
              </button>
            ) : (
              <div></div>
            )}

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 border-2 border-[#30363d] rounded-lg text-xs font-bold bg-[#21262d] text-gray-300 hover:bg-[#30363d] transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                className="px-5 py-2 border-2 border-amber-500 rounded-lg text-xs font-bold bg-amber-500 text-gray-950 hover:bg-amber-400 transition-colors brutal-shadow-sm font-mono"
              >
                Save Settings
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
