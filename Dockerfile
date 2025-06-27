FROM ubuntu:22.04

# Install basic dependencies
RUN apt-get update && apt-get install -y \
    curl \
    git \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 20.x
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs

# Create a non-root user for testing
RUN useradd -m -s /bin/bash laceuser

# Set working directory
WORKDIR /home/laceuser/lace

# Copy package files first for better caching
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy the rest of the application
COPY . .

# Build the application
RUN npm run build

# Change ownership to laceuser
RUN chown -R laceuser:laceuser /home/laceuser

# Switch to non-root user
USER laceuser

# Default command
CMD ["/bin/bash"]