FROM python:3.11-slim

# Install Node.js
RUN apt-get update && apt-get install -y \
    curl \
    ffmpeg \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Install yt-dlp
RUN pip install yt-dlp

WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm install

# Copy server
COPY server.js ./

EXPOSE 3001

CMD ["node", "server.js"]
