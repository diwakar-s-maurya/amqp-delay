import Joi from "@hapi/joi"
import amqplib from "amqplib"
import config from "./config"

let establishedConn: amqplib.Connection
let establishedCh: amqplib.ConfirmChannel
let shouldReconnect = true
let reconnectTimer: NodeJS.Timeout

const timeoutRefernces: NodeJS.Timeout[] = []

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
            timeoutRefernces.forEach((ref) => clearTimeout(ref))
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

const setUpConsumer = async (ch: amqplib.ConfirmChannel) => {
    await ch.assertQueue(config.DELAY_QUEUE_NAME)
    ch.prefetch(5, true)
    console.log("Consuming %s queue", config.DELAY_QUEUE_NAME)
    return ch.consume(config.DELAY_QUEUE_NAME, (msg) => queueConsumer(ch, msg), { consumerTag: "consumer" })
}

const queueConsumer = async (ch: amqplib.Channel, msg: amqplib.ConsumeMessage | null) => {
    if (msg === null) {
        return
    }
    let jsonMessage: {expireAt: number, replyQueueName: string, payload: string}
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
        console.debug("Time already passed. Sending message to %s", jsonMessage.replyQueueName)
        await ch.sendToQueue(jsonMessage.replyQueueName, Buffer.from(jsonMessage.payload))
        ch.ack(msg)
        console.log("Sent")
        return
    }

    console.debug("Setting timer for %sms to expire at %s", timeLeftForExpiration, (new Date(jsonMessage.expireAt * 1000)))
    timeoutRefernces.concat(setTimeout(async () => {
        console.log("Message delay expired. Sending message to %s", jsonMessage.replyQueueName)
        await ch.sendToQueue(jsonMessage.replyQueueName, Buffer.from(jsonMessage.payload))
        console.log("Sent")
        ch.ack(msg)
    }, timeLeftForExpiration))
}

process.once("SIGINT", async () => {
    shouldReconnect = false
    if (!establishedConn) {
        return
    }
    try {
        await establishedCh.cancel("consumer")
        clearTimeout(reconnectTimer)
        timeoutRefernces.forEach((ref) => clearTimeout(ref))
        establishedConn.close() // .bind(establishedConn)
    } catch (error) {
        console.error("Error in closing channel", error)
        process.exit(-1)
    }
})
