export type PatternType = 'exclude' | 'include';

export interface IngestRequest {
  input_text: string;
  max_file_size?: number; // In KB
  pattern_type?: PatternType;
  pattern?: string;
  token?: string;
}

export interface IngestResponse {
  summary: string;
  tree: string;
  content: string;
  repo_name?: string;
  files_analyzed?: number;
  estimated_tokens?: string;
  total_chars?: number;
  error?: string;
}

export interface GitHubUser {
  id?: number;
  node_id?: string;
  login: string;
  avatar_url: string;
  name?: string;
  html_url?: string;
}

export interface TokenStatus {
  configured: boolean;
  source: 'server_env' | 'saved_pat' | 'none';
  user?: GitHubUser | null;
}
