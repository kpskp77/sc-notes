set unstable

[private]
default:
  @just --list

[doc('start local dev server')]
serve:
  pnpm docs:dev

[doc('build for production')]
build:
  pnpm docs:build

[doc('preview production build')]
preview:
  pnpm docs:preview