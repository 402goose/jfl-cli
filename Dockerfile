FROM node:20-bullseye-slim

ENV DEBIAN_FRONTEND=noninteractive
ENV SHELL=/bin/zsh
ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8
ENV PNPM_HOME=/root/.local/share/pnpm
ENV PATH=/usr/local/bin:/usr/local/sbin:/usr/sbin:/usr/bin:/sbin:/bin:/root/.cargo/bin:/root/.local/bin:${PNPM_HOME}

RUN set -eux; \
  apt-get update; \
  apt-get install -y --no-install-recommends \
    bash \
    zsh \
    curl \
    wget \
    git \
    ca-certificates \
    openssh-client \
    procps \
    less \
    jq \
    unzip \
    xz-utils \
    zip \
    make \
    gcc \
    g++ \
    python3 \
    python3-pip \
    python3-venv \
    ripgrep \
    fd-find \
    fzf \
    bat \
    tmux \
    sqlite3 \
    file \
    tree; \
  rm -rf /var/lib/apt/lists/*

RUN ln -sf /usr/bin/fdfind /usr/local/bin/fd && \
    ln -sf /usr/bin/batcat /usr/local/bin/bat

RUN corepack enable && \
    corepack prepare pnpm@latest --activate && \
    corepack prepare yarn@stable --activate

RUN npm install -g \
  @anthropic-ai/claude-code \
  typescript \
  ts-node \
  npm-check-updates \
  zx

RUN pip3 install --no-cache-dir uv

RUN curl https://sh.rustup.rs -sSf | sh -s -- -y --profile minimal && \
  /root/.cargo/bin/rustup component add rustfmt clippy

WORKDIR /workspace

RUN mkdir -p \
  /root/.config/claude \
  /root/.npm \
  /root/.pnpm-store \
  /root/.cache \
  /root/.ssh \
  /opt/bin

COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

RUN printf '%s\n' \
  'export PATH=/usr/local/bin:/usr/local/sbin:/usr/sbin:/usr/bin:/sbin:/bin:/root/.cargo/bin:/root/.local/bin:$PNPM_HOME:$PATH' \
  'export BAT_THEME=ansi' \
  'alias ll="ls -la"' \
  'alias la="ls -A"' \
  'alias l="ls -CF"' \
  'alias cat="bat --paging=never"' \
  'cd /workspace' \
  > /root/.zshrc

ENTRYPOINT ["/entrypoint.sh"]
CMD ["zsh"]