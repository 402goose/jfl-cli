SHELL := /bin/bash

IMAGE := claude-pro-dev:latest
SERVICE := dev

JFL_VERSION ?= 0.3.0
JFL_LOCAL_PATH ?=
JFL_TGZ_PATH ?=

.PHONY: build rebuild shell jfl-030 jfl-latest jfl-local jfl-tgz doctor clean clean-all

build:
	docker compose build

rebuild:
	docker compose build --no-cache

shell:
	docker compose run --rm $(SERVICE)

jfl-030:
	JFL_VERSION=0.3.0 docker compose run --rm $(SERVICE)

jfl-latest:
	JFL_VERSION=latest docker compose run --rm $(SERVICE)

jfl-local:
	@if [ -z "$(JFL_LOCAL_PATH)" ]; then \
		echo "Set JFL_LOCAL_PATH, e.g. make jfl-local JFL_LOCAL_PATH=/opt/jfl-local"; \
		exit 1; \
	fi
	JFL_LOCAL_PATH=$(JFL_LOCAL_PATH) docker compose run --rm $(SERVICE)

jfl-tgz:
	@if [ -z "$(JFL_TGZ_PATH)" ]; then \
		echo "Set JFL_TGZ_PATH, e.g. make jfl-tgz JFL_TGZ_PATH=/opt/jfl.tgz"; \
		exit 1; \
	fi
	JFL_TGZ_PATH=$(JFL_TGZ_PATH) docker compose run --rm $(SERVICE)

doctor:
	docker compose run --rm \
		-e JFL_VERSION=$(JFL_VERSION) \
		$(SERVICE) \
		zsh -lc 'echo "PATH=$$PATH"; echo "--- jfl"; type -a jfl || true; which jfl || true; jfl --version || true; echo "--- npm global"; npm ls -g --depth=0 || true; echo "--- claude"; claude --version || true; claude auth status || true; echo "--- toolchain"; node -v; npm -v; pnpm -v; yarn -v; python3 --version; rustc --version'

clean:
	docker compose down --remove-orphans

clean-all:
	docker compose down -v --remove-orphans
	docker image rm $(IMAGE) || true