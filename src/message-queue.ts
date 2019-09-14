import Joi from "@hapi/joi"
import amqplib from "amqplib"
import config from "./config"
const connection = amqplib.connect(config.AMQP_CONNECTION_STRING)

let channel: amqplib.Channel
let conn: amqplib.Connection
const timeoutRefernces: NodeJS.Timeout[] = []

// message schema
const schema = Joi.object({
    expireAt: Joi.date().timestamp("unix").required(), // for unix timestamp (seconds)
    replyQueueName: Joi.string().required(),
    payload: Joi.string().required(),
})

// Consumer
connection.then((establishedConn) => {
    conn = establishedConn
    return conn.createChannel()
}).then((ch) => {
    channel = ch
    return ch.assertQueue(config.DELAY_QUEUE_NAME).then(() => {
        return ch.consume(config.DELAY_QUEUE_NAME, async (msg) => {
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

            console.debug("Setting timer for %s to expire at %s", timeLeftForExpiration, (new Date(jsonMessage.expireAt * 1000)))
            timeoutRefernces.concat(setTimeout(async () => {
                console.log("Message delay expired. Sending message to %s", jsonMessage.replyQueueName)
                await ch.sendToQueue(jsonMessage.replyQueueName, Buffer.from(jsonMessage.payload))
                console.log("Sent")
                ch.ack(msg)
            }, timeLeftForExpiration))
        }, { consumerTag: "delay-consumer" })
    })
}).catch(console.warn)

export { conn, channel }

process.once("SIGINT", async () => {
    if (!conn) {
        return
    }
    try {
        await channel.cancel("delay-consumer")
        timeoutRefernces.forEach((ref) => clearTimeout(ref))
        conn.close.bind(conn)
    } catch (error) {
        console.error("Error in closing channel", error)
        process.exit(-1)
    }
})
