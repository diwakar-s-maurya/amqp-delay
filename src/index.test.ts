import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import amqplib from "amqplib"
import config from "./config"
// importing the module starts the consumer against AMQP_CONNECTION_STRING
import { shutdown } from "./message-queue"

const DELAY_SECONDS = 3

describe("Test reception", () => {
    let channel: amqplib.Channel
    let establishedConnection: amqplib.ChannelModel

    before(async () => {
        establishedConnection = await amqplib.connect(config.AMQP_CONNECTION_STRING)
        channel = await establishedConnection.createChannel()
    })

    // Publish to the delay queue and resolve with the payload once it comes back, plus how long that took.
    // Each call uses its own reply queue so tests never consume each other's messages.
    const roundTrip = async (expireAt: number) => {
        const replyQueueName = `test-reply-${randomUUID()}`
        const payload = `Hello at ${expireAt}`
        await channel.assertQueue(replyQueueName, { autoDelete: true })

        const sentAt = Date.now()
        await channel.sendToQueue(config.DELAY_QUEUE_NAME, Buffer.from(JSON.stringify({ expireAt, replyQueueName, payload })), {
            persistent: true,
        })

        return new Promise<{ body: string; heldForSeconds: number; payload: string }>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`No message arrived on ${replyQueueName}`)), 30000)
            channel
                .consume(replyQueueName, (msg) => {
                    if (!msg) {
                        return
                    }
                    channel.ack(msg)
                    clearTimeout(timer)
                    resolve({ body: msg.content.toString(), heldForSeconds: (Date.now() - sentAt) / 1000, payload })
                })
                .catch(reject)
        })
    }

    it("Should receive message after some delay", async () => {
        const expireAt = Math.floor(Date.now() / 1000) + DELAY_SECONDS
        const { body, heldForSeconds, payload } = await roundTrip(expireAt)

        assert.equal(body, payload)
        // expireAt is floored to whole seconds, so allow up to 1s of lost precision
        assert.ok(heldForSeconds >= DELAY_SECONDS - 1.1, `message came back after ${heldForSeconds}s, expected it to be held ~${DELAY_SECONDS}s`)
    })

    it("Should deliver a message whose delay has already passed immediately", async () => {
        const expireAt = Math.floor(Date.now() / 1000) - 60 // expired a minute ago
        const { body, heldForSeconds, payload } = await roundTrip(expireAt)

        assert.equal(body, payload)
        assert.ok(heldForSeconds < 2, `past-due message took ${heldForSeconds}s, expected near-immediate delivery`)
    })

    it("Should not deliver a message with an out-of-range expireAt", async () => {
        const replyQueueName = `test-reply-${randomUUID()}`
        await channel.assertQueue(replyQueueName, { autoDelete: true })

        let delivered = false
        await channel.consume(replyQueueName, (msg) => {
            if (!msg) {
                return
            }
            channel.ack(msg)
            delivered = true
        })

        // Beyond the range JS Date can represent. The schema rejects this today; the NaN guard in
        // queueConsumer is the backstop if the schema is ever loosened, since a NaN delay would
        // otherwise reach setTimeout and fire immediately instead of being held.
        const expireAt = 8640000000000000
        await channel.sendToQueue(
            config.DELAY_QUEUE_NAME,
            Buffer.from(JSON.stringify({ expireAt, replyQueueName, payload: "should never arrive" })),
            { persistent: true },
        )

        await new Promise((resolve) => setTimeout(resolve, 2000))
        assert.equal(delivered, false, "message with an out-of-range expireAt should be rejected, not delivered")
    })

    after(async () => {
        await shutdown(0)
        await channel.close()
        await establishedConnection.close()
    })
})
