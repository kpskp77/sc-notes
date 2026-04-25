set unstable

[private]
default:
  @just --list

[doc('start local dev server')]
serve:
  bun docs:dev

[doc('build for production')]
build:
  bun docs:build

[doc('preview production build')]
preview:
  bun docs:preview
