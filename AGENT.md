# Agent Development Guide for obs-shogi

## Commands
- **Dev**: `npm run dev` - Start Vite dev server
- **Build**: `npm run build` - TypeScript compilation + Vite build  
- **Lint**: `npm run lint` - ESLint check
- **Tauri Dev**: `npm run tauri dev` - Start Tauri app in dev mode
- **No test runner configured** - Manual testing required

## Architecture
- **Tauri app**: React frontend + Rust backend for shogi game analysis and OBS integration
- **Frontend**: React 19 + TypeScript + Vite, uses React Router for navigation
- **Backend**: Rust with tauri-build, shogi engine integration via USI protocol
- **Key modules**: `src/contexts/` (React contexts), `src/services/` (business logic), `src-tauri/src/engine/` (shogi engine)
- **File structure**: kifu file management, game analysis, position tracking

## Code Style
- **Imports**: Use `@/*` path aliases (baseUrl: "./src"), import React components with proper casing
- **TypeScript**: Strict typing, interfaces in `src/interfaces/`, no implicit any
- **React**: Functional components with hooks, Context providers for state management
- **Naming**: PascalCase for components, camelCase for functions/variables, kebab-case for files
- **Error handling**: Use Result types in Rust, proper error boundaries in React
- **Formatting**: ESLint with react-hooks and react-refresh rules, no semicolons enforced
