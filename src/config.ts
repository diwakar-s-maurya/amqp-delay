export default {
    AMQP_CONNECTION_STRING: process.env.AMQP_CONNECTION_STRING || "amqp://user:password@localhost",
    DELAY_QUEUE_NAME: process.env.DELAY_QUEUE_NAME || "delay-queue",
    HEALTH_CHECK_HTTP_PORT: process.env.HEALTH_CHECK_HTTP_PORT || "3001",
}
