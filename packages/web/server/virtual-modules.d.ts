// ABOUTME: Type declarations for Vite-only virtual modules used by React Router SSR
// ABOUTME: Allows `tsc --noEmit` to typecheck server code without Vite

declare module 'virtual:react-router/server-build' {
  const build: unknown;
  export default build;
}
