import { existsSync } from "node:fs"

// Load .env into process.env before the values below are read. This lives here rather than in
// index.ts because ESM hoists imports above statements, so a loader call there would run too late.
// Unlike dotenv, the built-in throws when the file is absent, hence the existsSync guard.
if (existsSync(".env")) {
    process.loadEnvFile()
}

export default {
    AMQP_CONNECTION_STRING: process.env.AMQP_CONNECTION_STRING || "amqp://user:password@localhost",
    DELAY_QUEUE_NAME: process.env.DELAY_QUEUE_NAME || "delay-queue",
    HEALTH_CHECK_HTTP_PORT: process.env.HEALTH_CHECK_HTTP_PORT || "3001",
}
