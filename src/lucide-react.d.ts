// lucide-react ships only a legacy `typings` field (no `types`/`exports` map),
// which `moduleResolution: "bundler"` ignores — so tsc resolves to the CJS
// build with no sibling declaration. Re-export the bundled, self-contained
// type declarations to keep full type safety.
declare module 'lucide-react' {
  export * from 'lucide-react/dist/lucide-react';
}
