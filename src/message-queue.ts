import Joi from "@hapi/joi"
import amqplib from "amqplib"
import config from "./config"
import { v4 as uuidv4 } from 'uuid'

let establishedConn: amqplib.Connection
let establishedCh: amqplib.ConfirmChannel
let shouldReconnect = true
let reconnectTimer: NodeJS.Timeout

const timeoutReferences: { [key: string]: NodeJS.Timeout } = {}

// message schema
const schema = Joi.object({
    expireAt: Joi.date().timestamp("unix").required(), // for unix timestamp (seconds)
    replyQueueName: Joi.string().required(),
    payload: Joi.string().required(),
})

const connectToMq = (): Promise<amqplib.Connection> => new Promise((resolve, reject) => {
    amqplib.connect(`${config.AMQP_CONNECTION_STRING}?heartbeat=45`).then(async (connection) => { // heartbeat every 45 seconds
        establishedConn = connection

        const ch = await connection.createConfirmChannel()
        await ch.assertQueue(config.DELAY_QUEUE_NAME)
        establishedCh = ch

        connection.on("error", (err) => {
            if (err.message !== "Connection closing") {
                console.error("[AMQP] conn error %s", err.message)
            }
        })

        connection.on("close", () => {
            if (!shouldReconnect) {
                return
            }
            // if connection is restored after disconnection, all the messages that had been fetched by this consumer but not acked yet will be resent
            // clear the timers that had been set before because those messages will be sent again, so that we avoid duplicate processing
            Object.keys(timeoutReferences).forEach((ref) => clearTimeout(timeoutReferences[ref]))
            console.log("Cleared all timers because of disconnection")

            console.warn("[AMQP] reconnecting")
            const min = 1
            const rand = Math.floor((Math.random() * 10) + min) // Generate Random number between 1 - 10
            reconnectTimer = setTimeout(connectToMq, rand * 1000)
        })

        console.log("[AMQP] Connected to rabbitmq")

        await setUpConsumer(ch)
        return resolve(connection)
    }).catch((err) => {
        console.error("[AMQP] Failed to connect to rabbitmq %s", err.message)
        const min = 1
        const rand = Math.floor((Math.random() * 10) + min) // Generate Random number between 1 - 10
        if (shouldReconnect) {
            reconnectTimer = setTimeout(connectToMq, rand * 1000)
        }
    })
})

connectToMq()

function getUniqueKey(): string {
    let key = uuidv4()
    if (!timeoutReferences[key]) {
        return key
    }
    return getUniqueKey()
}

const setUpConsumer = async (ch: amqplib.ConfirmChannel) => {
    await ch.assertQueue(config.DELAY_QUEUE_NAME)
    // ch.prefetch(5, true)
    console.log("Consuming %s queue", config.DELAY_QUEUE_NAME)
    return ch.consume(config.DELAY_QUEUE_NAME, (msg) => queueConsumer(ch, msg), { consumerTag: "consumer" })
}

const queueConsumer = async (ch: amqplib.Channel, msg: amqplib.ConsumeMessage | null) => {
    if (msg === null) {
        return
    }
    let jsonMessage: { expireAt: number, replyQueueName: string, payload: string }
    console.debug("Received message")
    try {
        jsonMessage = JSON.parse(msg.content.toString())
    } catch (error) {
        console.debug("Failed to JSON parse message %s", msg.content)
        ch.nack(msg, undefined, false)
        return
    }

    const validation = schema.validate(jsonMessage)
    if (validation.error) {
        console.debug("Message validation failed", validation.error)
        return ch.nack(msg, undefined, false)
    }

    const expirationTime = (new Date(jsonMessage.expireAt * 1000)).getTime() // unix timestamp does not have microseconds, javascript has them
    const currentTime = (new Date()).getTime()
    const timeLeftForExpiration = expirationTime - currentTime

    if (timeLeftForExpiration <= 0) {
        console.debug("Time %s already passed. Sending message to %s", (new Date(jsonMessage.expireAt * 1000)).toLocaleString(), jsonMessage.replyQueueName)
        await ch.sendToQueue(jsonMessage.replyQueueName, Buffer.from(jsonMessage.payload), { persistent: true })
        ch.ack(msg)
        console.log("Sent")
        return
    }

    console.debug("Setting timer for %s ms to expire at %s with data: %s", timeLeftForExpiration, (new Date(jsonMessage.expireAt * 1000)), JSON.stringify(jsonMessage))
    const key = getUniqueKey()
    const timeoutRef = setTimeout(async () => {
        console.log("Message delay expired. Sending message to %s with data: %s", jsonMessage.replyQueueName, JSON.stringify(jsonMessage))
        await ch.sendToQueue(jsonMessage.replyQueueName, Buffer.from(jsonMessage.payload), { persistent: true })
        console.log("Sent")
        ch.ack(msg)
        delete timeoutReferences[key]
    }, timeLeftForExpiration)
    timeoutReferences[key] = timeoutRef
}

process.once("SIGINT", async () => {
    shouldReconnect = false
    if (!establishedConn) {
        return
    }
    try {
        await establishedCh.cancel("consumer")
        clearTimeout(reconnectTimer)
        Object.keys(timeoutReferences).forEach((key) => clearTimeout(timeoutReferences[key]))
        setTimeout(() => establishedConn.close(), 10000) // close connection with delay to allow draining time for any ongoing operation
    } catch (error) {
        console.error("Error in closing channel", error)
        process.exit(-1)
    }
})
