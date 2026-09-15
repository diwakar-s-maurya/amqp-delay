import express, { type Request, type Response } from "express"
import helmet from "helmet"
import "././message-queue"
import config from "./config"

const app = express()

// parse application/x-www-form-urlencoded
app.use(express.urlencoded({ extended: true }))
app.use(express.text())

// parse application/json
app.use(express.json())

app.use(helmet()) // set well-known security-related HTTP headers
app.disable("x-powered-by")

app.get("/health", (_req: Request, res: Response) => res.sendStatus(200))

if (config.HEALTH_CHECK_HTTP_PORT) {
    app.listen(config.HEALTH_CHECK_HTTP_PORT, () => console.log(`Starting health check server on Port ${config.HEALTH_CHECK_HTTP_PORT}`))
}
