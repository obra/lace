SHELL := /bin/bash

default: test

build:
	cargo build

test:
	cargo test

fmt:
	cargo fmt

clippy:
	cargo clippy --all-targets -- -D warnings

.PHONY: default build test fmt clippy
