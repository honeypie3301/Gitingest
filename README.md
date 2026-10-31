# GitIngest (Personal Edition)

This repository is a customized fork of [GitIngest](https://github.com/coderamp-labs/gitingest) for private and personal use.

## Features
- **Private Repository Access**: Automatically uses saved Personal Access Tokens (PAT) so you never have to re-enter credentials.
- **Owner Security Gate**: Optional passcode lock to restrict access to authorized personal sessions.
- **Preference Persistence**: Automatically remembers your include/exclude pattern filters and file size preferences across sessions.
- **Optimized Ingestion**: Fast directory analysis and consolidated text digests with ASCII file trees and token metrics for LLMs.
- **Dark Mode**: Sleek neo-brutalist dark theme.
- **Deployment Ready**: Configured for deployment on GitHub Pages (static) and Vercel.

## Quick Start
```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for GitHub Pages
npm run build:static
```

## Credits
Based on the original [gitingest](https://github.com/coderamp-labs/gitingest) tool created by Romain Courtois and contributors.
