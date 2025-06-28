FROM node:24

# Install development dependencies including ripgrep and Python for native modules
RUN apt-get update && apt-get install -y \
    curl \
    git \
    build-essential \
    python3 \
    python3-dev \
    ripgrep \
    vim \
    nano \
    htop \
    procps \
    && rm -rf /var/lib/apt/lists/*

# Create user first
RUN useradd -rm -d /home/laceuser -s /bin/bash -g root -G sudo -u 1001 laceuser

# Set working directory
WORKDIR /home/laceuser/lace

# Create node_modules directory and set ownership
RUN mkdir -p /home/laceuser/lace/node_modules && \
    chown -R laceuser:root /home/laceuser

# Switch to non-root user
USER laceuser

# Default to bash for development
CMD ["/bin/bash"]
