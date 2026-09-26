FROM node:22-bookworm

WORKDIR /app

RUN apt-get update && \
    apt-get install -y \
    git \
    cmake \
    build-essential \
    libcurl4-openssl-dev \
    && rm -rf /var/lib/apt/lists/*

RUN git clone --depth 1 https://github.com/ggml-org/llama.cpp.git /tmp/llama.cpp

RUN cmake -S /tmp/llama.cpp \
    -B /tmp/llama.cpp/build \
    -DGGML_NATIVE=OFF \
    -DGGML_CURL=ON \
    -DLLAMA_BUILD_SERVER=ON \
    -DCMAKE_BUILD_TYPE=Release \
    && \
    cmake --build /tmp/llama.cpp/build \
    --target llama-server \
    -j2

RUN cp /tmp/llama.cpp/build/bin/llama-server /usr/local/bin/llama-server

COPY package.json package-lock.json ./

RUN npm install --omit=dev

COPY . .

ENV PORT=10000
ENV LLAMA_SERVER=/usr/local/bin/llama-server
ENV LLAMA_PORT=8081
ENV CONTEXT_SIZE=4096
ENV THREADS=2
ENV ENABLE_VISION=true

EXPOSE 10000

CMD ["node", "index.js"]