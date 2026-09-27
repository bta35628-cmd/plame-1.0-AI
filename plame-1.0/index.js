const express = require("express");

const app = express();

const PORT = Number(process.env.PORT || 10000);

const PUBLIC_MODEL = "pipo/plame-1.0";
const UPSTREAM_MODEL = "llama3.1-8B";

const UPSTREAM_URL =
  process.env.UPSTREAM_URL ||
  "https://cj2api.keh5.workers.dev/v1/chat/completions";

app.disable("x-powered-by");

app.use(
  express.json({
    limit: "50mb"
  })
);

// ==============================
// CORS
// ==============================

app.use((req, res, next) => {
  res.setHeader(
    "Access-Control-Allow-Origin",
    "*"
  );

  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );

  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, OPTIONS"
  );

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  next();
});

// ==============================
// ERROR
// ==============================

function apiError(
  res,
  status,
  message,
  type = "invalid_request_error"
) {
  return res.status(status).json({
    error: {
      message,
      type,
      param: null,
      code: null
    }
  });
}

// ==============================
// PUBLIC MODEL
// ==============================

function publicModel() {
  return {
    id: PUBLIC_MODEL,
    object: "model",
    created: Math.floor(Date.now() / 1000),
    owned_by: "plame"
  };
}

// ==============================
// HOME
// ==============================

app.get("/", (req, res) => {
  res.json({
    name: "PLAME 1.0",
    id: PUBLIC_MODEL,

    model: PUBLIC_MODEL,

    upstream_model: UPSTREAM_MODEL,

    upstream_url: UPSTREAM_URL,

    vision: true,

    endpoints: {
      models: "/v1/models",
      chat: "/v1/chat/completions",
      health: "/health"
    }
  });
});

// ==============================
// HEALTH
// ==============================

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    model: PUBLIC_MODEL,
    upstream_model: UPSTREAM_MODEL,
    vision: true
  });
});

// ==============================
// ONLY ONE MODEL
// ==============================

app.get("/v1/models", (req, res) => {
  res.json({
    object: "list",

    data: [
      publicModel()
    ]
  });
});

// ==============================
// HEADERS
// ==============================

function createUpstreamHeaders(req) {
  const headers = {
    "Content-Type": "application/json"
  };

  const clientAuthorization =
    req.get("authorization");

  if (clientAuthorization) {
    headers.Authorization =
      clientAuthorization;
  }

  if (process.env.UPSTREAM_API_KEY) {
    headers.Authorization =
      "Bearer " +
      process.env.UPSTREAM_API_KEY;
  }

  return headers;
}

// ==============================
// CHECK VISION CONTENT
// ==============================

function containsVisionContent(messages) {
  for (const message of messages) {
    if (!message || typeof message !== "object") {
      continue;
    }

    if (!Array.isArray(message.content)) {
      continue;
    }

    for (const part of message.content) {
      if (!part || typeof part !== "object") {
        continue;
      }

      if (part.type === "image_url") {
        return true;
      }

      if (
        part.type === "input_image" ||
        part.type === "image"
      ) {
        return true;
      }
    }
  }

  return false;
}

// ==============================
// CHAT COMPLETIONS
// ==============================

app.post(
  "/v1/chat/completions",
  async (req, res) => {
    try {
      const body = req.body || {};

      // messages required
      if (!Array.isArray(body.messages)) {
        return apiError(
          res,
          400,
          "messages must be an array"
        );
      }

      // Only pipo/plame-1.0 is accepted
      if (
        body.model &&
        body.model !== PUBLIC_MODEL
      ) {
        return apiError(
          res,
          400,
          "Only model " +
            PUBLIC_MODEL +
            " is supported"
        );
      }

      const isVision =
        containsVisionContent(
          body.messages
        );

      /*
       * IMPORTANT:
       *
       * We do NOT modify:
       *
       * messages[].content
       * image_url
       * image data
       * base64 image
       * image URLs
       *
       * Vision content is forwarded unchanged.
       */

      const upstreamBody = {
        ...body,

        // Public model -> upstream model
        model: UPSTREAM_MODEL
      };

      // Optional metadata header
      // This does not modify the request body.
      const headers =
        createUpstreamHeaders(req);

      if (isVision) {
        headers["X-PLAME-Vision"] = "true";
      }

      console.log(
        "Request:",
        isVision
          ? "VISION"
          : "TEXT"
      );

      // ==============================
      // SEND TO UPSTREAM
      // ==============================

      const upstreamResponse =
        await fetch(
          UPSTREAM_URL,
          {
            method: "POST",

            headers,

            body: JSON.stringify(
              upstreamBody
            )
          }
        );

      const contentType =
        upstreamResponse.headers.get(
          "content-type"
        ) || "";

      // ==============================
      // UPSTREAM ERROR
      // ==============================

      if (!upstreamResponse.ok) {
        const errorText =
          await upstreamResponse.text();

        res.status(
          upstreamResponse.status
        );

        res.setHeader(
          "Content-Type",
          contentType ||
            "application/json"
        );

        return res.send(errorText);
      }

      // ==============================
      // STREAMING
      // ==============================

      if (
        body.stream === true ||
        contentType.includes(
          "text/event-stream"
        )
      ) {
        res.status(
          upstreamResponse.status
        );

        res.setHeader(
          "Content-Type",
          "text/event-stream"
        );

        res.setHeader(
          "Cache-Control",
          "no-cache"
        );

        res.setHeader(
          "Connection",
          "keep-alive"
        );

        if (!upstreamResponse.body) {
          return res.end();
        }

        const reader =
          upstreamResponse.body
            .getReader();

        while (true) {
          const chunk =
            await reader.read();

          if (chunk.done) {
            break;
          }

          res.write(
            Buffer.from(
              chunk.value
            )
          );
        }

        return res.end();
      }

      // ==============================
      // NORMAL JSON
      // ==============================

      const responseText =
        await upstreamResponse.text();

      try {
        const data =
          JSON.parse(responseText);

        // Return the public PLAME ID
        data.model =
          PUBLIC_MODEL;

        return res
          .status(
            upstreamResponse.status
          )
          .json(data);

      } catch {
        res.setHeader(
          "Content-Type",
          contentType ||
            "application/json"
        );

        return res
          .status(
            upstreamResponse.status
          )
          .send(responseText);
      }

    } catch (error) {
      console.error(
        "PLAME proxy error:",
        error
      );

      return apiError(
        res,
        502,
        error.message ||
          "Upstream request failed",
        "upstream_error"
      );
    }
  }
);

// ==============================
// START
// ==============================

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      "================================"
    );

    console.log(
      "          PLAME 1.0"
    );

    console.log(
      "================================"
    );

    console.log(
      "Port: " + PORT
    );

    console.log(
      "Public model: " +
        PUBLIC_MODEL
    );

    console.log(
      "Upstream model: " +
        UPSTREAM_MODEL
    );

    console.log(
      "Upstream: " +
        UPSTREAM_URL
    );

    console.log(
      "Vision: ENABLED"
    );

    console.log(
      "Local model: NONE"
    );

    console.log(
      "================================"
    );
  }
);
