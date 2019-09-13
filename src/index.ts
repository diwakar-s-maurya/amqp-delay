import dotenv from "dotenv"
dotenv.config()
import bodyParser from "body-parser"
import express, { Request, Response } from "express"
import helmet from "helmet"
import "././message-queue"

const app = express()

// parse application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({ extended: true }))
app.use(bodyParser.text())

// parse application/json
app.use(bodyParser.json())

app.use(helmet()) // set well-known security-related HTTP headers
app.disable("x-powered-by")

app.get("/health", (req: Request, res: Response) => res.sendStatus(200))

app.listen(process.env.PORT || 3000, () => console.log("Starting server on Port 3000"))
