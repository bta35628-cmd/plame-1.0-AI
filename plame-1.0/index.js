const express = require("express");

const app = express();

const PORT = Number(process.env.PORT || 10000);

// =====================================================
// PLAME PUBLIC MODEL
// =====================================================

const PUBLIC_MODEL = "pipo/plame-1.0";

// =====================================================
// CHAT UPSTREAM
// =====================================================

const CHAT_UPSTREAM_URL =
  process.env.CHAT_UPSTREAM_URL ||
  "https://cj2api.keh5.workers.dev/v1/chat/completions";

const CHAT_UPSTREAM_MODEL = "llama3.1-8B";

// =====================================================
// IMAGE UPSTREAM
// =====================================================

const IMAGE_UPSTREAM_URL =
  process.env.IMAGE_UPSTREAM_URL ||
  "https://image.pollinations.ai";

// =====================================================
// EXPRESS
// =====================================================

app.disable("x-powered-by");

app.use(
  express.json({
    limit: "50mb"
  })
);

// =====================================================
// CORS
// =====================================================

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

// =====================================================
// ERROR
// =====================================================

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

// =====================================================
// PUBLIC MODEL OBJECT
// =====================================================

function publicModel() {
  return {
    id: PUBLIC_MODEL,
    object: "model",
    created: Math.floor(
      Date.now() / 1000
    ),
    owned_by: "plame"
  };
}

// =====================================================
// HOME
// =====================================================

app.get("/", (req, res) => {
  res.json({
    name: "PLAME 1.0",
    id: PUBLIC_MODEL,

    model: PUBLIC_MODEL,

    chat: {
      model: CHAT_UPSTREAM_MODEL,
      endpoint:
        "/v1/chat/completions"
    },

    image: {
      endpoint:
        "/v1/images/generations",
      upstream:
        IMAGE_UPSTREAM_URL
    },

    endpoints: {
      models: "/v1/models",
      chat: "/v1/chat/completions",
      images: "/v1/images/generations",
      health: "/health"
    }
  });
});

// =====================================================
// HEALTH
// =====================================================

app.get("/health", (req, res) => {
  res.json({
    status: "ok",

    model: PUBLIC_MODEL,

    chat: {
      enabled: true,
      upstream_model: CHAT_UPSTREAM_MODEL
    },

    image_generation: {
      enabled: true,
      upstream: IMAGE_UPSTREAM_URL
    }
  });
});

// =====================================================
// MODELS
//
// EXACTLY ONE PUBLIC MODEL
// =====================================================

app.get("/v1/models", (req, res) => {
  res.json({
    object: "list",

    data: [
      publicModel()
    ]
  });
});

// =====================================================
// CHAT HEADERS
// =====================================================

function createChatHeaders(req) {
  const headers = {
    "Content-Type": "application/json"
  };

  const incomingAuth =
    req.get("authorization");

  if (incomingAuth) {
    headers.Authorization =
      incomingAuth;
  }

  if (process.env.CHAT_UPSTREAM_API_KEY) {
    headers.Authorization =
      "Bearer " +
      process.env.CHAT_UPSTREAM_API_KEY;
  }

  return headers;
}

// =====================================================
// CHAT
//
// pipo/plame-1.0
//        -> llama3.1-8B
//
// Vision content is forwarded unchanged.
// =====================================================

app.post(
  "/v1/chat/completions",
  async (req, res) => {
    try {
      const body = req.body || {};

      if (!Array.isArray(body.messages)) {
        return apiError(
          res,
          400,
          "messages must be an array"
        );
      }

      // Do not allow another public model ID.
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

      /*
       * IMPORTANT:
       *
       * The whole request is preserved.
       *
       * This includes:
       * - messages
       * - text
       * - image_url
       * - base64 image data
       * - temperature
       * - top_p
       * - max_tokens
       * - stream
       * - tools
       * - tool_choice
       * - response_format
       *
       * Only the model field changes.
       */

      const upstreamBody = {
        ...body,

        model:
          CHAT_UPSTREAM_MODEL
      };

      const upstreamResponse =
        await fetch(
          CHAT_UPSTREAM_URL,
          {
            method: "POST",

            headers:
              createChatHeaders(req),

            body:
              JSON.stringify(
                upstreamBody
              )
          }
        );

      const contentType =
        upstreamResponse.headers.get(
          "content-type"
        ) || "";

      // -------------------------------------------------
      // UPSTREAM ERROR
      // -------------------------------------------------

      if (!upstreamResponse.ok) {
        const text =
          await upstreamResponse.text();

        res.status(
          upstreamResponse.status
        );

        res.setHeader(
          "Content-Type",
          contentType ||
            "application/json"
        );

        return res.send(text);
      }

      // -------------------------------------------------
      // STREAM
      // -------------------------------------------------

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

      // -------------------------------------------------
      // NORMAL JSON
      // -------------------------------------------------

      const text =
        await upstreamResponse.text();

      try {
        const data =
          JSON.parse(text);

        // Expose only PLAME model ID.
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
          .send(text);
      }

    } catch (error) {
      console.error(
        "Chat proxy error:",
        error
      );

      return apiError(
        res,
        502,
        error.message ||
          "Chat upstream failed",
        "upstream_error"
      );
    }
  }
);

