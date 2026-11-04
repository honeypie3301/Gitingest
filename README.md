# GitDigest

A high-performance codebase ingestion tool designed to convert any Git repository, local directory, or archive into clean, LLM-ready text digests.

## Key Features

- **Fast Ingestion Engine**: Speeds up codebase analysis with speculative GitHub zipball extraction and native Git CLI fallback strategies.
- **Local Directory Support**: Analyzes local filesystem folders completely offline with zero network calls and rate limit constraints.
- **Java Class Bytecode Decompiler**: Optionally decompiles Java `.class` files into readable source code inline.
- **Flexible Pattern Filtering**: Easily filter repository content using include/exclude wildcard patterns (e.g., `*.md, tests/, docs/`).
- **Configurable Max File Size**: Custom size threshold slider, direct numeric input, and dynamic unit switcher (KB, MB, GB).
- **Personal Access Token Integration**: Auto-authenticates private repositories via custom GitHub Personal Access Tokens (PAT) or local GitHub CLI (`gh`) session.
- **Multi-Workflow Sessions**: Work with up to 10 concurrent repository ingestion tabs in a dark neo-brutalist interface.
- **Multiple Export Formats**: Copy or download formatted code dumps, ASCII file trees, and token count estimations calculated for LLM context windows.

## Running Locally

### Prerequisites

- Node.js (v18+)
- Git CLI (optional, for private repos and offline fallback)

### Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the development server:
   ```bash
   npm run dev
   ```

3. Open your browser and navigate to `http://localhost:3000`.
