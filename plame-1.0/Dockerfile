FROM node:22-bookworm

WORKDIR /app

# =========================
# 1. Build llama.cpp
# =========================
RUN apt-get update && \
    apt-get install -y \
        git \
        cmake \
        build-essential \
        libcurl4-openssl-dev \
        curl \
        ca-certificates && \
    rm -rf /var/lib/apt/lists/*

RUN git clone --depth 1 https://github.com/ggml-org/llama.cpp.git /tmp/llama.cpp

RUN cmake -S /tmp/llama.cpp \
    -B /tmp/llama.cpp/build \
    -DGGML_NATIVE=OFF \
    -DGGML_CURL=ON \
    -DLLAMA_BUILD_SERVER=ON \
    -DCMAKE_BUILD_TYPE=Release && \
    cmake --build /tmp/llama.cpp/build \
    --target llama-server \
    -j2 && \
    cp /tmp/llama.cpp/build/bin/llama-server /usr/local/bin/llama-server

# =========================
# 2. Node.js application
# =========================
COPY package.json package-lock.json ./

RUN npm install --omit=dev

COPY . .

# =========================
# 3. Download Plame 1.0 model
# =========================
RUN mkdir -p /app/models

RUN curl -L --fail --retry 5 \
    -o /app/models/plame-1.0.gguf \
    "https://huggingface.co/ggml-org/Qwen2.5-VL-3B-Instruct-GGUF/resolve/main/Qwen2.5-VL-3B-Instruct-Q4_K_M.gguf"

# =========================
# 4. Download Vision Projector
# =========================
RUN curl -L --fail --retry 5 \
    -o /app/models/plame-1.0-mmproj.gguf \
    "https://huggingface.co/ggml-org/Qwen2.5-VL-3B-Instruct-GGUF/resolve/main/mmproj-Qwen2.5-VL-3B-Instruct-Q8_0.gguf"

# =========================
# 5. Environment
# =========================
ENV PORT=10000
ENV LLAMA_SERVER=/usr/local/bin/llama-server
ENV LLAMA_PORT=8081

ENV CONTEXT_SIZE=4096
ENV THREADS=2
ENV ENABLE_VISION=true

ENV MODEL_NAME=plame-1.0
ENV MODEL_PATH=/app/models/plame-1.0.gguf
ENV MMPROJ_PATH=/app/models/plame-1.0-mmproj.gguf

EXPOSE 10000

# =========================
# 6. Start Plame
# =========================
CMD ["node", "index.js"]