// =====================================================
// IMAGE GENERATION
//
// POST /v1/images/generations
//
// Example:
// {
//   "prompt": "a cat in space",
//   "size": "1024x1024"
// }
//
// The proxy calls:
// https://image.pollinations.ai/prompt/{prompt}
//
// No additional PLAME model is exposed.
// =====================================================

app.post(
  "/v1/images/generations",
  async (req, res) => {
    try {
      const body = req.body || {};

      if (
        !body.prompt ||
        typeof body.prompt !== "string"
      ) {
        return apiError(
          res,
          400,
          "prompt must be a non-empty string"
        );
      }

      // -----------------------------------------------
      // SIZE
      // -----------------------------------------------

      let width = 1024;
      let height = 1024;

      if (
        typeof body.size === "string" &&
        /^\d+x\d+$/.test(body.size)
      ) {
        const parts =
          body.size.split("x");

        width =
          Math.max(
            1,
            Math.min(
              2048,
              Number(parts[0])
            )
          );

        height =
          Math.max(
            1,
            Math.min(
              2048,
              Number(parts[1])
            )
          );
      }

      // -----------------------------------------------
      // QUERY PARAMETERS
      // -----------------------------------------------

      const params =
        new URLSearchParams();

      params.set(
        "width",
        String(width)
      );

      params.set(
        "height",
        String(height)
      );

      // Optional seed
      if (
        body.seed !== undefined &&
        body.seed !== null
      ) {
        params.set(
          "seed",
          String(body.seed)
        );
      }

      // Optional enhance
      if (
        body.enhance !== undefined
      ) {
        params.set(
          "enhance",
          String(
            Boolean(body.enhance)
          )
        );
      }

      // Optional safe
      if (
        body.safe !== undefined
      ) {
        params.set(
          "safe",
          String(
            Boolean(body.safe)
          )
        );
      }

      // Optional nologo
      if (
        body.nologo !== undefined
      ) {
        params.set(
          "nologo",
          String(
            Boolean(body.nologo)
          )
        );
      }

      /*
       * We intentionally do NOT expose a second
       * PLAME model through /v1/models.
       *
       * The image endpoint simply forwards the
       * prompt to Pollinations.
       */

      const prompt =
        encodeURIComponent(
          body.prompt
        );

      const imageUrl =
        IMAGE_UPSTREAM_URL +
        "/prompt/" +
        prompt +
        "?" +
        params.toString();

      // -----------------------------------------------
      // OPTIONAL POLLINATIONS API KEY
      // -----------------------------------------------

      const imageHeaders = {};

      if (
        process.env.POLLINATIONS_API_KEY
      ) {
        imageHeaders.Authorization =
          "Bearer " +
          process.env.POLLINATIONS_API_KEY;
      }

      console.log(
        "Generating image through Pollinations"
      );

      const imageResponse =
        await fetch(
          imageUrl,
          {
            method: "GET",
            headers: imageHeaders
          }
        );

      if (!imageResponse.ok) {
        const errorText =
          await imageResponse.text();

        return res
          .status(
            imageResponse.status
          )
          .json({
            error: {
              message:
                errorText ||
                "Image generation failed",
              type:
                "image_generation_error"
            }
          });
      }

      /*
       * Instead of downloading the image into Render,
       * return the Pollinations URL.
       */

      return res.json({
        created: Math.floor(
          Date.now() / 1000
        ),

        data: [
          {
            url: imageUrl
          }
        ]
      });

    } catch (error) {
      console.error(
        "Image proxy error:",
        error
      );

      return apiError(
        res,
        502,
        error.message ||
          "Image generation failed",
        "image_generation_error"
      );
    }
  }
);

// =====================================================
// START
// =====================================================

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
      "Chat upstream: " +
        CHAT_UPSTREAM_URL
    );

    console.log(
      "Chat model: " +
        CHAT_UPSTREAM_MODEL
    );

    console.log(
      "Image upstream: " +
        IMAGE_UPSTREAM_URL
    );

    console.log(
      "Local model: NONE"
    );

    console.log(
      "================================"
    );
  }
);
