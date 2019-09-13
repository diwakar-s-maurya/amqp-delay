export default {
    AMQP_CONNECTION_STRING: "amqp://user:password@localhost",
    DELAY_QUEUE_NAME: process.env.DELAY_QUEUE_NAME || "delay-queue",
}
