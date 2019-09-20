import amqplib from "amqplib"
import config from "./config"
const connection = amqplib.connect(config.AMQP_CONNECTION_STRING)

describe("Test reception", () => {

    let channel: amqplib.Channel
    let establishedConnection: amqplib.Connection
    before(async () => {
        establishedConnection = await connection
        channel = await establishedConnection.createChannel()
    })

    it("Should receive message after some delay", async () => {
        try {
            await channel.assertQueue(config.DELAY_QUEUE_NAME)
            const expireAt = new Date()
            expireAt.setSeconds(expireAt.getSeconds() + 100)
            const message = {
                expireAt: expireAt.getTime() / 1000, // needs unix timestamp
                replyQueueName: "my-application",
                payload: "Hello at " + expireAt,
            }
            await channel.sendToQueue(config.DELAY_QUEUE_NAME, Buffer.from(JSON.stringify(message)), {persistent: true})
        } catch (error) {
            throw error
        }
    })

    after(async () => {
        await channel.close()
        await establishedConnection.close.bind(establishedConnection)
    })
})
