# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a VitePress-based documentation site for SystemC learning notes. It covers core language concepts and simulation scheduling mechanisms.

## Commands

```bash
# Install dependencies
pnpm install

# Start local dev server
pnpm docs:dev

# Build for production
pnpm docs:build

# Preview production build
pnpm docs:preview
```

## Architecture

- Content lives in `docs/*.md` (schedule.md, communication.md, process.md)
- VitePress config: `docs/.vitepress/config.mts`