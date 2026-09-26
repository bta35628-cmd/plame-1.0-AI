const express = require("express");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const app = express();

const PORT = Number(process.env.PORT || 10000);

const MODEL_NAME = "plame-1.0";

const MODEL_PATH =
  process.env.MODEL_PATH ||
  path.join(__dirname, "models", "plame-1.0.gguf");

const MMPROJ_PATH =
  process.env.MMPROJ_PATH ||
  path.join(__dirname, "models", "plame-1.0-mmproj.gguf");

const LLAMA_SERVER =
  process.env.LLAMA_SERVER ||
  (process.platform === "win32"
    ? "llama-server.exe"
    : "llama-server");

const LLAMA_PORT = Number(process.env.LLAMA_PORT || 8081);

let llamaProcess = null;

app.use(express.json({
  limit: "50mb"
}));

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );
  res.header(
    "Access-Control-Allow-Methods",
    "GET, POST, OPTIONS"
  );

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

function publicModel() {
  return {
    id: MODEL_NAME,
    object: "model",
    created: Math.floor(Date.now() / 1000),
    owned_by: "plame"
  };
}

app.get("/", (req, res) => {
  res.json({
    name: "Plame 1.0",
    model: MODEL_NAME,
    status: "online",
    endpoints: {
      models: "/v1/models",
      chat: "/v1/chat/completions",
      health: "/health"
    }
  });
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    model: MODEL_NAME,
    llamaServer: Boolean(llamaProcess)
  });
});

app.get("/v1/models", (req, res) => {
  res.json({
    object: "list",
    data: [
      publicModel()
    ]
  });
});

function normalizeMessages(messages) {
  return messages.map(message => {
    if (!message || typeof message !== "object") {
      return message;
    }

    if (Array.isArray(message.content)) {
      const textParts = [];

      for (const part of message.content) {
        if (part.type === "text") {
          textParts.push(part.text || "");
        }

        if (part.type === "image_url") {
          textParts.push(
            "\n[IMAGE INPUT]\n"
          );
        }
      }

      return {
        role: message.role,
        content: textParts.join("\n")
      };
    }

    return {
      role: message.role,
      content: message.content
    };
  });
}

async function llamaRequest(body) {
  const url =
    `http://127.0.0.1:${LLAMA_PORT}/v1/chat/completions`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const text = await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(text);
  }

  if (!response.ok) {
    throw new Error(
      data.error?.message ||
      text ||
      `llama-server HTTP ${response.status}`
    );
  }

  return data;
}

async function llamaStream(body, res) {
  const url =
    `http://127.0.0.1:${LLAMA_PORT}/v1/chat/completions`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      ...body,
      stream: true
    })
  });

  if (!response.ok || !response.body) {
    const text = await response.text();

    throw new Error(text);
  }

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const reader = response.body.getReader();

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    res.write(Buffer.from(value));
  }

  res.end();
}

app.post("/v1/chat/completions", async (req, res) => {
  try {
    const body = req.body || {};

    if (!Array.isArray(body.messages)) {
      return res.status(400).json({
        error: {
          message: "messages must be an array",
          type: "invalid_request_error"
        }
      });
    }

    const messages = normalizeMessages(body.messages);

    const request = {
      model: MODEL_NAME,
      messages,

      temperature:
        typeof body.temperature === "number"
          ? body.temperature
          : 0.7,

      top_p:
        typeof body.top_p === "number"
          ? body.top_p
          : 0.95,

      max_tokens:
        typeof body.max_tokens === "number"
          ? body.max_tokens
          : 1024,

      stream: Boolean(body.stream)
    };

    if (body.stop !== undefined) {
      request.stop = body.stop;
    }

    if (body.seed !== undefined) {
      request.seed = body.seed;
    }

    if (body.stream) {
      await llamaStream(request, res);
      return;
    }

    const result = await llamaRequest(request);

    result.model = MODEL_NAME;

    res.json(result);

  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: {
        message: error.message || "Plame backend error",
        type: "server_error"
      }
    });
  }
});

async function waitForLlama(timeout = 120000) {
  const started = Date.now();

  while (Date.now() - started < timeout) {
    try {
      const response = await fetch(
        `http://127.0.0.1:${LLAMA_PORT}/health`
      );

      if (response.ok) {
        return true;
      }
    } catch {}

    await new Promise(resolve =>
      setTimeout(resolve, 1000)
    );
  }

  return false;
}

function startLlama() {
  if (!fs.existsSync(MODEL_PATH)) {
    console.warn(
      "Model file not found:",
      MODEL_PATH
    );

    console.warn(
      "Plame API will start, but inference will not work until a GGUF model is installed."
    );

    return;
  }

  const args = [
    "-m",
    MODEL_PATH,

    "--alias",
    MODEL_NAME,

    "--host",
    "127.0.0.1",

    "--port",
    String(LLAMA_PORT),

    "--ctx-size",
    process.env.CONTEXT_SIZE || "4096",

    "--threads",
    process.env.THREADS || "2",

    "--parallel",
    "1",

    "--jinja"
  ];

  if (
    fs.existsSync(MMPROJ_PATH) &&
    process.env.ENABLE_VISION !== "false"
  ) {
    args.push(
      "--mmproj",
      MMPROJ_PATH
    );
  }

  console.log(
    "Starting llama-server:"
  );

  console.log(
    LLAMA_SERVER,
    args.join(" ")
  );

  llamaProcess = spawn(
    LLAMA_SERVER,
    args,
    {
      stdio: "inherit"
    }
  );

  llamaProcess.on("exit", code => {
    console.log(
      `llama-server exited with code ${code}`
    );

    llamaProcess = null;
  });

  llamaProcess.on("error", error => {
    console.error(
      "Could not start llama-server:",
      error
    );
  });
}

app.listen(PORT, "0.0.0.0", async () => {
  console.log("");
  console.log("==============================");
  console.log("       PLAME 1.0");
  console.log("==============================");
  console.log(
    `API: http://0.0.0.0:${PORT}`
  );
  console.log(
    `Model: ${MODEL_NAME}`
  );
  console.log("==============================");
  console.log("");

  startLlama();

  const ready = await waitForLlama();

  if (ready) {
    console.log(
      "llama-server is ready."
    );
  } else {
    console.log(
      "llama-server is not ready yet."
    );
  }
});