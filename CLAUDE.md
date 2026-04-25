# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a VitePress-based documentation site for SystemC learning notes. It covers core language concepts and simulation scheduling mechanisms.

## Commands

```bash
# Install dependencies
bun install

# Start local dev server
bun docs:dev

# Build for production
bun docs:build

# Preview production build
bun docs:preview
```

## Architecture

- Content lives in `docs/*.md` (schedule.md, communication.md, process.md)
- VitePress config: `docs/.vitepress/config.mts`
